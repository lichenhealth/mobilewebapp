import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import './AdminCategories.css';

type Tier = 'community' | 'concierge';
type Row = {
  profile_id: string;
  tier: Tier;
  source: 'gift' | 'stripe';
  status: string;
  member: { full_name: string | null; email: string | null } | null;
};

const TIERS: { id: Tier; label: string; price: string }[] = [
  { id: 'community', label: 'Community', price: '$29/mo' },
  { id: 'concierge', label: 'Concierge', price: '$99/mo' },
];

export default function AdminSupporters() {
  const { loading, user, isAdmin } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState('');
  const [tier, setTier] = useState<Tier>('community');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('subscriptions')
      .select('profile_id, tier, source, status, member:profiles!subscriptions_profile_id_fkey(full_name, email)')
      .order('granted_at', { ascending: false });
    if (e) setError(e.message);
    else setRows((data as unknown as Row[]) ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  async function gift() {
    const em = email.trim();
    if (!em) return;
    setBusy(true); setMsg(''); setError('');
    const { error: e } = await supabase.rpc('gift_subscription', { p_email: em, p_tier: tier });
    setBusy(false);
    if (e) { setError(e.message); return; }
    setMsg(`Gifted ${TIERS.find((t) => t.id === tier)?.label} to ${em}.`);
    setEmail('');
    load();
  }

  async function revoke(em: string | null) {
    if (!em) return;
    setError('');
    const { error: e } = await supabase.rpc('revoke_subscription', { p_email: em });
    if (e) setError(e.message); else load();
  }

  if (loading) return <div className="adminc"><p className="adminc__muted">Loading…</p></div>;
  if (!user || !isAdmin) return <Navigate to="/home" replace />;

  return (
    <div className="adminc">
      <header className="adminc__head">
        <h1 className="adminc__title">Gift access</h1>
        <p className="adminc__sub">
          Comp a beta member into a tier. No charge now — you can convert gifts to paid when beta ends.
        </p>
      </header>

      {error && <p className="adminc__error">{error}</p>}

      <div className="adminc__gift">
        <input
          className="adminc__gift-email"
          type="email"
          placeholder="Member's email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setMsg(''); }}
        />
        <div className="adminc__gift-tiers">
          {TIERS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={'adminc__tier-btn' + (tier === t.id ? ' is-on' : '')}
              onClick={() => setTier(t.id)}
            >
              {t.label} <span className="adminc__tier-price">{t.price}</span>
            </button>
          ))}
        </div>
        <button className="adminc__btn adminc__btn--approve" onClick={gift} disabled={busy || !email.trim()}>
          {busy ? '…' : 'Gift access'}
        </button>
      </div>
      {msg && <p className="adminc__msg">{msg}</p>}

      <h2 className="adminc__subhead">Current supporters</h2>
      {loaded && rows.length === 0 && <p className="adminc__empty">No supporters yet.</p>}
      <ul className="adminc__list">
        {rows.map((r) => (
          <li key={r.profile_id} className="adminc__row">
            <div className="adminc__info">
              <span className={'adminc__badge adminc__badge--' + (r.tier === 'concierge' ? 'good' : 'service')}>
                {r.tier}
              </span>
              <span className="adminc__name">{r.member?.full_name || r.member?.email || 'Member'}</span>
              <span className="adminc__by">{r.source === 'gift' ? 'gifted' : 'paid'} · {r.status}</span>
            </div>
            <div className="adminc__actions">
              <button className="adminc__btn adminc__btn--reject" onClick={() => revoke(r.member?.email ?? null)}>
                Revoke
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
