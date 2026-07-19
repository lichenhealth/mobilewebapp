import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import './Donate.css';

const PORTAL = 'https://billing.stripe.com/p/login/9B6bJ00MU047bRidT3bII00';
const PAYPAL = 'https://www.paypal.com/donate/?hosted_button_id=F2A847YRU7EPU';
const CALENDLY = 'https://calendly.com/galyntime';
const PRESETS = [25, 50, 100, 250];

type Freq = 'one-time' | 'monthly' | 'annually';

export default function Donate() {
  const [params] = useSearchParams();
  const status = params.get('status');

  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<Freq>('one-time');
  const [designation, setDesignation] = useState('');
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
          <input
            type="text"
            placeholder='e.g. "For Melanie Bright — subsidize care for those who can&rsquo;t afford it"'
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
            maxLength={300}
          />
          <span className="donate__direct-hint">
            Name a practitioner, group, or purpose within the Lichen network, in
            your own words. 95% of your gift flows there as Lichen Current-cy;
            5% sustains the platform that makes it possible.
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
