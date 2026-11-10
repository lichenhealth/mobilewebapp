// REPLY TO A KNOCK BY WORD (founder 2026-11-10: "you should be able to type
// in the assistant what you want sent to the person and they should be able
// to send for you"). Rung 2 of the parity ladder — a send to another person,
// so the assistant only DRAFTS: the reply carries a knock_reply card and the
// PERSON's tap on Send is what calls the knock-reply edge fn with their own
// session (whose RLS read is the real authorization). No Always-allow: a
// personal email to a stranger is worth one tap every time.
//
// Targets resolve against the knocks the sender can already answer — every
// waiting knock for a platform admin, else knocks at spaces they steward —
// by exact name or email. Never an id from the model.

type SbFn = (path: string, init?: RequestInit) => Promise<Response>;
type Out = { ok: boolean; [k: string]: unknown };
export type KnockDraft = { type: 'knock_reply'; knock_id: string; name: string; email: string; message: string };

export const KNOCK_TOOLS = [
  {
    name: 'my_knocks',
    description: 'List the people waiting at the door (knocks) this member can answer — everyone for a platform admin, otherwise knocks at the spaces they steward. Returns each one\'s name, email, what they wrote, where they knocked, and whether they\'ve been replied to. Read this before drafting a reply.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'draft_knock_reply',
    description: 'Draft a personal email reply to someone waiting at the door WITHOUT letting them into Lichen (no invitation, no seat — their knock keeps waiting). Pick the knock by the exact name or email from my_knocks. message = what the member wants said, in their words and voice (tidy it only as they ask). add_booking_link=true appends their public booking link when they ask for it — only if the link isn\'t already in the message. This NEVER sends: a card appears under your reply where the member can edit it and tap Send. Never say it was sent.',
    input_schema: {
      type: 'object',
      properties: {
        who: { type: 'string', description: 'Exact name or email from my_knocks.' },
        message: { type: 'string' },
        add_booking_link: { type: 'boolean' },
      },
      required: ['who', 'message'],
    },
  },
];

export const KNOCK_TOOL_NAMES = new Set(KNOCK_TOOLS.map((t) => t.name));

type Knock = { id: string; name: string | null; email: string | null; story: string | null; space_id: string | null; replied_at: string | null; reply_count: number | null; created_at: string };

async function answerable(sb: SbFn, profileId: string, isAdmin: boolean): Promise<{ knocks: Knock[]; spaceNames: Map<string, string> }> {
  const sel = 'id,name,email,story,space_id,replied_at,reply_count,created_at';
  let knocks: Knock[] = [];
  if (isAdmin) {
    knocks = await (await sb(`join_requests?status=eq.new&select=${sel}&order=created_at.desc&limit=40`)).json();
  } else {
    const mine = await (await sb(`space_members?profile_id=eq.${profileId}&role=in.(admin,super_admin)&select=space_id`)).json();
    const ids = (Array.isArray(mine) ? mine : []).map((r: { space_id: string }) => r.space_id).filter(Boolean);
    if (ids.length) {
      knocks = await (await sb(`join_requests?status=eq.new&space_id=in.(${ids.join(',')})&select=${sel}&order=created_at.desc&limit=40`)).json();
    }
  }
  if (!Array.isArray(knocks)) knocks = [];
  const spaceIds = [...new Set(knocks.map((k) => k.space_id).filter(Boolean))] as string[];
  const spaceNames = new Map<string, string>();
  if (spaceIds.length) {
    const sp = await (await sb(`spaces?id=in.(${spaceIds.join(',')})&select=id,name`)).json();
    for (const s of Array.isArray(sp) ? sp : []) spaceNames.set(s.id, s.name);
  }
  return { knocks, spaceNames };
}

export async function runKnockTool(
  sb: SbFn, profileId: string, isAdmin: boolean, name: string, input: Record<string, unknown>, drafts: KnockDraft[],
): Promise<Out> {
  const { knocks, spaceNames } = await answerable(sb, profileId, isAdmin);
  if (name === 'my_knocks') {
    return {
      ok: true,
      knocks: knocks.map((k) => ({
        name: k.name, email: k.email, wrote: (k.story ?? '').slice(0, 400),
        knocked_at: k.space_id ? (spaceNames.get(k.space_id) ?? 'one of your spaces') : 'Lichen',
        since: k.created_at.slice(0, 10),
        replied: k.replied_at ? `${k.reply_count ?? 1}× (last ${k.replied_at.slice(0, 10)})` : 'not yet',
      })),
      note: knocks.length ? undefined : 'Nobody is waiting at a door they can answer.',
    };
  }
  if (name === 'draft_knock_reply') {
    const who = String(input.who ?? '').trim().toLowerCase();
    let message = String(input.message ?? '').trim();
    if (!who) return { ok: false, error: 'Who is the reply for?' };
    if (message.length < 2) return { ok: false, error: 'Write the message first.' };
    const hits = knocks.filter((k) => (k.email ?? '').toLowerCase() === who || (k.name ?? '').trim().toLowerCase() === who);
    if (hits.length === 0) {
      return { ok: false, error: 'No one by that exact name or email is waiting at a door they can answer.', waiting: knocks.map((k) => `${k.name} <${k.email}>`) };
    }
    if (hits.length > 1) return { ok: false, error: 'Several knocks match — use their email.', matches: hits.map((k) => k.email) };
    const k = hits[0];
    if (!k.email) return { ok: false, error: 'That knock left no email to reply to.' };
    if ((k.reply_count ?? 0) >= 3) return { ok: false, error: 'They\'ve been replied to three times already — the conversation continues in the member\'s own inbox.' };
    let linkNote: string | undefined;
    if (input.add_booking_link === true) {
      const p = await (await sb(`profiles?id=eq.${profileId}&select=handle`)).json();
      const handle = Array.isArray(p) ? p[0]?.handle : null;
      const bt = handle ? await (await sb(`booking_types?profile_id=eq.${profileId}&active=eq.true&audience=eq.public&select=id&limit=1`)).json() : [];
      if (!handle || !Array.isArray(bt) || !bt.length) {
        linkNote = 'They have no public booking link yet (a handle plus a public session type) — say so, and redraft so the message doesn\'t promise a link that isn\'t there; nothing was added.';
      } else {
        const link = `https://lichen.health/book/${handle}`;
        if (!message.includes(link)) message = `${message}\n\nHere's my calendar if you'd like to find a time to talk: ${link}`;
      }
    }
    if (message.length > 4000) return { ok: false, error: 'Keep it under 4,000 characters.' };
    const draft: KnockDraft = { type: 'knock_reply', knock_id: k.id, name: k.name ?? '', email: k.email, message };
    const i = drafts.findIndex((d) => d.knock_id === k.id);
    if (i >= 0) drafts[i] = draft; else drafts.push(draft);
    return {
      ok: true, drafted_for: `${k.name} <${k.email}>`, message,
      note: 'Drafted, NOT sent. A card under your reply shows it — they can edit it and tap Send. The email comes from them via Lichen, and the person\'s reply goes to their own inbox; the knock keeps waiting.',
      ...(linkNote ? { booking_link: linkNote } : {}),
    };
  }
  return { ok: false, error: 'Unknown tool.' };
}
