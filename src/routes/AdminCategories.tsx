import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import './AdminCategories.css';

type Suggestion = {
  id: string;
  domain: 'good' | 'service' | 'place' | 'identity';
  name: string;
  created_at: string;
  proposer: { full_name: string | null } | null;
};

const DOMAINS = ['good', 'service', 'place', 'identity'] as const;
type Domain = (typeof DOMAINS)[number];

export default function AdminCategories() {
  const { loading, user, isAdmin } = useAuth();
  const [items, setItems] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  // Approve into the right domain(s) (founder 2026-08-20): "Beekeeper" typed
  // as an identity may honestly also be a service. Defaults to the domain it
  // was suggested in; the reviewer widens or moves it before approving.
  const [approveDomains, setApproveDomains] = useState<Record<string, Domain[]>>({});
  const [mapping, setMapping] = useState<string | null>(null);
  const [mapQ, setMapQ] = useState('');
  const [allCats, setAllCats] = useState<{ id: string; name: string; domain: string }[]>([]);

  useEffect(() => {
    void supabase.from('categories').select('id, name, domain').order('name')
      .then(({ data }) => setAllCats((data as { id: string; name: string; domain: string }[] | null) ?? []));
  }, []);

  /** Answer a suggestion by mapping it onto a category that already exists. */
  async function mapTo(suggestionId: string, categoryId: string) {
    setBusy(suggestionId); setError('');
    const { error } = await supabase.rpc('alias_category_suggestion', {
      p_suggestion: suggestionId, p_category: categoryId,
    });
    setBusy(null);
    if (error) { setError(error.message); return; }
    setMapping(null); setMapQ('');
    setItems((list) => list.filter((x) => x.id !== suggestionId));
  }
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
    const chosen = approveDomains[id];
    const { error } = approve
      ? await supabase.rpc('approve_category_suggestion', {
          p_suggestion_id: id,
          // Only sent when the reviewer changed it — null keeps the RPC's
          // "as suggested" default.
          p_domains: chosen && chosen.length ? chosen : null,
        })
      : await supabase.rpc('reject_category_suggestion', { p_suggestion_id: id });
    setBusy(null);
    if (error) { setError(error.message); return; }
    setItems((list) => list.filter((s) => s.id !== id));
  }

  function toggleDomain(s: Suggestion, d: Domain) {
    setApproveDomains((m) => {
      const cur = m[s.id] ?? [s.domain];
      const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d];
      // Never empty — approving into no world is not a choice.
      return { ...m, [s.id]: next.length ? next : cur };
    });
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
              {/* MAPPING IS THE DEFAULT ANSWER (founder 2026-08-06). Every new
                  category makes the picker longer and search less precise;
                  an alias lets them use their own word while the filter list
                  stays short. Minting a new one is the deliberate exception. */}
              <button
                className="adminc__btn adminc__btn--approve"
                onClick={() => setMapping(mapping === s.id ? null : s.id)}
                disabled={busy === s.id}
              >
                Same as…
              </button>
              <button
                className="adminc__btn"
                onClick={() => decide(s.id, true)}
                disabled={busy === s.id}
              >
                {busy === s.id ? '…' : 'New category'}
              </button>
              <button
                className="adminc__btn adminc__btn--reject"
                onClick={() => decide(s.id, false)}
                disabled={busy === s.id}
              >
                Reject
              </button>
            </div>
            {/* The same word can live in more than one world — "Beekeeper"
                typed as an identity may also be a service (founder
                2026-08-20). "New category" lands it in exactly the checked
                worlds; identity → the proposer's identity tags, provider
                domains → their offerings. */}
            <div className="adminc__domains">
              <span className="adminc__domains-lead">Approve as</span>
              {DOMAINS.map((d) => {
                const on = (approveDomains[s.id] ?? [s.domain]).includes(d);
                return (
                  <button key={d} type="button"
                    className={'adminc__domain' + (on ? ' is-on' : '')}
                    onClick={() => toggleDomain(s, d)} disabled={busy === s.id}>
                    {on ? '✓ ' : ''}{d}
                  </button>
                );
              })}
            </div>
            {mapping === s.id && (
              <div className="adminc__map">
                <input
                  className="adminc__map-q"
                  autoFocus
                  value={mapQ}
                  placeholder="Which existing category is this?"
                  onChange={(e) => setMapQ(e.target.value)}
                />
                <div className="adminc__map-hits">
                  {allCats
                    .filter((c) => c.domain === s.domain
                      && c.name.toLowerCase().includes(mapQ.trim().toLowerCase()))
                    .slice(0, 6)
                    .map((c) => (
                      <button className="adminc__map-hit" key={c.id}
                        onClick={() => void mapTo(s.id, c.id)}>
                        {c.name}
                      </button>
                    ))}
                </div>
                <p className="adminc__map-note">
                  &ldquo;{s.name}&rdquo; becomes another word for it — searches for either
                  find the same people, and the filter list doesn&rsquo;t grow.
                </p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
