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
  groupTypesByTitle, sessionLengthLabel, slugify,
  saveBookResume, readBookResume, clearBookResume, emailIsMember, type BookResume,
  type PublicBookingPage, type BookingBoard, type BookingType,
} from '../lib/bookingApi';
import TimeZonePick from '../components/TimeZonePick';
import PayDoors from '../components/PayDoors';
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
  // THREE TIERS OF DETAIL (founder 2026-11-02: "/book/galyn is all public
  // meeting types, /book/galyn/catch-up then asks what duration and
  // /book/galyn/catch-up-15 is smart enough to know its 15 minutes and have
  // that pre-selected" — platform-wide, every provider's links):
  //   1. /book/<handle>            — the whole menu.
  //   2. /book/<handle>/<title>    — a session NAME shared by several
  //      lengths opens the how-long chooser for that family. The family
  //      name BEATS a sibling whose own slug happens to be the bare name.
  //   3. /book/<handle>/<link>     — an exact length's link pre-selects it;
  //      with same-name siblings the length row stays visible, switchable.
  // Signed in, exact links still hand to the member slot picker (their
  // account on the booking; its length switcher covers tier 3 there).
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
  // Tier 2/3 slug modes: slugFam = the URL named a session FAMILY (or a
  // length with visible siblings), so the how-long row renders under a
  // slug route too. A signed-in slug that resolves to nothing falls
  // through to the honest !page miss below.
  const [slugFam, setSlugFam] = useState(false);
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
        // Signed in, the memberView effect owns slug resolution (it sees
        // every type the viewer's standing allows, not just the public
        // slice) — this effect just stands down.
        if (user) { setReady(true); return; }
        const low = slug.toLowerCase();
        const groupsPub = groupTypesByTitle(p?.types ?? []);
        // TIER 2 — the slug is a session NAME with several lengths: open
        // the how-long chooser. The family name BEATS a sibling whose own
        // link happens to carry the bare name (her explicit spec).
        const famPub = groupsPub.find((g) => slugify(g.title) === low && g.variants.length > 1) ?? null;
        if (famPub) { setPage(p); setPubKey(famPub.key); setSlugFam(true); setReady(true); return; }
        // TIER 3 — an exact length's link: pre-selected, and when visible
        // siblings share the name the length row stays on screen to switch.
        const pubHit = p?.types.find((t) => (t.slug ?? '') === low) ?? null;
        if (pubHit) {
          setPage(p);
          setTypeId(pubHit.id);
          const g = groupsPub.find((x) => x.variants.some((v) => v.id === pubHit.id));
          if (g && g.variants.length > 1) { setPubKey(g.key); setSlugFam(true); }
          setReady(true);
          return;
        }
        // A single-length family name still answers (slugify(title) match,
        // one variant) — the link teaches itself.
        const famOne = groupsPub.find((g) => slugify(g.title) === low) ?? null;
        if (famOne) { setPage(p); setTypeId(famOne.variants[0].id); setReady(true); return; }
        setPage(null); setReady(true);  // honest miss
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
    if (!user) { setMemberView(null); setMvReady(true); return; }
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
        if (slug) {
          // Signed-in slug resolution, against EVERYTHING their standing
          // lets them see (the public RPC would miss members-only types).
          const low = slug.toLowerCase();
          const groups = groupTypesByTitle(types);
          const fam = groups.find((g) => slugify(g.title) === low && g.variants.length > 1) ?? null;
          if (fam) {
            // Tier 2: the family's how-long step, right here.
            setLenKey(fam.key); setSlugFam(true);
          } else {
            const hit = types.find((t) => (t.slug ?? '') === low)
              ?? groups.find((g) => slugify(g.title) === low)?.variants[0] ?? null;
            if (hit) { navigate(`/book/${hit.id}`, { replace: true }); return; }
          }
        }
        setMemberView({ provider: prov, types });
      } else if (slug) {
        // The provider's profile row may be unreadable to this viewer
        // (unfindable, no shared circle) while their PUBLIC link is still
        // real — the SECURITY DEFINER vanity resolver covers that case.
        const id = await resolveBookingVanity(handle, slug);
        if (!live) return;
        if (id) { navigate(`/book/${id}`, { replace: true }); return; }
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

  // Freshly signed in on the bare handle with a parked pick: skip the menu
  // and land straight on that type's member picker, which restores the day
  // and slot itself — "right to the same booking spot".
  useEffect(() => {
    if (!user || !mvReady || !memberView) return;
    const r = readBookResume();
    if (r?.typeId && memberView.types.some((t) => t.id === r.typeId)) {
      navigate(`/book/${r.typeId}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, mvReady, memberView]);

  // THE ROUND TRIP (founder 2026-11-02: "Sign in to complete your booking,
  // and it should take them right to the same booking spot, so they don't
  // have to re-do anything" + "Request an invite, which should drop you
  // back on this screen to complete your booking"): parking before the
  // door, restoring on return. The day/slot land through pendingResume
  // AFTER the board arrives, because the typeId effect above rightly
  // clears them on every type change.
  const pendingResume = useRef<BookResume | null>(null);
  const resumed = useRef(false);
  const parkAndGo = (dest: '/login' | '/signup') => {
    saveBookResume({
      path: window.location.pathname, typeId,
      date: pick?.iso ?? selDay, start: pick?.start ?? null,
      name, email, note, answers,
    });
    navigate(`${dest}?next=${encodeURIComponent(window.location.pathname)}`);
  };

  // A MEMBER'S EMAIL IS RECOGNIZED (founder 2026-11-02, Gabe booking her
  // session logged out: "see if someone is booking from an email that is a
  // registered Lichen user and ask them to sign in? But still deliver them
  // to the booking page?"): a debounced boolean check on the typed email —
  // a hit offers the sign-in door, which parks everything typed and the
  // pick (the round trip). Booking as a guest stays one tap away; the
  // nudge never blocks.
  const [knownMember, setKnownMember] = useState(false);
  useEffect(() => {
    if (user) { setKnownMember(false); return; }
    const v = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { setKnownMember(false); return; }
    let live = true;
    const t = window.setTimeout(() => {
      void emailIsMember(v).then((hit) => { if (live) setKnownMember(hit); });
    }, 500);
    return () => { live = false; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, user?.id]);
  useEffect(() => {
    if (!ready || resumed.current) return;
    const r = readBookResume();
    if (!r || r.path !== window.location.pathname) return;
    resumed.current = true;
    clearBookResume();
    pendingResume.current = r;
    if (r.name) setName(r.name);
    if (r.email) setEmail(r.email);
    if (r.note) setNote(r.note);
    if (r.answers) setAnswers(r.answers);
    if (r.typeId) {
      setTypeId(r.typeId);
      if (page) {
        const g = groupTypesByTitle(page.types).find((x) => x.variants.some((v) => v.id === r.typeId));
        if (g) setPubKey(g.key);
      }
    }
    // The board may already be standing (the slug case loads it before this
    // runs) — then the [board] effect below never re-fires, so apply now.
    if (board && (!r.typeId || r.typeId === typeId)) {
      pendingResume.current = null;
      if (r.date) {
        setSelDay(r.date);
        if (r.start != null) setPick({ iso: r.date, start: r.start });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, page, board]);
  useEffect(() => {
    const r = pendingResume.current;
    if (!r || !board) return;
    pendingResume.current = null;
    if (r.date) {
      setSelDay(r.date);
      if (r.start != null) setPick({ iso: r.date, start: r.start });
    }
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
  // A tier-2 family link (slugFam) lands here too, with its how-long step
  // already open.
  if (user && memberView && (!slug || slugFam)) {
    const mName = memberView.provider.full_name ?? 'A Lichen member';
    const mFirst = mName.split(' ')[0];
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
                  {/* TITLE ONLY on the menu pills (founder 2026-11-02,
                      striking "· 50m · Sessions charged manually via Ivy
                      Pay": "let's only have the title for the booking
                      link... the details after are included on the next,
                      booking page"). */}
                  if (g.variants.length === 1) {
                    return (
                      <button key={g.key} className="bkg__slot" onClick={() => navigate(`/book/${t.id}`)}>
                        {g.title}
                      </button>
                    );
                  }
                  return (
                    <button key={g.key} className="bkg__slot" onClick={() => setLenKey(g.key)}>
                      {g.title} ›
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
        {doneStatus === 'confirmed' && (
          <PayDoors
            methods={board?.type.pay_methods}
            lead={cents ? 'Or pay directly' : `Ways to pay${board?.type.price ? ` ${board.type.price}` : ''}`}
            className="bkg__paydoors"
          />
        )}
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
          a name with several lengths reveals the how-long row below. THREE
          TIERS under a slug (founder 2026-11-02): a family-name link opens
          straight onto this how-long row (nothing picked), an exact
          length's link arrives with its length lit and switchable, and
          only a single-length session skips the row entirely — her "send
          someone the 30 minute URL" skip, kept for the one case where
          there is nothing to choose. */}
      {(!slug || slugFam) && (() => {
        const groups = groupTypesByTitle(page.types);
        const sel = pubKey ? groups.find((g) => g.key === pubKey) ?? null : null;
        return (
          <>
            {!slug && groups.length > 1 && (
              <div className="bkpub__types">
                {/* Title only (founder 2026-11-02) — the details live on
                    the picked session's own screen below. */}
                {groups.map((g) => (
                  <button
                    key={g.key}
                    className={'bkg__slot' + (pubKey === g.key ? ' is-on' : '')}
                    onClick={() => {
                      setPubKey(g.key);
                      setTypeId(g.variants.length === 1 ? g.variants[0].id : null);
                    }}
                  >
                    {g.title}
                  </button>
                ))}
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
          {!user && knownMember && (
            <p className="bkpub__fine bkpub__known">
              That email already has a Lichen account —{' '}
              <button className="bkpub__signin" onClick={() => parkAndGo('/login')}>
                sign in to complete your booking
              </button>
              {' '}under it. Booking as a guest works too.
            </p>
          )}
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
          {/* The round-trip doors (founder 2026-11-02): both park the pick
              and typed fields, so nothing is redone on return. */}
          <p className="bkpub__fine">
            No account needed — you&rsquo;ll get an email with a link to view or
            cancel. {user ? '' : 'On Lichen already? '}
            {!user && <button className="bkpub__signin" onClick={() => parkAndGo('/login')}>Sign in to complete your booking</button>}
          </p>
          {!user && (
            <p className="bkpub__fine">
              Want to join Lichen?{' '}
              <button className="bkpub__signin" onClick={() => parkAndGo('/signup')}>Request an invite</button>
              {' '}— you&rsquo;ll land right back here to finish your booking.
            </p>
          )}
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
