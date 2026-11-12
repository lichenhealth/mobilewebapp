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
  {
    name: 'my_event',
    description: 'Look up one of their events — one they host, co-host, or are invited to/attending — and get what they need to act: when (with time zone), where, the event\'s OWN Zoom join link (only to hosts and invitees), the friendly event address, whether a shareable link exists and who it lets in, and (hosts only) the guest list with each person\'s status and whether they opened their invitation. Leave event_title empty for their soonest upcoming event (today first). Hosts may also act: make_link=true creates the shareable link if it is missing (it is how off-Lichen guests open the friendly address); link_access = anyone | invited | members changes who that link lets in — ONLY when they explicitly asked to change who gets in (never widen it on your own; "fix it" means create a missing link, not open it to anyone); zoom_room=true gives the event its own Zoom room when it has none (Lichen\'s Zoom serves only some hosts — a refusal is a capacity limit, say so plainly). Use this whenever they ask for their Zoom link, "the link", how a guest gets in, or who has replied — never send them hunting on the event page.',
    input_schema: {
      type: 'object',
      properties: {
        event_title: { type: 'string', description: 'Exact title, or empty for the soonest upcoming event' },
        make_link: { type: 'boolean' },
        link_access: { type: 'string', enum: ['anyone', 'invited', 'members'] },
        zoom_room: { type: 'boolean' },
      },
    },
  },
  {
    name: 'set_clinical_home',
    description: 'For licensed providers: name the HIPAA tool where their CLINICAL conversations and records live (SimplePractice, Spruce, Hushmail…), with an optional client-portal link and a short note for clients. Members see "For anything clinical, X uses …" on their profile and care team. Lichen is not a HIPAA platform yet — it points there and never holds clinical records. service empty clears it. A url only if they typed it in this conversation.',
    input_schema: { type: 'object', properties: { service: { type: 'string' }, url: { type: 'string' }, note: { type: 'string' } }, required: ['service'] },
  },
];

export const LIFE_TOOL_SECTION: Record<string, string> = {
  my_lists: 'calendar', change_task: 'calendar', budget_line: 'currentcy',
  drive_folder: 'saved', save_or_hide_post: 'saved', rsvp: 'events', set_candle: 'home', my_event: 'events', set_clinical_home: 'profile',
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

  if (name === 'my_event') {
    const APP = 'https://lichen.health';
    type Ev = { id: string; title: string | null; start_date: string; start_min: number | null; end_min: number | null; all_day: boolean | null; timezone: string | null; location: string | null; creator_id: string; zoom_unique: boolean | null; guest_link_token: string | null; link_access: string | null; poll_status: string | null };
    const cols = 'id,title,start_date,start_min,end_min,all_day,timezone,location,creator_id,zoom_unique,guest_link_token,link_access,poll_status';
    const arr = <T,>(x: unknown) => (Array.isArray(x) ? x : []) as T[];
    const since = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    // The candidate set: events they host, co-host, or hold an RSVP row for.
    const hosted = arr<Ev>(await (await sb(`events?creator_id=eq.${me}&is_draft=eq.false&start_date=gte.${since}&select=${cols}&order=start_date.asc&limit=60`)).json());
    const coIds = arr<{ event_id: string }>(await (await sb(`event_cohosts?profile_id=eq.${me}&select=event_id`)).json()).map((r) => r.event_id);
    const attIds = arr<{ event_id: string; status: string }>(await (await sb(`event_attendees?profile_id=eq.${me}&select=event_id,status`)).json());
    const otherIds = [...new Set([...coIds, ...attIds.map((a) => a.event_id)])].filter((id) => !hosted.some((h) => h.id === id));
    const others = otherIds.length
      ? arr<Ev>(await (await sb(`events?id=in.(${otherIds.slice(0, 150).join(',')})&is_draft=eq.false&start_date=gte.${since}&select=${cols}`)).json())
      : [];
    const all = [...hosted, ...others].sort((a, b) => (a.start_date + String(a.start_min ?? 0).padStart(4, '0')).localeCompare(b.start_date + String(b.start_min ?? 0).padStart(4, '0')));
    const title = String(input.event_title ?? '').trim().toLowerCase();
    let ev: Ev | undefined;
    if (title) {
      const hits = all.filter((e) => (e.title ?? '').trim().toLowerCase() === title);
      const loose = hits.length ? hits : all.filter((e) => (e.title ?? '').toLowerCase().includes(title));
      if (loose.length > 1 && !hits.length) return { ok: false, error: `Several of their events match "${input.event_title}": ${loose.slice(0, 6).map((e) => `"${e.title}" (${e.start_date})`).join(', ')}. Ask which.` };
      ev = loose[0];
    } else {
      ev = all.find((e) => e.start_date >= today()) ?? all[0];
    }
    if (!ev) return { ok: false, error: title ? `No upcoming event of theirs is titled "${input.event_title}".` : 'They have no upcoming events.' };
    const isHost = ev.creator_id === me || coIds.includes(ev.id);
    const mine = attIds.find((a) => a.event_id === ev!.id);
    const changes: string[] = [];

    if (isHost && input.make_link && !ev.guest_link_token) {
      const tok = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
      const r = await sb(`events?id=eq.${ev.id}&guest_link_token=is.null`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ guest_link_token: tok }) });
      if (r.ok) { ev.guest_link_token = tok; changes.push('created the shareable link'); }
    } else if (!isHost && (input.make_link || input.link_access || input.zoom_room)) {
      return { ok: false, error: 'Only the event\'s hosts can make or change its shareable link.' };
    }
    if (isHost && input.link_access && ['anyone', 'invited', 'members'].includes(String(input.link_access))) {
      const r = await sb(`events?id=eq.${ev.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ link_access: input.link_access, link_space_ids: [] }) });
      if (r.ok) { ev.link_access = String(input.link_access); changes.push(`set the link to let in: ${input.link_access}`); }
    }

    if (isHost && input.zoom_room && !ev.zoom_unique) {
      const ps = arr<{ value: unknown }>(await (await sb(`platform_settings?key=eq.zoom_providers&select=value`)).json())[0];
      const allowed = Array.isArray(ps?.value) && (ps!.value as string[]).includes(me);
      if (!allowed) {
        changes.push('could NOT add a Zoom room — Lichen\'s one Zoom account only serves a few hosts for now (a capacity limit, not an outage); they can paste their own Zoom/Meet link as the event\'s place on its edit screen');
      } else {
        const r = await sb(`events?id=eq.${ev.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ zoom_unique: true, location: 'Zoom' }) });
        if (r.ok) { ev.zoom_unique = true; changes.push('gave the event its own Zoom room (the link appears within a minute — ask again to get it)'); }
      }
    }

    const fmt = (m: number | null) => m == null ? '' : `${((Math.floor(m / 60) + 11) % 12) + 1}${m % 60 ? ':' + String(m % 60).padStart(2, '0') : ''}${m < 720 ? 'am' : 'pm'}`;
    const when = `${ev.start_date}${ev.all_day || ev.start_min == null ? ' (all day)' : ` ${fmt(ev.start_min)}${ev.end_min != null ? '–' + fmt(ev.end_min) : ''}`} ${ev.timezone ?? ''}`.trim();

    // The room: hosts and invitees only (event_meetings is never public).
    let zoom: string | null = null;
    if (isHost || mine) {
      const m = arr<{ join_url: string }>(await (await sb(`event_meetings?event_id=eq.${ev.id}&select=join_url`)).json())[0];
      zoom = m?.join_url ?? null;
    }
    const post = arr<{ id: string; slug: string | null; author_id: string; author_space_id: string | null }>(
      await (await sb(`posts?linked_event_id=eq.${ev.id}&select=id,slug,author_id,author_space_id&limit=1`)).json())[0];
    let address: string | null = null;
    if (post) {
      let handle: string | null = null;
      if (post.slug) {
        const h = post.author_space_id
          ? arr<{ handle: string | null }>(await (await sb(`spaces?id=eq.${post.author_space_id}&select=handle`)).json())[0]
          : arr<{ handle: string | null }>(await (await sb(`profiles?id=eq.${post.author_id}&select=handle`)).json())[0];
        handle = h?.handle ?? null;
      }
      address = handle && post.slug ? `${APP}/events/${handle}/${post.slug}` : `${APP}/events/${post.id}`;
    }
    const accessWords: Record<string, string> = {
      anyone: 'anyone with the link opens it straight away',
      invited: 'people on the invite list type the email or phone they were invited with and land on their own invitation; anyone else asks the host',
      members: 'Lichen members come in by signing in; people off Lichen are asked to sign in',
      circles: 'members of the chosen groups come in; everyone else is turned away',
    };
    const out: Out = {
      ok: true,
      title: ev.title, when, where: ev.zoom_unique ? 'Zoom (its own room)' : (ev.location || 'not set'),
      you_are: isHost ? 'host' : (mine ? `invited — ${mine.status}` : 'not on it'),
      zoom_join_link: zoom ?? (ev.zoom_unique ? (isHost || mine ? 'the room is still being made — try again in a minute' : 'only hosts and invitees see the room') : 'no Zoom room on this event'),
      event_address: address,
      shareable_link: ev.guest_link_token
        ? `exists — ${accessWords[ev.link_access ?? ''] ?? 'it follows the event\'s visibility'}`
        : (isHost ? 'NOT created yet — off-Lichen guests cannot open the event address until it is; offer to create it (make_link=true)' : 'not created'),
      guest_page_link: ev.guest_link_token && isHost ? `${APP}/e/${ev.guest_link_token}` : undefined,
      poll: ev.poll_status === 'open' ? 'a time poll is still open — the time is not final' : undefined,
    };
    if (changes.length) out.change = changes.join('; ');
    if (isHost) {
      const gs = arr<{ name: string | null; email: string | null; phone: string | null; status: string; opened_at: string | null }>(
        await (await sb(`event_guests?event_id=eq.${ev.id}&select=name,email,phone,status,opened_at&order=created_at.asc&limit=80`)).json());
      out.guests_off_lichen = gs.map((g) => `${g.name ?? '(no name)'} · ${g.email ? 'email' : 'phone'} · ${g.status}${g.opened_at ? ' · opened' : ' · not opened yet'}`);
      const att = arr<{ status: string; profiles: { full_name: string | null } | null }>(
        await (await sb(`event_attendees?event_id=eq.${ev.id}&select=status,profiles!event_attendees_profile_id_fkey(full_name)&limit=80`)).json());
      out.members = att.map((a) => `${a.profiles?.full_name ?? 'a member'} · ${a.status}`);
    }
    out.copies = [
      ...(zoom ? [{ text: zoom, label: 'Copy the Zoom link' }] : []),
      ...(address ? [{ text: address, label: 'Copy the event address' }]
        : (ev.guest_link_token && isHost ? [{ text: `${APP}/e/${ev.guest_link_token}`, label: 'Copy the shareable link' }] : [])),
    ];
    if (post) out.door = { path: `/events/${post.id}`, label: `Open ${ev.title ?? 'the event'} →` };
    out.note = out.copies && (out.copies as unknown[]).length
      ? 'These ride along as Copy buttons under your reply: ' + (out.copies as { label: string }[]).map((c) => c.label).join(', ') + '. Say they are there; do not paste long URLs. Speak the guest list in plain words.'
      : 'No Copy buttons ride along this time — do not promise any.';
    return out;
  }

  if (name === 'set_clinical_home') {
    const service = String(input.service ?? '').trim().slice(0, 60);
    if (!service) {
      await sb(`profiles?id=eq.${me}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ clinical_home: null }) });
      return { ok: true, change: 'cleared their clinical home' };
    }
    let url = String(input.url ?? '').trim();
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    url = url.replace(/^http:\/\//i, 'https://');
    if (url && !/^https:\/\/[^\s]{3,400}$/.test(url)) return { ok: false, error: 'That link does not look like a web address.' };
    const note = String(input.note ?? '').trim().slice(0, 200);
    const value = { service, url: url || null, note: note || null };
    const res = await sb(`profiles?id=eq.${me}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ clinical_home: value }) });
    if (!res.ok) return { ok: false, error: 'It would not save.' };
    return { ok: true, change: `set their clinical home to ${service}${url ? ` (${url})` : ''}`, note: 'Members now see it on their profile and care team. Remind them plainly: clinical details belong there, not in Lichen chat.' };
  }

  return { ok: false, error: 'Unknown tool.' };
}
