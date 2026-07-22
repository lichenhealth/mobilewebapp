import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import DateRangeCalendar, { DateRange } from '../components/DateRangeCalendar';
import RecurrenceSelect from '../components/RecurrenceSelect';
import TimeField from '../components/TimeField';
import { useAuth } from '../auth/AuthProvider';
import { useActing } from '../acting/ActingProvider';
import { supabase } from '../lib/supabase';
import { colorFor, monogramFor } from '../lib/chatApi';
import { todayISO, formatDateShort, addDays } from '../lib/conciergeApi';
import { Recurrence, recurrenceLabel, occursOn } from '../lib/recurrence';
import { createEvent, updateEvent, loadEvent, minToLabel, freeBusy, FreeBusyRow } from '../lib/calendarApi';
import LocationField from '../components/LocationField';
import type { GeoPoint } from '../lib/geoApi';
import { LinkifiedText } from '../components/CarePostCard';
import { parseFlex, defaultWindow } from '../lib/flexParse';
import { createReminder } from '../lib/remindersApi';
import { SmartLocation } from './Calendar';
import './Concierge.css';
import './Calendar.css';

interface SpaceOpt { id: string; name: string }
interface MemberOpt { id: string; full_name: string | null }

/** Compose a calendar event: title, which calendar, when (date/times/recurrence),
 *  invitees, location + notes. With an :eventId param it edits in place. */
export default function EventComposer() {
  const { user } = useAuth();
  const me = user?.id ?? '';
  const { eventId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const back = () => navigate('/calendar');

  // Events vs Reminders (Gabe, 2026-07-18): an event is a social object; a
  // reminder is a private nudge — no guests, no busy weight.
  const [kind, setKind] = useState<'event' | 'reminder'>(
    params.get('kind') === 'reminder' ? 'reminder' : 'event');
  const [remHasTime, setRemHasTime] = useState(false);
  const [remAtMin, setRemAtMin] = useState(9 * 60);
  const [remLead, setRemLead] = useState(0);

  const [title, setTitle] = useState('');
  const [calendar, setCalendar] = useState('me');            // 'me' | space id
  const [spaces, setSpaces] = useState<SpaceOpt[]>([]);
  const [range, setRange] = useState<DateRange>({ start: todayISO(), end: todayISO() });
  const [allDay, setAllDay] = useState(false);
  const [startMin, setStartMin] = useState(9 * 60);
  const [endMin, setEndMin] = useState(10 * 60);
  const [recurrence, setRecurrence] = useState<Recurrence | null>(null);
  const [members, setMembers] = useState<MemberOpt[]>([]);
  const [query, setQuery] = useState('');
  const [invitees, setInvitees] = useState<MemberOpt[]>([]);
  const [location, setLocation] = useState('');
  // Coordinates from a picked LocationField suggestion (null = text-only).
  const [locGeo, setLocGeo] = useState<GeoPoint | null>(null);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const anchor = range.start ?? todayISO();

  // ── Availability (founder sketch 2026-07-18): three date shapes. ──────────
  //    one   — a fixed day; check the chosen time, suggest same-day slots
  //    multi — a fixed stretch (retreat); show per-person conflicts, suggest
  //            other same-length stretches with fewer conflicts
  //    flex  — "we know how long, not when"; search the next 8 weeks
  //    All of it reads free_busy: only what each member shares with you.
  type DateMode = 'one' | 'multi' | 'flex';
  const [dateMode, setDateMode] = useState<DateMode>('one');
  const [flexDays, setFlexDays] = useState(3);
  // Flexible mode's sentence box: "a 3 day retreat between july 1 and
  // august 31 with Gabe and the WAG group" → length, window, invitees.
  const [flexQ, setFlexQ] = useState('');
  const [flexWindow, setFlexWindow] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });
  const [flexChips, setFlexChips] = useState<string[]>([]);
  const [spaceNotes, setSpaceNotes] = useState<string[]>([]);
  const expandedSpaces = useRef(new Set<string>());
  const spanLen = useMemo(() => {
    if (!range.start || !range.end || range.end === range.start) return 1;
    let n = 1; let d = range.start;
    while (d < range.end && n < 60) { d = addDays(d, 1); n += 1; }
    return n;
  }, [range.start, range.end]);

  // The sentence, applied: length + window + invitees (groups expand to
  // their members, capped so a huge community doesn't flood the invite list).
  useEffect(() => {
    if (dateMode !== 'flex') return;
    const t = window.setTimeout(async () => {
      const p = parseFlex(
        flexQ,
        members.map((m) => ({ id: m.id, name: m.full_name ?? '' })),
        spaces.map((s) => ({ id: s.id, name: s.name })),
      );
      if (p.days) setFlexDays(p.days);
      setFlexWindow({ from: p.from, to: p.to });
      setFlexChips(p.chips);
      if (p.memberIds.length > 0) {
        setInvitees((cur) => {
          const add = p.memberIds.filter((id) => !cur.some((i) => i.id === id))
            .map((id) => members.find((m) => m.id === id)).filter((m): m is MemberOpt => !!m);
          return add.length > 0 ? [...cur, ...add] : cur;
        });
      }
      for (const sid of p.spaceIds) {
        if (expandedSpaces.current.has(sid)) continue;
        expandedSpaces.current.add(sid);
        const name = spaces.find((s) => s.id === sid)?.name ?? 'that group';
        const { data } = await supabase.from('space_members')
          .select('profiles(id, full_name)').eq('space_id', sid).limit(26);
        const folks = ((data as unknown as { profiles: MemberOpt | null }[] | null) ?? [])
          .map((r) => r.profiles).filter((x): x is MemberOpt => !!x && x.id !== me);
        if (folks.length > 25) {
          setSpaceNotes((n) => [...n, `${name}: too many members to check`]);
        } else if (folks.length === 0) {
          setSpaceNotes((n) => [...n, `${name}: no other members yet`]);
        } else {
          setInvitees((cur) => {
            const add = folks.filter((f) => !cur.some((i) => i.id === f.id));
            return add.length > 0 ? [...cur, ...add] : cur;
          });
          setSpaceNotes((n) => [...n, `${name} · ${folks.length} member${folks.length > 1 ? 's' : ''} added`]);
        }
      }
    }, 500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flexQ, dateMode, members, spaces]);

  const [fb, setFb] = useState<FreeBusyRow[]>([]);
  const [fbLoading, setFbLoading] = useState(false);
  const singleTimedDay = dateMode === 'one' && !allDay && (!range.end || range.end === range.start);
  const inviteeKey = invitees.map((i) => i.id).sort().join(',');
  // The stretch the multi/flex search sweeps (flex honors the sentence
  // window; everything else looks 8 weeks out via defaultWindow()).
  const search = useMemo(() => {
    const dflt = defaultWindow();
    if (dateMode !== 'flex' || !flexWindow.from || !flexWindow.to) return dflt;
    const today = todayISO();
    const from = flexWindow.from > today ? flexWindow.from : dflt.from;
    let to = flexWindow.to;
    if (to > addDays(from, 120)) to = addDays(from, 120);  // sanity cap
    return to > from ? { from, to } : dflt;
  }, [dateMode, flexWindow.from, flexWindow.to]);
  useEffect(() => {
    if (!me || invitees.length === 0) { setFb([]); return; }
    if (dateMode === 'one' && !singleTimedDay) { setFb([]); return; }
    let live = true;
    setFbLoading(true);
    const from = dateMode === 'one' ? anchor : search.from;
    const to = dateMode === 'one' ? anchor : search.to;
    const t = window.setTimeout(async () => {
      const rows = await freeBusy([me, ...invitees.map((i) => i.id)], from, to);
      if (live) { setFb(rows); setFbLoading(false); }
    }, 300);
    return () => { live = false; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, anchor, inviteeKey, singleTimedDay, dateMode, search.from, search.to]);

  const people = useMemo(() => [me, ...invitees.map((i) => i.id)], [me, inviteeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const busyAt = (pid: string, iso: string, s: number, e: number) => fb.some((r) =>
    r.profile_id === pid && occursOn(r, iso)
    && (r.all_day || ((r.start_min ?? 0) < e && (r.end_min ?? 1440) > s)));
  const busyOnDay = (pid: string, iso: string) => fb.some((r) => r.profile_id === pid && occursOn(r, iso));
  /** Days within a stretch on which this person has anything at all. */
  const conflictDays = (pid: string, startISO: string, len: number): string[] => {
    const out: string[] = [];
    for (let i = 0, d = startISO; i < len; i += 1, d = addDays(d, 1)) {
      if (busyOnDay(pid, d)) out.push(d);
    }
    return out;
  };

  // ONE DAY: slots where everyone looks free — same day, event's length.
  const daySlots = useMemo(() => {
    if (!singleTimedDay || invitees.length === 0 || fb.length === 0) return [];
    const dur = Math.max(30, endMin - startMin);
    const now = new Date();
    const minStart = anchor === todayISO()
      ? Math.ceil((now.getHours() * 60 + now.getMinutes() + 15) / 30) * 30 : 0;
    const out: number[] = [];
    for (let t = Math.max(7 * 60, minStart); t + dur <= 21 * 60 && out.length < 6; t += 30) {
      if (t === startMin) continue;
      if (!people.some((p) => busyAt(p, anchor, t, t + dur))) out.push(t);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fb, anchor, startMin, endMin, inviteeKey, singleTimedDay]);

  // SEVERAL DAYS / FLEXIBLE: same-length stretches ranked by total conflict
  // person-days (0 = everyone clear all days). Real calendars are busy, so
  // near-misses show with their count instead of vanishing.
  const windowHits = useMemo(() => {
    if (dateMode === 'one' || invitees.length === 0 || fb.length === 0) return [];
    const len = dateMode === 'flex' ? flexDays : spanLen;
    const scored: { start: string; score: number }[] = [];
    const lastStart = addDays(search.to, 1 - len);
    for (let d = search.from, i = 0; d <= lastStart && i < 130; i += 1, d = addDays(d, 1)) {
      if (dateMode === 'multi' && d === range.start) continue;
      let score = 0;
      for (const p of people) score += conflictDays(p, d, len).length;
      scored.push({ start: d, score });
    }
    scored.sort((a, b) => a.score - b.score || (a.start < b.start ? -1 : 1));
    return scored.slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fb, dateMode, flexDays, spanLen, inviteeKey, range.start, search.from, search.to]);

  useEffect(() => {
    if (!me) return;
    (async () => {
      const [spRes, memRes] = await Promise.all([
        supabase.from('space_members').select('spaces(id, name)').eq('profile_id', me),
        supabase.from('profiles').select('id, full_name').neq('id', me).order('full_name').limit(500),
      ]);
      const sp = ((spRes.data as unknown as { spaces: SpaceOpt | null }[] | null) ?? [])
        .map((r) => r.spaces).filter((s): s is SpaceOpt => !!s);
      setSpaces(sp);
      const mem = (memRes.data as MemberOpt[] | null) ?? [];
      setMembers(mem);
      // Hydrate names of any query-prefilled invitees now that we know members.
      setInvitees((cur) => cur.map((i) => i.full_name ? i : (mem.find((m) => m.id === i.id) ?? i)));
    })();
  }, [me, eventId]);

  // Prefill from a slot click/drag or find-a-time link (?date&start&end&space&inv).
  // Synchronous on mount — must never wait on (or be skipped by) network calls.
  const { actor } = useActing();
  useEffect(() => {
    if (eventId) return;
    const qSpace = params.get('space'), qDate = params.get('date'), qStart = params.get('start'), qEnd = params.get('end'), qInv = params.get('inv');
    // Explicit link target wins; otherwise default to whoever you're acting as.
    if (qSpace) setCalendar(qSpace);
    else if (actor.type === 'space') setCalendar(actor.id);
    if (qDate) setRange({ start: qDate, end: qDate });
    if (qStart) {
      const s = Number(qStart);
      if (Number.isFinite(s)) { setStartMin(s); setEndMin(Math.min(s + 60, 1440)); }
    }
    if (qEnd) {
      const en = Number(qEnd);
      if (Number.isFinite(en) && en > 0) setEndMin(Math.min(en, 1440));
    }
    if (qInv) {
      const ids = [...new Set(qInv.split(',').filter(Boolean))];
      setInvitees((cur) => {
        const have = new Set(cur.map((i) => i.id));
        return [...cur, ...ids.filter((id) => !have.has(id)).map((id) => ({ id, full_name: null }))];
      });
    }
  }, [eventId, params, actor]);

  // Edit mode: prefill from the existing event.
  useEffect(() => {
    if (!eventId) return;
    (async () => {
      const ev = await loadEvent(eventId);
      if (!ev) { setError('Event not found.'); return; }
      setTitle(ev.title);
      setCalendar(ev.owner_space_id ?? 'me');
      setRange({ start: ev.start_date, end: ev.end_date });
      setAllDay(ev.all_day);
      if (ev.start_min != null) setStartMin(ev.start_min);
      if (ev.end_min != null) setEndMin(ev.end_min);
      setRecurrence(ev.recurrence);
      setLocation(ev.location);
      setLocGeo(ev.lat != null && ev.lng != null ? { lat: ev.lat, lng: ev.lng } : null);
      setDescription(ev.description);
      setInvitees((ev.attendees ?? []).map((a) => ({ id: a.profile_id, full_name: a.profile?.full_name ?? null })));
    })();
  }, [eventId]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return members
      .filter((m) => !invitees.some((i) => i.id === m.id))
      .filter((m) => (m.full_name ?? '').toLowerCase().includes(q))
      .slice(0, 6);
  }, [query, members, invitees]);

  async function save() {
    if (!me) return;
    if (!title.trim()) { setError('Give the event a title.'); return; }
    if (!range.start) { setError('Pick a day.'); return; }
    if (!allDay && endMin <= startMin && range.start === (range.end ?? range.start)) {
      setError('End time must be after the start.'); return;
    }
    setSaving(true); setError('');
    try {
      const input = {
        ownerProfileId: calendar === 'me' ? me : undefined,
        ownerSpaceId: calendar === 'me' ? undefined : calendar,
        title: title.trim(),
        description: description.trim(),
        location: location.trim(),
        lat: locGeo?.lat ?? null,
        lng: locGeo?.lng ?? null,
        startDate: range.start,
        endDate: range.end ?? range.start,
        allDay,
        startMin, endMin,
        recurrence,
        inviteeIds: invitees.map((i) => i.id),
      };
      if (eventId) await updateEvent(me, eventId, input);
      else await createEvent(me, input);
      back();
    } catch (e) {
      // Supabase errors are plain objects, not Error instances — read .message either way.
      const msg = (e as { message?: string } | null)?.message;
      setError(msg || 'Could not save.');
      setSaving(false);
    }
  }

  // Time + repeat controls: rendered in-flow on mobile, in the right column on
  // desktop (per the founder's layout sketch). Same state either way.
  const whenControls = (
    <>
      <label className="rec__radio">
        <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day
      </label>
      {!allDay && (
        <div className="rec__row">
          <TimeField value={startMin} onChange={(m) => { setStartMin(m); if (endMin <= m) setEndMin(Math.min(m + 60, 1440)); }} ariaLabel="Start time" />
          <span className="rec__lbl">to</span>
          <TimeField value={endMin} onChange={setEndMin} min={range.start === (range.end ?? range.start) ? startMin : undefined} ariaLabel="End time" />
        </div>
      )}
      <RecurrenceSelect
        anchor={anchor} recurrence={recurrence}
        onChange={(r) => { setRecurrence(r); if (r) { setRange({ start: anchor, end: anchor }); setDateMode('one'); } }}
      />
    </>
  );

  // Availability checker (founder's sketch, 2026-07-18): per-invitee free/busy
  // + suggestions, shaped by the date mode. Honest by design — it reads only
  // what each member shares with you (free_busy / calendar_shares).
  const fmtWindow = (startISO: string, len: number) =>
    formatDateShort(startISO) + (len > 1 ? ` – ${formatDateShort(addDays(startISO, len - 1))}` : '');
  const activeLen = dateMode === 'flex' ? flexDays : spanLen;
  const showPanel = invitees.length > 0 && !recurrence
    && (dateMode !== 'one' ? true : singleTimedDay);

  const availabilityPanel = showPanel && (
    <div className="evav">
      <p className="evprev__eyebrow">Availability</p>
      <div className="evprev__card">
        {fbLoading && fb.length === 0 && <p className="evav__note">Checking calendars&hellip;</p>}

        {dateMode === 'flex' && (
          <div className="evav__flexrow">
            <span className="evav__flexlbl">How long?</span>
            <button type="button" className="evav__step" onClick={() => setFlexDays((n) => Math.max(1, n - 1))}>−</button>
            <span className="evav__flexn">{flexDays === 1 ? '1 day' : `${flexDays} days`}</span>
            <button type="button" className="evav__step" onClick={() => setFlexDays((n) => Math.min(14, n + 1))}>+</button>
          </div>
        )}

        {fb.length > 0 && dateMode === 'one' && (
          <div className="evav__people">
            {[{ id: me, full_name: 'You' } as MemberOpt, ...invitees].map((m) => {
              const busy = busyAt(m.id, anchor, startMin, endMin);
              return (
                <span className={'evav__person' + (busy ? ' is-busy' : '')} key={m.id}>
                  <span className="evav__dot" aria-hidden />
                  {m.full_name ?? 'Member'}
                  <em>{busy ? 'busy then' : 'looks free'}</em>
                </span>
              );
            })}
          </div>
        )}

        {fb.length > 0 && dateMode === 'multi' && range.start && (
          <div className="evav__people">
            {[{ id: me, full_name: 'You' } as MemberOpt, ...invitees].map((m) => {
              const days = conflictDays(m.id, range.start as string, spanLen);
              return (
                <span className={'evav__person' + (days.length > 0 ? ' is-busy' : '')} key={m.id}>
                  <span className="evav__dot" aria-hidden />
                  {m.full_name ?? 'Member'}
                  <em>
                    {days.length === 0 ? (spanLen === 1 ? 'looks free' : 'free all days')
                      : `busy ${formatDateShort(days[0])}${days.length > 1 ? ` +${days.length - 1}` : ''}`}
                  </em>
                </span>
              );
            })}
          </div>
        )}

        {dateMode === 'one' && daySlots.length > 0 && (
          <>
            <p className="evav__sub">Times that work for everyone</p>
            <div className="evav__slots">
              {daySlots.map((t) => (
                <button
                  key={t} type="button" className="evav__slot"
                  onClick={() => { const dur = Math.max(30, endMin - startMin); setStartMin(t); setEndMin(Math.min(t + dur, 1440)); }}
                >
                  {minToLabel(t)}
                </button>
              ))}
            </div>
          </>
        )}
        {dateMode === 'one' && daySlots.length === 0 && !fbLoading && fb.length > 0
          && people.some((p) => busyAt(p, anchor, startMin, endMin)) && (
          <p className="evav__note">No open slot fits everyone on this day — try another date.</p>
        )}

        {dateMode !== 'one' && windowHits.length > 0 && (
          <>
            <p className="evav__sub">
              {dateMode === 'flex' ? 'Dates that work' : 'Other dates that work'}
            </p>
            <div className="evav__slots">
              {windowHits.map((w) => (
                <button
                  key={w.start} type="button"
                  className={'evav__slot' + (w.score > 0 ? ' evav__slot--near' : '')}
                  onClick={() => setRange({ start: w.start, end: activeLen > 1 ? addDays(w.start, activeLen - 1) : w.start })}
                >
                  {fmtWindow(w.start, activeLen)}
                  {w.score > 0 && <span className="evav__score">{w.score} conflict{w.score > 1 ? 's' : ''}</span>}
                </button>
              ))}
            </div>
          </>
        )}
        {dateMode !== 'one' && windowHits.length === 0 && !fbLoading && (
          <p className="evav__note">Add people above and I&rsquo;ll look for dates across the next 8 weeks.</p>
        )}

        <p className="evav__fine">Based on what each member shares with you.</p>
      </div>
    </div>
  );

  const kindPills = !eventId && (
    <div className="evav__modes evkind__row">
      {([['event', 'Event'], ['reminder', 'Reminder']] as const).map(([k, label]) => (
        <button
          key={k} type="button"
          className={'evav__mode' + (kind === k ? ' is-on' : '')}
          onClick={() => setKind(k)}
        >
          {label}
        </button>
      ))}
    </div>
  );

  async function saveReminder() {
    if (!title.trim()) { setError('Give the reminder a few words.'); return; }
    if (!range.start) { setError('Pick a date.'); return; }
    setSaving(true); setError('');
    try {
      await createReminder(me, {
        title: title.trim(), date: range.start,
        atMin: remHasTime ? remAtMin : null,
        leadMin: remHasTime ? remLead : 0,
        recurrence,
      });
      if (remHasTime && 'Notification' in window && Notification.permission === 'default') {
        void Notification.requestPermission();
      }
      back();
    } catch (e) {
      setError((e as { message?: string } | null)?.message || 'Could not save.');
      setSaving(false);
    }
  }

  if (kind === 'reminder') {
    return (
      <div className="cedit">
        <header className="cedit__head">
          <button className="conc__back" onClick={back} aria-label="Back"><Icon name="arrow-left" size={18} /></button>
          <h1 className="cedit__title">New reminder</h1>
          <button className="btn btn-primary cedit__save" onClick={saveReminder} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </header>
        {error && <p className="cedit__error">{error}</p>}
        <div className="cedit__body">
          {kindPills}
          <input
            className="cedit__input" placeholder="Remind me to… (e.g. Pay rent)"
            value={title} onChange={(e) => setTitle(e.target.value)}
          />
          <div className="cedit__rem-grid">
            <div className="cedit__field">
              <span className="cedit__label">Date</span>
              <DateRangeCalendar
                value={{ start: range.start, end: range.start }}
                onChange={(r) => setRange({ start: r.start, end: r.start })}
              />
            </div>
            <div className="cedit__rem-side">
              <div className="cedit__field">
                <span className="cedit__label">Repeat</span>
                <RecurrenceSelect
                  anchor={anchor} recurrence={recurrence}
                  onChange={(r) => setRecurrence(r)}
                />
                <p className="rec__summary">
                  {recurrence ? recurrenceLabel(recurrence, anchor) : `Once, on ${formatDateShort(anchor)}`}
                </p>
              </div>
              <div className="cedit__field">
                <span className="cedit__label">Alert</span>
                <label className="rec__radio">
                  <input type="checkbox" checked={remHasTime} onChange={(e) => setRemHasTime(e.target.checked)} /> At a time
                </label>
                {remHasTime ? (
                  <div className="rec__row">
                    <TimeField value={remAtMin} onChange={setRemAtMin} ariaLabel="Reminder time" />
                    <select className="rec__select rec__select--inline" value={remLead} onChange={(e) => setRemLead(Number(e.target.value))} aria-label="How early to alert">
                      <option value={0}>on time</option>
                      <option value={10}>10 mins before</option>
                      <option value={30}>30 mins before</option>
                      <option value={60}>1 hour before</option>
                      <option value={1440}>1 day before</option>
                    </select>
                  </div>
                ) : (
                  <p className="evav__note">A quiet nudge on your calendar that day — it never blocks your availability.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cedit">
      <header className="cedit__head">
        <button className="conc__back" onClick={back} aria-label="Back"><Icon name="arrow-left" size={18} /></button>
        <h1 className="cedit__title">{eventId ? 'Edit event' : 'New event'}</h1>
        <button className="btn btn-primary cedit__save" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </header>

      {error && <p className="cedit__error">{error}</p>}

      <div className="cedit__cols">
      <div className="cedit__body">
        {kindPills}
        <input
          className="cedit__input" placeholder="Event title"
          value={title} onChange={(e) => setTitle(e.target.value)}
        />

        {/* Which calendar */}
        <div className="cedit__field">
          <span className="cedit__label">Organizer</span>
          <select className="rec__select" value={calendar} onChange={(e) => setCalendar(e.target.value)}>
            <option value="me">Me</option>
            {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {/* When (times + repeat) — on desktop this block renders in the right
            column instead (see whenControls below); the DATE picker stays here. */}
        <div className="cedit__field only-mobile">
          <span className="cedit__label">When</span>
          {whenControls}
        </div>
        <div className="cedit__field">
          <span className="cedit__label evav__datehead">
            Date
            {!recurrence && (
              <span className="evav__modes">
                {([['one', 'One day'], ['multi', 'Multi-day'], ['flex', 'Flexible']] as const).map(([m, label]) => (
                  <button
                    key={m} type="button"
                    className={'evav__mode' + (dateMode === m ? ' is-on' : '')}
                    onClick={() => {
                      setDateMode(m);
                      if (m === 'one') setRange({ start: anchor, end: anchor });
                      if (m === 'flex' && spanLen > 1) setFlexDays(spanLen);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </span>
            )}
          </span>
          {dateMode === 'flex' && !recurrence ? (
            <>
              <textarea
                className="cedit__input evflex__q"
                rows={2}
                value={flexQ}
                onChange={(e) => setFlexQ(e.target.value)}
                placeholder="Say it like you'd say it to a friend — &ldquo;a 3 day retreat between July 1 and August 31 with Gabe and the WAG group&rdquo;"
              />
              {(flexChips.length > 0 || spaceNotes.length > 0) && (
                <div className="evflex__chips">
                  <span className="evflex__lbl">Understood:</span>
                  {[...flexChips, ...spaceNotes].map((c, i) => <span className="evflex__chip" key={i}>{c}</span>)}
                </div>
              )}
            </>
          ) : (
            <DateRangeCalendar
              value={recurrence ? { start: range.start, end: range.start } : range}
              onChange={(r) => {
                if (recurrence || dateMode === 'one') setRange({ start: r.start, end: r.start });
                else setRange(r);
              }}
            />
          )}
          <p className="rec__summary">
            {recurrence ? recurrenceLabel(recurrence, anchor)
              : dateMode === 'flex' ? (
                `Looking for ${flexDays === 1 ? 'a day' : `${flexDays} days`} between ${formatDateShort(search.from)} and ${formatDateShort(search.to)}`
                + (range.start && range.end && range.end !== range.start ? ` · picked ${formatDateShort(range.start)} – ${formatDateShort(range.end)}` : '')
              )
              : range.start === (range.end ?? range.start) ? 'One day' : `${spanLen} days`}
          </p>
        </div>

        {/* Invitees */}
        <div className="cedit__field">
          <span className="cedit__label">Invite People, Groups, Communities, Organizations, and/or Places</span>
          {invitees.length > 0 && (
            <div className="calp__invitees">
              {invitees.map((m) => (
                <button className="calp__invitee" key={m.id} onClick={() => setInvitees((cur) => cur.filter((x) => x.id !== m.id))}>
                  <span className="calp__person-avatar" style={{ background: colorFor(m.id) }}>{monogramFor(m.full_name ?? 'Member')}</span>
                  {m.full_name ?? 'Member'} ×
                </button>
              ))}
            </div>
          )}
          <input
            className="cedit__input" placeholder="Search members…"
            value={query} onChange={(e) => setQuery(e.target.value)}
          />
          {matches.map((m) => (
            <button
              className="calp__match" key={m.id}
              onClick={() => { setInvitees((cur) => [...cur, m]); setQuery(''); }}
            >
              <span className="calp__person-avatar" style={{ background: colorFor(m.id) }}>{monogramFor(m.full_name ?? 'Member')}</span>
              {m.full_name ?? 'Member'}
            </button>
          ))}
        </div>

        <div className="only-mobile">{availabilityPanel}</div>

        {/* Location + notes */}
        <div className="cedit__field">
          <span className="cedit__label">Location</span>
          <LocationField
            className="cedit__input"
            value={location}
            geo={locGeo}
            onChange={(text, g) => { setLocation(text); setLocGeo(g); }}
            placeholder="Where (optional)"
          />
        </div>
        <div className="cedit__field">
          <span className="cedit__label">Notes</span>
          <textarea className="cedit__textarea" rows={3} placeholder="Details (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      {/* Right column (desktop): time controls + live invite preview */}
      <aside className="evprev" aria-label="Invite preview">
        <div className="cedit__field only-desktop evprev__when">
          <span className="cedit__label">When</span>
          {whenControls}
        </div>
        <p className="evprev__eyebrow">Invite preview</p>
        <div className="evprev__card">
          <h2 className="calp__sheet-title">{title.trim() || 'Untitled event'}</h2>
          <p className="calp__sheet-when">
            {range.start ? formatDateShort(range.start) : '—'}
            {!recurrence && range.end && range.end !== range.start ? ` – ${formatDateShort(range.end)}` : ''}
            {allDay ? ' · All day' : ` · ${minToLabel(startMin)} – ${minToLabel(endMin)}`}
            {recurrence && range.start && ` · ${recurrenceLabel(recurrence, range.start)}`}
          </p>
          {location.trim() && <SmartLocation loc={location.trim()} className="calp__sheet-loc" />}
          {description.trim() && <p className="calp__sheet-desc"><LinkifiedText text={description} /></p>}
          {invitees.length > 0 && (
            <div className="calp__sheet-people">
              {invitees.map((m) => (
                <span className="calp__person" key={m.id}>
                  <span className="calp__person-avatar" style={{ background: colorFor(m.id) }}>{monogramFor(m.full_name ?? 'Member')}</span>
                  <span className="calp__person-name">{m.full_name ?? 'Member'}</span>
                  <span className="calp__person-status">?</span>
                </span>
              ))}
            </div>
          )}
          <p className="evprev__from">
            {calendar === 'me' ? 'Organized by you' : `Organized by ${spaces.find((s) => s.id === calendar)?.name ?? 'your group'}`}
          </p>
        </div>
        {availabilityPanel}
      </aside>
      </div>
    </div>
  );
}
