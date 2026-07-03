import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import { colorFor, monogramFor } from '../lib/chatApi';
import { localDate, toISO, todayISO, formatDateShort } from '../lib/conciergeApi';
import { occursOn } from '../lib/recurrence';
import { EventRow, loadMyEvents, deleteEvent, rsvp, minToLabel } from '../lib/calendarApi';
import './Calendar.css';

const HOUR_PX = 48;
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Sunday that starts the week containing iso (mock's grid is Sunday-first). */
export function sundayOfWeek(iso: string): string {
  const d = localDate(iso);
  d.setDate(d.getDate() - d.getDay());
  return toISO(d);
}
function addDays(iso: string, n: number): string {
  const d = localDate(iso); d.setDate(d.getDate() + n); return toISO(d);
}

/** My calendar — week grid per the Figma mock: Sunday-first columns, hour rows,
 *  peach event blocks, all-day chips above the grid. */
export default function Calendar() {
  const { user } = useAuth();
  const me = user?.id ?? '';
  const navigate = useNavigate();
  const today = todayISO();

  const [weekStart, setWeekStart] = useState(() => sundayOfWeek(todayISO()));
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<EventRow | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekEnd = days[6];

  const load = useCallback(async () => {
    if (!me) return;
    setLoading(true);
    setEvents(await loadMyEvents(me, weekStart, weekEnd));
    setLoading(false);
  }, [me, weekStart, weekEnd]);
  useEffect(() => { load(); }, [load]);

  // Open the grid around the working morning.
  useEffect(() => { gridRef.current?.scrollTo({ top: 7 * HOUR_PX }); }, []);

  const timedOn = (iso: string) =>
    events
      .filter((e) => !e.all_day && occursOn(e, iso))
      .sort((a, b) => (a.start_min ?? 0) - (b.start_min ?? 0));
  const allDayOn = (iso: string) => events.filter((e) => e.all_day && occursOn(e, iso));
  const hasAllDayRow = days.some((d) => allDayOn(d).length > 0);

  async function onDelete(ev: EventRow) {
    await deleteEvent(ev.id); setSelected(null); load();
  }
  async function onRsvp(ev: EventRow, status: 'going' | 'declined') {
    await rsvp(ev.id, me, status); setSelected(null); load();
  }

  const monthLabel = localDate(days[3]).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const myAttend = (ev: EventRow) => ev.attendees?.find((a) => a.profile_id === me);
  // Google-style block state: pending invite = white w/ peach outline; declined = faded.
  const blockClass = (ev: EventRow, base: string) => {
    const st = ev.creator_id !== me ? myAttend(ev)?.status : undefined;
    return base + (st === 'invited' ? ` ${base}--pending` : st === 'declined' ? ` ${base}--declined` : '');
  };

  return (
    <div className="calp">
      <div className="calp__head">
        <div className="calp__head-row">
          <h1 className="calp__title">Calendar</h1>
          <button className="calp__new" onClick={() => navigate('/calendar/new')} aria-label="New event">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M9 3.75V14.25M3.75 9H14.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="calp__nav">
          <button className="calp__navbtn" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week"><Icon name="chevron-left" size={16} /></button>
          <button className="calp__month" onClick={() => setWeekStart(sundayOfWeek(todayISO()))}>{monthLabel}</button>
          <button className="calp__navbtn" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week"><Icon name="chevron-right" size={16} /></button>
        </div>
      </div>

      <div className="calp__card">
        {/* Day headers */}
        <div className="calp__days">
          <span className="calp__gutter-head" />
          {days.map((iso, i) => (
            <div className="calp__day" key={iso}>
              <span className="calp__day-name">{DAY_LABELS[i]}</span>
              <span className={'calp__day-num' + (iso === today ? ' is-today' : '')}>{localDate(iso).getDate()}</span>
            </div>
          ))}
        </div>

        {/* All-day chips */}
        {hasAllDayRow && (
          <div className="calp__alldays">
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

        {/* Hour grid */}
        <div className="calp__grid" ref={gridRef}>
          <div className="calp__grid-inner" style={{ height: 24 * HOUR_PX }}>
            <div className="calp__gutter">
              {Array.from({ length: 23 }, (_, h) => (
                <span className="calp__hour" key={h + 1} style={{ top: (h + 1) * HOUR_PX }}>{minToLabel((h + 1) * 60)}</span>
              ))}
            </div>
            {days.map((iso) => (
              <div className="calp__col" key={iso}>
                {Array.from({ length: 23 }, (_, h) => (
                  <span className="calp__line" key={h + 1} style={{ top: (h + 1) * HOUR_PX }} />
                ))}
                {timedOn(iso).map((e) => {
                  const top = ((e.start_min ?? 0) / 60) * HOUR_PX;
                  const height = Math.max(22, (((e.end_min ?? 60) - (e.start_min ?? 0)) / 60) * HOUR_PX);
                  return (
                    <button
                      className={blockClass(e, 'calp__event')} key={e.id + iso}
                      style={{ top, height }}
                      onClick={() => setSelected(e)}
                    >
                      {e.title}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        {loading && <p className="calp__loading">Loading…</p>}
      </div>

      {/* Event detail sheet */}
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
            </p>
            {selected.location && <p className="calp__sheet-loc"><Icon name="location" size={13} /> {selected.location}</p>}
            {selected.description && <p className="calp__sheet-desc">{selected.description}</p>}

            {(selected.attendees?.length ?? 0) > 0 && (
              <div className="calp__sheet-people">
                {selected.attendees!.map((a) => (
                  <span className="calp__person" key={a.profile_id} title={a.status}>
                    <span className="calp__person-avatar" style={{ background: colorFor(a.profile_id) }}>
                      {monogramFor(a.profile?.full_name ?? 'Member')}
                    </span>
                    <span className="calp__person-name">{a.profile?.full_name ?? 'Member'}</span>
                    <span className={'calp__person-status is-' + a.status}>{a.status === 'invited' ? '?' : a.status === 'going' ? '✓' : '✕'}</span>
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
