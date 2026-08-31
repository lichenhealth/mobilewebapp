import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import SiteHeader from '../components/SiteHeader';
import { useAuth } from '../auth/AuthProvider';
import './Donate.css';

const PORTAL = 'https://billing.stripe.com/p/login/9B6bJ00MU047bRidT3bII00';
const PAYPAL = 'https://www.paypal.com/donate/?hosted_button_id=F2A847YRU7EPU';
const CALENDLY = 'https://calendly.com/galyntime';
const PRESETS = [25, 50, 100, 250];

// The intentions donors reach for most — one tap fills the field.
// 'Where it's needed most' is the DEFAULT: trust the mycelium's routing.
const PURPOSES = [
  'Where it’s needed most',
  'Subsidize care for those who can’t afford it',
  'Subsidize goods and services for those who can’t afford them',
  'Subsidize spaces and places for those who can’t afford them',
  'Lichen operations',
];

interface DirectHit { key: string; label: string; kind: string; fill: string }

// Donors write sentences ("Care subsidies for melanie"), so the name usually
// sits at the END. Search the whole phrase plus its trailing words.
function nameNeedles(raw: string): string[] {
  const words = raw.split(/\s+/).filter(Boolean);
  const afterFor = (() => {
    const i = raw.toLowerCase().lastIndexOf(' for ');
    return i >= 0 ? raw.slice(i + 5) : '';
  })();
  const all = [raw, afterFor, words.slice(-2).join(' '), words.slice(-1).join(' ')]
    .map((c) => c.trim().replace(/[,%()]/g, ''))
    .filter((c) => c.length >= 2);
  return [...new Set(all)].slice(0, 4);
}

// Picking a hit keeps the donor's own words: the trailing name fragment is
// replaced with the full name ("Care subsidies for melanie" → "… Melanie Bright").
function fillWithName(name: string, q: string): string {
  const lq = q.toLowerCase();
  const ln = name.toLowerCase();
  for (let i = 0; i < q.length; i++) {
    const suffix = lq.slice(i).trim();
    if (suffix.length >= 2 && ln.includes(suffix)) {
      return (q.slice(0, i).trimEnd() + ' ' + name).trim();
    }
  }
  return `For ${name}`;
}

type Freq = 'one-time' | 'monthly' | 'annually';

export default function Donate() {
  const [params] = useSearchParams();
  const status = params.get('status');
  const navigate = useNavigate();
  const { user } = useAuth();

  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<Freq>('one-time');
  // Chips behave like radios (default: trust the routing); the text box is a
  // CUSTOM suggestion that overrides the chip when filled.
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [designation, setDesignation] = useState('');
  const [hits, setHits] = useState<DirectHit[]>([]);
  const [picked, setPicked] = useState(false);
  // The peach receipt under the box — proof the network recognized who you named.
  const [pickedLabel, setPickedLabel] = useState('');
  // The tax-policy fork (IRS conduit rule), now front and center as two
  // columns: Donate = deductible, Lichen holds discretion; Give = the donor
  // chooses who benefits — a personal gift, honestly not deductible.
  const [flow, setFlow] = useState<'donate' | 'gift'>('donate');
  const mode: 'donation' | 'sponsorship' = flow === 'gift' ? 'sponsorship' : 'donation';

  // Type-ahead for the designation: real members and groups (signed-in
  // donors only — the member list is private to members) + purpose
  // suggestions for everyone ("lichen" offers up operations, etc.).
  useEffect(() => {
    const q = designation.trim();
    if (q.length < 2 || picked || PURPOSES.includes(q)) { setHits([]); return; }
    let live = true;
    const t = window.setTimeout(async () => {
      const needle = q.replace(/^for\s+/i, '');
      const needles = nameNeedles(needle);
      const purposeHits: DirectHit[] = PURPOSES
        .filter((p) => needles.some((n) => p.toLowerCase().includes(n.toLowerCase()))
          || /lichen/i.test(needle) && p === 'Lichen operations')
        .map((p) => ({ key: 'p:' + p, label: p, kind: 'Purpose', fill: p }));
      let memberHits: DirectHit[] = [];
      if (needles.length > 0) {
        // Signed-out donors get an RLS-empty result — free text still works.
        const [mem, sp] = await Promise.all([
          supabase.from('profiles').select('id, full_name, headline')
            .or(needles.map((n) => `full_name.ilike.%${n}%`).join(',')).limit(4),
          supabase.from('spaces').select('id, name, kind')
            .or(needles.map((n) => `name.ilike.%${n}%`).join(',')).limit(3),
        ]);
        memberHits = [
          ...(((mem.data as { id: string; full_name: string | null; headline: string | null }[] | null) ?? [])
            .map((m) => ({
              key: 'm:' + m.id,
              label: m.full_name ?? 'Member',
              kind: m.headline ?? 'Member',
              fill: fillWithName(m.full_name ?? 'Member', q),
            }))),
          ...(((sp.data as { id: string; name: string; kind: string }[] | null) ?? [])
            .map((s) => ({
              key: 's:' + s.id,
              label: s.name,
              kind: s.kind.charAt(0).toUpperCase() + s.kind.slice(1),
              fill: fillWithName(s.name, q),
            }))),
        ];
      }
      if (live) setHits([...memberHits, ...purposeHits].slice(0, 6));
    }, 250);
    return () => { live = false; window.clearTimeout(t); };
  }, [designation, picked]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Signed-out donors read a website, not the app (founder 2026-07-30).
  useEffect(() => {
    if (user) return;
    document.documentElement.classList.add('is-public-page');
    return () => document.documentElement.classList.remove('is-public-page');
  }, [user]);

  async function donate() {
    setErr(false);
    if (!amount || Number(amount) < 1) {
      setErr(true);
      setMsg('Please enter an amount of at least $1.');
      return;
    }
    if (flow === 'gift' && !designation.trim()) {
      setErr(true);
      setMsg('A personal gift needs a recipient — tell us who it’s for.');
      return;
    }
    setLoading(true);
    setMsg('Taking you to secure checkout…');
    try {
      // Our own checkout (donate-checkout edge fn) — the donation lands in
      // Lichen's books and, once translated, in the Current-cy ledger.
      const { data, error } = await supabase.functions.invoke('donate-checkout', {
        body: {
          amount: Number(amount), frequency, kind: mode,
          // Custom words override the chip; gifts carry only explicit words.
          designation: designation.trim() || (flow === 'donate' ? purpose : ''),
        },
      });
      if (error || !data?.url) throw new Error(error?.message || data?.error || 'Could not start checkout.');
      window.location.href = data.url;
    } catch (e) {
      setErr(true);
      setMsg((e as { message?: string } | null)?.message
        || 'Something went wrong — please try again or email connect@lichen.health.');
      setLoading(false);
    }
  }

  async function copyCheck() {
    try {
      await navigator.clipboard.writeText('Lichen Health\nGalyn Burke\n2076 Nova Rd.\nPine, CO 80470');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <>
    {!user && <SiteHeader />}
    <div className="donate">
      <header className="donate__head">
        <p className="eyebrow">Support Lichen</p>
        <h1 className="donate__title">
          Restore balance by <span className="display-italic">giving back.</span>
        </h1>
        <p className="donate__sub">
          Thank you for investing in a more balanced and healthy future.
        </p>
        <p className="donate__caption">Welcome to the Community — every donor is invited to join us on the platform, and receives the aggregate story of their impact.</p>
        <div className="donate__head-links">
          <button
            type="button" className="donate__how-link"
            onClick={() => navigate('/donate/how')}
          >
            How giving works →
          </button>
          {user && (
            <button
              type="button" className="donate__how-link"
              onClick={() => navigate('/giving')}
            >
              My giving →
            </button>
          )}
        </div>
      </header>

      {/* The two ways in — the IRS conduit rule as columns. */}
      <section className="donate__flows">
        <button
          type="button"
          className={'donate__flow' + (flow === 'donate' ? ' is-active' : '')}
          onClick={() => setFlow('donate')}
        >
          <span className="donate__flow-name">Donate</span>
          <span className="donate__flow-desc">
            Tax-deductible. Lichen assesses and delivers your contribution
            where it&rsquo;s needed most, as the IRS requires.
          </span>
          <span className="donate__flow-law">
            Once given, your dollars are permanently dedicated to the
            commons — by law, they can never return to private profit.
          </span>
          <span
            role="link" tabIndex={0} className="donate__flow-learn"
            onClick={(e) => { e.stopPropagation(); navigate('/donate/how#donate'); }}
          >
            Learn more
          </span>
        </button>
        <button
          type="button"
          className={'donate__flow' + (flow === 'gift' ? ' is-active' : '')}
          onClick={() => setFlow('gift')}
        >
          <span className="donate__flow-name">Give</span>
          <span className="donate__flow-desc">
            A direct personal gift — you choose exactly who benefits.
            Generous and honest, but not tax-deductible.
          </span>
          <span
            role="link" tabIndex={0} className="donate__flow-learn"
            onClick={(e) => { e.stopPropagation(); navigate('/donate/how#give'); }}
          >
            Learn more
          </span>
        </button>
        <button
          type="button"
          className="donate__flow donate__flow--door"
          onClick={() => navigate('/market')}
        >
          <span className="donate__flow-name">The Lichen Economy</span>
          <span className="donate__flow-desc">
            Where value lives and moves inside: dollar-backed Current-cy,
            fully above board — and offerings freely given, which money
            can&rsquo;t buy. You enter by offering.
          </span>
          <span className="donate__flow-enter">Enter the Marketplace →</span>
          <span
            role="link" tabIndex={0} className="donate__flow-learn"
            onClick={(e) => { e.stopPropagation(); navigate('/donate/how#economy'); }}
          >
            Learn more
          </span>
        </button>
      </section>

      {status === 'success' && (
        <div className="donate__banner donate__banner--ok">
          Thank you — your donation went through. You're helping bring holistic,
          community-based care to those who need it most.
        </div>
      )}
      {status === 'cancelled' && (
        <div className="donate__banner donate__banner--soft">
          No charge was made — your donation wasn't completed. You're welcome to try
          again whenever you're ready.
        </div>
      )}

      <section className="donate__give">
        <p className="donate__give-sub">
          Choose an amount and how often you'd like to give — one time, monthly, or annually.
        </p>

        <div className="donate__presets">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={'donate__preset' + (amount === String(p) ? ' is-active' : '')}
              onClick={() => setAmount(String(p))}
            >
              ${p}
            </button>
          ))}
        </div>

        <div className="donate__fields">
          <label className="donate__field donate__field--amount">
            <span className="donate__label">Amount</span>
            <div className="donate__amount-input">
              <span className="donate__dollar">$</span>
              <input
                type="number"
                min="1"
                step="1"
                inputMode="decimal"
                placeholder="50"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </label>
          <label className="donate__field">
            <span className="donate__label">Frequency</span>
            <select value={frequency} onChange={(e) => setFrequency(e.target.value as Freq)}>
              <option value="one-time">One time</option>
              <option value="monthly">Monthly</option>
              <option value="annually">Annually</option>
            </select>
          </label>
        </div>

        <label className="donate__field donate__field--direct">
          <span className="donate__label">
            {flow === 'gift' ? 'Who is this gift for?' : 'Direct your donation (optional)'}
          </span>
          {flow === 'donate' && (
            <>
              <div className="donate__direct-presets">
                {PURPOSES.map((p) => (
                  <button
                    key={p} type="button"
                    className={'donate__preset donate__preset--sm' + (purpose === p && !designation.trim() ? ' is-active' : '')}
                    onClick={() => { setPurpose(p); setDesignation(''); setHits([]); setPickedLabel(''); }}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <button
                type="button" className="donate__learn"
                onClick={() => navigate('/donate/how#needed-most')}
              >
                How does Lichen decide where it&rsquo;s needed most? Learn more
              </button>
            </>
          )}
          <input
            type="text"
            placeholder={flow === 'gift'
              ? 'e.g. "For Melanie Bright — sessions for the Ruiz family"'
              : 'Make a custom suggestion or request, e.g. "For Melanie Bright — subsidize care for those who can’t afford it"'}
            value={designation}
            onChange={(e) => { setDesignation(e.target.value); setPicked(false); setPickedLabel(''); }}
            maxLength={300}
          />
          {hits.length > 0 && (
            <div className="donate__direct-hits">
              {hits.map((h) => (
                <button
                  key={h.key} type="button" className="donate__direct-hit"
                  onClick={() => {
                    setDesignation(h.fill); setPicked(true); setHits([]);
                    setPickedLabel(h.kind === 'Purpose' ? '' : h.label);
                  }}
                >
                  {h.label}
                  <em>{h.kind}</em>
                </button>
              ))}
            </div>
          )}
          {pickedLabel && (
            <span className="donate__direct-ok">✓ {pickedLabel} — recognized in the Lichen network</span>
          )}
          {flow === 'donate' && pickedLabel && (
            <span className="donate__direct-note">
              Your preference for {pickedLabel} guides us — Lichen decides who
              receives care.{' '}
              <button type="button" onClick={() => setFlow('gift')}>
                Want to choose yourself? Give directly instead.
              </button>
            </span>
          )}
          {flow === 'gift' ? (
            <span className="donate__direct-hint">
              You choose exactly who benefits — Lichen facilitates your
              generosity as you direct it. 95% flows to them as Lichen
              Current-cy; 5% sustains the platform. A personal gift is not a
              charitable donation: you&rsquo;ll receive a gift acknowledgment
              rather than a tax receipt.
            </span>
          ) : (
            <span className="donate__direct-hint">
              Name a practitioner, group, or purpose within the Lichen network, in
              your own words. 95% of your donation flows there as Lichen Current-cy;
              5% sustains the operations required to provide the platform that
              makes it possible. Designations are preferences — Lichen Health
              retains full discretion and control over donated funds, as the IRS
              requires for tax-deductibility.
            </span>
          )}
        </label>

        <button type="button" className="donate__submit" onClick={donate} disabled={loading}>
          {loading ? 'One moment…' : mode === 'sponsorship' ? 'Send gift' : 'Donate'}
        </button>
        {msg && (
          <p className={'donate__status' + (err ? ' is-err' : '')} role="status">
            {msg}
          </p>
        )}
        <p className="donate__fine">
          Secure checkout powered by Stripe. Monthly and annual gifts recur automatically
          until you cancel — <a href={PORTAL} target="_blank" rel="noopener">manage or cancel your donation anytime</a>.
        </p>
      </section>

      <p className="donate__tax">
        Lichen Health is a registered 501(c)(3) nonprofit organization (EIN 73-1683375),
        based in Nevada City, California. Donations are tax-deductible to the fullest
        extent allowed by law.
      </p>

      <hr className="donate__divider" />

      <h2 className="donate__give-title">Other ways to give</h2>
      <div className="donate__ways">
        <div className="donate__way">
          <h3 className="donate__way-name">PayPal</h3>
          <p>Prefer PayPal? Give a one-time gift there.</p>
          <a className="donate__way-cta" href={PAYPAL} target="_blank" rel="noopener">Give via PayPal</a>
        </div>
        <div className="donate__way">
          <h3 className="donate__way-name">Check</h3>
          <p>Mailing a check avoids processing fees entirely.</p>
          <div className="donate__check">
            <div className="donate__check-row">
              <span className="donate__check-label">Payable to</span>
              <span className="donate__check-val">Lichen Health</span>
            </div>
            <div className="donate__check-row">
              <span className="donate__check-label">Mail to</span>
              <span className="donate__check-val">Galyn Burke<br />2076 Nova Rd.<br />Pine, CO 80470</span>
            </div>
            <button type="button" className="donate__check-copy" onClick={copyCheck}>
              {copied ? 'Copied!' : 'Copy details'}
            </button>
          </div>
        </div>
        <div className="donate__way">
          <h3 className="donate__way-name">Gift</h3>
          <p>Speak with our founder to facilitate a larger gift.</p>
          <a className="donate__way-cta" href={CALENDLY} target="_blank" rel="noopener">Book a call</a>
        </div>
      </div>
      {/* Founders Circle — ported from the marketing site (2026-07-29).
          The tiers anchor the land vision; large gifts begin as conversations. */}
      <section className="donate__fc">
        <h2 className="donate__fc-title">The Founders Circle</h2>
        <p className="donate__fc-sub">
          For those ready to anchor the forest — founding contributions that
          restore the land, build the sanctuary, and fuel the infrastructure
          that supports the commons. Tax-deductible; invitation into
          community, with anonymity honored as desired at every tier.
        </p>
        <div className="donate__fc-tiers">
          {[
            ['Substrate Circle', 'From $5,000', 'An ocean of those who are ready for sea change.'],
            ['Root Circle', 'From $25,000', 'The hidden architecture that anchors what grows.'],
            ['Hearth Circle', 'From $75,000', 'Where the fire is tended.'],
            ['Maloka Circle', 'From $250,000', 'The sacred container itself.'],
            ['Old Growth Circle', 'From $1,000,000', 'The mother trees that anchor the entire forest.'],
          ].map(([name, from, essence]) => (
            <div className="donate__fc-tier" key={name}>
              <p className="donate__fc-name">{name}</p>
              <p className="donate__fc-from">{from}</p>
              <p className="donate__fc-essence">{essence}</p>
            </div>
          ))}
        </div>
        <a className="donate__way-cta" href={CALENDLY} target="_blank" rel="noopener">
          Begin the conversation
        </a>
      </section>

      <p className="donate__connect">
        Would you like to connect before giving? Feel free to{' '}
        <a href={CALENDLY} target="_blank" rel="noopener">book a time</a> to chat with us via Zoom.
      </p>
    </div>
    </>
  );
}
