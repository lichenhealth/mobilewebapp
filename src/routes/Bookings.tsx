import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import Avatar from '../components/Avatar';
import { useAuth } from '../auth/AuthProvider';
import { minToLabel } from '../lib/calendarApi';
import { formatDateShort, todayISO } from '../lib/conciergeApi';
import {
  BookingRow, OpenSession, listMyBookings, listOpenSessions, respondBooking, cancelBooking,
  sendBookingMail,
} from '../lib/bookingApi';
import './Bookings.css';
import { useConfirm } from '../components/ConfirmDialog';

/** The bookings hub: requests awaiting your answer, sessions on your books,
 *  and the ones you've asked for. Confirmed bookings live on both calendars
 *  as real events; this page is the lifecycle view. */
export default function Bookings() {
  const navigate = useNavigate();
  const confirmDialog = useConfirm();
  const { user } = useAuth();
  const me = user?.id ?? '';

  const [asProvider, setAsProvider] = useState<BookingRow[]>([]);
  const [asBooker, setAsBooker] = useState<BookingRow[]>([]);
  const [open, setOpen] = useState<OpenSession[]>([]);
  const [bookQ, setBookQ] = useState('');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!me) return;
    const [{ asProvider: p, asBooker: b }, sessions] = await Promise.all([
      listMyBookings(me), listOpenSessions(me),
    ]);
    setAsProvider(p); setAsBooker(b); setOpen(sessions); setReady(true);
  }, [me]);
  useEffect(() => { load(); }, [load]);

  // The book-from-here directory: every session offered to you, narrowed by name
  const openHits = useMemo(() => {
    const n = bookQ.trim().toLowerCase();
    if (!n) return open;
    return open.filter((s) =>
      (s.provider?.full_name ?? '').toLowerCase().includes(n)
      || s.title.toLowerCase().includes(n));
  }, [open, bookQ]);

  const act = async (fn: () => Promise<void>) => {
    setError('');
    try { await fn(); await load(); }
    catch (e) { setError((e as { message?: string } | null)?.message || 'Something went wrong.'); }
  };

  const today = todayISO();
  const when = (b: BookingRow) =>
    `${formatDateShort(b.on_date)} · ${minToLabel(b.start_min)} – ${minToLabel(b.end_min)}`;
  // A guest row has no member behind it — name it honestly.
  const who = (b: BookingRow) =>
    b.booker_id ? (b.booker?.full_name ?? 'A member') : `${b.guest_name ?? 'A guest'} · from outside Lichen`;
  // Guests hear by email, not bell — after a decision, the mail function
  // reads the row's CURRENT status and writes accordingly.
  const decideGuest = (b: BookingRow, accept: boolean) =>
    act(async () => {
      await respondBooking(b.id, accept);
      if (!b.booker_id && b.guest_token) sendBookingMail(b.guest_token);
    });

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

      {ready && open.length > 0 && (
        <section className="bkg__sec">
          <h2 className="bkg__h2">Book a session</h2>
          {open.length > 4 && (
            <input
              className="bkg__search"
              value={bookQ}
              onChange={(e) => setBookQ(e.target.value)}
              placeholder="Search by name or session…"
            />
          )}
          {openHits.map((s) => (
            <button className="bkg__row bkg__row--go" key={s.id} onClick={() => navigate(`/book/${s.id}`)}>
              <Avatar
                id={s.profile_id}
                name={s.provider?.full_name ?? 'Member'}
                url={s.provider?.avatar_url ?? null}
                size={36}
              />
              <div className="bkg__row-body">
                <span className="bkg__row-title">{s.provider?.full_name ?? 'A member'} · {s.title}</span>
                <span className="bkg__row-sub">
                  {s.duration_min} min{s.price ? ` · ${s.price}` : ''}{s.location ? ` · ${s.location}` : ''}
                </span>
              </div>
              <Icon name="chevron-right" size={14} />
            </button>
          ))}
          {openHits.length === 0 && (
            <p className="bkg__muted">No sessions match &ldquo;{bookQ.trim()}&rdquo;.</p>
          )}
        </section>
      )}

      {ready && open.length === 0 && requests.length === 0 && upcoming.length === 0 && mine.length === 0 && (
        <p className="bkg__muted">
          Nothing here yet. Offer sessions from Calendar settings — they&rsquo;ll
          appear here for others to book.
        </p>
      )}

      {requests.length > 0 && (
        <section className="bkg__sec">
          <h2 className="bkg__h2">Waiting on you</h2>
          {requests.map((b) => (
            <div className="bkg__row" key={b.id}>
              <div className="bkg__row-body">
                <span className="bkg__row-title">{who(b)} · {b.type?.title ?? 'Session'}</span>
                <span className="bkg__row-sub">{when(b)}</span>
                {b.note && <span className="bkg__row-note">&ldquo;{b.note}&rdquo;</span>}
              </div>
              <div className="bkg__row-actions">
                <button className="btn btn-primary bkg__btn" onClick={() => void decideGuest(b, true)}>Accept</button>
                <button className="btn bkg__btn" onClick={() => void decideGuest(b, false)}>Decline</button>
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
                <span className="bkg__row-title">{who(b)} · {b.type?.title ?? 'Session'}</span>
                <span className="bkg__row-sub">{when(b)}</span>
              </div>
              <button className="btn bkg__btn bkg__btn--quiet" onClick={() => {
                void confirmDialog({ message: 'Cancel this session? They\u2019ll be notified.', confirmLabel: 'Cancel session', cancelLabel: 'Keep it', danger: true }).then((ok) => { if (ok) void act(() => cancelBooking(b.id)); });
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
                void confirmDialog({ message: 'Cancel this session?', confirmLabel: 'Cancel session', cancelLabel: 'Keep it', danger: true }).then((ok) => { if (ok) void act(() => cancelBooking(b.id)); });
              }}>Cancel</button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
