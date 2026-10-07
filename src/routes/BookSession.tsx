import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { minToLabel } from '../lib/calendarApi';
import { addDays, localDate, todayISO } from '../lib/conciergeApi';
import {
  BookingBoard, loadBookingBoard, slotsForDay, createBooking, bookingMeetingUrl, nudgeAvailability,
  rescheduleBooking, sendBookingMail, seatsLeft, viewerZone, viewerSlotLabel,
} from '../lib/bookingApi';
import { ensureDirectChat } from '../lib/chatApi';
import { videoServiceOf } from '../lib/linkify';
import './Bookings.css';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The slot picker: a session type's open times over the next two weeks —
 *  declared hours minus every kind of busy (Lichen events, imported
 *  calendars, held bookings), buffered. Picking a slot requests (or books)
 *  through the server, which re-validates before anything is held. */
export default function BookSession() {
  const { param = '' } = useParams();
  const typeId = param;   // /book/:param — a uuid landed here (BookGate)
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = user?.id ?? '';
  // ?reschedule=<booking id> — the same picker MOVES a live booking instead
  // of creating one (founder 2026-10-03, the Calendly audit's #1 gap).
  const [params] = useSearchParams();
  const rescheduleId = params.get('reschedule');

  const [board, setBoard] = useState<BookingBoard | null>(null);
  const [providerName, setProviderName] = useState('');
  const [ready, setReady] = useState(false);
  const [pick, setPick] = useState<{ iso: string; start: number } | null>(null);
  const [note, setNote] = useState('');
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [mineTime, setMineTime] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'requested' | 'booked' | 'moved' | null>(null);
  // An instant booking's video link, read back once the booking exists.
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
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

  // Provider-local minutes are the stored truth; only LABELS convert when
  // the viewer's clock runs elsewhere (founder 2026-10-03 — the public
  // link's logged timezone follow-up, applied to the member picker too).
  const ptz = board?.type.provider_tz ?? null;
  const vz = viewerZone();
  const foreign = !!(ptz && vz && ptz !== vz);
  const slotLabel = (iso: string, s: number): string => {
    if (!foreign || !mineTime) return minToLabel(s);
    const v = viewerSlotLabel(iso, s, ptz);
    if (!v) return minToLabel(s);
    return v.label + (v.dayShift === 1 ? ' (+1d)' : v.dayShift === -1 ? ' (−1d)' : '');
  };
  const questions = (board?.type.questions ?? []).filter(Boolean);
  const capacity = board?.type.capacity ?? 1;
  const unanswered = !rescheduleId && questions.some((_, i) => !(answers[i] ?? '').trim());

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
            {done === 'moved' ? 'Moved.' : done === 'booked' ? 'It’s on both calendars.' : 'Request sent.'}
          </h1>
          <p className="bkg__sub">
            {done === 'moved'
              ? `${t.title} has its new time — everyone on it has been told.`
              : done === 'booked'
                ? `${t.title} with ${providerName || 'your practitioner'} is confirmed.`
                : `${providerName || 'They'} will accept or decline — you’ll get a bell either way.`}
          </p>
        </header>
        {done === 'booked' && joinUrl && (
          <div className="bkg__doneactions">
            <a className="btn bkg__btn" href={joinUrl} target="_blank" rel="noopener noreferrer">
              <Icon name="video" size={14} /> {videoServiceOf(joinUrl) ?? 'Video'} link
            </a>
            <span className="bkg__joinnote">It&rsquo;s also on the calendar event and in your sessions.</span>
          </div>
        )}
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
          {rescheduleId ? 'Pick a new time' : 'Book'}{providerName && <> · <Link className="bkg__who" to={`/members/${t.provider_id}`}>{providerName}</Link></>}
        </p>
        <h1 className="bkg__title display-italic">{t.title}</h1>
        <p className="bkg__sub">
          {t.duration_min} min{t.price ? ` · ${t.price}` : ''}{t.location ? ` · ${t.location}` : ''}
          {capacity > 1 ? ` · group session, up to ${capacity} people` : ''}
          {t.approval === 'request' ? ' · requests are confirmed by hand' : ' · books instantly'}
        </p>
        {foreign && (
          <p className="bkpub__tz">
            {mineTime
              ? `Times are shown in your time zone (${vz}).`
              : `Times are shown in ${providerName ? `${providerName.split(' ')[0]}’s` : 'their'} time zone (${ptz}).`}{' '}
            <button className="bkg__tzflip" onClick={() => setMineTime((v) => !v)}>
              Show in {mineTime ? (providerName ? `${providerName.split(' ')[0]}’s` : 'their') : 'your'} time
            </button>
          </p>
        )}
        {t.description && !rescheduleId && <p className="bkg__desc">{t.description}</p>}
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
                {slotLabel(iso, s)}
                {capacity > 1 && <em className="bkg__seats"> · {seatsLeft(board, iso, s)} left</em>}
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
            {foreign && (() => {
              const v = viewerSlotLabel(pick.iso, pick.start, ptz);
              const ve = viewerSlotLabel(pick.iso, pick.start + t.duration_min, ptz);
              return v && ve ? ` (${v.label} – ${ve.label} your time)` : '';
            })()}
          </p>
          {!rescheduleId && questions.map((q, i) => (
            <label className="bkg__q" key={i}>
              <span>{q}</span>
              <textarea
                className="bkg__note"
                value={answers[i] ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))}
              />
            </label>
          ))}
          {!rescheduleId && (
            <textarea
              className="bkg__note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything they should know? (optional)"
            />
          )}
          <button
            className="btn btn-primary bkg__btn"
            disabled={busy || unanswered}
            onClick={async () => {
              setBusy(true); setError('');
              try {
                if (rescheduleId) {
                  // Provider moving a guest's booking gets the token back
                  // so the state-derived mail reaches the guest too.
                  const tok = await rescheduleBooking(rescheduleId, pick.iso, pick.start);
                  if (tok) sendBookingMail(tok);
                  setDone('moved');
                } else {
                  const id = await createBooking(
                    t.id, pick.iso, pick.start, note.trim(),
                    questions.map((q, i) => ({ q, a: (answers[i] ?? '').trim() })).filter((x) => x.a),
                  );
                  if (id && t.approval === 'instant') setJoinUrl(await bookingMeetingUrl(id));
                  setDone(t.approval === 'instant' ? 'booked' : 'requested');
                }
              } catch (e) {
                setError((e as { message?: string } | null)?.message || 'Something went wrong.');
                setBusy(false);
              }
            }}
          >
            {busy ? 'One moment…'
              : rescheduleId ? 'Move it to this time'
                : t.approval === 'instant' ? 'Book it' : 'Request this time'}
          </button>
          {unanswered && <p className="bkg__muted">A quick answer to each question above and you&rsquo;re set.</p>}
        </div>
      )}
    </div>
  );
}
