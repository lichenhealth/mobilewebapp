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

import { LICHEN_DOCTRINE } from '../_shared/doctrine.ts';
import { assistantConsentOff } from '../_shared/consent.ts';

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

/** LOOK, DON'T GUESS (founder 2026-08-16). The doctrine tells the assistant
 *  how Lichen works; these tell it how THIS member's Lichen is actually set
 *  up. "Why can't people book me?" has a real answer sitting in the database,
 *  and inferring it from a document is how you get a confident wrong answer.
 *
 *  ⚠ THE SAFETY RULE, same as the profile-editing tools: no tool takes a
 *  target. Every one is scoped server-side to the profile that sent the
 *  triggering message, so there is no argument a model could pass — or a
 *  member could talk it into passing — that would read someone else's data.
 *  Read-only throughout; nothing here writes. */
const LOOKUP_TOOLS = [
  {
    name: 'my_setup',
    description: "Read the ASKING member's own Lichen settings: handle, public page, findability, pronouns, timezone, membership, their availability hours by kind, and whether they have any bookable session types. Use this before answering 'why can't people find/book me' — the answer is usually a setting they haven't set.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'my_spaces',
    description: "List the spaces (organizations, communities, groups, places) the ASKING member belongs to, and whether they steward each one. Use it when they ask how to manage something, or which of their groups a feature applies to.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
];

/** Run a lookup for ONE profile — the sender of the triggering message. */
async function runLookup(
  name: string,
  who: string,
  sb: (path: string, init?: RequestInit) => Promise<Response>,
): Promise<Record<string, unknown>> {
  const one = async (path: string) => {
    const r = await sb(path);
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  };
  if (name === 'my_setup') {
    const [prof] = await one(`profiles?id=eq.${who}&select=handle,public_page,findable,pronouns,timezone,assistant_readable`);
    const hours = await one(`availability_windows?profile_id=eq.${who}&select=kind`);
    const types = await one(`booking_types?profile_id=eq.${who}&select=title,audience,active`);
    const [sub] = await one(`subscriptions?profile_id=eq.${who}&select=tier,status&order=current_period_end.desc&limit=1`);
    const byKind: Record<string, number> = {};
    for (const h of hours as { kind: string }[]) byKind[h.kind] = (byKind[h.kind] ?? 0) + 1;
    return {
      handle: (prof as { handle?: string })?.handle ?? null,
      public_page_on: (prof as { public_page?: boolean })?.public_page ?? false,
      findable: (prof as { findable?: boolean })?.findable ?? null,
      pronouns: (prof as { pronouns?: string })?.pronouns ?? null,
      timezone: (prof as { timezone?: string })?.timezone ?? null,
      assistant_readable: (prof as { assistant_readable?: boolean })?.assistant_readable ?? null,
      availability_windows_by_kind: Object.keys(byKind).length ? byKind : 'none set — so they are not bookable and not counted as available',
      booking_types: (types as { title: string; audience: string; active: boolean }[]).map((t) => `${t.title} (${t.audience}${t.active ? '' : ', inactive'})`),
      membership: sub ? `${(sub as { tier: string }).tier} (${(sub as { status: string }).status})` : 'none on file',
    };
  }
  if (name === 'my_spaces') {
    const rows = await one(`space_members?profile_id=eq.${who}&select=role,duties,spaces(name,kind,handle)`);
    return {
      spaces: (rows as { role: string; duties: string[] | null; spaces?: { name: string; kind: string } }[]).map((r) => ({
        name: r.spaces?.name, kind: r.spaces?.kind, your_role: r.role,
        stewards_it: r.role === 'admin' || r.role === 'super_admin',
        duties: r.duties ?? undefined,
      })),
    };
  }
  return { error: 'unknown lookup' };
}

/** The hand-typed PLATFORM_MAP that used to live here is gone (founder
 *  2026-08-16). It was a 900-token summary of a 26,000-token document and it
 *  had already drifted within hours of being written. Assistants now read the
 *  real docs via _shared/doctrine.ts, generated from CLAUDE.md — the one
 *  document that can't rot, because updating it is part of shipping. */
/** The help room's own frame. Two intelligences sit in it with the member,
 *  and the routing is by KIND of question, not by who types first — a race
 *  the assistant would win every time, leaving the human no room. */
const HELP_FRAME = `You are in a member's private HELP room on Lichen. Three parties are here:
- THE MEMBER who opened the room.
- LICHEN HEALTH — the support account, staffed by Galyn, a real human (she/her). Also called Lichen Architect, or "Oi" (organic intelligence, carbon, Ca). When someone asks whether "a real person" is here, the answer is yes: Lichen Health is a human, and you should say whether they are present and whether they've read the room.
- YOU — Lichen Builder, also called "Ai" (silicon, Si). You are not a person and never pretend to be.

Members may use any of those names. "Ai" means you; "Oi" means the human. Don't say you don't know what they mean. Be transparent about that whenever it matters: the member should always know which of you is speaking, and that a human reads this room too.

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
  // help room, that's the answer, not a prompt for one. Held at function
  // scope because the roster below needs it too, to say WHICH of the people
  // in the room is the human.
  let supportId: string | null = null;
  if (isHelp) {
    const support = await (await sb('profiles?email=eq.connect@lichen.health&select=id')).json();
    supportId = Array.isArray(support) ? support[0]?.id : null;
    if (supportId && trigger.sender_id === supportId) return json({ ok: true, skipped: 'steward-spoke' });
  }

  // PER-IDENTITY AI CONSENT (founder 2026-08-17): the sender's own door for
  // this kind of room. A member who switched the assistant off in chat asked
  // for exactly this silence — the same shape as not being addressed.
  if (await assistantConsentOff(trigger.sender_id, [{ type: 'section', id: isHelp ? 'help' : 'chat' }])) {
    return json({ ok: true, skipped: 'consent-off' });
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

  // WHO ELSE IS ACTUALLY HERE (founder 2026-08-16: asked in help whether Ai
  // and Oi were both in the room, and the assistant could confirm itself but
  // not the human). The facts already exist — chat_members.last_read_at is a
  // read receipt, and presence is the platform's own three states. Reading
  // them lets the room answer honestly instead of guessing, and lets it say
  // "they haven't seen this yet, but they've been notified" rather than
  // implying someone is listening when they aren't.
  let rosterNote = '';
  if (isHelp) {
    const roster = await (await sb(
      `chat_members?chat_id=eq.${chat_id}&select=profile_id,last_read_at,profiles(full_name,pronouns,last_seen_at,presence_always_present,presence_lit_until)`)).json();
    const newest = rows.length ? rows[rows.length - 1] : null;
    const lines = (Array.isArray(roster) ? roster : []).map((r: {
      profile_id: string; last_read_at: string | null;
      profiles?: { full_name?: string; pronouns?: string | null; last_seen_at?: string | null;
                   presence_always_present?: boolean; presence_lit_until?: string | null };
    }) => {
      const p = r.profiles ?? {};
      if (r.profile_id === assistant_id) return `- ${p.full_name ?? 'The assistant'} — YOU, the assistant (Ai). Always here.`;
      const role = r.profile_id === supportId
        ? 'LICHEN HEALTH, the human support account (Galyn / Oi — a real person)'
        : 'the member who opened this room';
      // PRESENT = candle lit AND a heartbeat in the last 5 minutes. Both arms
      // matter: a hand-lit candle must not outlive the session that lit it.
      const beat = p.last_seen_at ? Date.parse(p.last_seen_at) : 0;
      const fresh = beat > Date.now() - 5 * 60 * 1000;
      const lit = p.presence_always_present === true
        || (p.presence_lit_until ? Date.parse(p.presence_lit_until) > Date.now() : false);
      const present = fresh && lit;
      const seen = r.last_read_at && newest?.created_at
        ? (Date.parse(r.last_read_at) >= Date.parse(newest.created_at)
            ? 'has read everything here'
            : 'has NOT yet read the latest message')
        : 'has not opened this room yet';
      const pron = p.pronouns?.trim() ? ` (${p.pronouns.trim()})` : '';
      return `- ${p.full_name ?? 'A member'}${pron} — ${role}. ${present ? 'PRESENT right now' : 'NOT present right now'}; ${seen}.`;
    });
    if (lines.length) {
      rosterNote = `\n\nWHO IS IN THIS ROOM, as of this moment:\n${lines.join('\n')}\n`
        + `Answer honestly if asked. A human not being present does NOT mean they are ignoring anyone — they are notified on their phone and will pick it up. Never imply someone is reading along when the facts above say they aren't.`;
    }
  }

  const messages = rows.map((m: { sender_id: string; body: string }) =>
    m.sender_id === assistant_id
      ? { role: 'assistant', content: m.body }
      : { role: 'user', content: `${nameOf[m.sender_id] ?? 'A member'}: ${m.body}` });

  // A BOUNDED LOOK-THEN-ANSWER LOOP (founder 2026-08-16). Help rooms may
  // consult the member's own setup before answering; every other surface
  // stays single-shot. Two rounds is enough to look and then speak, and the
  // last round forces tool_choice 'none' so it always ends in an answer
  // rather than another lookup.
  const MAX_LOOKUP_ROUNDS = 2;
  let data: Record<string, unknown> | undefined;
  let inTok = 0, outTok = 0, round = 0;
  const convo = [...messages];

  while (true) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        // 400 cut a help reply mid-sentence ("As for \"getting them into the
        // con") — the same trap wow-window hit at 300. A support answer that
        // stops halfway is worse than a short one.
        max_tokens: 900,
        // Two blocks on purpose: persona, frame, rules and the doctrine are
        // stable and worth caching (the doctrine is ~27k tokens). The roster
        // changes every message as presence and read cursors move, so it goes
        // in its own UNCACHED block rather than busting the cache each reply.
        system: [
          {
            type: 'text',
            text: isHelp
              ? `${ident.persona}\n\n${HELP_FRAME}\n\n${BASE_RULES}\n\n${LICHEN_DOCTRINE}`
              : `${ident.persona}\n\n${BASE_RULES}`,
            cache_control: { type: 'ephemeral' },
          },
          ...(rosterNote ? [{ type: 'text', text: rosterNote }] : []),
        ],
        messages: convo,
        ...(isHelp
          ? { tools: LOOKUP_TOOLS, ...(round >= MAX_LOOKUP_ROUNDS ? { tool_choice: { type: 'none' } } : {}) }
          : {}),
      }),
    });
    if (!res.ok) return json({ error: 'Anthropic call failed', detail: (await res.text()).slice(0, 300) }, 502);
    data = await res.json();
    inTok += (data as { usage?: { input_tokens?: number } })?.usage?.input_tokens ?? 0;
    outTok += (data as { usage?: { output_tokens?: number } })?.usage?.output_tokens ?? 0;

    const calls = ((data as { content?: { type: string; id?: string; name?: string }[] })?.content ?? [])
      .filter((c) => c.type === 'tool_use');
    if (!calls.length) break;

    convo.push({ role: 'assistant', content: (data as { content: unknown }).content });
    const results = [];
    for (const c of calls) {
      // ⚠ `trigger.sender_id`, never anything the model supplied.
      const out = await runLookup(c.name ?? '', trigger.sender_id, sb);
      results.push({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out) });
    }
    convo.push({ role: 'user', content: results });
    round++;
  }

  const reply = ((data as { content?: { type: string; text?: string }[] })?.content ?? [])
    .filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n').trim();
  if (!reply) return json({ ok: true, skipped: 'empty-reply' });

  await sb('chat_messages', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
    chat_id, sender_id: assistant_id, body: reply,
  }) });

  // UVA seed: record the silicon contribution with its exact cost.
  await sb('assistant_queries', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
    profile_id: trigger.sender_id, context: 'chat', model: MODEL,
    input_tokens: inTok || null, output_tokens: outTok || null,
  }) });

  return json({ ok: true, replied: true });
});
