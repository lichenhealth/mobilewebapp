import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import Avatar from '../components/Avatar';
import SlotMonth from '../components/SlotMonth';
import { useAuth } from '../auth/AuthProvider';
import { minToLabel } from '../lib/calendarApi';
import { addDays, localDate, todayISO } from '../lib/conciergeApi';
import { revealBelow } from '../lib/smartReveal';
import {
  publicBookingPage, publicBookingBoard, guestCreateBooking, sendBookingMail,
  resolveBookingVanity, slotsForDay, seatsLeft, viewerZone, zoneSlotLabel, allTimeZones,
  startBookingCheckout, usdLabel, setBookingPayChoice, listBookableTypes,
  groupTypesByTitle, sessionLengthLabel,
  type PublicBookingPage, type BookingBoard, type BookingType,
} from '../lib/bookingApi';
import TimeZonePick from '../components/TimeZonePick';
import { supabase } from '../lib/supabase';
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
  // SIGNED IN, THE MAIN LINK SHOWS EVERY SESSION YOU MAY SEE (founder
  // 2026-11-01: "Shouldn't all my session types be on my main link?"): the
  // public RPC serves the open web public types only, so a member landing
  // on /book/<handle> resolves the provider through RLS and lists ALL their
  // visible types — picking one opens the member slot picker (/book/<id>),
  // their account on the booking, the vanity-link precedent.
  const [memberView, setMemberView] = useState<{
    provider: { id: string; full_name: string | null; avatar_url: string | null; headline: string | null };
    types: BookingType[];
  } | null>(null);
  const [mvReady, setMvReady] = useState(false);
  // SESSION LENGTHS (founder 2026-11-01, her Calendly screenshot): types
  // sharing one title are ONE session with a "how long?" step — lenKey is
  // the signed-in menu's open group, pubKey the guest page's picked group.
  const [lenKey, setLenKey] = useState<string | null>(null);
  const [pubKey, setPubKey] = useState<string | null>(null);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [board, setBoard] = useState<BookingBoard | null>(null);
  const [pick, setPick] = useState<{ iso: string; start: number } | null>(null);
  // SCREEN 1 → SCREEN 2 (founder 2026-11-01, her Calendly markup): the month
  // grid leads, a picked day reveals its times.
  const [selDay, setSelDay] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [answers, setAnswers] = useState<Record<number, string>>({});
  // THE TIMEZONE DROPDOWN (founder 2026-11-01: "a drop down that lets you
  // change time zones before you book") — display zone only; stored minutes
  // stay provider-local by doctrine.
  const [dispZone, setDispZone] = useState<string>(() => viewerZone());
  // PAYMENT OPTIONS (founder 2026-10-29: "bank transfer, card, invoice you
  // later"): card + US bank ride the one Stripe page; "invoice me later" is
  // the booker's declared intent, offered when the type allows it.
  const [payLater, setPayLater] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [doneToken, setDoneToken] = useState<string | null>(null);
  const [doneStatus, setDoneStatus] = useState<'pending' | 'confirmed'>('pending');

  const from = todayISO();
  // Two browsable months — the month grid made the old fortnight feel short.
  const to = addDays(from, 59);

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
      if (p) {
        // One session name on offer → walk straight into it; a single
        // LENGTH skips the chooser too, several show the how-long step.
        const gs = groupTypesByTitle(p.types);
        if (gs.length === 1) {
          setPubKey(gs[0].key);
          if (gs[0].variants.length === 1) setTypeId(gs[0].variants[0].id);
        }
      }
      setReady(true);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, slug, user?.id]);

  useEffect(() => {
    if (!user || slug) { setMemberView(null); setMvReady(true); return; }
    let live = true;
    setMvReady(false);
    void (async () => {
      const { data } = await supabase.from('profiles')
        .select('id, full_name, avatar_url, headline')
        .ilike('handle', handle).maybeSingle();
      if (!live) return;
      if (data) {
        const prov = data as { id: string; full_name: string | null; avatar_url: string | null; headline: string | null };
        const types = await listBookableTypes(prov.id);
        if (!live) return;
        setMemberView({ provider: prov, types });
      }
      setMvReady(true);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, slug, user?.id]);

  useEffect(() => {
    if (!typeId) { setBoard(null); setPick(null); setSelDay(null); return; }
    let live = true;
    setPick(null); setSelDay(null);
    void publicBookingBoard(typeId, from, to).then((b) => { if (live) setBoard(b); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeId]);

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
  // below the fold (founder 2026-11-01: "maybe it scrolls down enough to
  // see the times?") — walk them into view on every pick.
  const dayRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!selDay) return;
    // Scroll JUST ENOUGH (founder 2026-11-01's crop mock): the times'
    // bottom comes into view; the calendar above keeps as much as fits.
    requestAnimationFrame(() => revealBelow(dayRef.current));
  }, [selDay]);

  if (!ready || !mvReady) return <div className="gev"><p className="gev__muted">Loading…</p></div>;

  // Signed in on the bare handle link: the WHOLE menu, not just the public
  // slice — every active type the viewer's standing lets them see, each
  // opening the member slot picker so the booking carries their account.
  if (user && !slug && memberView) {
    const mName = memberView.provider.full_name ?? 'A Lichen member';
    const mFirst = mName.split(' ')[0];
    const AUD_TAG: Record<string, string> = { everyone: ' · members', mycelium: ' · my-celium', space: ' · group' };
    return (
      <div className="gev bkpub">
        <header className="bkg__head">
          <Avatar id={memberView.provider.id} name={mName} url={memberView.provider.avatar_url ?? undefined} size={72} />
          <h1 className="bkg__title display-italic">Book time with {mName}</h1>
          {memberView.provider.headline && <p className="bkg__sub">{memberView.provider.headline}</p>}
        </header>
        {memberView.types.length === 0 ? (
          <p className="bkg__muted">{mFirst} has nothing bookable for you right now.</p>
        ) : (() => {
          // One menu entry per session NAME; a name with several lengths
          // opens the how-long step (founder 2026-11-01, Calendly's shape).
          const groups = groupTypesByTitle(memberView.types);
          const open = lenKey ? groups.find((g) => g.key === lenKey) ?? null : null;
          if (open && open.variants.length > 1) {
            return (
              <>
                <p className="bkpub__tz bkpub__pick">{open.title} — how long would you like?</p>
                <div className="bkpub__types bkpub__types--menu">
                  {open.variants.map((t) => (
                    <button key={t.id} className="bkg__slot" onClick={() => navigate(`/book/${t.id}`)}>
                      {sessionLengthLabel(t.duration_min)}{t.price ? ` · ${t.price}` : ''}
                    </button>
                  ))}
                </div>
                <p className="bkg__muted bkg__pickhint">
                  <button className="bkg__tzflip" onClick={() => setLenKey(null)}>← All sessions</button>
                </p>
              </>
            );
          }
          return (
            <>
              <p className="bkpub__tz bkpub__pick">Pick a session — you&rsquo;re signed in, so it books under your name.</p>
              <div className="bkpub__types bkpub__types--menu">
                {groups.map((g) => {
                  const t = g.variants[0];
                  if (g.variants.length === 1) {
                    return (
                      <button key={g.key} className="bkg__slot" onClick={() => navigate(`/book/${t.id}`)}>
                        {g.title} · {t.duration_min}m{t.price ? ` · ${t.price}` : ''}{AUD_TAG[t.audience] ?? ''}
                      </button>
                    );
                  }
                  const samePrice = g.variants.every((v) => (v.price ?? '') === (t.price ?? ''));
                  const sameAud = g.variants.every((v) => v.audience === t.audience);
                  return (
                    <button key={g.key} className="bkg__slot" onClick={() => setLenKey(g.key)}>
                      {g.title}{samePrice && t.price ? ` · ${t.price}` : ''}{sameAud ? (AUD_TAG[t.audience] ?? '') : ''} ›
                    </button>
                  );
                })}
              </div>
            </>
          );
        })()}
      </div>
    );
  }

  if (!page) {
    return (
      <div className="gev">
        <p className="gev__muted">Nothing bookable lives at this address.</p>
      </div>
    );
  }

  const provider = page.provider;
  const providerName = provider.full_name ?? 'A Lichen member';
  const first = providerName.split(' ')[0];
  const activeType = page.types.find((t) => t.id === typeId) ?? null;

  // The logged timezone follow-up, built (founder 2026-10-03): slots are the
  // PROVIDER's wall time by doctrine; the visitor reads them in whatever
  // zone the dropdown says (defaulting to their own). Stored minutes never
  // convert — only labels.
  const ptz = provider.timezone ?? null;
  const zone = dispZone || ptz || '';
  const zoneDiffers = !!(ptz && zone && zone !== ptz);
  const zoneOptions = allTimeZones();
  const slotLabel = (iso: string, s: number): string => {
    if (!zoneDiffers) return minToLabel(s);
    const v = zoneSlotLabel(iso, s, ptz, zone);
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
        {!user && (
          <footer className="gev__join">
            <p>
              Lichen is a community for healing, growing and creating — <span className="nobr">{providerName}</span> is a member.{' '}
              <button className="gev__joinlink" onClick={() => navigate('/signup')}>Request to join Lichen</button>
            </p>
          </footer>
        )}
      </div>
    );
  }

  return (
    <div className="gev bkpub">
      <header className="bkg__head">
        <Avatar id={provider.id} name={providerName} url={provider.avatar_url ?? undefined} size={72} />
        <h1 className="bkg__title display-italic">Book time with {providerName}</h1>
        {provider.headline && <p className="bkg__sub">{provider.headline}</p>}
        {ptz ? (
          <p className="bkpub__tz bkg__tzrow">
            Times shown in{' '}
            <TimeZonePick
              value={zone}
              zones={zoneOptions}
              lead={[
                { zone: ptz, label: `${first}’s time` },
                ...(viewerZone() && viewerZone() !== ptz ? [{ zone: viewerZone(), label: 'your time' }] : []),
              ]}
              onChange={setDispZone}
            />
          </p>
        ) : (
          <p className="bkpub__tz">Times are in {first}’s local time.</p>
        )}
      </header>

      {error && <p className="bkg__error">{error}</p>}

      {/* One pill per session NAME (founder 2026-11-01, Calendly's shape);
          a name with several lengths reveals the how-long row below. A
          vanity slug locked the page onto one length already — it skips
          both, her "send someone the 30 minute URL". */}
      {!slug && (() => {
        const groups = groupTypesByTitle(page.types);
        const sel = pubKey ? groups.find((g) => g.key === pubKey) ?? null : null;
        return (
          <>
            {groups.length > 1 && (
              <div className="bkpub__types">
                {groups.map((g) => {
                  const t0 = g.variants[0];
                  const samePrice = g.variants.every((v) => (v.price ?? '') === (t0.price ?? ''));
                  return (
                    <button
                      key={g.key}
                      className={'bkg__slot' + (pubKey === g.key ? ' is-on' : '')}
                      onClick={() => {
                        setPubKey(g.key);
                        setTypeId(g.variants.length === 1 ? g.variants[0].id : null);
                      }}
                    >
                      {g.title}
                      {g.variants.length === 1
                        ? ` · ${t0.duration_min}m${t0.price ? ` · ${t0.price}` : ''}`
                        : samePrice && t0.price ? ` · ${t0.price}` : ''}
                    </button>
                  );
                })}
              </div>
            )}
            {sel && sel.variants.length > 1 && (
              <section className="bkg__day">
                <h2 className="bkg__h2">How long would you like?</h2>
                <div className="bkg__slots bkpub__types">
                  {sel.variants.map((t) => (
                    <button
                      key={t.id}
                      className={'bkg__slot' + (typeId === t.id ? ' is-on' : '')}
                      onClick={() => setTypeId(t.id)}
                    >
                      {sessionLengthLabel(t.duration_min)}{t.price ? ` · ${t.price}` : ''}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        );
      })()}

      {activeType?.description && <p className="bkg__desc">{activeType.description}</p>}

      {typeId && board && openDays.size === 0 && (
        <p className="bkg__muted">No open times in the next two months — check back soon.</p>
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
                {dayMap.get(selDay)!.map((s) => (
                  <button
                    key={s}
                    className={'bkg__slot' + (pick?.iso === selDay && pick.start === s ? ' is-on' : '')}
                    onClick={() => setPick({ iso: selDay, start: s })}
                  >
                    {slotLabel(selDay, s)}
                    {capacity > 1 && board && <em className="bkg__seats"> · {seatsLeft(board, selDay, s)} left</em>}
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {pick && activeType && (
        <div className="bkg__confirm">
          <p className="bkg__confirm-when">
            {localDate(pick.iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            {' · '}{minToLabel(pick.start)} – {minToLabel(pick.start + activeType.duration_min)}
            {zoneDiffers && (() => {
              const v = zoneSlotLabel(pick.iso, pick.start, ptz, zone);
              const ve = zoneSlotLabel(pick.iso, pick.start + activeType.duration_min, ptz, zone);
              return v && ve ? ` (${v.label} – ${ve.label} in ${zone.replace(/_/g, ' ')})` : '';
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
          <p>
            Lichen is a community for healing, growing and creating — <span className="nobr">{providerName}</span> is a member.{' '}
            <button className="gev__joinlink" onClick={() => navigate('/signup')}>Request to join Lichen</button>
          </p>
        </footer>
      )}
    </div>
  );
}
