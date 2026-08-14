import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import { useActing } from '../acting/ActingProvider';
import { colorFor, monogramFor } from '../lib/chatApi';
import { LinkifiedText } from '../components/CarePostCard';
import { locationInfo } from '../lib/linkify';

/** Location line: video links say "Join Zoom/Meet…", other URLs are plain
 *  links, physical addresses tap out to Google Maps directions. */
export function SmartLocation({ loc, className }: { loc: string; className: string }) {
  const info = locationInfo(loc);
  if (!info) return null;
  if (info.type === 'video') {
    return (
      <a className={className} href={info.url} target="_blank" rel="noopener noreferrer">
        <Icon name="video" size={13} /> Join {info.service}
      </a>
    );
  }
  if (info.type === 'link') {
    return (
      <a className={className} href={info.url} target="_blank" rel="noopener noreferrer">
        <Icon name="globe" size={13} /> {loc}
      </a>
    );
  }
  return (
    <a className={className} href={info.mapsUrl} target="_blank" rel="noopener noreferrer">
      <Icon name="location" size={13} /> {loc}
    </a>
  );
}
import { supabase } from '../lib/supabase';
import { localDate, toISO, todayISO, formatDateShort } from '../lib/conciergeApi';
import { occursOn, recurrenceLabel, weekdayMon0 } from '../lib/recurrence';
import { listReminders, listDone, setDone, remindersOn, type Reminder as ReminderRow } from '../lib/remindersApi';
import {
  EventRow, FreeBusyRow, MemberWindow,
  loadMyEvents, loadSpaceEvents, deleteEvent, rsvp, minToLabel, freeBusy, availabilityOf,
  loadMyExternalBusy, syncExternalCalendars,
  listCalendarPins, addCalendarPin, removeCalendarPin,
} from '../lib/calendarApi';
import TodoView from '../components/TodoView';
import './Calendar.css';
import AssistantDoor from '../components/AssistantDoor';

const HOUR_PX = 32; // compact rows — more of the day on screen
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type View = 'schedule' | 'day' | '3day' | 'week' | 'month' | 'todo';
type GridView = Exclude<View, 'todo'>;
const VIEW_LABELS: Record<GridView, string> = { schedule: 'Schedule', day: 'Day', '3day': '3 Days', week: 'Week', month: 'Month' };

/** Sunday that starts the week containing iso (grids are Sunday-first). */
export function sundayOfWeek(iso: string): string {
  const d = localDate(iso);
  d.setDate(d.getDate() - d.getDay());
  return toISO(d);
}
function addDays(iso: string, n: number): string {
  const d = localDate(iso); d.setDate(d.getDate() + n); return toISO(d);
}
function addMonths(iso: string, n: number): string {
  const d = localDate(iso); return toISO(new Date(d.getFullYear(), d.getMonth() + n, 1));
}
/** Full Sun-first cell range covering iso's month. */
function monthCells(iso: string): string[] {
  const d = localDate(iso);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const start = addDays(toISO(first), -first.getDay());
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const rows = Math.ceil((first.getDay() + daysInMonth) / 7);
  return Array.from({ length: rows * 7 }, (_, i) => addDays(start, i));
}

/** My calendar — Day / 3 Days / Week time grids + Month overview + search. */
export default function Calendar() {
  const { user } = useAuth();
  const me = user?.id ?? '';
  const { actor } = useActing();
  const navigate = useNavigate();
  // Arrived via Events > My Calendar → offer the way back (maps' ?from= pattern)
  const [urlParams] = useSearchParams();
  const fromEvents = urlParams.get('from') === 'events';
  const today = todayISO();

  // Schedule (agenda list) is the phone default — a 7-column grid through a
  // keyhole is nobody's friend (founder + Gabe, 2026-07-17).
  const [view, setView] = useState<View>(() =>
    window.matchMedia('(max-width: 640px)').matches ? 'schedule' : 'week');
  // To-Do is a peer "view" toggled from the toolbar; toggling off returns to
  // the grid view you were on.
  const [prevGridView, setPrevGridView] = useState<GridView>('week');
  const toggleTodo = () => {
    if (view === 'todo') setView(prevGridView);
    else { setPrevGridView(view as GridView); setView('todo'); }
  };
  const [anchor, setAnchor] = useState(todayISO());
  const [events, setEvents] = useState<EventRow[]>([]);
  // Private nudges — never busy, never shared (Gabe's Reminders, 2026-07-18).
  const [reminders, setReminders] = useState<ReminderRow[]>([]);
  const [remDone, setRemDone] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<EventRow | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchPool, setSearchPool] = useState<EventRow[]>([]);
  const gridRef = useRef<HTMLDivElement>(null);

  // Which calendars are showing — additive, like every lens row: Mine starts
  // on, tap a space chip to layer its events in (tap again to drop it).
  const [calendars, setCalendars] = useState<{ id: string; name: string }[]>([]);
  const [selectedCals, setSelectedCals] = useState<string[]>(['me']);
  // Follows whoever the TopBar says you're acting as (founder 2026-08-10) —
  // acting as a space shows ITS calendar, not "Mine" (Galyn's) by default.
  useEffect(() => {
    setSelectedCals(actor.type === 'space' ? [actor.id] : ['me']);
  }, [actor]);
  const [overlayOn, setOverlayOn] = useState(false);
  // Find-a-time spans EVERY selected space (founder 2026-07-22): the more
  // groups you add, the more availability narrows toward when ALL their
  // members are free. Mine may be on alongside.
  const spaceSel = selectedCals.filter((x) => x !== 'me');
  const spaceKey = spaceSel.join(',');
  const primarySpace = spaceSel[0] ?? null;   // organizer when creating from a slot
  const toggleCal = (id: string) => {
    setSelectedCals((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    setOverlayOn(false);
  };
  // Search-first picker (founder 2026-08-14): the row no longer lists every
  // membership as a bubble — type into "Add a calendar" instead. Empty query
  // = the full membership list, so focus alone still shows everything.
  const [calQ, setCalQ] = useState('');
  const [calAddOpen, setCalAddOpen] = useState(false);
  const calChoices = useMemo(() => {
    const q = calQ.trim().toLowerCase();
    return calendars
      .filter((c) => !selectedCals.includes(c.id))
      .filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [calendars, selectedCals, calQ]);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [fbRows, setFbRows] = useState<FreeBusyRow[]>([]);
  const [memberWindows, setMemberWindows] = useState<MemberWindow[]>([]);

  // Searched-calendar overlays: ephemeral side-by-side schedules (person or
  // space), each a dismissible chip. Re-search to bring one back — no saving.
  interface CalOverlay { kind: 'profile' | 'space'; id: string; name: string }
  // PINNED person/space overlays (founder, 2026-07-17): calendars you add
  // from search stay put — per-viewer consent (calendar_shares) decides what
  // each renders. Synced across devices via calendar_pins; localStorage is
  // only a seed while signed-out plus a one-time migration source.
  const [overlays, setOverlays] = useState<CalOverlay[]>(() => {
    try { return JSON.parse(localStorage.getItem('calp:pins') || '[]') as CalOverlay[]; }
    catch { return []; }
  });
  useEffect(() => {
    if (!me) return;
    let live = true;
    (async () => {
      const probe = await listCalendarPins(me);
      if (probe === null) return; // table not ready — device-local pins stand
      // Migrate any device-local pins up, once, then the table is the truth.
      let local: CalOverlay[] = [];
      try { local = JSON.parse(localStorage.getItem('calp:pins') || '[]') as CalOverlay[]; } catch { /* fine */ }
      for (const o of local) await addCalendarPin(me, o.kind, o.id, o.name);
      localStorage.removeItem('calp:pins');
      const pins = local.length ? (await listCalendarPins(me) ?? probe) : probe;
      if (!live) return;
      setOverlays(pins.map((p) => ({ kind: p.target_kind, id: p.target_id, name: p.name })));
    })();
    return () => { live = false; };
  }, [me]);
  const [overlayRows, setOverlayRows] = useState<Record<string, FreeBusyRow[]>>({});
  const [calResults, setCalResults] = useState<CalOverlay[]>([]);

  // Visible days per view; month uses its own cell range.
  const days = useMemo(() => {
    if (view === 'schedule') return Array.from({ length: 30 }, (_, i) => addDays(anchor, i));
    if (view === 'month') return monthCells(anchor);
    if (view === 'week') return Array.from({ length: 7 }, (_, i) => addDays(sundayOfWeek(anchor), i));
    return Array.from({ length: view === 'day' ? 1 : 3 }, (_, i) => addDays(anchor, i));
  }, [view, anchor]);
  const from = days[0], to = days[days.length - 1];

  const load = useCallback(async () => {
    if (!me) return;
    setLoading(true);
    // Merge every selected source; an event visible from two sources (mine +
    // its space) appears once. All chips off = an honestly empty calendar.
    const sources = await Promise.all([
      selectedCals.includes('me') ? loadMyEvents(me, from, to) : Promise.resolve([]),
      ...spaceSel.map((id) => loadSpaceEvents(id, from, to)),
    ]);
    const byId = new Map<string, EventRow>();
    for (const arr of sources) for (const ev of arr) byId.set(ev.id, ev);
    // Imported busy blocks ride along on YOUR calendar — muted, read-only.
    if (selectedCals.includes('me')) {
      for (const b of await loadMyExternalBusy(me, from, to)) {
        byId.set('ext:' + b.id, {
          id: 'ext:' + b.id, creator_id: '', owner_profile_id: me, owner_space_id: null,
          title: b.title || 'Busy', description: '', location: '', lat: null, lng: null,
          start_date: b.on_date, end_date: b.on_date, all_day: b.all_day,
          start_min: b.start_min, end_min: b.end_min, recurrence: null,
          created_at: '', external: true, tint: colorFor('extcal:' + b.calendar_id),
        });
      }
    }
    setEvents([...byId.values()]);
    // Reminders ride only on YOUR calendar chip; a graceful [] before the
    // migration runs (listReminders warns and returns empty).
    if (selectedCals.includes('me')) {
      const rems = await listReminders(me);
      setReminders(rems);
      setRemDone(await listDone(me, rems.map((r) => r.id), from, to));
    } else setReminders([]);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, from, to, selectedCals.join(',')]);
  useEffect(() => { load(); }, [load]);

  // Refresh imported calendars quietly on arrival (the edge function skips
  // anything synced in the last 30 minutes), then fold new blocks in.
  useEffect(() => {
    if (!me) return;
    let live = true;
    syncExternalCalendars().then(() => { if (live) load(); }).catch(() => { /* no external calendars / offline */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  // My spaces → calendar chips.
  useEffect(() => {
    if (!me) return;
    (async () => {
      const { data } = await supabase.from('space_members').select('spaces(id, name)').eq('profile_id', me);
      setCalendars(((data as unknown as { spaces: { id: string; name: string } | null }[] | null) ?? [])
        .map((r) => r.spaces).filter((s): s is { id: string; name: string } => !!s));
    })();
  }, [me]);

  // Find-a-time overlay data: the space's members' busy fragments + declared hours.
  useEffect(() => {
    if (!overlayOn || spaceSel.length === 0 || view === 'month' || view === 'schedule') { setFbRows([]); setMemberWindows([]); return; }
    (async () => {
      const { data } = await supabase.from('space_members').select('profile_id').in('space_id', spaceSel);
      const ids = [...new Set(((data as { profile_id: string }[] | null) ?? []).map((r) => r.profile_id))];
      setMemberIds(ids);
      const [fb, wins] = await Promise.all([freeBusy(ids, from, to), availabilityOf(ids)]);
      setFbRows(fb); setMemberWindows(wins);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayOn, spaceKey, view, from, to]);

  /** Free members for a 30-min slot: not busy, and (if they declared hours)
   *  inside a declared window. Members with no declared hours count as free
   *  whenever they're not busy. */
  const freeMembersAt = (iso: string, slotStart: number): string[] => {
    const slotEnd = slotStart + 30;
    const wd = weekdayMon0(iso);
    return memberIds.filter((pid) => {
      const busy = fbRows.some((r) =>
        r.profile_id === pid && occursOn(r, iso)
        && (r.all_day || ((r.start_min ?? 0) < slotEnd && (r.end_min ?? 1440) > slotStart)));
      if (busy) return false;
      const wins = memberWindows.filter((w) =>
        w.profile_id === pid && w.kind === 'available'
        && (!w.valid_from || w.valid_from <= iso) && (!w.valid_to || w.valid_to >= iso));
      if (wins.length === 0) return true;
      return wins.some((w) => w.weekday === wd && w.start_min < slotEnd && w.end_min > slotStart);
    });
  };

  // Open time views scrolled to the working morning. #root is the app's
  // scroller (the document is pinned — see global.css).
  useEffect(() => {
    const scroller = document.getElementById('root');
    if (view === 'month' || view === 'schedule' || view === 'todo') { (scroller ?? window).scrollTo({ top: 0 }); return; }
    const el = gridRef.current;
    if (!el) return;
    // Land 7am just below the pinned toolbar+day-header stack.
    const y = el.getBoundingClientRect().top + (scroller?.scrollTop ?? window.scrollY) + 7 * HOUR_PX - 210;
    if (y > 0) (scroller ?? window).scrollTo({ top: y });
  }, [view]);

  // Search pulls a wide window once, then filters live.
  useEffect(() => {
    if (!searchOpen || !me) return;
    (async () => setSearchPool(await loadMyEvents(me, addDays(today, -60), addDays(today, 180))))();
  }, [searchOpen, me, today]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return searchPool
      .filter((e) => e.title.toLowerCase().includes(q) || e.location.toLowerCase().includes(q))
      .slice(0, 12);
  }, [query, searchPool]);

  // Search CALENDARS too: members by name, spaces by name.
  useEffect(() => {
    const q = query.trim();
    if (!searchOpen || q.length < 2) { setCalResults([]); return; }
    let live = true;
    (async () => {
      const [pRes, sRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name').ilike('full_name', `%${q}%`).neq('id', me).limit(5),
        supabase.from('spaces').select('id, name').ilike('name', `%${q}%`).limit(5),
      ]);
      if (!live) return;
      setCalResults([
        ...(((pRes.data as { id: string; full_name: string | null }[] | null) ?? [])
          .map((p) => ({ kind: 'profile' as const, id: p.id, name: p.full_name || 'Member' }))),
        ...(((sRes.data as { id: string; name: string }[] | null) ?? [])
          .map((s) => ({ kind: 'space' as const, id: s.id, name: s.name }))),
      ]);
    })();
    return () => { live = false; };
  }, [query, searchOpen, me]);

  // Fetch each overlay's schedule for the visible window. A person's calendar
  // comes through free_busy (their visibility rules applied — busy blocks, or
  // titles if they've granted details); a space's is its own events.
  useEffect(() => {
    if (overlays.length === 0) { setOverlayRows({}); return; }
    let live = true;
    (async () => {
      const entries = await Promise.all(overlays.map(async (o): Promise<[string, FreeBusyRow[]]> => {
        if (o.kind === 'profile') return [o.id, await freeBusy([o.id], from, to)];
        const evs = await loadSpaceEvents(o.id, from, to);
        return [o.id, evs.map((e) => ({
          profile_id: o.id, level: 'details' as const,
          start_date: e.start_date, end_date: e.end_date, all_day: e.all_day,
          start_min: e.start_min, end_min: e.end_min, recurrence: e.recurrence, title: e.title,
        }))];
      }));
      if (live) setOverlayRows(Object.fromEntries(entries));
    })();
    return () => { live = false; };
  }, [overlays, from, to]);

  const addOverlay = (o: CalOverlay) => {
    setOverlays((cur) => (cur.some((x) => x.id === o.id) ? cur : [...cur, o]));
    if (me) void addCalendarPin(me, o.kind, o.id, o.name);
    setSearchOpen(false); setQuery('');
  };
  const removeOverlay = (id: string) => {
    const gone = overlays.find((o) => o.id === id);
    setOverlays((cur) => cur.filter((o) => o.id !== id));
    if (me && gone) void removeCalendarPin(me, gone.kind, gone.id);
  };

  const page = (dir: 1 | -1) => {
    if (view === 'month') setAnchor(addMonths(anchor, dir));
    else if (view === 'schedule') setAnchor(addDays(anchor, 30 * dir));
    else if (view === 'week') setAnchor(addDays(anchor, 7 * dir));
    else setAnchor(addDays(anchor, (view === 'day' ? 1 : 3) * dir));
  };

  const timedOn = (iso: string) =>
    events.filter((e) => !e.all_day && occursOn(e, iso)).sort((a, b) => (a.start_min ?? 0) - (b.start_min ?? 0));

  /** Google-style overlap layout: events that overlap in time share the
   *  column side-by-side instead of stacking (founder, 2026-07-17 — a long
   *  block's title was buried under shorter ones). Greedy column assignment
   *  within each cluster of transitively-overlapping events. */
  const layoutDay = (list: EventRow[]): Map<string, { col: number; cols: number }> => {
    const out = new Map<string, { col: number; cols: number }>();
    let cluster: { id: string; col: number }[] = [];
    const colEnds: number[] = [];
    let clusterEnd = 0;
    const flush = () => {
      const cols = Math.max(1, colEnds.length);
      for (const c of cluster) out.set(c.id, { col: c.col, cols });
      cluster = []; colEnds.length = 0; clusterEnd = 0;
    };
    for (const e of list) {
      const start = e.start_min ?? 0;
      const end = Math.max(e.end_min ?? start + 60, start + 15);
      if (cluster.length && start >= clusterEnd) flush();
      let col = colEnds.findIndex((busyUntil) => busyUntil <= start);
      if (col === -1) { col = colEnds.length; colEnds.push(0); }
      colEnds[col] = end;
      cluster.push({ id: e.id, col });
      clusterEnd = Math.max(clusterEnd, end);
    }
    flush();
    return out;
  };
  const allDayOn = (iso: string) => events.filter((e) => e.all_day && occursOn(e, iso));
  const remsOn = (iso: string) => selectedCals.includes('me') ? remindersOn(reminders, iso) : [];
  const remKey = (r: ReminderRow, iso: string) => `${r.id}:${iso}`;
  const toggleRem = (r: ReminderRow, iso: string) => {
    const k = remKey(r, iso);
    const done = remDone.has(k);
    setRemDone((cur) => {
      const n = new Set(cur);
      if (done) n.delete(k); else n.add(k);
      return n;
    });
    void setDone(me, r.id, iso, !done).catch(console.error);
  };
  const anyOn = (iso: string) => events.filter((e) => occursOn(e, iso));
  const hasAllDayRow = days.some((d) => allDayOn(d).length > 0 || remsOn(d).length > 0);

  async function onDelete(ev: EventRow) { await deleteEvent(ev.id); setSelected(null); load(); }
  async function onRsvp(ev: EventRow, status: 'going' | 'tentative' | 'declined') { await rsvp(ev.id, me, status); setSelected(null); load(); }

  const headerLabel = view === 'schedule'
    // The 30-day window can straddle months — label the span, not a midpoint.
    ? `${localDate(days[0]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${localDate(days[days.length - 1]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    : localDate(view === 'month' ? anchor : days[Math.floor(days.length / 2)])
      .toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const myAttend = (ev: EventRow) => ev.attendees?.find((a) => a.profile_id === me);
  // Google-style block state: pending invite / tentative = white w/ peach
  // outline; declined = faded.
  /** Per-source hue: spaces + imported calendars wear their stable color
   *  (mine stays peach) so layered calendars read at a glance. */
  const tintOf = (ev: EventRow): string | null =>
    ev.tint ?? (ev.owner_space_id ? colorFor(ev.owner_space_id) : null);
  const blockClass = (ev: EventRow, base: string) => {
    if (ev.external) return `${base} ${base}--external`;
    const st = ev.creator_id !== me ? myAttend(ev)?.status : undefined;
    return base + (st === 'invited' || st === 'tentative' ? ` ${base}--pending` : st === 'declined' ? ` ${base}--declined` : '');
  };
  const jumpToDay = (iso: string) => { setAnchor(iso); setView('day'); };

  // Drag-to-create (mouse): press on an empty slot and drag — an orange box
  // grows with the selection; release opens the composer with that span.
  // A plain click/tap creates at the slot with the default duration. Touch
  // drags stay reserved for scrolling (the browser fires pointercancel).
  const dragRef = useRef<{ iso: string; anchor: number; start: number; end: number; moved: boolean } | null>(null);
  const [drag, setDrag] = useState<{ iso: string; start: number; end: number } | null>(null);
  const slotAt = (e: React.PointerEvent, el: HTMLElement) =>
    Math.max(0, Math.min(1410, Math.floor((e.clientY - el.getBoundingClientRect().top) / (HOUR_PX / 2)) * 30));

  /** Query string for the composer: overlaid people come along as invitees
   *  ("Blair's calendar is on my screen → she's who I'm scheduling with"). */
  const composerQS = (extra: string[] = []) => {
    const parts = [...extra];
    if (primarySpace) parts.push(`space=${primarySpace}`);
    const ids = overlays.filter((o) => o.kind === 'profile').map((o) => o.id);
    if (ids.length) parts.push(`inv=${ids.join(',')}`);
    return parts.length ? `?${parts.join('&')}` : '';
  };

  const onColDown = (iso: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return; // blocks/slots own their clicks
    const s = slotAt(e, e.currentTarget);
    dragRef.current = { iso, anchor: s, start: s, end: s + 30, moved: false };
    setDrag({ iso, start: s, end: s + 30 });
    if (e.pointerType === 'mouse') e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onColMove = (iso: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.iso !== iso || e.pointerType !== 'mouse') return;
    const s = slotAt(e, e.currentTarget);
    if (s !== d.anchor) d.moved = true;
    d.start = Math.min(d.anchor, s);
    d.end = Math.max(d.anchor + 30, s + 30);
    setDrag({ iso, start: d.start, end: d.end });
  };
  const onColUp = (iso: string) => () => {
    // Everything read from the ref — immune to state/render timing.
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d || d.iso !== iso) return;
    navigate('/calendar/new' + composerQS([
      `date=${iso}`, `start=${d.start}`,
      ...(d.moved ? [`end=${d.end}`] : []),
    ]));
  };
  const onColCancel = () => { dragRef.current = null; setDrag(null); };

  const gridCols = { gridTemplateColumns: `44px repeat(${days.length}, 1fr)` };

  return (
    <div className="calp">
      {/* Frozen unit (à la Google Cal): toolbar + day header stay pinned; the
          hour grid slides up and hides beneath them. The + lives here too, so
          nothing above the pin matters — no title row, grid starts high. */}
      {fromEvents && (
        <button className="cmp__back calp__backchip" onClick={() => navigate('/events')}>
          <Icon name="arrow-left" size={14} /> Events
        </button>
      )}
      <div className="calp__pin">
        <div className="calp__toolbar">
          <button
            className={'calp__tool' + (searchOpen ? ' is-on' : '')}
            onClick={() => { setSearchOpen((s) => !s); setQuery(''); }}
            aria-label="Search events"
          >
            <Icon name="search" size={15} />
          </button>
          <div className="calp__nav">
            <button className="calp__navbtn" onClick={() => page(-1)} aria-label="Previous"><Icon name="chevron-left" size={16} /></button>
            <button className="calp__month" onClick={() => setAnchor(todayISO())}>{headerLabel}</button>
            <button className="calp__navbtn" onClick={() => page(1)} aria-label="Next"><Icon name="chevron-right" size={16} /></button>
          </div>
          {/* Wrap break: search + date on row 1, action controls together on row 2 (narrow screens). */}
          <span className="calp__tbbreak" aria-hidden="true" />
          <button
            className={'calp__todo-toggle' + (view === 'todo' ? ' is-on' : '')}
            onClick={toggleTodo}
            aria-pressed={view === 'todo'}
            title="To-do list"
          >
            To Do
          </button>
          <select className="calp__vselect" value={view === 'todo' ? prevGridView : view} onChange={(e) => setView(e.target.value as View)} aria-label="View">
            {(Object.keys(VIEW_LABELS) as GridView[]).map((v) => <option key={v} value={v}>{VIEW_LABELS[v]}</option>)}
          </select>
          <button className="calp__tool" onClick={() => navigate('/bookings')} aria-label="Bookings" title="Sessions & requests">
            <Icon name="member-heart" size={15} />
          </button>
          <AssistantDoor section="calendar" label="Your assistant — what's coming, what's unanswered" />
          <button className="calp__tool" onClick={() => navigate('/calendar/settings')} aria-label="Calendar settings">
            <Icon name="settings" size={15} />
          </button>
          <button
            className="calp__tool calp__tool--new"
            onClick={() => navigate('/calendar/new' + composerQS())}
            aria-label="New event"
          >
            <svg width="14" height="14" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M9 3.75V14.25M3.75 9H14.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Calendar chips — ADDITIVE, and SEARCH-FIRST (founder 2026-08-14:
            "with so many calendars... lets just have search right off the bat,
            'Add a calendar' being the prompt"). Only Mine + calendars that are
            ON render as chips; everything else is found by typing. Tap a chip
            to drop it. */}
        <div className="calp__chips">
          <button
            className={'calp__calchip' + (selectedCals.includes('me') ? ' is-on' : '')}
            onClick={() => toggleCal('me')}
            aria-pressed={selectedCals.includes('me')}
          >
            Mine
          </button>
          {calendars.filter((c) => selectedCals.includes(c.id)).map((c) => (
            <button
              key={c.id}
              className="calp__calchip is-on"
              onClick={() => toggleCal(c.id)}
              title={`Remove ${c.name}`}
            >
              <span className="calp__chipdot" style={{ background: colorFor(c.id) }} />
              {c.name}
              <span className="calp__chipx" aria-hidden="true">×</span>
            </button>
          ))}
          <input
            className="calp__addcal"
            placeholder="Add a calendar…"
            value={calQ}
            onChange={(e) => setCalQ(e.target.value)}
            onFocus={() => setCalAddOpen(true)}
            onBlur={() => setCalAddOpen(false)}
            aria-label="Add a calendar"
          />
          {spaceSel.length > 0 && view !== "month" && view !== "schedule" && (
            <button
              className={'calp__calchip calp__calchip--overlay' + (overlayOn ? ' is-on' : '')}
              onClick={() => setOverlayOn((o) => !o)}
              title="Shade times when members are free"
            >
              Everyone free?
            </button>
          )}
        </div>
        {/* The add-a-calendar results live BELOW the chip row (it scrolls
            horizontally — a dropdown inside it would clip). An empty query
            lists every calendar you're a member of, so nothing that used to
            be a bubble became unfindable. Actions run on POINTERDOWN with
            preventDefault: it fires before the input's blur can close the
            panel, and keeps focus in the input so you can add several.
            (A plain onClick never fires here — blur unmounts the panel
            between pointerdown and click.) */}
        {calAddOpen && (
          <div className="calp__search">
            {calChoices.map((c) => (
              <button
                className="calp__result" key={c.id}
                onPointerDown={(e) => { e.preventDefault(); toggleCal(c.id); setCalQ(''); }}
              >
                <span className="calp__result-title">
                  <span className="calp__chipdot" style={{ background: colorFor(c.id) }} />
                  {c.name}
                </span>
                <span className="calp__result-when">add</span>
              </button>
            ))}
            {calChoices.length === 0 && !calQ.trim() && (
              <p className="calp__result-none">
                {calendars.length === 0
                  ? 'When you join a group, its calendar will show up here.'
                  : 'Every calendar from your groups is already on.'}
              </p>
            )}
            {calQ.trim() && (
              <button
                className="calp__result"
                onPointerDown={(e) => { e.preventDefault(); setQuery(calQ.trim()); setSearchOpen(true); setCalQ(''); setCalAddOpen(false); }}
              >
                <span className="calp__result-title">Search all of Lichen for “{calQ.trim()}”</span>
                <span className="calp__result-when">members &amp; groups</span>
              </button>
            )}
          </div>
        )}
        {searchOpen && (
          <div className="calp__search">
            <input
              className="calp__search-input" placeholder="Search events & calendars…" autoFocus
              value={query} onChange={(e) => setQuery(e.target.value)}
            />
            {calResults.length > 0 && <p className="calp__result-head">Calendars</p>}
            {calResults.map((c) => (
              <button className="calp__result" key={c.kind + c.id} onClick={() => addOverlay(c)}>
                <span className="calp__result-title">
                  <span className="calp__ovdot" style={{ background: colorFor(c.id) }} />
                  {c.name}
                </span>
                <span className="calp__result-when">{c.kind === 'profile' ? 'member' : 'space'} · overlay</span>
              </button>
            ))}
            {calResults.length > 0 && results.length > 0 && <p className="calp__result-head">Events</p>}
            {results.map((e) => (
              <button className="calp__result" key={e.id} onClick={() => { setSearchOpen(false); setQuery(''); jumpToDay(e.start_date); }}>
                <span className="calp__result-title">{e.title}</span>
                <span className="calp__result-when">
                  {e.recurrence ? recurrenceLabel(e.recurrence, e.start_date) : formatDateShort(e.start_date)}
                  {!e.all_day && e.start_min != null && ` · ${minToLabel(e.start_min)}`}
                </span>
              </button>
            ))}
            {query.trim() && results.length === 0 && calResults.length === 0 && (
              <p className="calp__result-none">No matching events or calendars.</p>
            )}
          </div>
        )}

        {/* Overlaid calendars (from search) — dismissible, never saved */}
        {overlays.length > 0 && (
          <div className="calp__ovchips">
            {overlays.map((o) => (
              <span className="calp__ovchip" key={o.id} style={{ borderColor: colorFor(o.id) }}>
                <span className="calp__ovdot" style={{ background: colorFor(o.id) }} />
                {o.name}
                <button className="calp__ovx" onClick={() => removeOverlay(o.id)} aria-label={`Remove ${o.name}`}>×</button>
              </span>
            ))}
          </div>
        )}
        {view !== 'month' && view !== 'schedule' && view !== 'todo' && (
          <div className="calp__days" style={gridCols}>
            <span className="calp__gutter-head" />
            {days.map((iso) => (
              <div className="calp__day" key={iso}>
                <span className="calp__day-name">{DAY_LABELS[localDate(iso).getDay()]}</span>
                <span className={'calp__day-num' + (iso === today ? ' is-today' : '')}>{localDate(iso).getDate()}</span>
              </div>
            ))}
          </div>
        )}
        {/* All-day + reminders ride INSIDE the pin so they stay frozen with
            the day header — reminders are top-matter you keep in view. */}
        {view !== 'month' && view !== 'schedule' && view !== 'todo' && hasAllDayRow && (
          <div className="calp__alldays" style={gridCols}>
            <span className="calp__gutter-head" />
            {days.map((iso) => (
              <div className="calp__allday-col" key={iso}>
                {remsOn(iso).map((r) => {
                  const done = remDone.has(remKey(r, iso));
                  return (
                    <div
                      className={'calp__chip calp__chip--rem' + (done ? ' is-done' : '')}
                      key={'rem:' + r.id}
                    >
                      <button
                        className="calp__rem-box"
                        aria-label={done ? 'Mark not done' : 'Mark done'}
                        onClick={(e) => { e.stopPropagation(); toggleRem(r, iso); }}
                      >{done ? '✓' : ''}</button>
                      <button
                        className="calp__rem-open"
                        onClick={() => { if (r.profile_id === me) navigate(`/calendar/new?reminder=${r.id}`); }}
                        title="Edit reminder"
                      >{r.title}</button>
                    </div>
                  );
                })}
                {allDayOn(iso).map((e) => (
                  <button className={blockClass(e, 'calp__chip')} key={e.id} onClick={() => setSelected(e)}>{e.title}</button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {view === 'todo' ? (
        <TodoView
          me={me}
          reminders={reminders}
          remDone={remDone}
          onToggleRem={toggleRem}
          days={Array.from({ length: 30 }, (_, i) => addDays(today, i))}
          today={today}
        />
      ) : view === 'schedule' ? (
        <div className="calp__sched">
          {days.map((iso) => {
            const evs = anyOn(iso).sort((a, b) =>
              (a.all_day === b.all_day ? (a.start_min ?? 0) - (b.start_min ?? 0) : a.all_day ? -1 : 1));
            const ovs = overlays.flatMap((o) =>
              (overlayRows[o.id] ?? []).filter((r) => occursOn(r, iso)).map((r) => ({ o, r })));
            const rems = remsOn(iso);
            if (evs.length === 0 && ovs.length === 0 && rems.length === 0) return null;
            return (
              <div className="calp__sched-day" key={iso}>
                <div className={'calp__sched-date' + (iso === today ? ' is-today' : '')}>
                  <span className="calp__sched-dow">{DAY_LABELS[localDate(iso).getDay()]}</span>
                  <span className="calp__sched-num">{localDate(iso).getDate()}</span>
                </div>
                <div className="calp__sched-list">
                  {rems.map((r) => {
                    const done = remDone.has(remKey(r, iso));
                    return (
                      <div
                        key={'rem:' + r.id + iso}
                        className={'calp__sched-item calp__rem' + (done ? ' is-done' : '')}
                      >
                        <button
                          className="calp__rem-check calp__rem-check--btn"
                          aria-label={done ? 'Mark not done' : 'Mark done'}
                          onClick={(e) => { e.stopPropagation(); toggleRem(r, iso); }}
                        >{done ? '✓' : ''}</button>
                        <button
                          className="calp__rem-open calp__rem-open--sched"
                          onClick={() => { if (r.profile_id === me) navigate(`/calendar/new?reminder=${r.id}`); }}
                          title="Edit reminder"
                        >
                          <span className="calp__sched-title">{r.title}</span>
                          {r.at_min != null && <span className="calp__sched-when">{minToLabel(r.at_min)}</span>}
                        </button>
                      </div>
                    );
                  })}
                  {evs.map((e) => {
                    const t = tintOf(e);
                    return (
                      <button
                        key={e.id + iso}
                        className={blockClass(e, 'calp__sched-item')}
                        style={t ? { borderLeftColor: t } : undefined}
                        onClick={() => setSelected(e)}
                      >
                        <span className="calp__sched-when">
                          {e.all_day ? 'All day' : `${minToLabel(e.start_min ?? 0)} – ${minToLabel(e.end_min ?? e.start_min ?? 0)}`}
                        </span>
                        <span className="calp__sched-title">{e.title}</span>
                      </button>
                    );
                  })}
                  {ovs.map(({ o, r }, i) => (
                    <span key={o.id + i} className="calp__sched-item calp__sched-item--ov" style={{ borderLeftColor: colorFor(o.id) }}>
                      <span className="calp__sched-when">
                        {r.all_day ? 'All day' : `${minToLabel(r.start_min ?? 0)} – ${minToLabel(r.end_min ?? 0)}`}
                      </span>
                      <span className="calp__sched-title">{o.name}{r.title ? ` · ${r.title}` : ' · busy'}</span>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
          {days.every((iso) => anyOn(iso).length === 0
            && overlays.every((o) => !(overlayRows[o.id] ?? []).some((r) => occursOn(r, iso)))) && (
            <p className="calp__sched-empty">Nothing scheduled in the next month. The + is right up there.</p>
          )}
        </div>
      ) : view === 'month' ? (
        /* ── Month overview ── */
        <div className="calp__card">
          <div className="calp__mweek">
            {DAY_LABELS.map((d) => <span className="calp__day-name" key={d}>{d}</span>)}
          </div>
          <div className="calp__mgrid">
            {days.map((iso) => {
              const inMonth = localDate(iso).getMonth() === localDate(anchor).getMonth();
              const evs = anyOn(iso);
              return (
                <button
                  className={'calp__mcell' + (inMonth ? '' : ' is-out') + (iso === today ? ' is-today' : '')}
                  key={iso} onClick={() => jumpToDay(iso)}
                >
                  <span className={'calp__mnum' + (iso === today ? ' is-today' : '')}>{localDate(iso).getDate()}</span>
                  <span className="calp__mdots">
                    {evs.slice(0, 3).map((e) => <span className={blockClass(e, 'calp__mdot')} key={e.id} />)}
                    {evs.length > 3 && <span className="calp__mmore">+{evs.length - 3}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        /* ── Time grid (Day / 3 Days / Week) — day header lives in the pin ── */
        <div className="calp__card calp__card--flush">
          <div className="calp__grid" ref={gridRef}>
            <div className="calp__grid-inner" style={{ height: 24 * HOUR_PX, ...gridCols }}>
              <div className="calp__gutter">
                {Array.from({ length: 23 }, (_, h) => (
                  <span className="calp__hour" key={h + 1} style={{ top: (h + 1) * HOUR_PX }}>{minToLabel((h + 1) * 60)}</span>
                ))}
              </div>
              {days.map((iso) => (
                <div
                  className="calp__col" key={iso}
                  onPointerDown={onColDown(iso)}
                  onPointerMove={onColMove(iso)}
                  onPointerUp={onColUp(iso)}
                  onPointerCancel={onColCancel}
                >
                  {Array.from({ length: 23 }, (_, h) => (
                    <span className="calp__line" key={h + 1} style={{ top: (h + 1) * HOUR_PX }} />
                  ))}
                  {/* Find-a-time shading: greener = more members free; tap to book */}
                  {overlayOn && spaceSel.length > 0 && memberIds.length > 0 &&
                    Array.from({ length: 48 }, (_, s) => s * 30).map((slot) => {
                      const free = freeMembersAt(iso, slot);
                      if (free.length === 0) return null;
                      const strong = free.length === memberIds.length;
                      return (
                        <button
                          key={`fa-${slot}`}
                          className={'calp__slot calp__slot--free' + (strong ? ' is-strong' : '')}
                          style={{ top: (slot / 60) * HOUR_PX, height: HOUR_PX / 2 }}
                          title={`${free.length}/${memberIds.length} free at ${minToLabel(slot)}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/calendar/new?${primarySpace ? `space=${primarySpace}&` : ""}date=${iso}&start=${slot}&inv=${free.filter((p) => p !== me).join(',')}`);
                          }}
                        />
                      );
                    })}
                  {/* Live drag-to-create selection box */}
                  {drag && drag.iso === iso && (
                    <span
                      className="calp__dragbox"
                      style={{ top: (drag.start / 60) * HOUR_PX, height: ((drag.end - drag.start) / 60) * HOUR_PX }}
                    >
                      {minToLabel(drag.start)} – {minToLabel(drag.end)}
                    </span>
                  )}
                  {/* Searched-calendar overlays: their schedule beside yours */}
                  {overlays.map((o) =>
                    (overlayRows[o.id] ?? []).filter((r) => occursOn(r, iso)).map((r, i) => {
                      const c = colorFor(o.id);
                      const top = r.all_day ? 0 : (((r.start_min ?? 0) / 60) * HOUR_PX);
                      const height = r.all_day ? 24 * HOUR_PX : Math.max(17, (((r.end_min ?? 60) - (r.start_min ?? 0)) / 60) * HOUR_PX);
                      return (
                        <span
                          className="calp__ovblock" key={`${o.id}-${i}-${iso}`}
                          style={{ top, height, borderColor: c, background: `color-mix(in srgb, ${c} 16%, transparent)` }}
                          title={`${o.name}: ${r.title ?? 'busy'}`}
                        >
                          {r.title ?? `${o.name} · busy`}
                        </span>
                      );
                    }))}
                  {(() => { const lay = layoutDay(timedOn(iso)); return timedOn(iso).map((e) => {
                    const top = ((e.start_min ?? 0) / 60) * HOUR_PX;
                    const height = Math.max(17, (((e.end_min ?? 60) - (e.start_min ?? 0)) / 60) * HOUR_PX);
                    const g = lay.get(e.id) ?? { col: 0, cols: 1 };
                    const t = tintOf(e);
                    return (
                      <button
                        className={blockClass(e, 'calp__event') + (t ? ' calp__event--tinted' : '')} key={e.id + iso}
                        style={{
                          top, height,
                          left: `calc(${(g.col / g.cols) * 100}% + 2px)`,
                          width: `calc(${100 / g.cols}% - 4px)`,
                          right: 'auto',
                          ...(t ? {
                            background: `color-mix(in srgb, ${t} 16%, var(--bone-warm))`,
                            borderLeft: `3px solid ${t}`,
                          } : {}),
                        }}
                        onClick={(ev) => { ev.stopPropagation(); setSelected(e); }}
                      >
                        {e.title}
                      </button>
                    );
                  }); })()}
                </div>
              ))}
            </div>
          </div>
          {loading && <p className="calp__loading">Loading…</p>}
        </div>
      )}

      {/* Event detail modal */}
      {selected && (
        <>
          <div className="calp__scrim" onClick={() => setSelected(null)} />
          <div className="calp__sheet" role="dialog" aria-label={selected.title}>
            <h2 className="calp__sheet-title">{selected.title}</h2>
            <p className="calp__sheet-when">
              {formatDateShort(selected.start_date)}
              {selected.end_date !== selected.start_date && !selected.recurrence ? ` – ${formatDateShort(selected.end_date)}` : ''}
              {!selected.all_day && selected.start_min != null && ` · ${minToLabel(selected.start_min)} – ${minToLabel(selected.end_min ?? selected.start_min)}`}
              {selected.all_day && ' · All day'}
              {selected.recurrence && ` · ${recurrenceLabel(selected.recurrence, selected.start_date)}`}
            </p>
            {selected.external && (
              <p className="calp__sheet-ext">Imported from your external calendar — edit it there; Lichen re-syncs on its own.</p>
            )}
            {selected.location && <SmartLocation loc={selected.location} className="calp__sheet-loc" />}
            {selected.description && <p className="calp__sheet-desc"><LinkifiedText text={selected.description} /></p>}

            {(selected.attendees?.length ?? 0) > 0 && (
              <div className="calp__sheet-people">
                {selected.attendees!.map((a) => (
                  <span className="calp__person" key={a.profile_id} title={a.status}>
                    <span className="calp__person-avatar" style={{ background: colorFor(a.profile_id) }}>
                      {monogramFor(a.profile?.full_name ?? 'Member')}
                    </span>
                    <span className="calp__person-name">{a.profile?.full_name ?? 'Member'}</span>
                    <span className={'calp__person-status is-' + a.status}>
                      {a.status === 'invited' ? '?' : a.status === 'going' ? '✓' : a.status === 'tentative' ? '~' : '✕'}
                    </span>
                  </span>
                ))}
              </div>
            )}

            <div className="calp__sheet-actions">
              {myAttend(selected) && selected.creator_id !== me && (
                <>
                  <button
                    className={'btn btn-primary calp__sheet-btn' + (myAttend(selected)?.status === 'going' ? ' is-current' : '')}
                    onClick={() => onRsvp(selected, 'going')}
                  >
                    Going
                  </button>
                  <button
                    className={'btn calp__sheet-btn' + (myAttend(selected)?.status === 'tentative' ? ' is-current' : '')}
                    onClick={() => onRsvp(selected, 'tentative')}
                  >
                    Maybe
                  </button>
                  <button
                    className={'btn calp__sheet-btn' + (myAttend(selected)?.status === 'declined' ? ' is-current' : '')}
                    onClick={() => onRsvp(selected, 'declined')}
                  >
                    Can&rsquo;t make it
                  </button>
                </>
              )}
              {selected.creator_id === me && (
                <>
                  <button className="btn btn-primary calp__sheet-btn" onClick={() => navigate(`/calendar/edit/${selected.id}`)}>Edit</button>
                  <button className="btn calp__sheet-btn calp__sheet-btn--del" onClick={() => onDelete(selected)}>Delete</button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
