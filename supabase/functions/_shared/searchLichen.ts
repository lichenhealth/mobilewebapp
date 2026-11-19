// search_my_lichen — ONE sweep across everything the member can see on
// Lichen, for a clue (founder 2026-11-19: "can you have it search the entire
// platform for clues, even drive, for example? As well as the open web").
// Their calendar (Lichen events, imported Google/ICS entries, tasks,
// bookings), their Drive (personal docs, files, folders, saved posts),
// their contact cards and guest lists, their chats, and Lichen's own
// directory (findable members, organizations/places/communities/groups,
// goods & services locations, public posts). Each source bows to its own
// section's AI switch; AI-free rooms are skipped; another member's chat words
// show only when that member lets assistants read them. Mail and the
// assistant history have their own tools (my_mail, search_my_history).

type SbFn = (path: string, init?: RequestInit) => Promise<Response>;

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'what', 'whats', 'where', 'when', 'was', 'were', 'have', 'from', 'name', 'named', 'called', 'place', 'some', 'thing', 'about', 'near', 'had', 'has', 'into', 'your', 'you', 'our', 'their', 'there', 'address', 'one', 'who']);
const arr = <T,>(x: unknown) => (Array.isArray(x) ? x : []) as T[];

export const SEARCH_LICHEN_TOOL = {
  name: 'search_my_lichen',
  description: 'Search EVERYTHING of theirs on Lichen at once for a clue — their calendar (Lichen events they made or were invited to, imported Google/ICS entries, tasks, bookings), their Drive (docs, sheets, slides, uploaded files, folders, saved posts), their contact cards and guest lists, their chats, AND Lichen\'s own directory (members, organizations, places, communities, groups, goods & services locations, public posts). Use it FIRST whenever they half-remember something ("the spa with hand in the name", "that doc about the retreat budget", "who was the farrier June mentioned") — then my_mail for their email, then web_search for the open web. query: the words they remember (a fragment like "hand" is fine). Returns matches with where each lives and a door to open it.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The words or fragment they remember.' },
    },
    required: ['query'],
  },
};

type Hit = { source: string; title: string; detail?: string; when?: string; open?: string; text: string };

export async function searchMyLichen(sb: SbFn, me: string, query: string, offSections: Set<string>) {
  const words = [...new Set(String(query).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).map((w) => w.replace(/'/g, ''))
    .filter((w) => w.length >= 3 && !STOP.has(w)))].slice(0, 4);
  if (!words.length) return { ok: false, error: 'Give me a word or two to look for.' };
  const or = (cols: string[]) => `or=(${cols.flatMap((c) => words.map((w) => `${c}.ilike.*${w}*`)).join(',')})`;
  const get = async (path: string) => { try { const r = await sb(path); return r.ok ? await r.json() : []; } catch { return []; } };
  const on = (s: string) => !offSections.has(s);
  const hits: Hit[] = [];
  const cut = (s: unknown, n = 160) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

  const jobs: Promise<void>[] = [];
  // ---- calendar
  if (on('calendar')) {
    jobs.push((async () => {
      const att = arr<{ event_id: string }>(await get(`event_attendees?profile_id=eq.${me}&select=event_id&limit=500`)).map((r) => r.event_id);
      const own = arr<Record<string, unknown>>(await get(`events?creator_id=eq.${me}&${or(['title', 'description', 'location'])}&select=id,title,description,location,start_date,start_min&order=start_date.desc&limit=10`));
      const inv = att.length ? arr<Record<string, unknown>>(await get(`events?id=in.(${att.slice(0, 300).join(',')})&${or(['title', 'description', 'location'])}&select=id,title,description,location,start_date,start_min&order=start_date.desc&limit=10`)) : [];
      const seen = new Set<string>();
      for (const e of [...own, ...inv]) {
        if (seen.has(String(e.id))) continue; seen.add(String(e.id));
        hits.push({ source: 'Lichen calendar', title: String(e.title ?? ''), detail: cut([e.location, e.description].filter(Boolean).join(' — ')), when: String(e.start_date ?? ''), open: `/calendar?d=${e.start_date}&e=${e.id}`, text: `${e.title} ${e.location} ${e.description}` });
      }
      for (const tbl of ['external_busy', 'external_show']) {
        const rows = arr<Record<string, unknown>>(await get(`${tbl}?profile_id=eq.${me}&${or(['title'])}&select=title,on_date,start_min,span_label&order=on_date.desc&limit=10`));
        const dedupe = new Set<string>();
        for (const r of rows) {
          const k = String(r.title); if (dedupe.has(k)) continue; dedupe.add(k);
          hits.push({ source: 'Imported calendar (Google/ICS)', title: String(r.title ?? ''), when: String(r.on_date ?? ''), open: `/calendar?d=${r.on_date}`, text: String(r.title ?? '') });
        }
      }
      for (const r of arr<Record<string, unknown>>(await get(`reminders?profile_id=eq.${me}&${or(['title'])}&select=title,start_date&order=start_date.desc&limit=8`)))
        hits.push({ source: 'Task / reminder', title: String(r.title ?? ''), when: String(r.start_date ?? ''), open: '/calendar?todo=1', text: String(r.title ?? '') });
      const bt = arr<{ id: string; title: string; profile_id: string }>(await get(`booking_types?${or(['title'])}&select=id,title,profile_id&limit=40`));
      if (bt.length) {
        const ids = bt.map((t) => t.id).join(',');
        const bk = arr<Record<string, unknown>>(await get(`bookings?type_id=in.(${ids})&or=(booker_id.eq.${me},provider_id.eq.${me})&select=id,type_id,on_date,start_min,status&order=on_date.desc&limit=8`));
        for (const b of bk) {
          const t = bt.find((x) => x.id === b.type_id);
          hits.push({ source: 'Booking', title: t?.title ?? 'Session', detail: String(b.status ?? ''), when: String(b.on_date ?? ''), open: `/bookings?b=${b.id}`, text: t?.title ?? '' });
        }
      }
    })());
  }
  // ---- Drive
  if (on('saved')) {
    jobs.push((async () => {
      for (const d of arr<Record<string, unknown>>(await get(`chat_docs?created_by=eq.${me}&chat_id=is.null&${or(['title', 'body'])}&select=id,kind,title,body,updated_at&order=updated_at.desc&limit=10`)))
        hits.push({ source: `Drive ${d.kind === 'sheet' ? 'spreadsheet' : d.kind === 'slides' ? 'presentation' : 'doc'}`, title: String(d.title || 'Untitled'), detail: cut(d.body), when: String(d.updated_at ?? '').slice(0, 10), open: `/docs/${d.id}`, text: `${d.title} ${d.body}` });
      for (const f of arr<Record<string, unknown>>(await get(`drive_files?profile_id=eq.${me}&${or(['title', 'path'])}&select=id,kind,title,path,created_at&limit=8`)))
        hits.push({ source: `Drive ${f.kind}`, title: String(f.title || String(f.path ?? '').split('/').pop()), when: String(f.created_at ?? '').slice(0, 10), open: '/drive', text: `${f.title} ${f.path}` });
      for (const c of arr<Record<string, unknown>>(await get(`collections?owner_id=eq.${me}&${or(['name', 'description'])}&select=id,name,description&limit=6`)))
        hits.push({ source: 'Drive folder', title: String(c.name ?? ''), detail: cut(c.description), open: `/collections/${c.id}`, text: `${c.name} ${c.description}` });
      const saved = arr<{ target_id: string }>(await get(`saved_items?profile_id=eq.${me}&target_type=eq.post&select=target_id&limit=400`)).map((r) => r.target_id);
      if (saved.length) for (const p of arr<Record<string, unknown>>(await get(`posts?id=in.(${saved.slice(0, 300).join(',')})&${or(['title', 'body'])}&select=id,title,body&limit=8`)))
        hits.push({ source: 'Saved post (Drive)', title: String(p.title || cut(p.body, 60)), detail: cut(p.body), open: `/posts/${p.id}`, text: `${p.title} ${p.body}` });
      // Contact cards + guest lists live under the same switch.
      for (const c of arr<Record<string, unknown>>(await get(`contacts?owner_id=eq.${me}&${or(['name', 'notes', 'address', 'website'])}&select=id,kind,name,address,website,phones,emails,notes&limit=10`)))
        hits.push({ source: `Contact card (${c.kind})`, title: String(c.name ?? ''), detail: cut([c.address, c.website, arr<string>(c.phones)[0], arr<string>(c.emails)[0], c.notes].filter(Boolean).join(' · ')), open: '/contacts', text: `${c.name} ${c.notes} ${c.address} ${c.website}` });
      for (const g of arr<Record<string, unknown>>(await get(`guest_lists?owner_id=eq.${me}&select=name,entries&limit=50`))) {
        const names = arr<Record<string, unknown>>(g.entries).map((e) => String(e.name ?? e.value ?? '')).filter(Boolean);
        const blob = `${g.name} ${names.join(' ')}`.toLowerCase();
        if (words.some((w) => blob.includes(w))) hits.push({ source: 'Guest list', title: String(g.name ?? ''), detail: cut(names.join(', ')), open: '/contacts', text: blob });
      }
    })());
  }
  // ---- chats (never AI-free rooms; others' words only when they allow it)
  if (on('chat')) {
    jobs.push((async () => {
      const mine = arr<{ chat_id: string }>(await get(`chat_members?profile_id=eq.${me}&select=chat_id&limit=400`)).map((r) => r.chat_id);
      if (!mine.length) return;
      const chats = arr<{ id: string; assistant_enabled: boolean | null; title: string | null; kind: string }>(await get(`chats?id=in.(${mine.slice(0, 300).join(',')})&select=id,assistant_enabled,title,kind`));
      const ok = chats.filter((c) => c.assistant_enabled !== false).map((c) => c.id);
      if (!ok.length) return;
      const msgs = arr<Record<string, unknown>>(await get(`chat_messages?chat_id=in.(${ok.join(',')})&${or(['body'])}&select=id,chat_id,sender_id,body,created_at&order=created_at.desc&limit=25`));
      const senders = [...new Set(msgs.map((m) => String(m.sender_id)).filter((s) => s !== me))];
      const people = senders.length ? arr<{ id: string; full_name: string; assistant_readable: boolean | null }>(await get(`profiles?id=in.(${senders.join(',')})&select=id,full_name,assistant_readable`)) : [];
      for (const m of msgs) {
        const who = m.sender_id === me ? null : people.find((p) => p.id === m.sender_id);
        if (who && who.assistant_readable === false) continue;
        const room = chats.find((c) => c.id === m.chat_id);
        hits.push({ source: 'Chat message', title: `${who ? who.full_name : 'You'}${room?.title ? ' · ' + room.title : ''}`, detail: cut(m.body, 220), when: String(m.created_at ?? '').slice(0, 10), open: `/chat/${m.chat_id}?m=${m.id}`, text: String(m.body ?? '') });
        if (hits.filter((h) => h.source === 'Chat message').length >= 10) break;
      }
    })());
  }
  // ---- Lichen's own directory (what any member can find)
  jobs.push((async () => {
    for (const s of arr<Record<string, unknown>>(await get(`spaces?findable=eq.true&status=eq.live&${or(['name', 'description', 'location'])}&select=id,kind,name,handle,location,description&limit=8`)))
      hits.push({ source: `On Lichen (${s.kind})`, title: String(s.name ?? ''), detail: cut([s.location, s.description].filter(Boolean).join(' — ')), open: s.handle ? `/${s.handle}` : `/spaces/${s.id}`, text: `${s.name} ${s.location} ${s.description}` });
    for (const p of arr<Record<string, unknown>>(await get(`profiles?findable=eq.true&onboarded=eq.true&kind=eq.person&${or(['full_name', 'headline'])}&select=id,full_name,headline&limit=6`)))
      hits.push({ source: 'Lichen member', title: String(p.full_name ?? ''), detail: cut(p.headline), open: `/members/${p.id}`, text: `${p.full_name} ${p.headline}` });
    for (const l of arr<Record<string, unknown>>(await get(`profile_locations?show_on_maps=eq.true&${or(['label', 'location'])}&select=profile_id,label,location&limit=6`)))
      hits.push({ source: 'Goods & services location', title: String(l.label ?? ''), detail: cut(l.location), open: `/members/${l.profile_id}`, text: `${l.label} ${l.location}` });
    if (on('market')) for (const p of arr<Record<string, unknown>>(await get(`posts?is_public=eq.true&${or(['title', 'body'])}&select=id,title,body,created_at&order=created_at.desc&limit=8`)))
      hits.push({ source: 'Post on Lichen', title: String(p.title || cut(p.body, 60)), detail: cut(p.body), when: String(p.created_at ?? '').slice(0, 10), open: `/posts/${p.id}`, text: `${p.title} ${p.body}` });
  })());

  await Promise.all(jobs);
  // A word counts when it STARTS a word in the text ("hand" → Hands, Handsome;
  // never the "spa" inside "space"). Matches holding every remembered word
  // lead; partial ones trail, a few at most.
  const res = words.map((w) => new RegExp(`(^|[^a-z0-9])${w}${w.length <= 3 ? "s?(?![a-z0-9])" : ""}`, "i"));
  const score = (h: Hit) => res.reduce((n, r) => n + (r.test(h.text) ? 1 : 0), 0);
  const scored = hits.map((h) => ({ h, s: score(h) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  const full = scored.filter((x) => x.s === words.length);
  const ranked = (full.length && words.length > 1 ? [...full, ...scored.filter((x) => x.s < words.length).slice(0, 5)] : scored).slice(0, 30);
  const off = ['calendar', 'saved', 'chat'].filter((s) => offSections.has(s));
  return {
    ok: true,
    searched_for: words,
    matches: ranked.map(({ h }) => ({ where: h.source, title: h.title, detail: h.detail || undefined, date: h.when || undefined, open: h.open })),
    ...(off.length ? { not_searched: `AI is off for ${off.join(', ')} — those weren't searched.` } : {}),
    note: ranked.length ? 'Each match names where it lives. Mail isn\'t included — use my_mail for that; for the open web, web_search.' : 'Nothing on Lichen matched. Try my_mail, then web_search, and a second spelling.',
  };
}
