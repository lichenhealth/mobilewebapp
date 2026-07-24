// Supabase Edge Function: claude-chat
//
// The assistant's voice in chat. Invoked by the assistant_on_message trigger
// (pg_net + Vault, the push pattern) when a member messages a chat that an
// assistant identity belongs to. One brain, many identities: the trigger passes
// which assistant (assistant_identities row) should answer; this fn loads that
// identity's persona, reads the recent thread, asks the Anthropic API, and
// posts the reply AS that assistant. Per-member daily cap via assistant_queries
// (context 'chat') — the same UVA seed ledger the search assistant writes.
//
// Manners: direct chats always answer; group/space chats answer only when the
// assistant's name appears in the message (speak when spoken to).
//
// Env: ANTHROPIC_API_KEY (set), PUSH_HOOK_SECRET, optional ASSISTANT_CHAT_MODEL
// (default claude-sonnet-5 — founder-picked) and ASSISTANT_CHAT_CAP (default 20).

const ANTHROPIC_API_KEY = (Deno.env.get('ANTHROPIC_API_KEY') ?? '').replace(/[^\x21-\x7E]/g, '');
const WEBHOOK_SECRET = Deno.env.get('PUSH_HOOK_SECRET');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const MODEL = Deno.env.get('ASSISTANT_CHAT_MODEL') ?? 'claude-sonnet-5';
const DAILY_CAP = Number(Deno.env.get('ASSISTANT_CHAT_CAP') ?? '20');

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const sb = (path: string, init?: RequestInit) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY!}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

const BASE_RULES = `Ground rules, always:
- Reply in the language the member wrote in. Keep replies to a few warm sentences.
- You only see this one conversation — never claim to know other members' private information.
- Don't invent platform features; if unsure how something works on Lichen, say so plainly.
- No medical, legal, or financial advice — warmly point to their care team, the Concierge tab, or a human.
- You are talking with a fellow Lichen member. Help, never sell.`;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!WEBHOOK_SECRET || req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) return json({ error: 'Unauthorized' }, 401);
  if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Not configured' }, 500);

  let body: { chat_id?: string; message_id?: string; assistant_id?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid body' }, 400); }
  const { chat_id, message_id, assistant_id } = body;
  if (!chat_id || !message_id || !assistant_id) return json({ error: 'Missing fields' }, 400);

  // The identity that should answer.
  const idents = await (await sb(`assistant_identities?profile_id=eq.${assistant_id}&active=eq.true&select=profile_id,label,persona`)).json();
  const ident = Array.isArray(idents) ? idents[0] : null;
  if (!ident) return json({ ok: true, skipped: 'no-identity' });

  // The triggering message + the chat's kind.
  const msgs = await (await sb(`chat_messages?id=eq.${message_id}&select=sender_id,body`)).json();
  const trigger = Array.isArray(msgs) ? msgs[0] : null;
  if (!trigger?.body?.trim()) return json({ ok: true, skipped: 'empty-message' });
  const chats = await (await sb(`chats?id=eq.${chat_id}&select=kind`)).json();
  const kind = Array.isArray(chats) ? chats[0]?.kind : null;

  // Group manners: outside direct chats, speak only when spoken to.
  if (kind !== 'direct') {
    const mention = (ident.label as string).split(/[^A-Za-z]/)[0].toLowerCase();  // "claude"
    if (!trigger.body.toLowerCase().includes(mention)) return json({ ok: true, skipped: 'not-addressed' });
  }

  // Per-member daily cap (spend control; logged in the UVA seed ledger).
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const capRes = await sb(`assistant_queries?profile_id=eq.${trigger.sender_id}&context=eq.chat&created_at=gte.${since.toISOString()}&select=id`, { headers: { Prefer: 'count=exact' } });
  const used = Number(capRes.headers.get('content-range')?.split('/')[1] ?? '0');
  if (used >= DAILY_CAP) {
    await sb('chat_messages', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
      chat_id, sender_id: assistant_id,
      body: 'I’ve reached today’s conversation limit with you — a small guardrail while the mycelium is young. Let’s pick this up tomorrow. 🌱',
    }) });
    return json({ ok: true, skipped: 'cap' });
  }

  // The recent thread, oldest → newest, with sender names.
  const thread = await (await sb(`chat_messages?chat_id=eq.${chat_id}&select=sender_id,body,created_at&order=created_at.desc&limit=20`)).json();
  const rows = (Array.isArray(thread) ? thread : []).reverse().filter((m: { body?: string }) => m.body?.trim());
  const senderIds = [...new Set(rows.map((m: { sender_id: string }) => m.sender_id))];
  const profs = await (await sb(`profiles?id=in.(${senderIds.join(',')})&select=id,full_name`)).json();
  const nameOf: Record<string, string> = {};
  for (const p of (Array.isArray(profs) ? profs : [])) nameOf[p.id] = p.full_name || 'A member';

  const messages = rows.map((m: { sender_id: string; body: string }) =>
    m.sender_id === assistant_id
      ? { role: 'assistant', content: m.body }
      : { role: 'user', content: `${nameOf[m.sender_id] ?? 'A member'}: ${m.body}` });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: [{ type: 'text', text: `${ident.persona}\n\n${BASE_RULES}`, cache_control: { type: 'ephemeral' } }],
      messages,
    }),
  });
  if (!res.ok) return json({ error: 'Anthropic call failed', detail: (await res.text()).slice(0, 300) }, 502);
  const data = await res.json();
  const reply = (data?.content ?? []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('\n').trim();
  if (!reply) return json({ ok: true, skipped: 'empty-reply' });

  await sb('chat_messages', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
    chat_id, sender_id: assistant_id, body: reply,
  }) });

  // UVA seed: record the silicon contribution with its exact cost.
  await sb('assistant_queries', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
    profile_id: trigger.sender_id, context: 'chat', model: MODEL,
    input_tokens: data?.usage?.input_tokens ?? null, output_tokens: data?.usage?.output_tokens ?? null,
  }) });

  return json({ ok: true, replied: true });
});
