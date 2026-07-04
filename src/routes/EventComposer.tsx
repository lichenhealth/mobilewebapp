import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import DateRangeCalendar, { DateRange } from '../components/DateRangeCalendar';
import RecurrenceSelect from '../components/RecurrenceSelect';
import TimeField from '../components/TimeField';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { colorFor, monogramFor } from '../lib/chatApi';
import { todayISO, formatDateShort } from '../lib/conciergeApi';
import { Recurrence, recurrenceLabel } from '../lib/recurrence';
import { createEvent, updateEvent, loadEvent, minToLabel } from '../lib/calendarApi';
import { LinkifiedText } from '../components/CarePostCard';
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
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const anchor = range.start ?? todayISO();

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

      // Prefill from a find-a-time slot link (?space&date&start&inv=…).
      if (!eventId) {
        const qSpace = params.get('space'), qDate = params.get('date'), qStart = params.get('start'), qInv = params.get('inv');
        if (qSpace) setCalendar(qSpace);
        if (qDate) setRange({ start: qDate, end: qDate });
        if (qStart) {
          const s = Number(qStart);
          if (Number.isFinite(s)) { setStartMin(s); setEndMin(Math.min(s + 60, 1440)); }
        }
        if (qInv) {
          const ids = qInv.split(',').filter(Boolean);
          setInvitees(ids.map((id) => mem.find((m) => m.id === id) ?? { id, full_name: null }));
        }
      }
    })();
  }, [me, eventId, params]);

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
        <input
          className="cedit__input" placeholder="Event title"
          value={title} onChange={(e) => setTitle(e.target.value)}
        />

        {/* Which calendar */}
        <div className="cedit__field">
          <span className="cedit__label">Calendar</span>
          <select className="rec__select" value={calendar} onChange={(e) => setCalendar(e.target.value)}>
            <option value="me">My calendar</option>
            {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {/* When */}
        <div className="cedit__field">
          <span className="cedit__label">When</span>
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
            onChange={(r) => { setRecurrence(r); if (r) setRange({ start: anchor, end: anchor }); }}
          />
          <DateRangeCalendar
            value={recurrence ? { start: range.start, end: range.start } : range}
            onChange={(r) => setRange(recurrence ? { start: r.start, end: r.start } : r)}
          />
          <p className="rec__summary">
            {recurrence ? recurrenceLabel(recurrence, anchor) : range.start === (range.end ?? range.start) ? 'One day' : 'Multi-day'}
          </p>
        </div>

        {/* Invitees */}
        <div className="cedit__field">
          <span className="cedit__label">Invite people</span>
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

        {/* Location + notes */}
        <div className="cedit__field">
          <span className="cedit__label">Location</span>
          <input className="cedit__input" placeholder="Where (optional)" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div className="cedit__field">
          <span className="cedit__label">Notes</span>
          <textarea className="cedit__textarea" rows={3} placeholder="Details (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      {/* Live invite preview (desktop): what every participant will see */}
      <aside className="evprev" aria-label="Invite preview">
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
            {calendar === 'me' ? 'On your calendar' : `On ${spaces.find((s) => s.id === calendar)?.name ?? 'a space calendar'}`}
          </p>
        </div>
      </aside>
      </div>
    </div>
  );
}
