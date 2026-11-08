// THE PARITY LADDER, RUNG 3 — acts that need the person's yes (founder
// 2026-11-08: "if you need a user permission (e.g. when money changes hands,
// confirming that you want to make the purchase, etc); that's fine - but give
// them a 'don't ask me this in the future' or 'always allow'").
//
// Every tool here only PROPOSES: it resolves the target server-side (exactly
// one match, named in the member's own words), then calls
// assistant_run_or_propose. With no standing allowance the reply carries a
// confirm card and nothing happens until the PERSON taps; with one, it runs at
// once — money only inside the ⚡100 / ⚡300-a-day ceilings, and anything over
// ⚡500 that they confirm waits 24 hours. The model can never grant itself an
// allowance — only the tap writes one.

type SbFn = (path: string, init?: RequestInit) => Promise<Response>;
type Out = { ok: boolean; change?: string; error?: string; [k: string]: unknown };
export type ConfirmDoor = { type: 'confirm'; id: string; kind: string; summary: string; amount?: number };

export const CONFIRM_TOOLS = [
  {
    name: 'send_currentcy',
    description: 'Send Current-cy from the member to another member, by the person\'s name or @handle as the member wrote it, with the amount they said. Nothing moves until the member taps Confirm on the card under your reply (unless they earlier chose Always allow — then up to ⚡100 a send and ⚡300 a day goes straight through). Over ⚡500 waits 24 hours after their confirm and can be cancelled. Say plainly what you proposed and that it waits on their tap.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'The recipient\'s full name or @handle, exactly as the member wrote it.' },
        amount: { type: 'number', description: 'The amount in Current, as the member said it.' },
        memo: { type: 'string', description: 'A short note that rides with it (their words).' },
      },
      required: ['to', 'amount'],
    },
  },
  {
    name: 'network_signal',
    description: 'Trust, recommend, or weave into their web (My-celium) a member — or a community, group, organization or place — named as the member wrote it. Trust and recommend are visible signals to their network; weave is plain membership in their web. Proposes a confirm card unless they earlier chose Always allow for that act.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['trust', 'recommend', 'weave'] },
        name: { type: 'string', description: 'The person\'s full name / @handle, or the space\'s exact name.' },
      },
      required: ['action', 'name'],
    },
  },
  {
    name: 'space_membership',
    description: 'Ask to JOIN a community, group, organization or place (its stewards approve), or LEAVE one they belong to — by its exact name as the member wrote it. Proposes a confirm card unless they earlier chose Always allow.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['join', 'leave'] },
        space_name: { type: 'string' },
      },
      required: ['action', 'space_name'],
    },
  },
];

export const CONFIRM_TOOL_SECTION: Record<string, string> = {
  send_currentcy: 'currentcy', network_signal: 'mycelium', space_membership: 'mycelium',
};

const enc = encodeURIComponent;

async function findPerson(sb: SbFn, me: string, raw: string): Promise<{ id: string; name: string } | string> {
  const q = raw.trim().replace(/^@/, '');
  if (!q) return 'Name who it is for.';
  const byHandle = await (await sb(`profiles?handle=eq.${enc(q.toLowerCase())}&select=id,full_name&limit=1`)).json();
  if (Array.isArray(byHandle) && byHandle.length) return { id: byHandle[0].id, name: byHandle[0].full_name || '@' + q };
  const rows = await (await sb(`profiles?full_name=ilike.${enc(q)}&findable=eq.true&onboarded=eq.true&select=id,full_name&limit=3`)).json();
  const list = (Array.isArray(rows) ? rows : []) as { id: string; full_name: string }[];
  if (!list.length) return `No findable member is named "${q}" — ask them for the exact name or @handle.`;
  if (list.length > 1) return `More than one member is named "${q}" — ask for their @handle.`;
  if (list[0].id === me) return 'That is the member themselves.';
  return { id: list[0].id, name: list[0].full_name };
}

async function findSpace(sb: SbFn, raw: string): Promise<{ id: string; name: string } | string> {
  const q = raw.trim();
  const rows = await (await sb(`spaces?name=ilike.${enc(q)}&status=neq.offline&select=id,name,findable&limit=3`)).json();
  const list = (Array.isArray(rows) ? rows : []) as { id: string; name: string }[];
  if (!list.length) return `No community, group, organization or place is named "${q}".`;
  if (list.length > 1) return `More than one is named "${q}" — do this from its page.`;
  return { id: list[0].id, name: list[0].name };
}

export async function runConfirmTool(
  sb: SbFn, me: string, name: string, input: Record<string, unknown>,
  offSections: Set<string>, memberText: string, doors: ConfirmDoor[],
): Promise<Out> {
  const sec = CONFIRM_TOOL_SECTION[name];
  if (sec && offSections.has(sec)) {
    return { ok: false, error: `They have AI switched off for ${sec} — that stays theirs to do by hand unless they turn it back on in Profile → Privacy.` };
  }
  const said = memberText.toLowerCase();
  const propose = async (kind: string, args: Record<string, unknown>, summary: string, amount?: number): Promise<Out> => {
    const r = await sb('rpc/assistant_run_or_propose', {
      method: 'POST',
      body: JSON.stringify({ p_profile: me, p_kind: kind, p_args: args, p_summary: summary, p_amount: amount ?? null }),
    });
    if (!r.ok) return { ok: false, error: `It would not record: ${(await r.text()).slice(0, 140)}` };
    const res = await r.json() as { status: string; id: string; result?: string };
    if (res.status === 'pending') {
      doors.push({ type: 'confirm', id: res.id, kind, summary, ...(amount != null ? { amount } : {}) });
      return { ok: true, proposed: summary, note: 'A confirm card rides under your reply — NOTHING has happened yet; it waits on their tap (Confirm, or Always allow). Say so plainly.' };
    }
    if (res.status === 'done') return { ok: true, change: `${summary} (done — they had chosen Always allow for this)` };
    return { ok: false, error: `It didn't go through: ${res.result ?? 'unknown reason'}` };
  };

  if (name === 'send_currentcy') {
    const amount = Math.round(Number(input.amount) * 100) / 100;
    if (!(amount > 0)) return { ok: false, error: 'Name a positive amount.' };
    const amtStr = String(amount).replace(/\.0+$/, '');
    if (!said.includes(amtStr)) return { ok: false, error: `The amount ${amtStr} isn't in their own words — money only moves on a figure they said. Ask them.` };
    const who = String(input.to ?? '');
    if (!said.includes(who.trim().replace(/^@/, '').toLowerCase())) return { ok: false, error: 'Use the recipient exactly as they wrote it.' };
    const p = await findPerson(sb, me, who);
    if (typeof p === 'string') return { ok: false, error: p };
    const memo = String(input.memo ?? '').trim().slice(0, 140);
    return propose('send_currentcy', { to_type: 'profile', to_id: p.id, amount, memo },
      `Send ⚡${amtStr} to ${p.name}${memo ? ` — "${memo}"` : ''}`, amount);
  }

  if (name === 'network_signal') {
    const action = String(input.action);
    if (!['trust', 'recommend', 'weave'].includes(action)) return { ok: false, error: 'action = trust, recommend or weave.' };
    const raw = String(input.name ?? '');
    if (!said.includes(raw.trim().replace(/^@/, '').toLowerCase())) return { ok: false, error: 'Use the name exactly as they wrote it.' };
    let target: { type: string; id: string; name: string } | null = null;
    const p = await findPerson(sb, me, raw);
    if (typeof p !== 'string') target = { type: 'profile', id: p.id, name: p.name };
    else {
      const s = await findSpace(sb, raw);
      if (typeof s === 'string') return { ok: false, error: `${p} ${s}` };
      target = { type: 'space', id: s.id, name: s.name };
    }
    const verb = action === 'trust' ? 'Trust' : action === 'recommend' ? 'Recommend' : 'Weave into your web:';
    return propose(action, { target_type: target.type, target_id: target.id }, `${verb} ${target.name}`);
  }

  if (name === 'space_membership') {
    const raw = String(input.space_name ?? '');
    if (!said.includes(raw.trim().toLowerCase())) return { ok: false, error: 'Use the name exactly as they wrote it.' };
    const s = await findSpace(sb, raw);
    if (typeof s === 'string') return { ok: false, error: s };
    const mem = await (await sb(`space_members?space_id=eq.${s.id}&profile_id=eq.${me}&select=role`)).json();
    const isMember = Array.isArray(mem) && mem.length > 0;
    if (input.action === 'leave') {
      if (!isMember) return { ok: false, error: `They aren't a member of ${s.name}.` };
      if (mem[0].role === 'super_admin') return { ok: false, error: `They are ${s.name}'s super admin — that role passes to someone else before they can leave.` };
      return propose('leave_space', { space_id: s.id }, `Leave ${s.name}`);
    }
    if (isMember) return { ok: false, error: `They're already a member of ${s.name}.` };
    return propose('join_space', { space_id: s.id }, `Ask to join ${s.name}`);
  }

  return { ok: false, error: 'Unknown tool.' };
}
