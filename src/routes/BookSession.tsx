import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { minToLabel } from '../lib/calendarApi';
import { addDays, localDate, todayISO } from '../lib/conciergeApi';
import {
  BookingBoard, loadBookingBoard, slotsForDay, createBooking, nudgeAvailability,
} from '../lib/bookingApi';
import { ensureDirectChat } from '../lib/chatApi';
import './Bookings.css';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The slot picker: a session type's open times over the next two weeks —
 *  declared hours minus every kind of busy (Lichen events, imported
 *  calendars, held bookings), buffered. Picking a slot requests (or books)
 *  through the server, which re-validates before anything is held. */
export default function BookSession() {
  const { typeId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = user?.id ?? '';

  const [board, setBoard] = useState<BookingBoard | null>(null);
  const [providerName, setProviderName] = useState('');
  const [ready, setReady] = useState(false);
  const [pick, setPick] = useState<{ iso: string; start: number } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'requested' | 'booked' | null>(null);
  const [error, setError] = useState('');

  const from = todayISO();
  const to = addDays(from, 29);

  useEffect(() => {
    if (!me || !typeId) return;
    let live = true;
    (async () => {
      const b = await loadBookingBoard(typeId, from, to);
      if (!live) return;
      setBoard(b);
      if (b) {
        const { data } = await supabase.from('profiles').select('full_name').eq('id', b.type.provider_id).maybeSingle();
        if (live) setProviderName((data as { full_name: string | null } | null)?.full_name ?? '');
      }
      setReady(true);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, typeId]);

  const days = useMemo(() => {
    if (!board) return [];
    return Array.from({ length: 14 }, (_, i) => addDays(from, i))
      .map((iso) => ({ iso, slots: slotsForDay(board, iso) }))
      .filter((d) => d.slots.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);

  if (!ready) return <div className="bkg"><p className="bkg__muted">Loading…</p></div>;
  if (!board) {
    return (
      <div className="bkg">
        <button className="cmp__back" onClick={() => navigate(-1)}><Icon name="arrow-left" size={14} /> Back</button>
        <p className="bkg__muted">This session isn&rsquo;t available.</p>
      </div>
    );
  }

  const t = board.type;
  if (done) {
    return (
      <div className="bkg">
        <header className="bkg__head">
          <p className="eyebrow">{done === 'booked' ? 'Booked' : 'Requested'}</p>
          <h1 className="bkg__title display-italic">
            {done === 'booked' ? 'It’s on both calendars.' : 'Request sent.'}
          </h1>
          <p className="bkg__sub">
            {done === 'booked'
              ? `${t.title} with ${providerName || 'your practitioner'} is confirmed.`
              : `${providerName || 'They'} will accept or decline — you’ll get a bell either way.`}
          </p>
        </header>
        <div className="bkg__doneactions">
          <button className="btn btn-primary bkg__btn" onClick={() => navigate('/bookings')}>See your sessions</button>
          <button className="btn bkg__btn" onClick={() => navigate('/calendar')}>Calendar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="bkg">
      <button className="cmp__back" onClick={() => navigate(-1)}><Icon name="arrow-left" size={14} /> Back</button>
      <header className="bkg__head">
        {/* The practitioner's name is a door to their profile (founder
            2026-08-05) — you should be able to read who you're booking. */}
        <p className="eyebrow">
          Book{providerName && <> · <Link className="bkg__who" to={`/members/${t.provider_id}`}>{providerName}</Link></>}
        </p>
        <h1 className="bkg__title display-italic">{t.title}</h1>
        <p className="bkg__sub">
          {t.duration_min} min{t.price ? ` · ${t.price}` : ''}{t.location ? ` · ${t.location}` : ''}
          {t.approval === 'request' ? ' · requests are confirmed by hand' : ' · books instantly'}
        </p>
        {t.description && <p className="bkg__desc">{t.description}</p>}
      </header>

      {error && <p className="bkg__error">{error}</p>}

      {/* No declared hours at all is a different truth than a full fortnight:
          nobody is bookable by default (founder 2026-08-14), so say so and
          turn the booker's interest into the provider's setup moment — one
          button sends the bell AND opens a DM the booker sends themselves. */}
      {board.windows.length === 0 ? (
        <div className="bkg__nohours">
          <p className="bkg__muted">
            {providerName || 'This member'} hasn&rsquo;t set up their availability hours yet,
            so there&rsquo;s nothing to pick from.
          </p>
          <button
            className="btn btn-primary bkg__btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true); setError('');
              try {
                await nudgeAvailability(t.provider_id, t.title);
                const chatId = await ensureDirectChat(t.provider_id);
                const ask = `I was trying to book “${t.title}” with you, but your availability isn’t set up yet — if you add your hours in Calendar settings, I can pick a time.`;
                navigate(`/chat/${chatId}?draft=${encodeURIComponent(ask)}`);
              } catch (e) {
                setError((e as { message?: string } | null)?.message || 'Something went wrong.');
                setBusy(false);
              }
            }}
          >
            {busy ? 'One moment…' : 'Let them know'}
          </button>
          <p className="bkg__nohours-fine">
            They&rsquo;ll get a notification, and you can send them a note in your own words.
          </p>
        </div>
      ) : days.length === 0 && (
        <p className="bkg__muted">
          No open times in the next two weeks — check back, or message them
          from their profile.
        </p>
      )}

      {days.map(({ iso, slots }) => (
        <section className="bkg__day" key={iso}>
          <h2 className="bkg__h2">{DOW[localDate(iso).getDay()]} · {localDate(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</h2>
          <div className="bkg__slots">
            {slots.map((s) => (
              <button
                key={s}
                className={'bkg__slot' + (pick?.iso === iso && pick.start === s ? ' is-on' : '')}
                onClick={() => setPick({ iso, start: s })}
              >
                {minToLabel(s)}
              </button>
            ))}
          </div>
        </section>
      ))}

      {pick && (
        <div className="bkg__confirm">
          <p className="bkg__confirm-when">
            {localDate(pick.iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            {' · '}{minToLabel(pick.start)} – {minToLabel(pick.start + t.duration_min)}
          </p>
          <textarea
            className="bkg__note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything they should know? (optional)"
          />
          <button
            className="btn btn-primary bkg__btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true); setError('');
              try {
                await createBooking(t.id, pick.iso, pick.start, note.trim());
                setDone(t.approval === 'instant' ? 'booked' : 'requested');
              } catch (e) {
                setError((e as { message?: string } | null)?.message || 'Something went wrong.');
                setBusy(false);
              }
            }}
          >
            {busy ? 'One moment…' : t.approval === 'instant' ? 'Book it' : 'Request this time'}
          </button>
        </div>
      )}
    </div>
  );
}
