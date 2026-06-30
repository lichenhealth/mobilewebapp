import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import './Membership.css';

type Sub = { tier: 'community' | 'concierge'; source: 'gift' | 'stripe'; status: string } | null;

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
      .from('subscriptions').select('tier, source, status').eq('profile_id', user.id).maybeSingle();
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
    if (e || !url) {
      // Surface the function's actual reason (temporary, to debug the Stripe setup).
      let detail = '';
      try {
        const ctx = (e as { context?: Response } | null)?.context;
        if (ctx && typeof ctx.json === 'function') {
          const b = await ctx.json();
          detail = b?.detail || b?.error || '';
        }
      } catch { /* ignore */ }
      setBusy('');
      setError(detail ? `Checkout error: ${detail}` : 'Couldn’t start checkout. Please try again in a moment.');
      return;
    }
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

  const activeTier = sub && sub.status === 'active' ? sub.tier : null;

  return (
    <div className="mship">
      <header className="mship__head">
        <h1 className="mship__title">Membership</h1>
        <p className="mship__sub">Community is your access to Lichen. Concierge adds your dedicated care layer.</p>
      </header>

      {msg && <p className="mship__msg">{msg}</p>}
      {error && <p className="mship__error">{error}</p>}

      {activeTier ? (
        <div className="mship__current">
          <p className="mship__status">
            You’re a <strong>{activeTier === 'concierge' ? 'Concierge' : 'Community'}</strong> member
            {sub!.source === 'gift' ? ' — gifted by Lichen' : ''}.
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
      ) : (
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
