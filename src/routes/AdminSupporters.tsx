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

// The chip and the email say the same thing: 1 month, 2 months… 1 year, 2 years.
const spanText = (m: number | null) =>
  m === null ? 'no end date'
    : m % 12 === 0 ? (m === 12 ? '1 year' : `${m / 12} years`)
    : m === 1 ? '1 month' : `${m} months`;

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
  const [myName, setMyName] = useState('');

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

  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
      .then(({ data }) => setMyName((data as { full_name: string | null } | null)?.full_name ?? ''));
  }, [user]);

  async function gift() {
    const em = email.trim();
    if (!em) return;
    setBusy(true); setMsg(''); setError('');
    const { error: e } = await supabase.rpc('gift_subscription', { p_email: em, p_tier: tier, p_months: months });
    setBusy(false);
    if (e) { setError(e.message); return; }
    void supabase.functions.invoke('send-gift-notice', {
      body: { email: em, inviterName: myName, tier, months },
    }).catch(console.warn);
    setMsg(`Gifted ${months ? spanText(months) + ' of ' : ''}${TIERS.find((t) => t.id === tier)?.label} to ${em}.`);
    setEmail('');
    load();
  }

  // Inline gift editing: re-gifting overwrites tier + end date server-side.
  const [editing, setEditing] = useState<string | null>(null);   // profile_id
  const [editTier, setEditTier] = useState<Tier>('community');
  const [editMonths, setEditMonths] = useState<number | null>(12);

  function startEdit(r: Row) {
    setEditing(r.profile_id);
    setEditTier(r.tier);
    // Prefill with time REMAINING; saving re-stamps end = now + months,
    // which lands within days of the current end date.
    setEditMonths(r.current_period_end
      ? Math.max(1, Math.round((new Date(r.current_period_end).getTime() - Date.now()) / (30.44 * 24 * 3600 * 1000)))
      : null);
    setMsg('');
  }

  async function saveEdit(r: Row) {
    const em = r.member?.email;
    if (!em) return;
    setBusy(true); setError('');
    // Same RPC as gifting — the upsert replaces tier + end date and rings
    // their bell with the new terms. No email echo for edits.
    const { error: e } = await supabase.rpc('gift_subscription', { p_email: em, p_tier: editTier, p_months: editMonths });
    setBusy(false);
    if (e) { setError(e.message); return; }
    setMsg(`Updated ${r.member?.full_name || em}: ${editMonths ? spanText(editMonths) + ' of ' : ''}${TIERS.find((t) => t.id === editTier)?.label}.`);
    setEditing(null);
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
          <div className={'adminc__gift-stepper' + (months === null ? ' is-off' : '')}>
            <button type="button" aria-label="Less time"
              disabled={months === null || months <= 1}
              onClick={() => setMonths((m) => Math.max(1, (m ?? 12) - 1))}>−</button>
            <span>{months === null ? '∞' : spanText(months)}</span>
            <button type="button" aria-label="More time"
              disabled={months === null || months >= 24}
              onClick={() => setMonths((m) => Math.min(24, (m ?? 0) + 1))}>+</button>
          </div>
          <button
            type="button"
            className={'adminc__tier-btn' + (months === null ? ' is-on' : '')}
            onClick={() => setMonths(months === null ? 12 : null)}
          >
            No end date
          </button>
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
                  <span className="adminc__by">{spanText(g.months)} · invited {new Date(g.created_at).toLocaleDateString()}</span>
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
              {r.source === 'gift' && (
                <button className="adminc__btn" onClick={() => (editing === r.profile_id ? setEditing(null) : startEdit(r))}>
                  {editing === r.profile_id ? 'Close' : 'Edit'}
                </button>
              )}
              <button className="adminc__btn adminc__btn--reject" onClick={() => revoke(r.member?.email ?? null)}>
                Revoke
              </button>
            </div>
            {editing === r.profile_id && (
              <div className="adminc__edit">
                <div className="adminc__gift-tiers">
                  {TIERS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={'adminc__tier-btn' + (editTier === t.id ? ' is-on' : '')}
                      onClick={() => setEditTier(t.id)}
                    >
                      {t.label} <span className="adminc__tier-price">{t.price}</span>
                    </button>
                  ))}
                </div>
                <div className="adminc__gift-tiers">
                  <div className={'adminc__gift-stepper' + (editMonths === null ? ' is-off' : '')}>
                    <button type="button" aria-label="Less time"
                      disabled={editMonths === null || editMonths <= 1}
                      onClick={() => setEditMonths((m) => Math.max(1, (m ?? 12) - 1))}>−</button>
                    <span>{editMonths === null ? '∞' : spanText(editMonths)}</span>
                    <button type="button" aria-label="More time"
                      disabled={editMonths === null || editMonths >= 24}
                      onClick={() => setEditMonths((m) => Math.min(24, (m ?? 0) + 1))}>+</button>
                  </div>
                  <button
                    type="button"
                    className={'adminc__tier-btn' + (editMonths === null ? ' is-on' : '')}
                    onClick={() => setEditMonths(editMonths === null ? 12 : null)}
                  >
                    No end date
                  </button>
                </div>
                <button className="adminc__btn adminc__btn--approve" disabled={busy} onClick={() => void saveEdit(r)}>
                  {busy ? '…' : 'Save changes'}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
