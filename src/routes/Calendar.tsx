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
import { listReminders, listDone, setDone, remindersOn, leaveReminder, type Reminder as ReminderRow } from '../lib/remindersApi';
import {
  EventRow, FreeBusyRow, MemberWindow,
  loadMyEvents, loadSpaceEvents, deleteEvent, rsvp, minToLabel, freeBusy, availabilityOf,
  loadMyExternalBusy, syncExternalCalendars, listExternalCalendars,
  listCalendarPins, addCalendarPin, removeCalendarPin,
} from '../lib/calendarApi';
import TodoView from '../components/TodoView';
import './Calendar.css';
import AssistantDoor from '../components/AssistantDoor';
import { listMyBookingTypes } from '../lib/bookingApi';

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
  // ONE CALENDAR, FILTERED (founder 2026-08-15): a course's cohort no longer
  // carries its own "Find a time" door — it sends you here with `?space=<id>`,
  // which lands the grid on that cohort's calendar alone. Find-a-time is a
  // feature of Calendar, not a separate room per group.
  const focusSpace = urlParams.get('space');
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
  /** WHICH DAY YOU'RE LOOKING AT LIVES IN THE URL (founder 2026-08-16:
   *  editing an event and coming back "drops you back on the present day,
   *  not the day of the event"). The anchor was plain component state seeded
   *  from today, so ANY remount — the editor, a refresh, browser back —
   *  threw away where you were. As `?d=YYYY-MM-DD` it survives all three and
   *  a link to a day becomes shareable, the same way `?open=` made a chat
   *  linkable. */
  const isISO = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const [anchor, setAnchor] = useState(() => {
    const d = new URLSearchParams(window.location.search).get('d');
    return isISO(d) ? d : todayISO();
  });
  // Write it back without touching history: the entry you LEAVE from then
  // carries the day, so coming back lands there.
  useEffect(() => {
    const u = new URL(window.location.href);
    if (u.searchParams.get('d') === anchor) return;
    u.searchParams.set('d', anchor);
    window.history.replaceState(window.history.state, '', u);
  }, [anchor]);
  // Follow the URL when it changes under us (back/forward, or an explicit
  // ?d= from the event composer).
  const dParam = urlParams.get('d');
  useEffect(() => {
    if (isISO(dParam) && dParam !== anchor) setAnchor(dParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dParam]);
  const [events, setEvents] = useState<EventRow[]>([]);
  // Private nudges — never busy, never shared (Gabe's Reminders, 2026-07-18).
  const [reminders, setReminders] = useState<ReminderRow[]>([]);
  const [remDone, setRemDone] = useState<Map<string, { profileId: string; name: string | null }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<EventRow | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchPool, setSearchPool] = useState<EventRow[]>([]);
  const gridRef = useRef<HTMLDivElement>(null);

  // Which calendars are showing — additive, like every lens row: Mine starts
  // on, tap a space chip to layer its events in (tap again to drop it).
  // Imported calendars (Google, ICS) are their OWN chips, ids 'ext:<id>'
  // (founder 2026-08-14: the chip row must tell the truth about every source
  // on the grid — Google used to ride Mine invisibly).
  const [calendars, setCalendars] = useState<{ id: string; name: string }[]>([]);
  const [extCals, setExtCals] = useState<{ id: string; name: string; url: string }[]>([]);
  // The Bookings door earns its slot: only once you've set up something
  // bookable (founder 2026-08-14). The hub stays reachable from profiles.
  const [hasBookables, setHasBookables] = useState(false);
  useEffect(() => {
    if (!me) return;
    let live = true;
    void listMyBookingTypes(me).then((t) => { if (live) setHasBookables(t.length > 0); });
    return () => { live = false; };
  }, [me]);
  const [selectedCals, setSelectedCals] = useState<string[]>(['me']);
  useEffect(() => {
    if (!me) return;
    (async () => setExtCals((await listExternalCalendars(me)).map((c) => ({ id: c.id, name: c.name, url: c.url }))))();
  }, [me]);
  // Follows whoever the TopBar says you're acting as (founder 2026-08-10) —
  // acting as a space shows ITS calendar, not "Mine" (Galyn's) by default.
  // As yourself, your imported calendars light up alongside Mine (they're
  // your time too); as a space, the space's calendar stands alone.
  const extKey = extCals.map((c) => c.id).join(',');
  useEffect(() => {
    if (focusSpace) { setSelectedCals([focusSpace]); return; }
    setSelectedCals(actor.type === 'space'
      ? [actor.id]
      : ['me', ...extCals.map((c) => 'ext:' + c.id)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor, extKey, focusSpace]);
  const [overlayOn, setOverlayOn] = useState(false);
  // Find-a-time spans EVERY selected space (founder 2026-07-22): the more
  // groups you add, the more availability narrows toward when ALL their
  // members are free. Mine may be on alongside.
  const spaceSel = selectedCals.filter((x) => x !== 'me' && !x.startsWith('ext:'));
  const extSel = selectedCals.filter((x) => x.startsWith('ext:')).map((x) => x.slice(4));
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
  const calAddRef = useRef<HTMLInputElement>(null);
  // PARKED chips (founder 2026-08-14 nit): tapping a chip's body turns it
  // WHITE — off but still in the row, one tap from coming back. Only the
  // explicit × removes it (back to the picker / unpinned).
  const [parkedCals, setParkedCals] = useState<Set<string>>(new Set());
  const [parkedOverlays, setParkedOverlays] = useState<Set<string>>(new Set());
  const parkToggle = (id: string) => {
    if (selectedCals.includes(id)) {
      setSelectedCals((cur) => cur.filter((x) => x !== id));
      setParkedCals((cur) => new Set(cur).add(id));
      setOverlayOn(false);
    } else {
      setParkedCals((cur) => { const n = new Set(cur); n.delete(id); return n; });
      setSelectedCals((cur) => [...cur, id]);
    }
  };
  const removeChip = (id: string) => {
    setSelectedCals((cur) => cur.filter((x) => x !== id));
    setParkedCals((cur) => { const n = new Set(cur); n.delete(id); return n; });
    setOverlayOn(false);
  };
  // Imported calendars are deliberately NOT in here — they render as standing
  // chips (white when off), so the picker only holds group calendars.
  const calChoices = useMemo(() => {
    const q = calQ.trim().toLowerCase();
    return calendars
      .map((c) => ({ key: c.id, name: c.name, tint: colorFor(c.id) }))
      .filter((c) => !selectedCals.includes(c.key) && !parkedCals.has(c.key))
      .filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [calendars, selectedCals, parkedCals, calQ]);
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
    // Imported busy blocks follow their OWN chips now — each connected
    // calendar renders only while its chip is lit.
    if (extSel.length > 0) {
      for (const b of (await loadMyExternalBusy(me, from, to)).filter((r) => extSel.includes(r.calendar_id))) {
        byId.set('ext:' + b.id, {
          id: 'ext:' + b.id, creator_id: '', owner_profile_id: me, owner_space_id: null,
          title: b.title || 'Busy', description: '', location: '', lat: null, lng: null,
          start_date: b.on_date, end_date: b.on_date, all_day: b.all_day,
          start_min: b.start_min, end_min: b.end_min, recurrence: null,
          created_at: '', external: true, tint: colorFor('extcal:' + b.calendar_id),
          sourceUrl: b.source_url ?? null, extCalId: b.calendar_id,
        });
      }
    }
    setEvents([...byId.values()]);
    // Reminders ride only on YOUR calendar chip; a graceful [] before the
    // migration runs (listReminders warns and returns empty).
    if (selectedCals.includes('me')) {
      const rems = await listReminders(me);
      setReminders(rems);
      setRemDone(await listDone(me, rems, from, to));
    } else { setReminders([]); setRemDone(new Map()); }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, from, to, selectedCals.join(',')]);
  useEffect(() => { load(); }, [load]);
  // The sync callback must reload through a REF to the latest load — this
  // effect runs once per member, so a captured `load` still carries the
  // mount-time source selection. That stale closure is exactly how Google
  // events painted the grid while acting-as had switched the chips to a
  // space's calendar (founder's screenshot, 2026-08-14).
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);

  // Refresh imported calendars quietly on arrival (the edge function skips
  // anything synced in the last 30 minutes), then fold new blocks in.
  useEffect(() => {
    if (!me) return;
    let live = true;
    syncExternalCalendars().then(() => { if (live) loadRef.current(); }).catch(() => { /* no external calendars / offline */ });
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

  /** UNKNOWN IS NEVER YES (founder 2026-08-14, fixing the wall of green):
   *  the shading counts only members the system actually knows something
   *  about — declared hours (work or social; on-call is the care rota, not a
   *  meeting invitation) or busy time their calendar shares let us see.
   *  Members who've signaled nothing used to count as free 24/7, which
   *  painted every slot green the moment a group had quiet members. Now they
   *  simply aren't in the count, and the overlay says so.
   *  (Limit: someone who shared an EMPTY calendar looks identical to someone
   *  who shared nothing — free_busy() returns rows, not shares.) */
  const knownIds = useMemo(() => memberIds.filter((pid) =>
    fbRows.some((r) => r.profile_id === pid) || memberWindows.some((w) => w.profile_id === pid)),
  [memberIds, fbRows, memberWindows]);

  /** Free KNOWN members for a 30-min slot: not busy, and — if they declared
   *  hours — inside a declared window (work or social alike: published hours
   *  are published hours). Busy-only members are free wherever they're not
   *  busy; that's real signal, unlike silence. */
  const freeMembersAt = (iso: string, slotStart: number): string[] => {
    const slotEnd = slotStart + 30;
    const wd = weekdayMon0(iso);
    return knownIds.filter((pid) => {
      const busy = fbRows.some((r) =>
        r.profile_id === pid && occursOn(r, iso)
        && (r.all_day || ((r.start_min ?? 0) < slotEnd && (r.end_min ?? 1440) > slotStart)));
      if (busy) return false;
      const wins = memberWindows.filter((w) =>
        w.profile_id === pid && (w.kind === 'available' || w.kind === 'social')
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
      const n = new Map(cur);
      // A SHARED task closes for everyone the moment anyone ticks it — the
      // optimistic row names you until the next load names whoever it was.
      if (done) n.delete(k); else n.set(k, { profileId: me, name: null });
      return n;
    });
    void setDone(me, r.id, iso, !done, r.done_mode ?? 'shared').catch(console.error);
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

  /** NAME THE ACCOUNT (founder 2026-08-16: the link "lands me on the month
   *  view, with the day correct, but it says it can't find the event").
   *  Google resolves an `eid` against whichever account the browser happens
   *  to be using; signed into more than one, it reads the date out of the
   *  eid but looks for the event in the wrong account. The eid itself is
   *  base64 of "<eventId> <calendarId>", so the calendar it belongs to is
   *  right there — hand it to Google as `authuser` and it looks in the right
   *  place. Anything unexpected falls through to the original link. */
  const googleAuthUser = (url: string): string => {
    try {
      const u = new URL(url);
      const eid = u.searchParams.get('eid');
      if (!eid) return url;
      const b64 = eid.replace(/-/g, '+').replace(/_/g, '/');
      const decoded = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
      const calId = decoded.split(' ')[1];
      // ⚠ Go to calendar.google.com DIRECTLY. Google's stored htmlLink points
      // at the legacy www.google.com/calendar/event endpoint, which redirects
      // to calendar.google.com/calendar/u/0/r — dropping every query param we
      // added and hardcoding account index 0 on the way. That's why naming
      // the account did nothing: it never survived the hop (founder's landed
      // URL, 2026-08-16: ".../u/0/r?msg=Could+not+find+the+requested+event").
      const out = new URL('https://calendar.google.com/calendar/event');
      out.searchParams.set('eid', eid);
      if (calId && calId.includes('@')) out.searchParams.set('authuser', calId);
      return out.toString();
    } catch { return url; }
  };

  /** The Google account an imported event belongs to — the second half of its
   *  eid, which is base64 of "<eventId> <calendarId>". */
  const googleCalIdOf = (e: EventRow): string | null => {
    try {
      const eid = new URL(e.sourceUrl ?? '').searchParams.get('eid');
      if (!eid) return null;
      const b64 = eid.replace(/-/g, '+').replace(/_/g, '/');
      const id = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)).split(' ')[1];
      return id && id.includes('@') ? id : null;
    } catch { return null; }
  };

  /** That day in the source calendar. Always resolves — no event id to look
   *  up — so it's the door that can't fail (founder 2026-08-16: the per-event
   *  link still errors, so the popup offers both rather than one dead end). */
  const googleDayDoor = (e: EventRow): string | null => {
    if (extHostOf(e) !== 'google') return null;
    const d = localDate(e.start_date);
    const cal = (() => {
      try {
        const eid = new URL(e.sourceUrl ?? '').searchParams.get('eid');
        if (!eid) return null;
        const b64 = eid.replace(/-/g, '+').replace(/_/g, '/');
        const id = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)).split(' ')[1];
        return id && id.includes('@') ? id : null;
      } catch { return null; }
    })();
    const base = `https://calendar.google.com/calendar/r/day/${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    return cal ? `${base}?authuser=${encodeURIComponent(cal)}` : base;
  };

  /** Where an imported block came from, and what to call the way back. The
   *  per-event link when the source gave one; otherwise that day in the
   *  source calendar (we know the source from the calendar's stored url). */
  const externalDoor = (e: EventRow): { href: string; label: string; account?: string } | null => {
    if (!e.external) return null;
    if (e.sourceUrl) {
      const host = extHostOf(e);
      return {
        href: host === 'google' ? googleAuthUser(e.sourceUrl) : e.sourceUrl,
        label: host === 'google' ? 'Open in Google Calendar' : 'Open where it lives',
        // WHICH ACCOUNT IT NEEDS (founder 2026-08-16). The event lives in one
        // Google account; a browser signed into a different one gets "Could
        // not find the requested event" — which reads as a broken link when
        // it's really the wrong account. Naming it makes the failure legible
        // and tells you what to do about it. We can't know which account the
        // browser is using, so we say which one the event is IN.
        account: host === 'google' ? (googleCalIdOf(e) ?? undefined) : undefined,
      };
    }
    const host = extHostOf(e);
    if (host !== 'google') return null;
    const d = localDate(e.start_date);
    return {
      href: `https://calendar.google.com/calendar/u/0/r/day/${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`,
      label: 'Open that day in Google Calendar',
    };
  };
  /** Which service an imported row came from — 'google:<id>' for the OAuth
   *  connection, else sniffed from the ICS host. */
  const extHostOf = (e: EventRow): 'google' | 'other' => {
    const cal = extCals.find((c) => c.id === e.extCalId);
    if (!cal) return 'other';
    return cal.url.startsWith('google:') || cal.url.includes('calendar.google.com') ? 'google' : 'other';
  };

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
        {/* Acting doors LEFT in Home's order (Search · + · Brain), the
            calendar's own controls RIGHT (founder 2026-08-14: "for UI
            consistency"). Bookings only shows once you've set up something
            bookable. Everything shares one 34px size. */}
        <div className="calp__toolbar">
          <button
            className={'calp__tool' + (searchOpen ? ' is-on' : '')}
            onClick={() => { setSearchOpen((s) => !s); setQuery(''); }}
            aria-label="Search events"
          >
            <Icon name="search" size={16} />
          </button>
          <button
            className="calp__tool calp__tool--new"
            onClick={() => navigate('/calendar/new' + composerQS())}
            aria-label="New event"
          >
            <svg width="15" height="15" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M9 3.75V14.25M3.75 9H14.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <AssistantDoor section="calendar" label="Your assistant — what's coming, what's unanswered" />
          <span className="calp__tb-spacer" aria-hidden="true" />
          <div className="calp__nav">
            <button className="calp__navbtn" onClick={() => page(-1)} aria-label="Previous"><Icon name="chevron-left" size={16} /></button>
            <button className="calp__month" onClick={() => setAnchor(todayISO())}>{headerLabel}</button>
            <button className="calp__navbtn" onClick={() => page(1)} aria-label="Next"><Icon name="chevron-right" size={16} /></button>
          </div>
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
          {hasBookables && (
            <button className="calp__tool" onClick={() => navigate('/bookings')} aria-label="Bookings" title="Bookings">
              <Icon name="booking-tap" size={16} />
            </button>
          )}
          <button className="calp__tool" onClick={() => navigate('/calendar/settings')} aria-label="Calendar settings">
            <Icon name="settings" size={16} />
          </button>
        </div>

        {/* Calendar chips — ADDITIVE, and SEARCH-FIRST (founder 2026-08-14:
            "with so many calendars... lets just have search right off the bat,
            'Add a calendar' being the prompt"). Only Mine + calendars that are
            ON render as chips; everything else is found by typing. Tap a chip
            to drop it. */}
        {view !== 'todo' && (<>
        <div className="calp__chips">
          <button
            className={'calp__calchip' + (selectedCals.includes('me') ? ' is-on' : '')}
            onClick={() => toggleCal('me')}
            aria-pressed={selectedCals.includes('me')}
          >
            Mine
          </button>
          {calendars.filter((c) => selectedCals.includes(c.id) || parkedCals.has(c.id)).map((c) => {
            const on = selectedCals.includes(c.id);
            return (
              <span
                key={c.id}
                role="button" tabIndex={0}
                className={'calp__calchip calp__calchip--holds' + (on ? ' is-on' : '')}
                onClick={() => parkToggle(c.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') parkToggle(c.id); }}
                title={on ? `Hide ${c.name} — the chip stays` : `Show ${c.name}`}
              >
                <span className="calp__chipdot" style={{ background: colorFor(c.id) }} />
                {c.name}
                <button
                  className="calp__ovx"
                  onClick={(e) => { e.stopPropagation(); removeChip(c.id); }}
                  aria-label={`Remove ${c.name} from the row`}
                >×</button>
              </span>
            );
          })}
          {/* Imported calendars are STANDING chips, never hidden in the picker
              (founder 2026-08-14: "we likely won't be the default cal for most
              people for a while" — their Google IS their life, so it stays in
              view: white when off, lit when on, a toggle like Mine). */}
          {extCals.map((c) => {
            const on = selectedCals.includes('ext:' + c.id);
            return (
              <button
                key={'ext:' + c.id}
                className={'calp__calchip' + (on ? ' is-on' : '')}
                onClick={() => toggleCal('ext:' + c.id)}
                aria-pressed={on}
              >
                <span className="calp__chipdot" style={{ background: colorFor('extcal:' + c.id) }} />
                {c.name}
              </button>
            );
          })}
          <input
            ref={calAddRef}
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
                className="calp__result" key={c.key}
                onPointerDown={(e) => { e.preventDefault(); toggleCal(c.key); setCalQ(''); setCalAddOpen(false); calAddRef.current?.blur(); }}
              >
                <span className="calp__result-title">
                  <span className="calp__chipdot" style={{ background: c.tint }} />
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

        {/* Find-a-time tells you what it's actually going on (founder
            2026-08-14): silence used to render as free-24/7 and the whole
            calendar went green. Now the legend names the coverage — and at
            zero signal there's no shading at all, just the truth. */}
        {overlayOn && spaceSel.length > 0 && memberIds.length > 0
          && view !== 'month' && view !== 'schedule' && (
          <p className="calp__ovnote">
            {knownIds.length === 0
              ? 'No one here has set up availability hours or shared a calendar yet, so there’s nothing to shade. Availability starts when they set it.'
              : knownIds.length < memberIds.length
                ? `Going on ${knownIds.length} of ${memberIds.length} members’ shared hours or calendars — the rest haven’t set any up yet. ${knownIds.length === 1 ? 'Green = that member’s free time.' : `Deeper green = all ${knownIds.length} free.`}`
                : memberIds.length === 1
                  ? 'Going on the one member’s shared time. Green = they’re free.'
                  : `Going on all ${memberIds.length} members’ shared time. Deeper green = everyone’s free.`}
          </p>
        )}

        {/* Overlaid calendars (from search) — dismissible, never saved */}
        {overlays.length > 0 && (
          <div className="calp__ovchips">
            {overlays.map((o) => {
              const off = parkedOverlays.has(o.id);
              return (
                <span
                  className={'calp__ovchip' + (off ? ' is-off' : '')}
                  key={o.id}
                  style={{ borderColor: colorFor(o.id) }}
                  role="button" tabIndex={0}
                  onClick={() => setParkedOverlays((cur) => { const n = new Set(cur); if (off) n.delete(o.id); else n.add(o.id); return n; })}
                  onKeyDown={(e) => { if (e.key === 'Enter') setParkedOverlays((cur) => { const n = new Set(cur); if (off) n.delete(o.id); else n.add(o.id); return n; }); }}
                  title={off ? `Show ${o.name} again` : `Hide ${o.name} — the chip stays pinned`}
                >
                  <span className="calp__ovdot" style={{ background: colorFor(o.id) }} />
                  {o.name}
                  <button className="calp__ovx" onClick={(e) => { e.stopPropagation(); removeOverlay(o.id); }} aria-label={`Unpin ${o.name}`}>×</button>
                </span>
              );
            })}
          </div>
        )}
        </>)}
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
          onLeave={(r) => {
            setReminders((cur) => cur.filter((x) => x.id !== r.id));
            void leaveReminder(r.id, me).catch(console.error);
          }}
          onTaskAdded={() => { void listReminders(me).then(setReminders); }}
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
                  {/* Find-a-time shading: greener = more KNOWN members free;
                      tap to book. Clamped to 7am–9pm — 3am being technically
                      clear is not an invitation. */}
                  {overlayOn && spaceSel.length > 0 && knownIds.length > 0 &&
                    Array.from({ length: 28 }, (_, s) => 7 * 60 + s * 30).map((slot) => {
                      const free = freeMembersAt(iso, slot);
                      if (free.length === 0) return null;
                      const strong = free.length === knownIds.length;
                      return (
                        <button
                          key={`fa-${slot}`}
                          className={'calp__slot calp__slot--free' + (strong ? ' is-strong' : '')}
                          style={{ top: (slot / 60) * HOUR_PX, height: HOUR_PX / 2 }}
                          title={`${free.length}/${knownIds.length} free at ${minToLabel(slot)}`}
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
                  {overlays.filter((o) => !parkedOverlays.has(o.id)).map((o) =>
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
              <>
                <p className="calp__sheet-ext">Imported from your external calendar — edit it there; Lichen re-syncs on its own.</p>
                {/* A door back to where it actually lives (founder 2026-08-14).
                    Google hands us a per-event link; an ICS may carry one.
                    With neither, we still land you on the right DAY in the
                    source calendar rather than leaving you to hunt. */}
                {externalDoor(selected) && (
                  <a
                    className="calp__sheet-extlink"
                    href={externalDoor(selected)!.href}
                    target="_blank" rel="noopener noreferrer"
                  >
                    <Icon name="arrow-right" size={13} /> {externalDoor(selected)!.label}
                  </a>
                )}
                {externalDoor(selected)?.account && (
                  <p className="calp__sheet-extnote">
                    Lives in <strong>{externalDoor(selected)!.account}</strong> — open it in a
                    browser signed into that account.
                  </p>
                )}
                {/* The deep link depends on Google resolving an event id
                    against the right account; when it can't, this one still
                    lands you next to the event instead of on an error. */}
                {selected.sourceUrl && googleDayDoor(selected) && (
                  <a
                    className="calp__sheet-extlink calp__sheet-extlink--alt"
                    href={googleDayDoor(selected)!}
                    target="_blank" rel="noopener noreferrer"
                  >
                    <Icon name="calendar" size={13} /> Or open that day
                  </a>
                )}
              </>
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
