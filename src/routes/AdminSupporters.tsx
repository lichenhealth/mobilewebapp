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
  current_period_end: string | null;
  member: { full_name: string | null; email: string | null } | null;
};

// Flat shape returned by the admin_list_supporters() RPC.
type SupporterRow = {
  profile_id: string;
  tier: string;
  source: string;
  status: string;
  full_name: string | null;
  email: string | null;
  current_period_end: string | null;
};

// A gift riding an invitation, waiting for that email to sign up.
type PendingGift = { id: string; invitee_email: string; tier: Tier; months: number | null; created_at: string };

// null = no end date. Shared vocabulary with the Invite screen's gift block.
const GIFT_SPANS: { months: number | null; label: string }[] = [
  { months: 3, label: '3 months' },
  { months: 6, label: '6 months' },
  { months: 12, label: '1 year' },
  { months: null, label: 'No end date' },
];
const spanLabel = (m: number | null) =>
  GIFT_SPANS.find((sp) => sp.months === m)?.label ?? `${m} months`;

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
  const [months, setMonths] = useState<number | null>(12);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const [pending, setPending] = useState<PendingGift[]>([]);

  const load = useCallback(async () => {
    // Admin-only RPC: returns supporters with member name + email. Regular
    // members can no longer read emails via a direct table query.
    const { data: pg } = await supabase
      .from('membership_gifts')
      .select('id, invitee_email, tier, months, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    setPending(((pg as PendingGift[] | null) ?? []));
    const { data, error: e } = await supabase.rpc('admin_list_supporters');
    if (e) setError(e.message);
    else setRows(((data as SupporterRow[] | null) ?? []).map((d) => ({
      profile_id: d.profile_id,
      tier: d.tier as Tier,
      source: d.source as 'gift' | 'stripe',
      status: d.status,
      current_period_end: d.current_period_end,
      member: { full_name: d.full_name, email: d.email },
    })));
    setLoaded(true);
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  async function gift() {
    const em = email.trim();
    if (!em) return;
    setBusy(true); setMsg(''); setError('');
    const { error: e } = await supabase.rpc('gift_subscription', { p_email: em, p_tier: tier, p_months: months });
    setBusy(false);
    if (e) { setError(e.message); return; }
    setMsg(`Gifted ${months ? spanLabel(months) + ' of ' : ''}${TIERS.find((t) => t.id === tier)?.label} to ${em}.`);
    setEmail('');
    load();
  }

  async function cancelGift(id: string) {
    setError('');
    const { error: e } = await supabase.from('membership_gifts').delete().eq('id', id);
    if (e) setError(e.message); else load();
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
        <div className="adminc__gift-tiers">
          {GIFT_SPANS.map((sp) => (
            <button
              key={String(sp.months)}
              type="button"
              className={'adminc__tier-btn' + (months === sp.months ? ' is-on' : '')}
              onClick={() => setMonths(sp.months)}
            >
              {sp.label}
            </button>
          ))}
        </div>
        <button className="adminc__btn adminc__btn--approve" onClick={gift} disabled={busy || !email.trim()}>
          {busy ? '…' : 'Gift access'}
        </button>
      </div>
      {msg && <p className="adminc__msg">{msg}</p>}

      {pending.length > 0 && (
        <>
          <h2 className="adminc__subhead">Waiting to sign up</h2>
          <ul className="adminc__list">
            {pending.map((g) => (
              <li key={g.id} className="adminc__row">
                <div className="adminc__info">
                  <span className={'adminc__badge adminc__badge--' + (g.tier === 'concierge' ? 'good' : 'service')}>
                    {g.tier}
                  </span>
                  <span className="adminc__name">{g.invitee_email}</span>
                  <span className="adminc__by">{spanLabel(g.months)} · invited {new Date(g.created_at).toLocaleDateString()}</span>
                </div>
                <div className="adminc__actions">
                  <button className="adminc__btn adminc__btn--reject" onClick={() => cancelGift(g.id)}>
                    Cancel
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

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
              <span className="adminc__by">
                {r.source === 'gift' ? 'gifted' : 'paid'} · {r.status}
                {r.source === 'gift' && r.current_period_end
                  ? (new Date(r.current_period_end) > new Date()
                      ? ` · through ${new Date(r.current_period_end).toLocaleDateString()}`
                      : ` · ended ${new Date(r.current_period_end).toLocaleDateString()}`)
                  : ''}
              </span>
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
