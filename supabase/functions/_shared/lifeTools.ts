// THE PARITY LADDER, RUNG 1 — private writes (founder 2026-11-08: "Complete
// parity for what can be built via the assistant or the admin side for all
// features and locations on lichen.health"). Each tool writes the SAME rows
// the manual screen writes (the shared-state rule), only the sender's own,
// and resolves every target by EXACT name against a server-side candidate
// set (the no-invented-targets rule). Nothing here reaches another person or
// moves money — those are rungs 2 and 3. Every tool also bows to its
// section's AI switch (`offSections`), checked before any read or write.

type SbFn = (path: string, init?: RequestInit) => Promise<Response>;
type Out = { ok: boolean; change?: string; error?: string; [k: string]: unknown };

export const LIFE_TOOLS = [
  {
    name: 'my_lists',
    description: 'Read their own lists before changing one: which = tasks (open to-dos and upcoming reminders), budget (their budget lines), folders (their Drive folders), rsvps (events they are invited to or going to, upcoming). Use the exact names it returns.',
    input_schema: { type: 'object', properties: { which: { type: 'string', enum: ['tasks', 'budget', 'folders', 'rsvps'] } }, required: ['which'] },
  },
  {
    name: 'change_task',
    description: 'Change one of THEIR OWN tasks/reminders/to-dos by its exact title (from my_lists tasks): mark it done (or not done), rename it, move its date or time, or delete it. To ADD a task use add_task.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        done: { type: 'boolean', description: 'true = done (today\'s occurrence for a reminder), false = reopen.' },
        new_title: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD — reminders only.' },
        time_min: { type: 'integer', description: 'Minutes after midnight; -1 makes it untimed. Reminders only.' },
        delete: { type: 'boolean' },
      },
      required: ['title'],
    },
  },
  {
    name: 'budget_line',
    description: 'Add or remove a line on their private Budget (Current-cy page — planning only, no money ever moves). add: label + amount + bucket (expense, income, gift = offered freely, need = something they cannot fund) + cadence (once, monthly, yearly; once may carry a date). remove: by exact label from my_lists budget.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'remove'] },
        label: { type: 'string' },
        amount: { type: 'number', description: 'In Current/dollars, e.g. 120.5. 0 is fine for gift or need.' },
        bucket: { type: 'string', enum: ['expense', 'income', 'gift', 'need'] },
        cadence: { type: 'string', enum: ['once', 'monthly', 'yearly'] },
        date: { type: 'string', description: 'YYYY-MM-DD, one-time lines only.' },
      },
      required: ['action', 'label'],
    },
  },
  {
    name: 'drive_folder',
    description: 'Their private Drive folders: create (name), add a post (by its exact title — one of their own posts, a post they saved, or the post shared into this conversation), or remove a post. Folders hold posts by reference.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'add', 'remove'] },
        folder: { type: 'string', description: 'Folder name (exact, from my_lists folders, except when creating).' },
        post_title: { type: 'string' },
      },
      required: ['action', 'folder'],
    },
  },
  {
    name: 'save_or_hide_post',
    description: 'Save a post to their Drive, unsave it, or hide it from their feeds — the post named by its exact title (a post they can see that is public on Lichen, one of their own, or the one shared into this conversation).',
    input_schema: {
      type: 'object',
      properties: { post_title: { type: 'string' }, action: { type: 'string', enum: ['save', 'unsave', 'hide'] } },
      required: ['post_title', 'action'],
    },
  },
  {
    name: 'rsvp',
    description: 'RSVP for them to an event by its exact title: going, maybe, can\'t (declined), or remove their RSVP. Only events they were invited to or that are open to everyone on Lichen. Hosts see the change.',
    input_schema: {
      type: 'object',
      properties: { event_title: { type: 'string' }, status: { type: 'string', enum: ['going', 'maybe', 'declined', 'remove'] } },
      required: ['event_title', 'status'],
    },
  },
  {
    name: 'set_candle',
    description: 'Light or snuff their presence candle (whether they show as present to their network). lit=true lights it for `hours` (default 4); lit=false snuffs it.',
    input_schema: { type: 'object', properties: { lit: { type: 'boolean' }, hours: { type: 'number' } }, required: ['lit'] },
  },
];

export const LIFE_TOOL_SECTION: Record<string, string> = {
  my_lists: 'calendar', change_task: 'calendar', budget_line: 'currentcy',
  drive_folder: 'saved', save_or_hide_post: 'saved', rsvp: 'events', set_candle: 'home',
};

const enc = encodeURIComponent;
const today = () => new Date().toISOString().slice(0, 10);

/** A post the member may act on, by exact title: their own, one they saved,
 *  the one shared into this exchange, or (for save/hide) a public one. */
async function findPost(sb: SbFn, me: string, title: string, sharedPostId: string | null, allowPublic: boolean) {
  const t = enc(title.trim());
  const pick = (rows: unknown) => (Array.isArray(rows) ? rows : []) as { id: string; title: string }[];
  const own = pick(await (await sb(`posts?author_id=eq.${me}&title=ilike.${t}&select=id,title&limit=3`)).json());
  if (own.length === 1) return own[0];
  if (sharedPostId) {
    const sh = pick(await (await sb(`posts?id=eq.${sharedPostId}&title=ilike.${t}&select=id,title`)).json());
    if (sh.length) return sh[0];
  }
  const saved = pick(await (await sb(`saved_items?profile_id=eq.${me}&target_type=eq.post&select=target_id`)).json())
    .map((r) => (r as unknown as { target_id: string }).target_id);
  if (saved.length) {
    const sv = pick(await (await sb(`posts?id=in.(${saved.slice(0, 200).join(',')})&title=ilike.${t}&select=id,title&limit=3`)).json());
    if (sv.length === 1) return sv[0];
  }
  if (allowPublic) {
    const pub = pick(await (await sb(`posts?is_public=eq.true&title=ilike.${t}&select=id,title&limit=3`)).json());
    if (pub.length === 1) return pub[0];
    if (pub.length > 1) return 'many' as const;
  }
  return own.length > 1 ? 'many' as const : null;
}

export async function runLifeTool(
  sb: SbFn, me: string, name: string, input: Record<string, unknown>,
  offSections: Set<string>, sharedPostId: string | null,
): Promise<Out> {
  const sec = LIFE_TOOL_SECTION[name];
  const which = name === 'my_lists' ? String(input.which ?? '') : '';
  const effSec = name === 'my_lists'
    ? ({ tasks: 'calendar', budget: 'currentcy', folders: 'saved', rsvps: 'events' } as Record<string, string>)[which]
    : sec;
  if (effSec && offSections.has(effSec)) {
    return { ok: false, error: `They have AI switched off for that part of Lichen (${effSec}) — it stays theirs to do by hand unless they turn it back on in Profile → Privacy.` };
  }

  if (name === 'my_lists') {
    if (which === 'tasks') {
      const rems = await (await sb(`reminders?profile_id=eq.${me}&end_date=gte.${today()}&select=title,start_date,at_min,recurrence&order=start_date.asc&limit=40`)).json();
      const todos = await (await sb(`todos?profile_id=eq.${me}&done=eq.false&select=title&order=created_at.desc&limit=40`)).json();
      return {
        ok: true,
        reminders: (Array.isArray(rems) ? rems : []).map((r: { title: string; start_date: string; at_min: number | null; recurrence: unknown }) =>
          `"${r.title}" ${r.start_date}${r.at_min != null ? ` at minute ${r.at_min}` : ''}${r.recurrence ? ' (repeats)' : ''}`),
        todos: (Array.isArray(todos) ? todos : []).map((t: { title: string }) => `"${t.title}"`),
      };
    }
    if (which === 'budget') {
      const rows = await (await sb(`budget_items?profile_id=eq.${me}&post_id=is.null&select=label,amount_cents,bucket,cadence,on_date&order=created_at.asc`)).json();
      return { ok: true, lines: (Array.isArray(rows) ? rows : []).map((r: { label: string; amount_cents: number | null; bucket: string; cadence: string; on_date: string | null }) =>
        `"${r.label}" ${((r.amount_cents ?? 0) / 100).toFixed(2)} · ${r.bucket} · ${r.cadence}${r.on_date ? ` on ${r.on_date}` : ''}`) };
    }
    if (which === 'folders') {
      const rows = await (await sb(`collections?owner_id=eq.${me}&space_id=is.null&select=name,kind,is_public&order=created_at.desc&limit=60`)).json();
      return { ok: true, folders: (Array.isArray(rows) ? rows : []).map((r: { name: string; kind: string; is_public: boolean }) =>
        `"${r.name}"${r.kind !== 'collection' ? ` (${r.kind})` : ''}${r.is_public ? ' · published' : ''}`) };
    }
    if (which === 'rsvps') {
      const rows = await (await sb(`event_attendees?profile_id=eq.${me}&select=status,events(title,start_date)&limit=60`)).json();
      return { ok: true, events: (Array.isArray(rows) ? rows : [])
        .filter((r: { events: { start_date: string } | null }) => r.events && r.events.start_date >= today())
        .map((r: { status: string; events: { title: string; start_date: string } }) => `"${r.events.title}" ${r.events.start_date} — ${r.status}`) };
    }
    return { ok: false, error: 'which = tasks, budget, folders or rsvps.' };
  }

  if (name === 'change_task') {
    const title = String(input.title ?? '').trim();
    if (!title) return { ok: false, error: 'Which task? Use its exact title from my_lists tasks.' };
    const rems = await (await sb(`reminders?profile_id=eq.${me}&title=ilike.${enc(title)}&select=id,title,start_date,end_date,at_min,done_mode&limit=2`)).json();
    const todos = await (await sb(`todos?profile_id=eq.${me}&title=ilike.${enc(title)}&select=id,title,done&limit=2`)).json();
    const r = Array.isArray(rems) ? rems : []; const t = Array.isArray(todos) ? todos : [];
    if (r.length + t.length === 0) return { ok: false, error: `No task of theirs is titled "${title}" — read my_lists tasks.` };
    if (r.length + t.length > 1) return { ok: false, error: `More than one task is titled "${title}" — this one needs the To-Do screen.` };
    if (t.length) {
      const todo = t[0] as { id: string; title: string };
      if (input.delete) { await sb(`todos?id=eq.${todo.id}&profile_id=eq.${me}`, { method: 'DELETE' }); return { ok: true, change: `deleted the to-do "${todo.title}"` }; }
      const patch: Record<string, unknown> = {};
      if (typeof input.done === 'boolean') patch.done = input.done;
      if (input.new_title) patch.title = String(input.new_title).trim().slice(0, 140);
      if (!Object.keys(patch).length) return { ok: false, error: 'To-dos take done, new_title or delete.' };
      const res = await sb(`todos?id=eq.${todo.id}&profile_id=eq.${me}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
      if (!res.ok) return { ok: false, error: 'The to-do would not save.' };
      return { ok: true, change: `updated the to-do "${todo.title}" (${Object.keys(patch).join(', ')})` };
    }
    const rem = r[0] as { id: string; title: string; start_date: string; end_date: string };
    if (input.delete) { await sb(`reminders?id=eq.${rem.id}&profile_id=eq.${me}`, { method: 'DELETE' }); return { ok: true, change: `deleted the task "${rem.title}"` }; }
    const changes: string[] = [];
    if (typeof input.done === 'boolean') {
      const d = today();
      if (input.done) await sb('reminder_done', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify({ reminder_id: rem.id, profile_id: me, on_date: d }) });
      else await sb(`reminder_done?reminder_id=eq.${rem.id}&on_date=eq.${d}`, { method: 'DELETE' });
      changes.push(input.done ? 'marked done for today' : 'reopened for today');
    }
    const patch: Record<string, unknown> = {};
    if (input.new_title) { patch.title = String(input.new_title).trim().slice(0, 140); changes.push(`renamed (was "${rem.title}")`); }
    if (input.date && /^\d{4}-\d{2}-\d{2}$/.test(String(input.date))) {
      const nd = String(input.date);
      const span = Math.round((+new Date(rem.end_date) - +new Date(rem.start_date)) / 864e5);
      patch.start_date = nd; patch.end_date = new Date(+new Date(nd) + span * 864e5).toISOString().slice(0, 10);
      changes.push(`moved to ${nd} (was ${rem.start_date})`);
    }
    if (input.time_min !== undefined && Number.isInteger(input.time_min)) {
      const tm = input.time_min as number;
      patch.at_min = tm < 0 ? null : Math.min(1439, tm);
      changes.push(tm < 0 ? 'made untimed' : `set to minute ${tm}`);
    }
    if (Object.keys(patch).length) {
      const res = await sb(`reminders?id=eq.${rem.id}&profile_id=eq.${me}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
      if (!res.ok) return { ok: false, error: 'The task would not save.' };
    }
    if (!changes.length) return { ok: false, error: 'Nothing to change — pass done, new_title, date, time_min or delete.' };
    return { ok: true, change: `task "${rem.title}": ${changes.join('; ')}` };
  }

  if (name === 'budget_line') {
    const label = String(input.label ?? '').trim().slice(0, 120);
    if (!label) return { ok: false, error: 'A budget line needs a label.' };
    if (input.action === 'remove') {
      const rows = await (await sb(`budget_items?profile_id=eq.${me}&post_id=is.null&label=ilike.${enc(label)}&select=id&limit=2`)).json();
      const list = Array.isArray(rows) ? rows : [];
      if (!list.length) return { ok: false, error: `No budget line is labeled "${label}" — read my_lists budget.` };
      if (list.length > 1) return { ok: false, error: `Several lines are labeled "${label}" — remove it on the Budget card.` };
      await sb(`budget_items?id=eq.${list[0].id}&profile_id=eq.${me}`, { method: 'DELETE' });
      return { ok: true, change: `removed the budget line "${label}"` };
    }
    const bucket = ['expense', 'income', 'gift', 'need'].includes(String(input.bucket)) ? String(input.bucket) : 'expense';
    const cadence = ['once', 'monthly', 'yearly'].includes(String(input.cadence)) ? String(input.cadence) : 'monthly';
    const amt = Math.max(0, Math.round(Number(input.amount ?? 0) * 100));
    const onDate = cadence === 'once' && /^\d{4}-\d{2}-\d{2}$/.test(String(input.date ?? '')) ? String(input.date) : null;
    const res = await sb('budget_items', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
      profile_id: me, label, amount_cents: amt, bucket, direction: bucket === 'income' || bucket === 'gift' ? 'in' : 'out', cadence, on_date: onDate,
    }) });
    if (!res.ok) return { ok: false, error: `The line would not save: ${(await res.text()).slice(0, 120)}` };
    return { ok: true, change: `added "${label}" to their budget (${bucket}, ${(amt / 100).toFixed(2)}, ${cadence}${onDate ? ` on ${onDate}` : ''})` };
  }

  if (name === 'drive_folder') {
    const folder = String(input.folder ?? '').trim().slice(0, 120);
    if (!folder) return { ok: false, error: 'Name the folder.' };
    if (input.action === 'create') {
      const res = await sb('collections', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ owner_id: me, name: folder, kind: 'collection' }) });
      if (!res.ok) return { ok: false, error: 'The folder would not save.' };
      return { ok: true, change: `created the private folder "${folder}" in their Drive` };
    }
    const fr = await (await sb(`collections?owner_id=eq.${me}&space_id=is.null&name=ilike.${enc(folder)}&select=id,name&limit=2`)).json();
    const fl = Array.isArray(fr) ? fr : [];
    if (fl.length !== 1) return { ok: false, error: fl.length ? `Several folders are named "${folder}".` : `No folder of theirs is named "${folder}" — read my_lists folders.` };
    const pt = String(input.post_title ?? '').trim();
    if (!pt) return { ok: false, error: 'Which post? Give its exact title.' };
    const post = await findPost(sb, me, pt, sharedPostId, false);
    if (post === 'many') return { ok: false, error: `Several posts are titled "${pt}" — do this one from the post's own page.` };
    if (!post) return { ok: false, error: `No post titled "${pt}" among their own, their saved, or the one shared here.` };
    if (input.action === 'remove') {
      await sb(`collection_items?collection_id=eq.${fl[0].id}&target_type=eq.post&target_id=eq.${post.id}`, { method: 'DELETE' });
      return { ok: true, change: `took "${post.title}" out of "${fl[0].name}"` };
    }
    const cnt = await sb(`collection_items?collection_id=eq.${fl[0].id}&select=target_id`, { headers: { Prefer: 'count=exact' } });
    const pos = Number(cnt.headers.get('content-range')?.split('/')[1] ?? '0');
    const res = await sb('collection_items', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify({ collection_id: fl[0].id, target_type: 'post', target_id: post.id, position: pos }) });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: /weav/i.test(txt) ? 'Its author keeps that piece out of other people\'s collections.' : `It would not add: ${txt.slice(0, 100)}` };
    }
    return { ok: true, change: `added "${post.title}" to the folder "${fl[0].name}"` };
  }

  if (name === 'save_or_hide_post') {
    const pt = String(input.post_title ?? '').trim();
    const post = await findPost(sb, me, pt, sharedPostId, true);
    if (post === 'many') return { ok: false, error: `Several posts are titled "${pt}" — do this from the post itself.` };
    if (!post) return { ok: false, error: `No post titled "${pt}" that they can see.` };
    if (input.action === 'hide') {
      await sb('hidden_posts', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify({ profile_id: me, post_id: post.id }) });
      return { ok: true, change: `hid "${post.title}" from their feeds` };
    }
    if (input.action === 'unsave') {
      await sb(`saved_items?profile_id=eq.${me}&target_type=eq.post&target_id=eq.${post.id}`, { method: 'DELETE' });
      return { ok: true, change: `took "${post.title}" out of their Drive` };
    }
    await sb('saved_items', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify({ profile_id: me, target_type: 'post', target_id: post.id }) });
    return { ok: true, change: `saved "${post.title}" to their Drive` };
  }

  if (name === 'rsvp') {
    const et = String(input.event_title ?? '').trim();
    const evs = await (await sb(`events?title=ilike.${enc(et)}&end_date=gte.${today()}&select=id,title,start_date&limit=5`)).json();
    const cands: { id: string; title: string; start_date: string }[] = [];
    for (const e of (Array.isArray(evs) ? evs : [])) {
      const att = await (await sb(`event_attendees?event_id=eq.${e.id}&profile_id=eq.${me}&select=status`)).json();
      const open = await (await sb(`posts?linked_event_id=eq.${e.id}&is_public=eq.true&select=id&limit=1`)).json();
      if ((Array.isArray(att) && att.length) || (Array.isArray(open) && open.length)) cands.push(e);
    }
    if (!cands.length) return { ok: false, error: `No upcoming event titled "${et}" that they're invited to or that is open on Lichen.` };
    if (cands.length > 1) return { ok: false, error: `Several upcoming events are titled "${et}" (${cands.map((c) => c.start_date).join(', ')}) — RSVP on the event page.` };
    const ev = cands[0];
    if (input.status === 'remove') {
      await sb(`event_attendees?event_id=eq.${ev.id}&profile_id=eq.${me}`, { method: 'DELETE' });
      return { ok: true, change: `removed their RSVP to "${ev.title}" (${ev.start_date})` };
    }
    const status = input.status === 'maybe' ? 'tentative' : input.status === 'declined' ? 'declined' : 'going';
    const res = await sb('event_attendees?on_conflict=event_id,profile_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ event_id: ev.id, profile_id: me, invited_by: me, status }) });
    if (!res.ok) return { ok: false, error: `The RSVP would not save: ${(await res.text()).slice(0, 100)}` };
    return { ok: true, change: `RSVP'd ${input.status === 'maybe' ? 'maybe' : status} to "${ev.title}" (${ev.start_date})` };
  }

  if (name === 'set_candle') {
    const lit = !!input.lit;
    const hours = Math.min(24, Math.max(0.5, Number(input.hours ?? 4)));
    const res = await sb(`profiles?id=eq.${me}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
      presence_lit_until: lit ? new Date(Date.now() + hours * 3600_000).toISOString() : null,
      ...(lit ? {} : { presence_always_present: false }),
    }) });
    if (!res.ok) return { ok: false, error: 'The candle would not change.' };
    return { ok: true, change: lit ? `lit their candle for ${hours} hours` : 'snuffed their candle' };
  }

  return { ok: false, error: 'Unknown tool.' };
}
