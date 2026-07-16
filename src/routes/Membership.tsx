import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import './Membership.css';

type Sub = { tier: 'community' | 'concierge'; source: 'gift' | 'stripe'; status: string; current_period_end: string | null; granted_at: string | null } | null;

// Same vocabulary as the gift pickers: 1 month / N months / 1 year / N years.
const spanText = (m: number) =>
  m % 12 === 0 ? (m === 12 ? 'a year' : `${m / 12} years`)
    : m === 1 ? 'a month' : `${m} months`;

const PLANS: { tier: 'community' | 'concierge'; label: string; price: string; blurb: string }[] = [
  { tier: 'community', label: 'Community', price: '$29', blurb: 'Your access to Lichen — the feed, spaces, marketplace, and your network.' },
  { tier: 'concierge', label: 'Concierge', price: '$99', blurb: 'Everything in Community, plus your dedicated care layer.' },
];

export default function Membership() {
  const { loading, user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [sub, setSub] = useState<Sub>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('subscriptions').select('tier, source, status, current_period_end, granted_at').eq('profile_id', user.id).maybeSingle();
    setSub((data as Sub) ?? null);
    setLoaded(true);
  }, [user]);

  useEffect(() => {
    if (!loading && !user) { navigate('/login', { replace: true }); return; }
    if (user) load();
  }, [user, loading, navigate, load]);

  // Returning from Stripe: the webhook writes the row a moment later, so re-check.
  useEffect(() => {
    const s = params.get('status');
    if (s === 'success') {
      setMsg('Thank you — activating your membership. This can take a few seconds.');
      const t = setTimeout(load, 4000);
      return () => clearTimeout(t);
    }
    if (s === 'cancel') setMsg('Checkout canceled — no charge was made.');
  }, [params, load]);

  async function subscribe(tier: 'community' | 'concierge') {
    setBusy(tier); setError('');
    const { data, error: e } = await supabase.functions.invoke('stripe-checkout', { body: { tier } });
    const url = (data as { url?: string } | null)?.url;
    if (e || !url) { setBusy(''); setError('Couldn’t start checkout. Please try again in a moment.'); return; }
    window.location.href = url;
  }

  async function manage() {
    setBusy('manage'); setError('');
    const { data, error: e } = await supabase.functions.invoke('stripe-portal', {});
    const url = (data as { url?: string } | null)?.url;
    if (e || !url) { setBusy(''); setError('Couldn’t open billing. Please try again in a moment.'); return; }
    window.location.href = url;
  }

  if (loading || !loaded) return <div className="mship"><p className="mship__muted">Loading…</p></div>;

  // A time-boxed gift that has run out no longer counts as membership.
  const giftEnded = !!sub && sub.source === 'gift' && !!sub.current_period_end
    && new Date(sub.current_period_end) <= new Date();
  const activeTier = sub && sub.status === 'active' && !giftEnded ? sub.tier : null;
  const giftUntil = sub && sub.source === 'gift' && sub.current_period_end && !giftEnded
    ? new Date(sub.current_period_end).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : null;
  // The gift's span, derived from grant → end ("a year", "6 months").
  const giftSpan = giftUntil && sub!.granted_at
    ? spanText(Math.max(1, Math.round(
        (new Date(sub!.current_period_end!).getTime() - new Date(sub!.granted_at).getTime()) / (30.44 * 24 * 3600 * 1000))))
    : null;
  const DAY = 24 * 3600 * 1000;
  const giftEndingSoon = !!giftUntil
    && new Date(sub!.current_period_end!).getTime() - Date.now() < 30 * DAY;

  return (
    <div className="mship">
      <header className="mship__head">
        <h1 className="mship__title">Membership</h1>
        <p className="mship__sub">Community is your access to Lichen. Concierge adds your dedicated care layer.</p>
      </header>

      {msg && <p className="mship__msg">{msg}</p>}
      {giftEnded && (
        <p className="mship__msg">
          Your gifted membership ended on {new Date(sub!.current_period_end!).toLocaleDateString()} — we’d love to keep you.
        </p>
      )}
      {error && <p className="mship__error">{error}</p>}

      {giftEndingSoon && activeTier && (
        <p className="mship__msg">
          Your gifted membership ends {giftUntil}. Choose a plan below and your
          access continues without interruption.
        </p>
      )}

      {activeTier ? (
        <div className="mship__current">
          <p className="mship__status">
            You’re a <strong>{activeTier === 'concierge' ? 'Concierge' : 'Community'}</strong> member
            {sub!.source === 'gift' ? ' — gifted by Lichen' : ''}
            {giftSpan ? ` · ${giftSpan}, through ${giftUntil}` : giftUntil ? ` through ${giftUntil}` : ''}.
          </p>
          {sub!.source === 'stripe' ? (
            <button className="btn btn-ghost mship__btn" onClick={manage} disabled={busy === 'manage'}>
              {busy === 'manage' ? '…' : 'Manage / change plan'}
            </button>
          ) : activeTier === 'community' ? (
            <button className="btn btn-primary mship__btn" onClick={() => subscribe('concierge')} disabled={!!busy}>
              {busy === 'concierge' ? 'Starting…' : 'Add Concierge — $99/mo'}
            </button>
          ) : null}
        </div>
      ) : null}

      {(!activeTier || giftEndingSoon) && (
        <div className="mship__plans">
          {PLANS.map((p) => (
            <div key={p.tier} className="mship__plan">
              <div className="mship__plan-head">
                <span className="mship__plan-name">{p.label}</span>
                <span className="mship__plan-price">{p.price}<span className="mship__plan-per">/mo</span></span>
              </div>
              <p className="mship__plan-blurb">{p.blurb}</p>
              <button className="btn btn-primary mship__btn" onClick={() => subscribe(p.tier)} disabled={!!busy}>
                {busy === p.tier ? 'Starting…' : `Join ${p.label}`}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
