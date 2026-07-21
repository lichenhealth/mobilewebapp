import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import './Donate.css';

const PORTAL = 'https://billing.stripe.com/p/login/9B6bJ00MU047bRidT3bII00';
const PAYPAL = 'https://www.paypal.com/donate/?hosted_button_id=F2A847YRU7EPU';
const CALENDLY = 'https://calendly.com/galyntime';
const PRESETS = [25, 50, 100, 250];

// The intentions donors reach for most — one tap fills the field.
const PURPOSES = [
  'Where it’s needed most',
  'Lichen operations',
  'Subsidize care for those who can’t afford it',
];

interface DirectHit { key: string; label: string; kind: string; fill: string }

type Freq = 'one-time' | 'monthly' | 'annually';

export default function Donate() {
  const [params] = useSearchParams();
  const status = params.get('status');

  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<Freq>('one-time');
  const [designation, setDesignation] = useState('');
  const [hits, setHits] = useState<DirectHit[]>([]);
  const [picked, setPicked] = useState(false);

  // Type-ahead for the designation: real members and groups (signed-in
  // donors only — the member list is private to members) + purpose
  // suggestions for everyone ("lichen" offers up operations, etc.).
  useEffect(() => {
    const q = designation.trim();
    if (q.length < 2 || picked || PURPOSES.includes(q)) { setHits([]); return; }
    let live = true;
    const t = window.setTimeout(async () => {
      const needle = q.replace(/^for\s+/i, '');
      const purposeHits: DirectHit[] = PURPOSES
        .filter((p) => p.toLowerCase().includes(needle.toLowerCase()) || /lichen/i.test(needle) && p === 'Lichen operations')
        .map((p) => ({ key: 'p:' + p, label: p, kind: 'Purpose', fill: p }));
      let memberHits: DirectHit[] = [];
      if (needle.length >= 2) {
        // Signed-out donors get an RLS-empty result — free text still works.
        const [mem, sp] = await Promise.all([
          supabase.from('profiles').select('id, full_name, headline').ilike('full_name', `%${needle}%`).limit(4),
          supabase.from('spaces').select('id, name, kind').ilike('name', `%${needle}%`).limit(3),
        ]);
        memberHits = [
          ...(((mem.data as { id: string; full_name: string | null; headline: string | null }[] | null) ?? [])
            .map((m) => ({
              key: 'm:' + m.id,
              label: m.full_name ?? 'Member',
              kind: m.headline ?? 'Member',
              fill: `For ${m.full_name}`,
            }))),
          ...(((sp.data as { id: string; name: string; kind: string }[] | null) ?? [])
            .map((s) => ({
              key: 's:' + s.id,
              label: s.name,
              kind: s.kind.charAt(0).toUpperCase() + s.kind.slice(1),
              fill: `For ${s.name}`,
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

  async function donate() {
    setErr(false);
    if (!amount || Number(amount) < 1) {
      setErr(true);
      setMsg('Please enter an amount of at least $1.');
      return;
    }
    setLoading(true);
    setMsg('Taking you to secure checkout…');
    try {
      // Our own checkout (donate-checkout edge fn) — the donation lands in
      // Lichen's books and, once translated, in the Current-cy ledger.
      const { data, error } = await supabase.functions.invoke('donate-checkout', {
        body: { amount: Number(amount), frequency, designation: designation.trim() },
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
      await navigator.clipboard.writeText('Lichen Health\nGalyn Burke\n320 Rustlers Rd.\nBailey, CO 80421');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <div className="donate">
      <header className="donate__head">
        <p className="eyebrow">Support Lichen</p>
        <h1 className="donate__title">
          Restore balance by <span className="display-italic">giving back.</span>
        </h1>
        <p className="donate__sub">
          Make a tax-deductible donation to expand access to holistic, community-based
          care for all. Thank you for investing in a more balanced and healthy future.
        </p>
      </header>

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
        <h2 className="donate__give-title">Give now</h2>
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
          <span className="donate__label">Direct your gift (optional)</span>
          <div className="donate__direct-presets">
            {PURPOSES.map((p) => (
              <button
                key={p} type="button"
                className={'donate__preset donate__preset--sm' + (designation === p ? ' is-active' : '')}
                onClick={() => { setDesignation(p); setHits([]); }}
              >
                {p}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder='e.g. "For Melanie Bright — subsidize care for those who can&rsquo;t afford it"'
            value={designation}
            onChange={(e) => { setDesignation(e.target.value); setPicked(false); }}
            maxLength={300}
          />
          {hits.length > 0 && (
            <div className="donate__direct-hits">
              {hits.map((h) => (
                <button
                  key={h.key} type="button" className="donate__direct-hit"
                  onClick={() => { setDesignation(h.fill); setPicked(true); setHits([]); }}
                >
                  {h.label}
                  <em>{h.kind}</em>
                </button>
              ))}
            </div>
          )}
          <span className="donate__direct-hint">
            Name a practitioner, group, or purpose within the Lichen network, in
            your own words. 95% of your gift flows there as Lichen Current-cy;
            5% sustains the operations required to provide the platform that
            makes it possible.
          </span>
        </label>

        <button type="button" className="donate__submit" onClick={donate} disabled={loading}>
          {loading ? 'One moment…' : 'Donate'}
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
              <span className="donate__check-val">Galyn Burke<br />320 Rustlers Rd.<br />Bailey, CO 80421</span>
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
      <p className="donate__connect">
        Would you like to connect before giving? Feel free to{' '}
        <a href={CALENDLY} target="_blank" rel="noopener">book a time</a> to chat with us via Zoom.
      </p>
    </div>
  );
}
