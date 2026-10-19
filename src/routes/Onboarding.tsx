import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import CategoryPicker, { type Category } from '../components/CategoryPicker';
import { LichenMark } from '../components/LichenMark';
import { approveCare } from '../lib/careTeamApi';
import './Onboarding.css';

/** A care-team invitation waiting on this brand-new member — the PROVIDER
 *  fast path (founder 2026-10-12: "an onboarding flow for Providers that is
 *  as easy and quick as possible"). */
type CareAsk = { id: string; patientId: string; patientName: string; status: 'pending' | 'active' };

type SpaceKind = 'organization' | 'community' | 'group' | 'place';
type DraftSpace = { id: number; kind: SpaceKind; name: string };

const CAPS = [
  { id: 'service_provider', label: 'Service Provider', desc: 'You offer services — healing, coaching, facilitation.' },
  { id: 'goods_provider',  label: 'Goods Provider',  desc: 'You offer goods — remedies, crafts, food, wares.' },
];

const SPACE_SECTIONS: { kind: SpaceKind; q: string; desc: string; one: string }[] = [
  { kind: 'organization', q: 'Do you run any organizations?', desc: 'Clinics, nonprofits, businesses, or practices you lead.', one: 'organization' },
  { kind: 'community',    q: 'Do you run any communities?',   desc: 'People gathered around a shared purpose or place.',     one: 'community' },
  { kind: 'group',        q: 'Do you run any groups?',        desc: 'Smaller circles — cohorts, teams, or working groups.',  one: 'group' },
  { kind: 'place',        q: 'Do you run any places?',        desc: 'Stewarded locations — land, centers, sanctuaries, venues.', one: 'place' },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, loading, markOnboarded } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  // Ask for whichever contact the SIGNUP didn't give us (founder 2026-08-21):
  // an email signup adds a phone; a phone signup adds an email. Neither is
  // public — what gets shared is chosen later in this same flow.
  const [contactEmail, setContactEmail] = useState('');
  const hasAuthPhone = !!user?.phone && !user?.email;
  // Age (founder 2026-08-05). One question for everyone; a minor gives a birth
  // date so the platform ages them up on its own instead of freezing a number.
  const [adult, setAdult] = useState<boolean | null>(null);
  const [birthDate, setBirthDate] = useState('');
  // Whether a grown-up already holds this account (a guardian-minted invite
  // creates the link at claim time). Under 13 can't proceed without one.
  const [heldBy, setHeldBy] = useState<string | null>(null);
  const [caps, setCaps] = useState<string[]>([]);
  // Something to offer right away? (founder 2026-10-01: Concierge already
  // asks what people can give — onboarding asks too, and what they name
  // goes straight into Marketplace.) The words ride into Compose as a
  // prefill; the composer's own flow shapes the terms (gift, trade, lend,
  // Current-cy…), so onboarding never mints a post itself.
  const [offer, setOffer] = useState('');
  const [spaces, setSpaces] = useState<DraftSpace[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [serviceCats, setServiceCats] = useState<string[]>([]);
  const [goodCats, setGoodCats] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const nextId = useRef(1);
  // THE PROVIDER FAST PATH (founder 2026-10-12): a member arriving off a
  // care invitation leads with that ask — approve it right here, add your
  // name, and Enter Lichen lands on the client's care board instead of Home.
  // Everything else on this page was already optional; the card says so.
  const [careAsks, setCareAsks] = useState<CareAsk[]>([]);
  const [careBusy, setCareBusy] = useState(false);
  // INTENT-SHAPED ONBOARDING (founder 2026-10-13: "an optimized onboarding
  // flow for practitioners… the same for those interested in community and
  // those interested in concierge as a client"): the claimed invitation
  // carries what this person came for, and the page shapes itself —
  // practitioner and client arrivals fold the optional sections away and
  // land on their work (the dashboard, the intake) instead of Home.
  const [arrival, setArrival] = useState<'practitioner' | 'client' | 'community' | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate('/signup', { replace: true });
  }, [loading, user, navigate]);

  useEffect(() => {
    let active = true;
    supabase
      .from('categories')
      .select('*')
      .order('sort', { ascending: true })
      .then(({ data }) => {
        if (active && data) setCategories(data as Category[]);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!user) return;
    let live = true;
    void supabase.rpc('my_guardians').then(({ data, error }) => {
      if (!live || error) return;
      const g = (data as { full_name: string | null }[] | null) ?? [];
      if (g.length) setHeldBy(g.map((x) => x.full_name ?? 'a grown-up').join(' & '));
    });
    return () => { live = false; };
  }, [user]);

  // Claim any care invitations addressed to this signup's email, then show
  // what's waiting. (Phone-matched invitations can only claim once the phone
  // saves — finish/skip re-run the claim, and the care-request bell carries
  // those the rest of the way.)
  useEffect(() => {
    if (!user) return;
    let live = true;
    void (async () => {
      await supabase.rpc('claim_care_invitations').then(() => {}, () => {});
      const { data } = await supabase.from('care_team_members')
        .select('id, patient_id, status, initiated_by, patient:profiles!care_team_members_patient_id_fkey(full_name)')
        .eq('caregiver_id', user.id).neq('initiated_by', user.id);
      if (!live) return;
      const rows = (data as unknown as {
        id: string; patient_id: string; status: 'pending' | 'active';
        patient: { full_name: string | null } | null;
      }[] | null) ?? [];
      setCareAsks(rows.map((r) => ({
        id: r.id, patientId: r.patient_id,
        patientName: r.patient?.full_name || 'A member',
        status: r.status,
      })));
    })();
    return () => { live = false; };
  }, [user]);

  // Read the claimed invitation's intent. ⚠ A tokened signup's claim_invite
  // is retried from App.tsx and can land a beat after this page mounts, so a
  // null read retries a few times instead of deciding "generic" too early.
  useEffect(() => {
    if (!user) return;
    // The welcome flight's own choice WINS over the invitation's intent
    // (founder 2026-10-18): the last intro card asked where they want to
    // begin, and a path someone declared by their own hand beats the
    // inviter's guess. Skipping the intro leaves the token's intent standing.
    try {
      const pick = localStorage.getItem('lichen.introIntent');
      if (pick === 'practitioner' || pick === 'client' || pick === 'community') {
        setArrival(pick);
        return;
      }
    } catch { /* storage off — fall through to the token's intent */ }
    let live = true;
    let tries = 0;
    const read = async () => {
      const { data } = await supabase.rpc('my_invite_intent');
      if (!live) return;
      const got = (data as string | null) ?? null;
      if (got === 'practitioner' || got === 'client' || got === 'community') { setArrival(got); return; }
      if (++tries < 4) window.setTimeout(read, 1500);
    };
    void read();
    return () => { live = false; };
  }, [user]);

  async function approveAsk(ask: CareAsk) {
    setCareBusy(true);
    try {
      await approveCare(ask.id);
      setCareAsks((cur) => cur.map((a) => (a.id === ask.id ? { ...a, status: 'active' } : a)));
    } catch {
      setError('Couldn’t approve just now — you can also approve later from your bell.');
    }
    setCareBusy(false);
  }

  // Prefill first/last from the name collected at signup (splittable full_name).
  useEffect(() => {
    if (!user) return;
    let active = true;
    supabase.from('profiles').select('full_name').eq('id', user.id).single()
      .then(({ data }) => {
        if (!active) return;
        const full = ((data as { full_name: string | null } | null)?.full_name ?? '').trim();
        if (!full) return;
        const sp = full.indexOf(' ');
        setFirstName((cur) => cur || (sp > 0 ? full.slice(0, sp) : full));
        if (sp > 0) setLastName((cur) => cur || full.slice(sp + 1).trim());
      });
    return () => { active = false; };
  }, [user]);

  /** The required basics; both Enter Lichen and "later" gate on these. */
  function basicsError(): string {
    if (adult === null) return 'Please tell us whether you’re 18 or older.';
    if (adult === false && !birthDate) return 'Please add your birth date so we can look after you properly.';
    // COPPA floor (founder 2026-08-05): under 13 joins only through a
    // guardian-minted invite, which is the consent record.
    if (adult === false && birthDate && !heldBy) {
      const thirteen = new Date();
      thirteen.setFullYear(thirteen.getFullYear() - 13);
      if (new Date(birthDate) > thirteen) {
        return 'Ask a parent or guardian to set this up for you — they can invite you from their own Lichen account.';
      }
    }
    const contactOk = hasAuthPhone ? contactEmail.trim() : phone.trim();
    return firstName.trim() && lastName.trim() && contactOk
      ? ''
      : `Please add your first name, last name, and ${hasAuthPhone ? 'email address' : 'phone number'}.`;
  }
  function basicsPatch() {
    return {
      first_name: firstName.trim(), last_name: lastName.trim(),
      // A phone signup already gave us the phone — keep it; what we asked
      // for instead was the email, saved to the profile's contact column.
      phone: hasAuthPhone ? (user?.phone ?? null) : phone.trim(),
      ...(hasAuthPhone && contactEmail.trim() ? { email: contactEmail.trim() } : {}),
      // A birth date always wins — the trigger recomputes is_adult from it.
      birth_date: birthDate || null,
      is_adult: adult ?? undefined,
      age_declared_at: new Date().toISOString(),
    };
  }

  /** Where entering Lichen lands: Marketplace's composer carrying a typed
   *  offer (typed words always win — dropping them because someone pressed
   *  "later" would be rude); a provider who approved a care ask lands ON
   *  that care work — one client goes straight to their board, several to
   *  the Provider dashboard; everyone else lands Home. */
  function landing() {
    const text = offer.trim();
    if (text) return `/compose?area=marketplace&body=${encodeURIComponent(text)}`;
    const active = careAsks.filter((a) => a.status === 'active');
    if (active.length === 1) return `/concierge/client/${active[0].patientId}`;
    if (active.length > 1) return '/caregiver';
    // CLAUDE WALKS THEM IN (founder 2026-10-18, superseding the 10-13
    // dashboard landings for chosen paths): the welcome flight promises a
    // guided setup, so a practitioner or community arrival lands in their
    // own Claude conversation with the ask prefilled UNSENT — the model call
    // is theirs to spend, and every manual screen stays one door away (the
    // assistant hands real doors via send_app_door). A CLIENT keeps the
    // guided intake — the front door the subsidy policy names.
    if (arrival === 'practitioner') {
      return '/assistant/feed?thread=general&convo=new&ask=' + encodeURIComponent(
        'I just joined Lichen as a practitioner. Walk me through getting set up, one step at a time — what care I offer, my session types and hours, and how to add my first client.');
    }
    if (arrival === 'client') return '/concierge/intake';
    if (arrival === 'community') {
      return '/assistant/feed?thread=general&convo=new&ask=' + encodeURIComponent(
        'I just joined Lichen for the community. Walk me through getting set up, one step at a time — my profile, finding people, and how giving and exchange work here.');
    }
    return '/home';
  }

  function toggleCap(id: string) {
    setCaps((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  }
  function addSpace(kind: SpaceKind) {
    setSpaces((s) => [...s, { id: nextId.current++, kind, name: '' }]);
  }
  function updateSpace(id: number, patch: Partial<DraftSpace>) {
    setSpaces((s) => s.map((sp) => (sp.id === id ? { ...sp, ...patch } : sp)));
  }
  function removeSpace(id: number) {
    setSpaces((s) => s.filter((sp) => sp.id !== id));
  }

  async function finish() {
    if (!user) return;
    setError('');
    const basicsErr = basicsError();
    if (basicsErr) { setError(basicsErr); return; }
    const named = spaces.filter((s) => s.name.trim());
    if (spaces.length !== named.length) {
      setError('Please name each one, or remove the blank ones.');
      return;
    }
    setSaving(true);
    try {
      if (caps.length) {
        const rows = caps.map((capability) => ({ profile_id: user.id, capability }));
        const { error: capErr } = await supabase
          .from('profile_capabilities')
          .upsert(rows, { onConflict: 'profile_id,capability', ignoreDuplicates: true });
        if (capErr) throw capErr;
      }

      const catIds = [
        ...(caps.includes('goods_provider') ? goodCats : []),
        ...(caps.includes('service_provider') ? serviceCats : []),
      ];
      if (catIds.length) {
        const rows = catIds.map((category_id) => ({ profile_id: user.id, category_id }));
        const { error: catErr } = await supabase
          .from('profile_categories')
          .upsert(rows, { onConflict: 'profile_id,category_id', ignoreDuplicates: true });
        if (catErr) throw catErr;
      }

      if (named.length) {
        const rows = named.map((s) => ({ kind: s.kind, name: s.name.trim(), created_by: user.id }));
        const { error: spaceErr } = await supabase.from('spaces').insert(rows);
        if (spaceErr) throw spaceErr;
      }
      const { error: onbErr } = await supabase
        .from('profiles').update({ ...basicsPatch(), onboarded: true }).eq('id', user.id);
      if (onbErr) throw onbErr;
      // The phone just saved — a phone-matched care invitation can claim now
      // (its bell announces; the asked person approves from it).
      await supabase.rpc('claim_care_invitations').then(() => {}, () => {});
      markOnboarded();
      // The intro's path choice has done its work — don't let it shape a
      // second account on this device.
      try { localStorage.removeItem('lichen.introIntent'); } catch { /* ignore */ }
      navigate(landing(), { replace: true });
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in e
        ? String((e as { message: unknown }).message)
        : 'Something went wrong. Please try again.';
      setError(msg);
      setSaving(false);
    }
  }

  async function skip() {
    if (!user) { navigate('/home', { replace: true }); return; }
    // "Later" still marks the profile onboarded, so the basics can't be skipped.
    setError('');
    const basicsErr = basicsError();
    if (basicsErr) { setError(basicsErr); return; }
    setSaving(true);
    await supabase.from('profiles').update({ ...basicsPatch(), onboarded: true }).eq('id', user.id);
    await supabase.rpc('claim_care_invitations').then(() => {}, () => {});
    markOnboarded();
    try { localStorage.removeItem('lichen.introIntent'); } catch { /* ignore */ }
    navigate(landing(), { replace: true });
  }

  if (loading || !user) {
    return <div className="onb"><p className="onb__sub" style={{ marginTop: 40 }}>Loading…</p></div>;
  }

  const showServices = caps.includes('service_provider');
  const showGoods = caps.includes('goods_provider');
  // Practitioner and client arrivals get a page that is MOSTLY the basics:
  // the optional sections fold behind one quiet door (nothing is removed —
  // every one of them lives in Profile afterwards anyway).
  const practitioner = arrival === 'practitioner';
  const clientArrival = arrival === 'client';
  const folded = (practitioner || clientArrival) && !moreOpen;

  return (
    <div className="onb">
      <div className="onb__card">
        <header className="onb__head">
          <div className="onb__logo"><LichenMark size={60} /></div>
          <h1 className="onb__title">Welcome to Lichen</h1>
          <p className="onb__sub">
            {practitioner
              ? 'You’re a member now. Add your name and what care you offer — your Concierge dashboard is ready on the other side.'
              : clientArrival
                ? 'You’re a member now. Add your name, and we’ll walk you into your care — everything else can wait.'
                : 'You’re a member now. Start with the basics, then tell us how you’ll show up — the rest is optional, and you can change it anytime.'}
          </p>
        </header>

        {/* The arrival card — says plainly what this invitation set up and
            where Enter Lichen lands (founder 2026-10-13). A waiting care
            invitation (below) already says the practitioner version. */}
        {practitioner && careAsks.length === 0 && (
          <section className="onb__section onb__care">
            <h2 className="onb__h2">You&rsquo;re joining as a practitioner</h2>
            <p className="onb__lead" style={{ marginBottom: 0 }}>
              Add your name below and press Enter Lichen — Claude, Lichen&rsquo;s
              AI partner, will walk you through setting up what you offer,
              your session types and hours, and adding your first client.
              Prefer to set things up yourself? Every manual control lives in
              your Provider dashboard and Calendar settings, one tap away.
            </p>
          </section>
        )}
        {arrival === 'community' && (
          <section className="onb__section onb__care">
            <h2 className="onb__h2">You&rsquo;re here for the community</h2>
            <p className="onb__lead" style={{ marginBottom: 0 }}>
              Add your name and the basics below — then Claude, Lichen&rsquo;s AI
              partner, will walk you through your first steps: your profile,
              finding people, and how giving and exchange work here.
              Everything on this page can also be done later, by hand.
            </p>
          </section>
        )}
        {clientArrival && (
          <section className="onb__section onb__care">
            <h2 className="onb__h2">You&rsquo;re here for Concierge care</h2>
            <p className="onb__lead" style={{ marginBottom: 0 }}>
              Add your name below and press Enter Lichen — a gentle guided
              intake walks you through your Web of Wellbeing, the first step
              of your care. Your care team builds around what you share.
            </p>
          </section>
        )}

        {/* THE PROVIDER FAST PATH (founder 2026-10-12): someone invited onto
            a care team leads with that ask — approve it here, add your name
            below, and Enter Lichen opens straight onto the care work.
            Everything else on this page is optional, and the card says so. */}
        {careAsks.length > 0 && (
          <section className="onb__section onb__care">
            <h2 className="onb__h2">You&rsquo;re invited to a care team</h2>
            {careAsks.map((a) => (
              <div className="onb__care-row" key={a.id}>
                <span className="onb__care-who">
                  <strong>{a.patientName}</strong>
                  {a.status === 'active' ? ' — you’re on their care team ✓' : ' invited you to their care team.'}
                </span>
                {a.status === 'pending' && (
                  <button type="button" className="btn btn-primary onb__care-yes"
                    disabled={careBusy} onClick={() => void approveAsk(a)}>
                    Approve
                  </button>
                )}
              </div>
            ))}
            <p className="onb__lead" style={{ marginBottom: 0 }}>
              The quick path: approve, add your name below, and press Enter
              Lichen — you&rsquo;ll land right on their care board. Everything
              else on this page is optional, whenever you like.
            </p>
          </section>
        )}

        <section className="onb__section">
          <h2 className="onb__h2">First, the basics</h2>
          <div className="onb__basics">
            <input
              className="onb__input"
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              autoComplete="given-name"
            />
            <input
              className="onb__input"
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
              autoComplete="family-name"
            />
            {hasAuthPhone ? (
              <input
                className="onb__input"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="Email address"
                autoComplete="email"
              />
            ) : (
              <input
                className="onb__input"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone number"
                autoComplete="tel"
              />
            )}
          </div>
          <p className="onb__lead" style={{ marginBottom: 0 }}>
            Not for public display, but for practical use cases on the
            platform. You&rsquo;ll be able to specify what contact info you
            want shared later in this process.
          </p>

          {/* Age. Everyone answers; only a minor gives a date, so we can age
              them up automatically rather than asking again (founder). */}
          <div className="onb__age">
            <p className="onb__age-q">How old are you?</p>
            <div className="onb__chips">
              <button type="button"
                className={'onb__chip' + (adult === true ? ' is-on' : '')}
                onClick={() => { setAdult(true); setBirthDate(''); }}>
                18 or older
              </button>
              <button type="button"
                className={'onb__chip' + (adult === false ? ' is-on' : '')}
                onClick={() => setAdult(false)}>
                Under 18
              </button>
            </div>
            {adult === false && (
              <>
                <input
                  className="onb__input onb__age-date"
                  type="date"
                  value={birthDate}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setBirthDate(e.target.value)}
                />
                <p className="onb__lead" style={{ marginBottom: 0 }}>
                  Your birth date stays private — nobody else on Lichen can see it. We use it
                  so your account grows up with you, and so a parent or guardian can hold the
                  parts of the economy that need holding.
                </p>
                {heldBy && (
                  <p className="onb__held">
                    <strong>{heldBy}</strong> is holding your account. You can offer what you
                    make and keep what you earn — money moves with their yes.
                  </p>
                )}
              </>
            )}
          </div>
        </section>

        {/* A practitioner's services ARE their practice — that section stays
            up front for them; a client arrival folds it with the rest. */}
        {(!folded || practitioner) && (
        <section className="onb__section">
          <h2 className="onb__h2">{practitioner ? 'What care do you offer?' : 'Do you offer any goods or services?'}</h2>
          <div className="onb__chips">
            {CAPS.map((c) => (
              <button
                type="button"
                key={c.id}
                className={'onb__chip' + (caps.includes(c.id) ? ' is-on' : '')}
                onClick={() => toggleCap(c.id)}
              >
                <strong>{c.label}</strong>
                <span>{c.desc}</span>
              </button>
            ))}
          </div>

          {showServices && (
            <div className="onb__picker">
              <p className="onb__lead">What services do you offer?</p>
              <CategoryPicker
                domain="service"
                categories={categories}
                selected={serviceCats}
                onChange={setServiceCats}
                userId={user.id}
              />
            </div>
          )}
          {showGoods && (
            <div className="onb__picker">
              <p className="onb__lead">What goods do you offer?</p>
              <CategoryPicker
                domain="good"
                categories={categories}
                selected={goodCats}
                onChange={setGoodCats}
                userId={user.id}
              />
            </div>
          )}
        </section>
        )}

        {!folded && (<>
        <section className="onb__section">
          <h2 className="onb__h2">Have something to offer right away?</h2>
          <p className="onb__lead">
            Lichen runs on what members bring — goods, services, skills, time.
            Describe one thing you could offer now, and when you enter Lichen
            we&rsquo;ll take you straight to Marketplace to post it. You choose
            the terms there — a gift, a trade, a loan, or for Current-cy.
          </p>
          <textarea
            className="onb__input onb__offer"
            rows={3}
            value={offer}
            onChange={(e) => setOffer(e.target.value)}
            placeholder="e.g. “Weekly riding lessons for beginners” or “A box of garden starts every spring”"
          />
        </section>

        {SPACE_SECTIONS.map((sec) => {
          const mine = spaces.filter((s) => s.kind === sec.kind);
          const article = /^[aeiou]/i.test(sec.one) ? 'an' : 'a';
          return (
            <section className="onb__section" key={sec.kind}>
              <h2 className="onb__h2">{sec.q}</h2>
              <p className="onb__lead">{sec.desc} You’ll be the super admin of each.</p>

              {mine.map((s) => (
                <div className="onb__draft" key={s.id}>
                  <input
                    className="onb__input"
                    type="text"
                    value={s.name}
                    onChange={(e) => updateSpace(s.id, { name: e.target.value })}
                    placeholder={'Name your ' + sec.one}
                  />
                  <button
                    type="button"
                    className="onb__remove"
                    onClick={() => removeSpace(s.id)}
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}

              <button type="button" className="onb__add" onClick={() => addSpace(sec.kind)}>
                + Add {mine.length ? 'another' : `${article} ${sec.one}`}
              </button>
            </section>
          );
        })}
        </>)}

        {/* The folded door — nothing is removed, it all lives in Profile
            afterwards too; this just keeps a shaped arrival to one screen. */}
        {folded && (
          <button type="button" className="onb__add onb__more" onClick={() => setMoreOpen(true)}>
            + More ways to show up — {practitioner ? '' : 'goods & services, '}offerings,
            organizations, communities, groups, places (all optional, all editable later)
          </button>
        )}

        {error && <p className="onb__error">{error}</p>}

        <div className="onb__actions">
          <button className="btn btn-primary onb__finish" onClick={finish} disabled={saving}>
            {saving ? 'Setting up…' : 'Enter Lichen'}
          </button>
          <button className="onb__skip" type="button" onClick={skip} disabled={saving}>
            I’ll do this later
          </button>
        </div>
      </div>
    </div>
  );
}
