import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import { minToLabel } from '../lib/calendarApi';
import { formatDateShort, todayISO } from '../lib/conciergeApi';
import {
  BookingRow, listMyBookings, respondBooking, cancelBooking,
} from '../lib/bookingApi';
import './Bookings.css';

/** The bookings hub: requests awaiting your answer, sessions on your books,
 *  and the ones you've asked for. Confirmed bookings live on both calendars
 *  as real events; this page is the lifecycle view. */
export default function Bookings() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = user?.id ?? '';

  const [asProvider, setAsProvider] = useState<BookingRow[]>([]);
  const [asBooker, setAsBooker] = useState<BookingRow[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!me) return;
    const { asProvider: p, asBooker: b } = await listMyBookings(me);
    setAsProvider(p); setAsBooker(b); setReady(true);
  }, [me]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<void>) => {
    setError('');
    try { await fn(); await load(); }
    catch (e) { setError((e as { message?: string } | null)?.message || 'Something went wrong.'); }
  };

  const today = todayISO();
  const when = (b: BookingRow) =>
    `${formatDateShort(b.on_date)} · ${minToLabel(b.start_min)} – ${minToLabel(b.end_min)}`;

  const requests = asProvider.filter((b) => b.status === 'pending');
  const upcoming = asProvider.filter((b) => b.status === 'confirmed' && b.on_date >= today);
  const mine = asBooker.filter((b) => (b.status === 'pending' || b.status === 'confirmed') && b.on_date >= today);

  return (
    <div className="bkg">
      <button className="cmp__back" onClick={() => navigate('/calendar')}>
        <Icon name="arrow-left" size={14} /> Calendar
      </button>
      <header className="bkg__head">
        <p className="eyebrow">Bookings</p>
        <h1 className="bkg__title display-italic">Sessions & requests</h1>
      </header>

      {error && <p className="bkg__error">{error}</p>}
      {!ready && <p className="bkg__muted">Loading…</p>}

      {ready && requests.length === 0 && upcoming.length === 0 && mine.length === 0 && (
        <p className="bkg__muted">
          Nothing here yet. Offer sessions from Calendar settings, or book
          someone from their profile.
        </p>
      )}

      {requests.length > 0 && (
        <section className="bkg__sec">
          <h2 className="bkg__h2">Waiting on you</h2>
          {requests.map((b) => (
            <div className="bkg__row" key={b.id}>
              <div className="bkg__row-body">
                <span className="bkg__row-title">{b.booker?.full_name ?? 'A member'} · {b.type?.title ?? 'Session'}</span>
                <span className="bkg__row-sub">{when(b)}</span>
                {b.note && <span className="bkg__row-note">&ldquo;{b.note}&rdquo;</span>}
              </div>
              <div className="bkg__row-actions">
                <button className="btn btn-primary bkg__btn" onClick={() => act(() => respondBooking(b.id, true))}>Accept</button>
                <button className="btn bkg__btn" onClick={() => act(() => respondBooking(b.id, false))}>Decline</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="bkg__sec">
          <h2 className="bkg__h2">On your books</h2>
          {upcoming.map((b) => (
            <div className="bkg__row" key={b.id}>
              <div className="bkg__row-body">
                <span className="bkg__row-title">{b.booker?.full_name ?? 'A member'} · {b.type?.title ?? 'Session'}</span>
                <span className="bkg__row-sub">{when(b)}</span>
              </div>
              <button className="btn bkg__btn bkg__btn--quiet" onClick={() => {
                if (window.confirm('Cancel this session? They’ll be notified.')) void act(() => cancelBooking(b.id));
              }}>Cancel</button>
            </div>
          ))}
        </section>
      )}

      {mine.length > 0 && (
        <section className="bkg__sec">
          <h2 className="bkg__h2">Your sessions</h2>
          {mine.map((b) => (
            <div className="bkg__row" key={b.id}>
              <div className="bkg__row-body">
                <span className="bkg__row-title">
                  {b.type?.title ?? 'Session'} with {b.provider?.full_name ?? 'a member'}
                  {b.status === 'pending' && <em className="bkg__pending"> · awaiting reply</em>}
                </span>
                <span className="bkg__row-sub">{when(b)}{b.type?.location ? ` · ${b.type.location}` : ''}</span>
              </div>
              <button className="btn bkg__btn bkg__btn--quiet" onClick={() => {
                if (window.confirm('Cancel this session?')) void act(() => cancelBooking(b.id));
              }}>Cancel</button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
