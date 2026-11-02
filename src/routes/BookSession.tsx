import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageHead } from '../components/PageHead';
import { Icon } from '../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import SlotMonth from '../components/SlotMonth';
import { minToLabel, freeBusy, type FreeBusyRow } from '../lib/calendarApi';
import { occursOn } from '../lib/recurrence';
import { revealBelow } from '../lib/smartReveal';
import { addDays, localDate, todayISO } from '../lib/conciergeApi';
import {
  BookingBoard, loadBookingBoard, slotsForDay, createBooking, bookingMeetingUrl, nudgeAvailability,
  rescheduleBooking, sendBookingMail, seatsLeft, viewerZone, zoneSlotLabel, allTimeZones,
  listBookableTypes, sessionLengthLabel, readBookResume, clearBookResume,
  type BookingType,
} from '../lib/bookingApi';
import TimeZonePick from '../components/TimeZonePick';
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
  // SESSION LENGTHS (founder 2026-11-01): this type's same-NAME siblings —
  // the provider's other lengths of the same session. More than one renders
  // a length-switcher row, so arriving on any length still offers the rest.
  const [sibs, setSibs] = useState<BookingType[]>([]);
  const [providerName, setProviderName] = useState('');
  const [ready, setReady] = useState(false);
  // SCREEN 1 → SCREEN 2 (founder 2026-11-01, her Calendly markup: "this is
  // screen 1, and then once you select a day, screen 2"): the month grid
  // leads, a picked day reveals its times.
  const [selDay, setSelDay] = useState<string | null>(null);
  // "Show availability for the both of you": the viewer's OWN busy over the
  // window — slots that clash render dimmed, never hidden (their calendar
  // may carry soft blocks; the pick stays theirs).
  const [myBusy, setMyBusy] = useState<FreeBusyRow[]>([]);
  const [pick, setPick] = useState<{ iso: string; start: number } | null>(null);
  const [note, setNote] = useState('');
  const [answers, setAnswers] = useState<Record<number, string>>({});
  // THE TIMEZONE DROPDOWN (founder 2026-11-01: "a drop down that lets you
  // change time zones before you book") — display zone, defaulting to the
  // viewer's own clock; stored minutes stay provider-local by doctrine.
  const [dispZone, setDispZone] = useState<string>(() => viewerZone());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'requested' | 'booked' | 'moved' | null>(null);
  // An instant booking's video link, read back once the booking exists.
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Two browsable months — the month grid made the old fortnight feel short.
  const from = todayISO();
  const to = addDays(from, 59);

  useEffect(() => {
    if (!me || !typeId) return;
    let live = true;
    // Switching lengths re-enters this effect — a day picked on the old
    // length may not be open on the new one.
    setSelDay(null); setPick(null);
    (async () => {
      const b = await loadBookingBoard(typeId, from, to);
      if (!live) return;
      setBoard(b);
      if (b) {
        const { data } = await supabase.from('profiles').select('full_name').eq('id', b.type.provider_id).maybeSingle();
        if (live) setProviderName((data as { full_name: string | null } | null)?.full_name ?? '');
        const all = await listBookableTypes(b.type.provider_id);
        if (live) {
          setSibs(all
            .filter((x) => x.title.trim().toLowerCase() === b.type.title.trim().toLowerCase())
            .sort((a, z) => a.duration_min - z.duration_min));
        }
      }
      setReady(true);
    })();
    // The both-of-you overlay — skipped while MOVING a booking: the booking
    // being moved is the viewer's own busy and would dim its own old slot.
    if (!rescheduleId) {
      void freeBusy([me], from, to).then((rows) => { if (live) setMyBusy(rows); });
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, typeId]);

  // THE SIGN-IN ROUND TRIP (founder 2026-11-02: "it should take them right
  // to the same booking spot, so they don't have to re-do anything once
  // logged in"): a guest who parked a pick on the public page and signed in
  // lands here (the member picker) — restore their day, slot and note when
  // the parked resume names THIS type. Runs after the board stands, since
  // the load effect above rightly clears the pick on entry.
  useEffect(() => {
    if (!board || rescheduleId) return;
    const r = readBookResume();
    if (!r || r.typeId !== typeId) return;
    clearBookResume();
    if (r.date) {
      setSelDay(r.date);
      if (r.start != null) setPick({ iso: r.date, start: r.start });
    }
    if (r.note) setNote(r.note);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);

  const dayMap = useMemo(() => {
    const m = new Map<string, number[]>();
    if (!board) return m;
    for (let i = 0; i < 60; i++) {
      const iso = addDays(from, i);
      const slots = slotsForDay(board, iso);
      if (slots.length > 0) m.set(iso, slots);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);
  const openDays = useMemo(() => new Set(dayMap.keys()), [dayMap]);

  // The month grid can fill the whole screen, so a picked day's times land
  // below the fold (founder 2026-11-01: "if i selected a date and its above
  // the fold, i don't see the times manifest below… maybe it scrolls down
  // enough to see the times?") — walk them into view on every pick.
  const dayRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!selDay) return;
    // Scroll JUST ENOUGH (founder 2026-11-01's crop mock): the times'
    // bottom comes into view; the calendar above keeps as much as fits.
    requestAnimationFrame(() => revealBelow(dayRef.current));
  }, [selDay]);

  // TIMED busy only — an all-day import ("Holiday") dimming a whole day
  // would read as closed when it isn't.
  const clashes = (iso: string, start: number, dur: number): boolean =>
    myBusy.some((b) => !b.all_day && b.start_min != null && b.end_min != null
      && occursOn(b, iso) && b.start_min < start + dur && b.end_min > start);

  // Provider-local minutes are the stored truth; only LABELS convert when
  // the chosen display zone runs elsewhere (founder 2026-10-03 — the public
  // link's logged timezone follow-up; the dropdown is 2026-11-01's pass).
  const ptz = board?.type.provider_tz ?? null;
  const zone = dispZone || ptz || '';
  const zoneDiffers = !!(ptz && zone && zone !== ptz);
  const zoneOptions = useMemo(() => allTimeZones(), []);
  const slotLabel = (iso: string, s: number): string => {
    if (!zoneDiffers) return minToLabel(s);
    const v = zoneSlotLabel(iso, s, ptz, zone);
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
        <PageHead />
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
      <PageHead />
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
        {ptz && (
          <p className="bkpub__tz bkg__tzrow">
            Times shown in{' '}
            <TimeZonePick
              value={zone}
              zones={zoneOptions}
              lead={[
                { zone: ptz, label: `${providerName ? `${providerName.split(' ')[0]}’s` : 'their'} time` },
                ...(viewerZone() && viewerZone() !== ptz ? [{ zone: viewerZone(), label: 'your time' }] : []),
              ]}
              onChange={setDispZone}
            />
          </p>
        )}
        {t.description && !rescheduleId && <p className="bkg__desc">{t.description}</p>}
      </header>

      {/* The length switcher (founder 2026-11-01): same-name siblings are
          one session's other lengths — the current one lit, the rest a tap
          away. A reschedule keeps its booked length. */}
      {sibs.length > 1 && !rescheduleId && (
        <div className="bkpub__types bkg__lenrow">
          {sibs.map((s) => (
            <button
              key={s.id}
              className={'bkg__slot' + (s.id === t.id ? ' is-on' : '')}
              onClick={() => { if (s.id !== t.id) navigate(`/book/${s.id}`, { replace: true }); }}
            >
              {sessionLengthLabel(s.duration_min)}{s.price ? ` · ${s.price}` : ''}
            </button>
          ))}
        </div>
      )}

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
      ) : openDays.size === 0 && (
        <p className="bkg__muted">
          No open times in the next two months — check back, or message them
          from their profile.
        </p>
      )}

      {openDays.size > 0 && (
        <>
          <SlotMonth
            availableDays={openDays}
            selected={selDay}
            onSelect={(d) => { setSelDay(d); setPick(null); }}
            minIso={from}
            maxIso={to}
          />
          {!selDay && <p className="bkg__muted bkg__pickhint">Pick a day to see the open times.</p>}
          {selDay && dayMap.has(selDay) && (
            <section className="bkg__day" ref={dayRef}>
              <h2 className="bkg__h2">{DOW[localDate(selDay).getDay()]} · {localDate(selDay).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</h2>
              <div className="bkg__slots">
                {dayMap.get(selDay)!.map((s) => {
                  const clash = !rescheduleId && clashes(selDay, s, t.duration_min);
                  return (
                    <button
                      key={s}
                      className={'bkg__slot'
                        + (pick?.iso === selDay && pick.start === s ? ' is-on' : '')
                        + (clash ? ' bkg__slot--clash' : '')}
                      title={clash ? 'You have something on your own calendar then' : undefined}
                      onClick={() => setPick({ iso: selDay, start: s })}
                    >
                      {slotLabel(selDay, s)}
                      {capacity > 1 && <em className="bkg__seats"> · {seatsLeft(board, selDay, s)} left</em>}
                    </button>
                  );
                })}
              </div>
              {!rescheduleId && dayMap.get(selDay)!.some((s) => clashes(selDay, s, t.duration_min)) && (
                <p className="bkg__clashnote">
                  Dimmed times overlap something on your own calendar — the bright
                  ones work for both of you.
                </p>
              )}
            </section>
          )}
        </>
      )}

      {pick && (
        <div className="bkg__confirm">
          <p className="bkg__confirm-when">
            {localDate(pick.iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            {' · '}{minToLabel(pick.start)} – {minToLabel(pick.start + t.duration_min)}
            {zoneDiffers && (() => {
              const v = zoneSlotLabel(pick.iso, pick.start, ptz, zone);
              const ve = zoneSlotLabel(pick.iso, pick.start + t.duration_min, ptz, zone);
              return v && ve ? ` (${v.label} – ${ve.label} in ${zone.replace(/_/g, ' ')})` : '';
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
                  if (id && t.approval === 'instant') {
                    // A unique-Zoom type mints its link a breath AFTER the
                    // booking lands (2026-10-07) — try again briefly so the
                    // booked screen catches it rather than showing nothing.
                    const url = await bookingMeetingUrl(id);
                    setJoinUrl(url);
                    if (!url) {
                      for (const wait of [2500, 5000]) {
                        window.setTimeout(() => {
                          void bookingMeetingUrl(id).then((u) => { if (u) setJoinUrl(u); });
                        }, wait);
                      }
                    }
                  }
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
