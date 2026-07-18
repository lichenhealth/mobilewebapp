import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../auth/AuthProvider';
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
import {
  EventRow, FreeBusyRow, MemberWindow,
  loadMyEvents, loadSpaceEvents, deleteEvent, rsvp, minToLabel, freeBusy, availabilityOf,
  loadMyExternalBusy, syncExternalCalendars,
} from '../lib/calendarApi';
import './Calendar.css';

const HOUR_PX = 32; // compact rows — more of the day on screen
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type View = 'schedule' | 'day' | '3day' | 'week' | 'month';
const VIEW_LABELS: Record<View, string> = { schedule: 'Schedule', day: 'Day', '3day': '3 Days', week: 'Week', month: 'Month' };

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
  const navigate = useNavigate();
  const today = todayISO();

  // Schedule (agenda list) is the phone default — a 7-column grid through a
  // keyhole is nobody's friend (founder + Gabe, 2026-07-17).
  const [view, setView] = useState<View>(() =>
    window.matchMedia('(max-width: 640px)').matches ? 'schedule' : 'week');
  const [anchor, setAnchor] = useState(todayISO());
  const [events, setEvents] = useState<EventRow[]>([]);
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
  const [overlayOn, setOverlayOn] = useState(false);
  // Find-a-time works one space at a time: available when exactly one space
  // chip is on (Mine may be on alongside).
  const spaceSel = selectedCals.filter((x) => x !== 'me');
  const soloSpace = spaceSel.length === 1 ? spaceSel[0] : null;
  const toggleCal = (id: string) => {
    setSelectedCals((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    setOverlayOn(false);
  };
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [fbRows, setFbRows] = useState<FreeBusyRow[]>([]);
  const [memberWindows, setMemberWindows] = useState<MemberWindow[]>([]);

  // Searched-calendar overlays: ephemeral side-by-side schedules (person or
  // space), each a dismissible chip. Re-search to bring one back — no saving.
  interface CalOverlay { kind: 'profile' | 'space'; id: string; name: string }
  // PINNED person/space overlays (founder, 2026-07-17): calendars you add
  // from search stay put — per-viewer consent (calendar_shares) decides what
  // each renders. Local to this device; a synced pin list can come later.
  const [overlays, setOverlays] = useState<CalOverlay[]>(() => {
    try { return JSON.parse(localStorage.getItem('calp:pins') || '[]') as CalOverlay[]; }
    catch { return []; }
  });
  useEffect(() => { localStorage.setItem('calp:pins', JSON.stringify(overlays)); }, [overlays]);
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
    if (!overlayOn || !soloSpace || view === 'month' || view === 'schedule') { setFbRows([]); setMemberWindows([]); return; }
    (async () => {
      const { data } = await supabase.from('space_members').select('profile_id').eq('space_id', soloSpace);
      const ids = ((data as { profile_id: string }[] | null) ?? []).map((r) => r.profile_id);
      setMemberIds(ids);
      const [fb, wins] = await Promise.all([freeBusy(ids, from, to), availabilityOf(ids)]);
      setFbRows(fb); setMemberWindows(wins);
    })();
  }, [overlayOn, soloSpace, view, from, to]);

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

  // Open time views scrolled to the working morning (the PAGE scrolls).
  useEffect(() => {
    if (view === 'month') return;
    const el = gridRef.current;
    if (!el) return;
    // Land 7am just below the pinned toolbar+day-header stack.
    const y = el.getBoundingClientRect().top + window.scrollY + 7 * HOUR_PX - 210;
    if (y > 0) window.scrollTo({ top: y });
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
    setSearchOpen(false); setQuery('');
  };
  const removeOverlay = (id: string) => setOverlays((cur) => cur.filter((o) => o.id !== id));

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
  const anyOn = (iso: string) => events.filter((e) => occursOn(e, iso));
  const hasAllDayRow = days.some((d) => allDayOn(d).length > 0);

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
    if (soloSpace) parts.push(`space=${soloSpace}`);
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
          <select className="calp__vselect" value={view} onChange={(e) => setView(e.target.value as View)} aria-label="View">
            {(Object.keys(VIEW_LABELS) as View[]).map((v) => <option key={v} value={v}>{VIEW_LABELS[v]}</option>)}
          </select>
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

        {/* Calendar chips — ADDITIVE: Mine defaults on, tap spaces to layer
            their events in (+ find-a-time toggle when exactly one space is on) */}
        <div className="calp__chips">
          <button
            className={'calp__calchip' + (selectedCals.includes('me') ? ' is-on' : '')}
            onClick={() => toggleCal('me')}
            aria-pressed={selectedCals.includes('me')}
          >
            Mine
          </button>
          {calendars.map((c) => (
            <button
              key={c.id}
              className={'calp__calchip' + (selectedCals.includes(c.id) ? ' is-on' : '')}
              onClick={() => toggleCal(c.id)}
              aria-pressed={selectedCals.includes(c.id)}
            >
              <span className="calp__chipdot" style={{ background: colorFor(c.id) }} />
              {c.name}
            </button>
          ))}
          {soloSpace && view !== 'month' && view !== 'schedule' && (
            <button
              className={'calp__calchip calp__calchip--overlay' + (overlayOn ? ' is-on' : '')}
              onClick={() => setOverlayOn((o) => !o)}
              title="Shade times when members are free"
            >
              Everyone free?
            </button>
          )}
        </div>
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
        {view !== 'month' && view !== 'schedule' && (
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
      </div>

      {view === 'schedule' ? (
        <div className="calp__sched">
          {days.map((iso) => {
            const evs = anyOn(iso).sort((a, b) =>
              (a.all_day === b.all_day ? (a.start_min ?? 0) - (b.start_min ?? 0) : a.all_day ? -1 : 1));
            const ovs = overlays.flatMap((o) =>
              (overlayRows[o.id] ?? []).filter((r) => occursOn(r, iso)).map((r) => ({ o, r })));
            if (evs.length === 0 && ovs.length === 0) return null;
            return (
              <div className="calp__sched-day" key={iso}>
                <div className={'calp__sched-date' + (iso === today ? ' is-today' : '')}>
                  <span className="calp__sched-dow">{DAY_LABELS[localDate(iso).getDay()]}</span>
                  <span className="calp__sched-num">{localDate(iso).getDate()}</span>
                </div>
                <div className="calp__sched-list">
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
          {hasAllDayRow && (
            <div className="calp__alldays" style={gridCols}>
              <span className="calp__gutter-head" />
              {days.map((iso) => (
                <div className="calp__allday-col" key={iso}>
                  {allDayOn(iso).map((e) => (
                    <button className={blockClass(e, 'calp__chip')} key={e.id} onClick={() => setSelected(e)}>{e.title}</button>
                  ))}
                </div>
              ))}
            </div>
          )}

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
                  {overlayOn && soloSpace && memberIds.length > 0 &&
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
                            navigate(`/calendar/new?space=${soloSpace}&date=${iso}&start=${slot}&inv=${free.filter((p) => p !== me).join(',')}`);
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
