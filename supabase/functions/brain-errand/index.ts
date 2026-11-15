// «FIRST»'S BRAIN — AI ON A MEMBER'S BEHALF (founder 2026-11-15: "let my Ai
// brain message gabe with a link to my cal and instructions, and help him get
// setup if needs to, flagging me if there's an issue. Make it clear that it is
// my Brain messaging him").
//
// Two modes:
//  send  (the member's JWT) — the PERSON tapped "Let my Brain send it" on one
//        of their own calendar shares. Opens/finds the DM with that member,
//        posts the link + instructions as a via_brain message (sender = the
//        member, so it lives in THEIR conversation), and opens an ERRAND.
//  reply (x-webhook-secret, from the brain_errand_on_message trigger) — the
//        recipient wrote back while the errand is open. The Brain answers ONLY
//        about getting the calendar set up, flags its owner (a bell) when
//        something is wrong or the message is really for them, and marks the
//        errand done (a bell: "Gabe's all set") when he confirms it works.
// Every Brain message says what it is. The model cannot reach another chat,
// person or share: errand id → chat/owner/recipient/share are all read here.
// Env: ANTHROPIC_API_KEY, PUSH_HOOK_SECRET, optional BRAIN_ERRAND_MODEL.
import { shareMessage, seesLine, FEED_BASE } from '../_shared/calShare.ts';
import { assistantConsentOff } from '../_shared/consent.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const WEBHOOK_SECRET = Deno.env.get('PUSH_HOOK_SECRET');
const MODEL = Deno.env.get('BRAIN_ERRAND_MODEL') ?? Deno.env.get('ASSISTANT_CHAT_MODEL') ?? 'claude-sonnet-5';
const MAX_REPLIES = 12;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const svc = (path: string, init?: RequestInit) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
const rows = async <T>(r: Response): Promise<T[]> => { const j = await r.json().catch(() => []); return Array.isArray(j) ? j as T[] : []; };
const first = (full: string | null | undefined, fn: string | null | undefined) => (fn || (full ?? '').split(' ')[0] || 'them').trim();

async function notify(recipient: string, title: string, body: string, link: string, actor: string | null) {
  await svc('rpc/notify', { method: 'POST', body: JSON.stringify({
    p_recipient: recipient, p_section: 'chat', p_space: null, p_type: 'brain_errand',
    p_title: title, p_body: body, p_link: link, p_actor: actor,
  }) });
}

async function postAsBrain(chatId: string, ownerId: string, body: string) {
  await svc('chat_messages', { method: 'POST', body: JSON.stringify({ chat_id: chatId, sender_id: ownerId, body, via_brain: true }) });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Not configured' }, 500);
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  // ── SEND: the member's own tap ─────────────────────────────────────────
  if (body.mode === 'send') {
    const auth = req.headers.get('Authorization') ?? '';
    const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: auth } });
    const user = ures.ok ? await ures.json().catch(() => null) : null;
    if (!user?.id) return json({ error: 'Sign in first' }, 401);
    const id = String(body.share_id ?? '');
    if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Which share?' }, 400);
    const share = (await rows<{ token: string; detail: string; recipient_profile_id: string | null; recipient_name: string }>(
      await svc(`calendar_feed_shares?id=eq.${id}&owner_id=eq.${user.id}&revoked_at=is.null&select=token,detail,recipient_profile_id,recipient_name`)))[0];
    if (!share) return json({ error: 'That share isn\'t yours, or it was stopped.' }, 404);
    if (!share.recipient_profile_id) return json({ error: 'Your Brain can only message someone on Lichen — use text or email for this one.' }, 400);

    // The DM, opened through the member's OWN session (ensure_direct_chat
    // reads auth.uid(), so it can only ever be their conversation).
    const cr = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ensure_direct_chat`, {
      method: 'POST', headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_other: share.recipient_profile_id }),
    });
    const chatId = cr.ok ? String(await cr.json().catch(() => '')).replace(/"/g, '') : '';
    if (!/^[0-9a-f-]{36}$/.test(chatId)) return json({ error: 'Couldn\'t open your chat with them — try again.' }, 502);

    const people = await rows<{ id: string; full_name: string | null; first_name: string | null }>(
      await svc(`profiles?id=in.(${user.id},${share.recipient_profile_id})&select=id,full_name,first_name`));
    const me = people.find((p) => p.id === user.id);
    const them = people.find((p) => p.id === share.recipient_profile_id);
    const ownerFirst = first(me?.full_name, me?.first_name);
    const themFirst = first(them?.full_name ?? share.recipient_name, them?.first_name);
    const note = String(body.note ?? '').trim().slice(0, 1200);
    const text = `Hi ${themFirst} — this is ${ownerFirst}'s Brain, the AI assistant ${ownerFirst} uses on Lichen, writing on ${ownerFirst}'s behalf. `
      + `${ownerFirst} asked me to share their calendar with you and help you get it set up.\n\n`
      + (note ? note + '\n\n' : '')
      // The share wording is the owner's first person; the Brain speaks ABOUT them.
      + shareMessage(ownerFirst, share.detail, FEED_BASE + share.token).replace(/\n\n— .*$/s, '')
        .replace("Here's my Lichen calendar", `Here's ${ownerFirst}'s Lichen calendar`)
        .replace(/Anything I've marked/, `Anything ${ownerFirst} has marked`)
        .replace(/\bI'm\b/g, `${ownerFirst} is`).replace(/\bI'm going\b/g, `${ownerFirst} is going`)
        .replace(/\bmy (to-dos|Lichen calendar)/g, `${ownerFirst}'s $1`)
      + `\n\nIf anything gets stuck, just reply here — I'll help, and I'll let ${ownerFirst} know if it needs them.`;

    // One live errand per chat.
    await svc(`brain_errands?chat_id=eq.${chatId}&status=in.(open,flagged)`, { method: 'PATCH', body: JSON.stringify({ status: 'closed', updated_at: new Date().toISOString(), last_note: 'Replaced by a new errand' }) });
    await postAsBrain(chatId, user.id, text);
    await svc('brain_errands', { method: 'POST', body: JSON.stringify({ owner_id: user.id, chat_id: chatId, recipient_id: share.recipient_profile_id, share_id: id }) });
    await svc(`calendar_feed_shares?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ channel: 'chat', sent_at: new Date().toISOString() }) });
    return json({ ok: true, chat_id: chatId });
  }

  // ── REPLY: the recipient wrote back ───────────────────────────────────
  if (body.mode === 'reply') {
    if (!WEBHOOK_SECRET || req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) return json({ error: 'Unauthorized' }, 401);
    if (!ANTHROPIC_API_KEY) return json({ error: 'Not configured' }, 500);
    const errandId = String(body.errand_id ?? ''), messageId = String(body.message_id ?? '');
    const errand = (await rows<{ id: string; owner_id: string; chat_id: string; recipient_id: string; share_id: string | null; status: string; replies: number; expires_at: string }>(
      await svc(`brain_errands?id=eq.${errandId}&select=*`)))[0];
    if (!errand || !['open', 'flagged'].includes(errand.status) || new Date(errand.expires_at) < new Date()) return json({ ok: true, skipped: 'no-errand' });
    const trig = (await rows<{ sender_id: string; body: string | null; via_brain: boolean }>(
      await svc(`chat_messages?id=eq.${messageId}&chat_id=eq.${errand.chat_id}&select=sender_id,body,via_brain`)))[0];
    if (!trig || trig.via_brain || trig.sender_id !== errand.recipient_id || !trig.body?.trim()) return json({ ok: true, skipped: 'not-for-brain' });

    const people = await rows<{ id: string; full_name: string | null; first_name: string | null; assistant_readable: boolean | null }>(
      await svc(`profiles?id=in.(${errand.owner_id},${errand.recipient_id})&select=id,full_name,first_name,assistant_readable`));
    const owner = people.find((p) => p.id === errand.owner_id);
    const them = people.find((p) => p.id === errand.recipient_id);
    const ownerFirst = first(owner?.full_name, owner?.first_name);
    const themFirst = first(them?.full_name, them?.first_name);
    const link = `/chat/${errand.chat_id}`;
    const patch = (p: Record<string, unknown>) => svc(`brain_errands?id=eq.${errand.id}`, { method: 'PATCH', body: JSON.stringify({ ...p, updated_at: new Date().toISOString() }) });

    // The owner switched their calendar assistant off since — stand down,
    // tell them a reply is waiting.
    if (await assistantConsentOff(errand.owner_id, [{ type: 'section', id: 'calendar' }])) {
      await patch({ status: 'closed', last_note: 'Calendar AI is off' });
      await notify(errand.owner_id, `${themFirst} replied about your calendar`, 'Your Brain stood down because calendar AI is off — the reply is waiting for you.', link, errand.recipient_id);
      return json({ ok: true, skipped: 'consent-off' });
    }
    // The recipient doesn't let assistants read their words — don't.
    if (them?.assistant_readable === false) {
      await patch({ status: 'flagged', last_note: `${themFirst} keeps assistants out of their messages` });
      await notify(errand.owner_id, `${themFirst} replied about your calendar`, `${themFirst} keeps assistants out of their messages, so your Brain didn't read it — it's waiting for you.`, link, errand.recipient_id);
      return json({ ok: true, skipped: 'not-readable' });
    }
    if (errand.replies >= MAX_REPLIES) {
      await patch({ status: 'flagged', last_note: 'Long conversation — handed back to you' });
      await postAsBrain(errand.chat_id, errand.owner_id, `I've passed this to ${ownerFirst} so they can pick it up with you directly.`);
      await notify(errand.owner_id, `Your Brain handed ${themFirst} back to you`, 'The calendar setup conversation ran long — take it from here.', link, errand.recipient_id);
      return json({ ok: true, handed: true });
    }

    const share = errand.share_id ? (await rows<{ token: string; detail: string; revoked_at: string | null }>(
      await svc(`calendar_feed_shares?id=eq.${errand.share_id}&select=token,detail,revoked_at`)))[0] : null;
    if (!share || share.revoked_at) {
      await patch({ status: 'closed', last_note: 'The share was stopped' });
      await postAsBrain(errand.chat_id, errand.owner_id, `${ownerFirst} has stopped sharing this calendar link, so I'll leave it there. ${ownerFirst} will see your message.`);
      await notify(errand.owner_id, `${themFirst} replied about your calendar`, 'You had stopped sharing — the reply is waiting for you.', link, errand.recipient_id);
      return json({ ok: true, closed: true });
    }

    const history = await rows<{ sender_id: string; body: string | null; via_brain: boolean; created_at: string }>(
      await svc(`chat_messages?chat_id=eq.${errand.chat_id}&created_at=gte.${encodeURIComponent(new Date(Date.now() - 8 * 86400_000).toISOString())}&select=sender_id,body,via_brain,created_at&order=created_at.desc&limit=24`));
    const convo = history.reverse().filter((m) => m.body?.trim()).map((m) => {
      const who = m.via_brain ? `${ownerFirst}'s Brain (you)` : m.sender_id === errand.owner_id ? `${ownerFirst} (in person)` : themFirst;
      return `${who}: ${m.body!.trim().slice(0, 1500)}`;
    }).join('\n\n');

    const system = `You are ${ownerFirst}'s Brain — the AI assistant ${ownerFirst} uses on Lichen — writing in ${ownerFirst}'s direct chat with ${themFirst}, ON ${ownerFirst.toUpperCase()}'S BEHALF. ${themFirst} knows they are talking with an AI; never pretend to be ${ownerFirst}.
YOUR ONE JOB: help ${themFirst} subscribe to ${ownerFirst}'s shared Lichen calendar feed. Facts you may use:
- The link (only ever repeat this exact one): ${FEED_BASE + share.token}
- Google Calendar: it must be added on a COMPUTER (or a phone's web browser in desktop mode) at calendar.google.com → Other calendars "+" → From URL → paste → Add calendar. The Google Calendar phone app can't add a URL, but once added on the web the calendar shows up in the phone app too (it may need switching on under the app's Settings → that calendar → Sync).
- Apple Calendar: File → New Calendar Subscription (Mac); on iPhone: Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar.
- Outlook: Add calendar → Subscribe from web.
- Google refreshes subscribed calendars on its own schedule, often every 12–24 hours — new events can take that long to appear. That's normal, not broken.
- They will see ${seesLine(share.detail)}. Events ${ownerFirst} marked private never appear; to-dos and the care plan aren't included.
- If Google says it can't fetch the URL, ask them to make sure they pasted the whole link with nothing added, and try again; if it still fails, flag ${ownerFirst}.
RULES: Reply in 1–4 short sentences, warm and plain. Never invent features, links or other people's details. If the message is really for ${ownerFirst} personally (anything beyond setting up the calendar), say briefly that you'll make sure ${ownerFirst} sees it, and call flag_owner. If you can't solve a setup problem in a reply or two, or something seems wrong with the link, call flag_owner with a one-line reason and tell ${themFirst} you've let ${ownerFirst} know. When ${themFirst} says it's working (or they're all set), call mark_done and say a short goodbye.`;

    const tools = [
      { name: 'flag_owner', description: `Let ${ownerFirst} know they're needed: a setup problem you can't solve, something wrong with the link, or a message that's really for ${ownerFirst}.`,
        input_schema: { type: 'object', properties: { reason: { type: 'string', description: 'One plain line for the bell.' } }, required: ['reason'] } },
      { name: 'mark_done', description: `${themFirst} has the calendar working (or says they're all set). Ends your errand and tells ${ownerFirst}.`,
        input_schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } },
    ];
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1200, system, tools,
        messages: [{ role: 'user', content: `The conversation so far:\n\n${convo}\n\n${themFirst} just wrote the last message. Reply as ${ownerFirst}'s Brain.` }] }),
    });
    const out = res.ok ? await res.json().catch(() => null) : null;
    const blocks = (out?.content ?? []) as { type: string; text?: string; name?: string; input?: Record<string, string> }[];
    let reply = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim();
    const flag = blocks.find((b) => b.type === 'tool_use' && b.name === 'flag_owner');
    const done = blocks.find((b) => b.type === 'tool_use' && b.name === 'mark_done');
    if (!reply && !out) {
      await patch({ status: 'flagged', last_note: 'Your Brain couldn\'t answer' });
      await notify(errand.owner_id, `${themFirst} replied about your calendar`, 'Your Brain couldn\'t answer just now — the reply is waiting for you.', link, errand.recipient_id);
      return json({ ok: false, error: 'model' }, 502);
    }
    if (!reply) reply = done ? `Wonderful — you're all set. I'll let ${ownerFirst} know.` : `I've let ${ownerFirst} know — they'll pick this up with you.`;
    await postAsBrain(errand.chat_id, errand.owner_id, reply.slice(0, 2000));
    if (done) {
      await patch({ status: 'done', replies: errand.replies + 1, last_note: String(done.input?.summary ?? 'All set').slice(0, 300) });
      await notify(errand.owner_id, `${themFirst} has your calendar ✓`, `Your Brain helped ${themFirst} set it up. ${String(done.input?.summary ?? '').slice(0, 200)}`.trim(), link, errand.recipient_id);
    } else if (flag) {
      const reason = String(flag.input?.reason ?? 'They need you').slice(0, 300);
      await patch({ status: 'flagged', replies: errand.replies + 1, last_note: reason });
      await notify(errand.owner_id, `Your Brain needs you with ${themFirst}`, reason, link, errand.recipient_id);
    } else {
      await patch({ replies: errand.replies + 1 });
    }
    await svc('assistant_queries', { method: 'POST', body: JSON.stringify({
      profile_id: errand.owner_id, context: 'chat', model: MODEL,
      input_tokens: out?.usage?.input_tokens ?? null, output_tokens: out?.usage?.output_tokens ?? null,
    }) }).catch(() => null);
    return json({ ok: true });
  }

  return json({ error: 'Unknown mode' }, 400);
});
