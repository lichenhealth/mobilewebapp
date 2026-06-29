import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import './AdminCategories.css';

type Suggestion = {
  id: string;
  domain: 'good' | 'service';
  name: string;
  created_at: string;
  proposer: { full_name: string | null } | null;
};

export default function AdminCategories() {
  const { loading, user, isAdmin } = useAuth();
  const [items, setItems] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('category_suggestions')
      .select('id, domain, name, created_at, proposer:profiles!category_suggestions_proposer_id_fkey(full_name)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) setError(error.message);
    else setItems((data as unknown as Suggestion[]) ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  async function decide(id: string, approve: boolean) {
    setBusy(id);
    setError('');
    const fn = approve ? 'approve_category_suggestion' : 'reject_category_suggestion';
    const { error } = await supabase.rpc(fn, { p_suggestion_id: id });
    setBusy(null);
    if (error) { setError(error.message); return; }
    setItems((list) => list.filter((s) => s.id !== id));
  }

  if (loading) return <div className="adminc"><p className="adminc__muted">Loading…</p></div>;
  if (!user || !isAdmin) return <Navigate to="/home" replace />;

  return (
    <div className="adminc">
      <header className="adminc__head">
        <h1 className="adminc__title">Category suggestions</h1>
        <p className="adminc__sub">
          Members proposed these. Approving adds it to the taxonomy and to their profile.
        </p>
      </header>

      {error && <p className="adminc__error">{error}</p>}

      {loaded && items.length === 0 && (
        <p className="adminc__empty">Nothing waiting for review. 🌿</p>
      )}

      <ul className="adminc__list">
        {items.map((s) => (
          <li key={s.id} className="adminc__row">
            <div className="adminc__info">
              <span className={'adminc__badge adminc__badge--' + s.domain}>{s.domain}</span>
              <span className="adminc__name">{s.name}</span>
              <span className="adminc__by">
                {s.proposer?.full_name ? `by ${s.proposer.full_name}` : 'by a member'}
              </span>
            </div>
            <div className="adminc__actions">
              <button
                className="adminc__btn adminc__btn--approve"
                onClick={() => decide(s.id, true)}
                disabled={busy === s.id}
              >
                {busy === s.id ? '…' : 'Approve'}
              </button>
              <button
                className="adminc__btn adminc__btn--reject"
                onClick={() => decide(s.id, false)}
                disabled={busy === s.id}
              >
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
