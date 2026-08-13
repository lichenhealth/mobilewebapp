// Supabase Edge Function: assistant-feed
//
// The assistant's voice in a member's Claude feed (supersedes claude-chat for
// this relationship — claude-chat/assistant_on_message stay running untouched
// for any pre-existing chat thread, this is a new parallel surface). Invoked
// by the assistant_on_feed_post trigger (pg_net + Vault, the push pattern)
// whenever a member posts into assistant_feed_posts. Always replies — this
// relationship is inherently 1:1, no "speak when spoken to" branch needed.
// When the triggering post references a shared platform post (source_post_id),
// that post's title/body is folded into the prompt so the reply is actually
// informed by what was shared, not just the member's added note.
//
// Per-member daily cap via assistant_queries (context 'feed') — its own
// budget, not shared with claude-chat's 'chat' context.
//
// Env: ANTHROPIC_API_KEY (set), PUSH_HOOK_SECRET, optional ASSISTANT_FEED_MODEL
// (default claude-sonnet-5) and ASSISTANT_FEED_CAP (default 20).

const ANTHROPIC_API_KEY = (Deno.env.get('ANTHROPIC_API_KEY') ?? '').replace(/[^\x21-\x7E]/g, '');
const WEBHOOK_SECRET = Deno.env.get('PUSH_HOOK_SECRET');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const MODEL = Deno.env.get('ASSISTANT_FEED_MODEL') ?? 'claude-sonnet-5';
const DAILY_CAP = Number(Deno.env.get('ASSISTANT_FEED_CAP') ?? '20');

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const sb = (path: string, init?: RequestInit) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY!}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

const BASE_RULES = `Ground rules, always:
- Reply in the language the member wrote in. Keep replies to a few warm sentences.
- You only see this one feed — never claim to know other members' private information.
- Don't invent platform features; if unsure how something works on Lichen, say so plainly.
- No medical, legal, or financial advice — warmly point to their care team, the Concierge tab, or a human.
- You are talking with a fellow Lichen member. Help, never sell.
- When a shared post is included below, actually respond to it — don't just acknowledge that something was shared.`;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!WEBHOOK_SECRET || req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) return json({ error: 'Unauthorized' }, 401);
  if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Not configured' }, 500);

  let body: { feed_post_id?: string; profile_id?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid body' }, 400); }
  const { feed_post_id, profile_id } = body;
  if (!feed_post_id || !profile_id) return json({ error: 'Missing fields' }, 400);

  // One assistant identity exists today (Claude) — no per-entity fabric yet.
  const idents = await (await sb(`assistant_identities?active=eq.true&select=profile_id,label,persona&limit=1`)).json();
  const ident = Array.isArray(idents) ? idents[0] : null;
  if (!ident) return json({ ok: true, skipped: 'no-identity' });

  const posts = await (await sb(`assistant_feed_posts?id=eq.${feed_post_id}&select=body,source_post_id,thread`)).json();
  const trigger = Array.isArray(posts) ? posts[0] : null;
  if (!trigger?.body?.trim()) return json({ ok: true, skipped: 'empty-post' });

  // Per-member daily cap (spend control; logged in the UVA seed ledger).
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const capRes = await sb(`assistant_queries?profile_id=eq.${profile_id}&context=eq.feed&created_at=gte.${since.toISOString()}&select=id`, { headers: { Prefer: 'count=exact' } });
  const used = Number(capRes.headers.get('content-range')?.split('/')[1] ?? '0');
  if (used >= DAILY_CAP) {
    await sb('assistant_feed_posts', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
      profile_id, author: 'claude', thread: trigger.thread ?? 'general',
      body: 'I’ve reached today’s limit with you — a small guardrail while the mycelium is young. Let’s pick this up tomorrow. 🌱',
    }) });
    return json({ ok: true, skipped: 'cap' });
  }

  // A shared post, if this entry came from "Share to Claude" — fold its
  // actual content in, not just the member's note about it.
  let sharedPostContext = '';
  if (trigger.source_post_id) {
    const shared = await (await sb(`posts?id=eq.${trigger.source_post_id}&select=title,body`)).json();
    const sp = Array.isArray(shared) ? shared[0] : null;
    if (sp) sharedPostContext = `\n\n[The member shared this post: "${sp.title ?? ''}" — ${sp.body ?? ''}]`;
  }

  // THREADS (founder 2026-08-11): the assistant keeps a thread per section, so
  // this reply reads THIS thread's history — marketplace work doesn't wander
  // into a care conversation. General is the exception: it's the thread for
  // whatever isn't one subject, so it gets a short glance at the others.
  const thread = trigger.thread ?? 'general';
  const feed = await (await sb(`assistant_feed_posts?profile_id=eq.${profile_id}&thread=eq.${thread}&select=id,author,body,source_post_id&order=created_at.desc&limit=20`)).json();
  const rows = (Array.isArray(feed) ? feed : []).reverse().filter((p: { body?: string }) => p.body?.trim());

  let elsewhere = '';
  if (thread === 'general') {
    const others = await (await sb(`assistant_feed_posts?profile_id=eq.${profile_id}&thread=neq.general&select=thread,body,created_at&order=created_at.desc&limit=12`)).json();
    const lines = (Array.isArray(others) ? others : [])
      .filter((p: { body?: string }) => p.body?.trim())
      .map((p: { thread: string; body: string }) => `[${p.thread}] ${p.body.slice(0, 180)}`);
    if (lines.length) {
      elsewhere = `\n\nFor context, recent work from their other threads (do not bring it up unless it's relevant to what they just asked):\n${lines.join('\n')}`;
    }
  }

  // WHERE THEY STAND (founder 2026-08-11): the thread is always the
  // MEMBER's, but what the assistant can usefully help with changes with
  // their role in each place. Galyn is a member of Melanie's Mentorship
  // Group and both member AND steward of WAG — so the assistant helps her
  // participate in the first and also run the second. This reads only her
  // OWN memberships; nobody else's standing is fetched.
  let standing = '';
  {
    const mem = await (await sb(
      `space_members?profile_id=eq.${profile_id}&select=role,duties,spaces(name,kind)&limit=60`,
    )).json();
    const rows = (Array.isArray(mem) ? mem : []) as {
      role: string; duties: string[] | null; spaces: { name: string; kind: string } | null;
    }[];
    const steward = rows.filter((r) => r.role === 'admin' || r.role === 'super_admin');
    const member = rows.filter((r) => r.role === 'member');
    const name = (r: typeof rows[number]) => {
      const s = r.spaces;
      if (!s) return null;
      // A duty-scoped admin stewards ONE part — say which, so the assistant
      // doesn't offer them doors they don't actually hold.
      const duties = Array.isArray(r.duties) && r.duties.length ? ` — ${r.duties.join(', ')} only` : '';
      return `${s.name} (${s.kind})${duties}`;
    };
    const stewardNames = steward.map(name).filter(Boolean);
    const memberNames = member.map(name).filter(Boolean);
    if (stewardNames.length || memberNames.length) {
      standing = '\n\nWhere this member stands today:'
        + (stewardNames.length
          ? `\n- They STEWARD (admin): ${stewardNames.join('; ')}. Here you can help both ways — running the place (approving who is waiting at the door, member roles, what is shared to the shelves, the public page, gatherings) AND taking part in it.`
          : '')
        + (memberNames.length
          ? `\n- They are a MEMBER of: ${memberNames.join('; ')}. Here you help them take part — finding what is happening, joining in, offering and asking. Do not offer to run these or suggest steward actions they cannot take; if they need something only a steward can do, say who to ask.`
          : '')
        + '\nNever assume a role they do not hold, and never describe another member\'s standing.';
    }
  }

  // Staying in the right thread is part of the job: if what they've asked
  // plainly belongs somewhere else, say so and point, rather than doing the
  // work in the wrong place (founder 2026-08-11).
  const threadRule = thread === 'general'
    ? '\n\nYou are in their GENERAL thread — anything goes here, and you may draw on their other threads when it helps.'
    : `\n\nYou are in their ${thread.toUpperCase()} thread, which keeps that work together. If what they have just asked clearly belongs to a different part of Lichen, answer briefly and say which thread it belongs in so it stays findable — one short sentence, never a lecture.`;

  const messages = rows.map((p: { id: string; author: string; body: string; source_post_id: string | null }) =>
    p.author === 'claude'
      ? { role: 'assistant', content: p.body }
      : { role: 'user', content: p.id === feed_post_id ? `${p.body}${sharedPostContext}` : p.body });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: [{ type: 'text', text: `${ident.persona}\n\n${BASE_RULES}${standing}${threadRule}${elsewhere}`, cache_control: { type: 'ephemeral' } }],
      messages,
    }),
  });
  if (!res.ok) return json({ error: 'Anthropic call failed', detail: (await res.text()).slice(0, 300) }, 502);
  const data = await res.json();
  const reply = (data?.content ?? []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('\n').trim();
  if (!reply) return json({ ok: true, skipped: 'empty-reply' });

  await sb('assistant_feed_posts', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
    profile_id, author: 'claude', body: reply, thread,
  }) });

  // UVA seed: record the silicon contribution with its exact cost.
  await sb('assistant_queries', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
    profile_id, context: 'feed', model: MODEL,
    input_tokens: data?.usage?.input_tokens ?? null, output_tokens: data?.usage?.output_tokens ?? null,
  }) });

  return json({ ok: true, replied: true });
});
