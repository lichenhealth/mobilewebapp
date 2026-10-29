import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { LichenMark } from '../components/LichenMark';
import Avatar from '../components/Avatar';
import { useAuth } from '../auth/AuthProvider';
import { minToLabel } from '../lib/calendarApi';
import { addDays, localDate, todayISO } from '../lib/conciergeApi';
import {
  publicBookingPage, publicBookingBoard, guestCreateBooking, sendBookingMail,
  resolveBookingVanity, slotsForDay, seatsLeft, viewerZone, viewerSlotLabel,
  startBookingCheckout, usdLabel, setBookingPayChoice,
  type PublicBookingPage, type BookingBoard,
} from '../lib/bookingApi';
import './Bookings.css';
import './GuestEvent.css';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The PUBLIC booking page — lichen.health/book/<handle> (founder 2026-08-14,
 *  the Calendly replacement). Works signed out: the provider's public session
 *  types against their REAL availability (declared hours minus Lichen events,
 *  imported calendars, and held bookings). Guests book with a name and an
 *  email; the emailed token link is theirs to view or cancel. */
export default function BookPublic() {
  // /book/<handle> = the whole public page; /book/<handle>/<link-name> = a
  // VANITY LINK straight to one session type (founder 2026-10-03, the
  // Calendly shape). The slug locks the page onto that type; a SIGNED-IN
  // member is handed to the member slot picker instead, which also lets a
  // vanity link work for everyone/mycelium-audience types they may see.
  const { param: handle = '', slug = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [page, setPage] = useState<PublicBookingPage | null>(null);
  const [ready, setReady] = useState(false);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [board, setBoard] = useState<BookingBoard | null>(null);
  const [pick, setPick] = useState<{ iso: string; start: number } | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [mineTime, setMineTime] = useState(true);
  // PAYMENT OPTIONS (founder 2026-10-29: "bank transfer, card, invoice you
  // later"): card + US bank ride the one Stripe page; "invoice me later" is
  // the booker's declared intent, offered when the type allows it.
  const [payLater, setPayLater] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [doneToken, setDoneToken] = useState<string | null>(null);
  const [doneStatus, setDoneStatus] = useState<'pending' | 'confirmed'>('pending');

  const from = todayISO();
  const to = addDays(from, 29);

  useEffect(() => {
    let live = true;
    void publicBookingPage(handle).then(async (p) => {
      if (!live) return;
      if (slug) {
        // Vanity link: the slug names ONE type. Signed in → the member
        // picker (their account on the booking, and non-public audiences
        // they may see resolve too). Guest → this page locked to it.
        const pubHit = p?.types.find((t) => (t.slug ?? '') === slug.toLowerCase()) ?? null;
        if (user || !pubHit) {
          const id = await resolveBookingVanity(handle, slug);
          if (!live) return;
          if (id && user) { navigate(`/book/${id}`, { replace: true }); return; }
          if (!id && !pubHit) { setPage(null); setReady(true); return; }  // honest miss
        }
        setPage(p);
        if (pubHit) setTypeId(pubHit.id);
        setReady(true);
        return;
      }
      setPage(p);
      if (p && p.types.length === 1) setTypeId(p.types[0].id);
      setReady(true);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, slug, user?.id]);

  useEffect(() => {
    if (!typeId) { setBoard(null); return; }
    let live = true;
    setPick(null);
    void publicBookingBoard(typeId, from, to).then((b) => { if (live) setBoard(b); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeId]);

  const days = useMemo(() => {
    if (!board) return [];
    return Array.from({ length: 14 }, (_, i) => addDays(from, i))
      .map((iso) => ({ iso, slots: slotsForDay(board, iso) }))
      .filter((d) => d.slots.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);

  if (!ready) return <div className="gev"><p className="gev__muted">Loading…</p></div>;
  if (!page) {
    return (
      <div className="gev">
        <div className="gev__mark"><LichenMark size={40} /><span>Lichen</span></div>
        <p className="gev__muted">Nothing bookable lives at this address.</p>
      </div>
    );
  }

  const provider = page.provider;
  const providerName = provider.full_name ?? 'A Lichen member';
  const first = providerName.split(' ')[0];
  const activeType = page.types.find((t) => t.id === typeId) ?? null;

  // The logged timezone follow-up, built (founder 2026-10-03): slots are the
  // PROVIDER's wall time by doctrine; a visitor on another clock reads them
  // in their own by default, with the honest note and a flip. Stored minutes
  // never convert — only labels.
  const ptz = provider.timezone ?? null;
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
  const unanswered = questions.some((_, i) => !(answers[i] ?? '').trim());

  if (doneToken) {
    // Payment (founder 2026-10-29): an INSTANT priced session asks for the
    // money right here — the frozen price, straight into Stripe Checkout. A
    // REQUEST type never charges before the provider's yes: the acceptance
    // email carries the pay link instead.
    const cents = board?.type.price_cents ?? null;
    return (
      <div className="gev">
        <div className="gev__mark"><LichenMark size={40} /><span>Lichen</span></div>
        <header className="bkg__head">
          <p className="eyebrow">{doneStatus === 'confirmed' ? 'Booked' : 'Requested'}</p>
          <h1 className="bkg__title display-italic">
            {doneStatus === 'confirmed' ? 'You’re booked.' : 'Request sent.'}
          </h1>
          <p className="bkg__sub">
            {doneStatus === 'confirmed'
              ? `${activeType?.title ?? 'Your session'} with ${providerName} is on their calendar.`
              : `${providerName} confirms each request by hand — you’ll get an email either way.`}
            {' '}A confirmation is on its way to {email.trim()}.
            {cents && doneStatus === 'pending'
              ? (payLater
                ? ` You chose to be invoiced — if they accept, your booking link takes payment (card or bank) whenever you're ready.`
                : ` If they accept, that email carries the ${usdLabel(cents)} payment link.`)
              : ''}
            {cents && doneStatus === 'confirmed' && payLater
              ? ` You chose to be invoiced — your email and booking link carry the ${usdLabel(cents)} payment door whenever you're ready.`
              : ''}
          </p>
        </header>
        {error && <p className="bkg__error">{error}</p>}
        {cents && doneStatus === 'confirmed' && !payLater ? (
          <div className="bkg__doneactions">
            <button
              className="btn btn-primary bkg__btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true); setError('');
                try { window.location.href = await startBookingCheckout({ token: doneToken }); }
                catch (e) { setError((e as { message?: string } | null)?.message || 'Checkout failed.'); setBusy(false); }
              }}
            >
              {busy ? 'One moment…' : `Pay ${usdLabel(cents)} to secure it`}
            </button>
          </div>
        ) : null}
        <div className="bkg__doneactions">
          <button className={'btn bkg__btn' + (cents && doneStatus === 'confirmed' && !payLater ? '' : ' btn-primary')} onClick={() => navigate(`/b/${doneToken}`)}>
            See your booking
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="gev bkpub">
      <div className="gev__mark"><LichenMark size={40} /><span>Lichen</span></div>
      <header className="bkg__head">
        <Avatar id={provider.id} name={providerName} url={provider.avatar_url ?? undefined} size={72} />
        <h1 className="bkg__title display-italic">Book time with {providerName}</h1>
        {provider.headline && <p className="bkg__sub">{provider.headline}</p>}
        <p className="bkpub__tz">
          {foreign
            ? (mineTime
              ? `Times are shown in your time zone (${vz}).`
              : `Times are shown in ${first}’s time zone (${ptz}).`)
            : `Times are in ${first}’s local time${ptz ? ` (${ptz})` : ''}.`}
          {foreign && (
            <>{' '}
              <button className="bkg__tzflip" onClick={() => setMineTime((v) => !v)}>
                Show in {mineTime ? `${first}’s` : 'your'} time
              </button>
            </>
          )}
        </p>
      </header>

      {error && <p className="bkg__error">{error}</p>}

      {page.types.length > 1 && !slug && (
        <div className="bkpub__types">
          {page.types.map((t) => (
            <button
              key={t.id}
              className={'bkg__slot' + (typeId === t.id ? ' is-on' : '')}
              onClick={() => setTypeId(t.id)}
            >
              {t.title} · {t.duration_min}m{t.price ? ` · ${t.price}` : ''}
            </button>
          ))}
        </div>
      )}

      {activeType?.description && <p className="bkg__desc">{activeType.description}</p>}

      {typeId && board && days.length === 0 && (
        <p className="bkg__muted">No open times in the next two weeks — check back soon.</p>
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
                {capacity > 1 && board && <em className="bkg__seats"> · {seatsLeft(board, iso, s)} left</em>}
              </button>
            ))}
          </div>
        </section>
      ))}

      {pick && activeType && (
        <div className="bkg__confirm">
          <p className="bkg__confirm-when">
            {localDate(pick.iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            {' · '}{minToLabel(pick.start)} – {minToLabel(pick.start + activeType.duration_min)}
            {foreign && (() => {
              const v = viewerSlotLabel(pick.iso, pick.start, ptz);
              const ve = viewerSlotLabel(pick.iso, pick.start + activeType.duration_min, ptz);
              return v && ve ? ` (${v.label} – ${ve.label} your time)` : '';
            })()}
          </p>
          {!!board?.type.price_cents && (
            <p className="bkpub__fine">
              {usdLabel(board.type.price_cents)} — paid online by card or US bank transfer, {activeType.approval === 'instant'
                ? 'right after you book.' : `once ${first} accepts your request.`}
            </p>
          )}
          {!!board?.type.price_cents && board.type.allow_pay_later !== false && (
            <div className="bkpub__paychoice">
              <button
                className={'bkg__slot' + (!payLater ? ' is-on' : '')}
                onClick={() => setPayLater(false)}
              >
                Pay {activeType.approval === 'instant' ? 'now' : 'when accepted'}
              </button>
              <button
                className={'bkg__slot' + (payLater ? ' is-on' : '')}
                onClick={() => setPayLater(true)}
              >
                Invoice me — settle later
              </button>
            </div>
          )}
          <input className="bkg__note bkpub__field" value={name}
            onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          <input className="bkg__note bkpub__field" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="Your email — the confirmation lands here" />
          {questions.map((q, i) => (
            <label className="bkg__q" key={i}>
              <span>{q}</span>
              <textarea
                className="bkg__note"
                value={answers[i] ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))}
              />
            </label>
          ))}
          <textarea className="bkg__note" value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={`Anything ${first} should know? (optional)`} />
          <button
            className="btn btn-primary bkg__btn"
            disabled={busy || !name.trim() || !/\S+@\S+\.\S+/.test(email) || unanswered}
            onClick={async () => {
              setBusy(true); setError('');
              try {
                const token = await guestCreateBooking(
                  typeId!, pick.iso, pick.start, name.trim(), email.trim(), note.trim(),
                  questions.map((q, i) => ({ q, a: (answers[i] ?? '').trim() })).filter((x) => x.a),
                );
                // Record the invoice-me-later intent BEFORE the mail, so the
                // email speaks it (best-effort — the booking stands either way).
                if (payLater) await setBookingPayChoice({ token, later: true }).catch(console.error);
                sendBookingMail(token);
                setDoneStatus(activeType.approval === 'instant' ? 'confirmed' : 'pending');
                setDoneToken(token);
                setBusy(false);
              } catch (e) {
                setError((e as { message?: string } | null)?.message || 'Something went wrong.');
                setBusy(false);
              }
            }}
          >
            {busy ? 'One moment…' : activeType.approval === 'instant' ? 'Book it' : 'Request this time'}
          </button>
          <p className="bkpub__fine">
            No account needed — you&rsquo;ll get an email with a link to view or
            cancel. {user ? '' : 'On Lichen already? '}
            {!user && <button className="bkpub__signin" onClick={() => navigate(`/login?next=${encodeURIComponent(location.pathname)}`)}>Sign in instead</button>}
          </p>
        </div>
      )}

      {!user && (
        <footer className="gev__join">
          <p>Lichen is a community for healing, growing and creating — {providerName} is a member.</p>
          <button className="btn bkg__btn" onClick={() => navigate('/signup')}>Learn about joining</button>
        </footer>
      )}
    </div>
  );
}
