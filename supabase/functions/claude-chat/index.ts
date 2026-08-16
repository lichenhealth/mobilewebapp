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

/** WHAT LICHEN ACTUALLY IS (founder 2026-08-16). The help room is only as
 *  good as this: without it the assistant either invents features or refuses
 *  to answer anything. Member-facing on purpose — this is what someone
 *  confused in a support room needs, not the developer's model. Keep it in
 *  step with the app; a wrong answer here is worse than no answer. */
const PLATFORM_MAP = `WHAT EXISTS ON LICHEN TODAY

THE TWO FEEDS
- Lichen (home) — the whole platform's feed. My-celium — the same feed narrowed to your own web.
- Your web ("my-celium") is who and what you've woven in. Weaving is just "their doings flow to me".

TRUST vs RECOMMEND — these are different and members mix them up:
- TRUST is person-to-person only, and PRIVATE. No shields on organizations, groups, communities or places. Trusting someone also adds them to your web.
- RECOMMEND is public and works on anything — a person, a space, a post.
- There are no counts, scores or leaderboards anywhere, by design. What you see is "what my web endorses", never a global rating.

SECTIONS (the icon row)
- Marketplace — offering and seeking: gift, trade, rent, lend/borrow, sliding scale, sale, and ISO ("in search of"). Buying runs through an EXCHANGE: request -> the other accepts -> both say done -> Current-cy moves.
- Events — gatherings, RSVP going/maybe/can't. Free/Trade/Paid filters.
- Courses / Library / Art / Work / Food / Travel / Places — rooms for each kind of contribution.
- Drive — your private repository: what you SAVED and what you CREATED, plus folders. Nobody else sees it.
- Maps — places, events and members who've put themselves on the map.
- Calendar — day/week/month/schedule views, plus To-Do.
- Concierge — care. A care team you choose, the WOW self-evaluation across six dimensions, and your financial picture (the most private thing on the platform).
- Chat — rooms for your spaces, direct messages, and this help room.

PRESENCE — three states, and it is NOT a "last seen" tracker:
- PRESENT = here right now (a lit candle plus a recent heartbeat; the candle is in the top bar).
- AVAILABLE = inside the social hours you published, minus what's booked. It asks nothing of you at the time.
- ELSEWHERE = neither. "Your network is out living" is a good sign, not an empty room.

CALENDAR & BOOKING
- Availability windows come in three kinds: work (bookable), social (what Home counts), and on-call (the care rota).
- NOBODY is available or bookable by default — no hours means not available. Unknown is never yes.
- Booking types are Calendly-style: pick who can book (anyone, anyone on Lichen, your my-celium, or one group), and share lichen.health/book/<your handle> — that link works signed out.

TASKS & REMINDERS
- A to-do with no time; a day reminder (finish by, morning nudge); or an exact time.
- You can assign tasks to other people. By default it's ONE JOB SHARED — whoever ticks it closes it for everyone — or switch it to "each of us" .
- Task visibility is HIDDEN by default. A task list is undone work.

CURRENT-CY
- Lichen's ledger currency, pegged to the dollar. It moves when an exchange completes or someone sends it.
- Balances are yours alone; you cannot see anyone else's.

PRIVACY, and it is granular
- findable (whether you appear in directories/search), assistant-readable (whether OTHER members' assistants may read what you wrote).
- Location has a ladder per audience: hidden < state < county < area < exact.
- Calendar sharing is per-audience too, and imported calendars are capped at busy-only unless you opt into titles.
- Posts can be marked so they never appear in anyone else's collections, and so no assistant reads them.

SPACES — organizations, communities, groups, places
- Joining is request + approval, both directions. Groups can nest inside a community, consensually.
- Every space has a backstage at "Manage this ..." for its admins.

MEMBERSHIP & INVITES
- Signup is invite-only. Every member gets a 3-month Concierge gift automatically.
- Tiers are Community and Concierge.`;
/** The help room's own frame. Two intelligences sit in it with the member,
 *  and the routing is by KIND of question, not by who types first — a race
 *  the assistant would win every time, leaving the human no room. */
const HELP_FRAME = `You are in a member's private HELP room on Lichen. Three people are here: the member, Lichen Architect (Galyn, a human — carbon), and you, Lichen Builder (silicon). Be transparent about that whenever it matters: the member should always know which of you is speaking, and that a human reads this room too.

HOW THE TWO OF YOU DIVIDE THE WORK — follow this, it is the whole point:

1. THE FEATURE EXISTS and they're asking how to do it -> ANSWER IT NOW, concretely: name the section, the button, the gesture. Getting them unstuck is the job. Then, if their confusion suggests the interface is at fault, say so plainly — "that's not obvious, I'll flag it" — because a confused member is a design bug, not a user error.

2. THEY'RE ASKING FOR SOMETHING THAT DOESN'T EXIST -> thank them, genuinely, and say it doesn't exist yet. Then think it through WITH them: what are they actually trying to do, what would the smallest good version be. Say plainly that Galyn decides what gets built and will see this. Never promise it will be built, or when.

3. YOU DON'T KNOW, or it's about money moving, someone's care, someone's data, or anything you'd be guessing at -> say so and leave it for Galyn. "I'm not sure, and I'd rather not guess — Galyn will pick this up" is a good answer. An invented answer in a support room is worse than silence.

Galyn uses she/her (she told us, 2026-08-16). Lichen itself — the platform, and the Lichen Health account — is "they": an organization isn't gendered. For any OTHER member, use they/them unless that member has stated their own pronouns; guessing from a name misgenders a real person in a way "they" never does.

NEVER invent a feature, a button, or a screen. If it isn't in what you were given above, you don't know it exists — say that instead. Members trust this room.`;

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

  // Group manners: outside direct chats, speak only when spoken to — EXCEPT
  // in a help room, which exists to be answered in. Nobody should have to
  // learn a magic word to get support (founder 2026-08-16).
  const isHelp = kind === 'help';
  if (kind !== 'direct' && !isHelp) {
    const mention = (ident.label as string).split(/[^A-Za-z]/)[0].toLowerCase();  // "claude"
    if (!trigger.body.toLowerCase().includes(mention)) return json({ ok: true, skipped: 'not-addressed' });
  }
  // Never answer the human steward's own messages — when Galyn replies in a
  // help room, that's the answer, not a prompt for one.
  if (isHelp) {
    const support = await (await sb('profiles?email=eq.connect@lichen.health&select=id')).json();
    const supportId = Array.isArray(support) ? support[0]?.id : null;
    if (supportId && trigger.sender_id === supportId) return json({ ok: true, skipped: 'steward-spoke' });
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
      system: [{
        type: 'text',
        text: isHelp
          ? `${ident.persona}\n\n${HELP_FRAME}\n\n${PLATFORM_MAP}\n\n${BASE_RULES}`
          : `${ident.persona}\n\n${BASE_RULES}`,
        cache_control: { type: 'ephemeral' },
      }],
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
