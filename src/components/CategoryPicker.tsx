import { useState, useMemo, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import './CategoryPicker.css';

export type Category = {
  id: string;
  domain: 'good' | 'service' | 'place';
  name: string;
  sort: number;
  /** Two labeled worlds (founder 2026-07-28): the healing taxonomy in one
   *  place — ignorable if you're not a healer — everyday commerce in the
   *  other. Absent pre-migration → flat list. */
  section?: 'healing' | 'everyday' | null;
};

type Pending = { id: string; name: string };

type Props = {
  domain: 'good' | 'service' | 'place';
  categories: Category[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /** When provided, enables "suggest a new one" (routed to admin approval). */
  userId?: string;
};

/* --- tiny fuzzy match so we can nudge toward an existing category --- */
function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d[m][n];
}
function similarity(a: string, b: string): number {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.9;
  const maxLen = Math.max(x.length, y.length);
  return 1 - lev(x, y) / maxLen;
}

export default function CategoryPicker({ domain, categories, selected, onChange, userId }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [suggestName, setSuggestName] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');

  const noun = domain === 'good' ? 'goods' : domain === 'service' ? 'services' : 'places & spaces';
  const singular = domain === 'good' ? 'good' : 'service';

  const pool = useMemo(
    () => categories.filter((c) => c.domain === domain).sort((a, b) => a.name.localeCompare(b.name)),
    [categories, domain],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? pool.filter((c) => c.name.toLowerCase().includes(q)) : pool;
  }, [pool, query]);

  const selectedSet = new Set(selected);
  const chosen = pool.filter((c) => selectedSet.has(c.id));

  // load this member's already-pending suggestions for this domain
  useEffect(() => {
    if (!userId) return;
    let active = true;
    supabase
      .from('category_suggestions')
      .select('id, name')
      .eq('proposer_id', userId)
      .eq('domain', domain)
      .eq('status', 'pending')
      .then(({ data }) => {
        if (active && data) setPending(data as Pending[]);
      });
    return () => { active = false; };
  }, [userId, domain]);

  function toggle(id: string) {
    if (selectedSet.has(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  }

  // closest existing category to what they're typing (to avoid near-duplicates)
  const nearest = useMemo(() => {
    const t = suggestName.trim();
    if (t.length < 2) return null;
    let best: { cat: Category; score: number } | null = null;
    for (const c of pool) {
      const score = similarity(t, c.name);
      if (!best || score > best.score) best = { cat: c, score };
    }
    return best && best.score >= 0.6 ? best : null;
  }, [suggestName, pool]);

  const exactExists = useMemo(
    () => pool.find((c) => norm(c.name) === norm(suggestName)),
    [pool, suggestName],
  );

  async function submitSuggestion() {
    const name = suggestName.trim();
    if (!name || !userId) return;
    setNotice('');
    // if it already exists, just select it instead of creating a duplicate
    if (exactExists) {
      if (!selectedSet.has(exactExists.id)) toggle(exactExists.id);
      setSuggestName('');
      setNotice(`“${exactExists.name}” already exists — selected it for you.`);
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase
      .from('category_suggestions')
      .insert({ proposer_id: userId, domain, name })
      .select('id, name')
      .single();
    setSubmitting(false);
    if (error) {
      setNotice('Could not send that just now — please try again.');
      return;
    }
    setPending((p) => [...p, data as Pending]);
    setSuggestName('');
    setNotice('Sent for review — it’ll appear on your profile once approved.');
  }

  return (
    <div className="cat">
      <button type="button" className="cat__toggle" onClick={() => setOpen((o) => !o)}>
        <span>{chosen.length ? `${chosen.length} selected` : noun.charAt(0).toUpperCase() + noun.slice(1)}</span>
        <span className="cat__chev">{open ? '\u25B2' : '\u25BC'}</span>
      </button>

      {(chosen.length > 0 || pending.length > 0) && (
        <div className="cat__chips">
          {chosen.map((c) => (
            <button key={c.id} type="button" className="cat__chip" onClick={() => toggle(c.id)}>
              {c.name} <span className="cat__chip-x">{'\u00D7'}</span>
            </button>
          ))}
          {pending.map((p) => (
            <span key={p.id} className="cat__chip is-pending" title="Awaiting approval">
              {p.name} <span className="cat__pending-tag">pending</span>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="cat__panel">
          <input
            className="cat__search"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${noun}\u2026`}
            autoFocus
          />
          <div className="cat__list">
            {filtered.length === 0 && <p className="cat__empty">No matches.</p>}
            {(() => {
              const row = (c: Category) => {
                const on = selectedSet.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={'cat__item' + (on ? ' is-on' : '')}
                    onClick={() => toggle(c.id)}
                  >
                    <span className="cat__box">{on ? '\u2713' : ''}</span>
                    <span>{c.name}</span>
                  </button>
                );
              };
              const everyday = filtered.filter((c) => (c.section ?? 'everyday') !== 'healing');
              const healing = filtered.filter((c) => c.section === 'healing');
              if (!everyday.length || !healing.length) return filtered.map(row);
              return (
                <>
                  <p className="cat__section">Everyday</p>
                  {everyday.map(row)}
                  <p className="cat__section">Healing &amp; wellness</p>
                  {healing.map(row)}
                </>
              );
            })()}
          </div>

          {userId && (
            <div className="cat__suggest">
              <p className="cat__suggest-lead">Don’t see your {singular}? Suggest one:</p>
              <div className="cat__suggest-row">
                <input
                  className="cat__search"
                  type="text"
                  value={suggestName}
                  onChange={(e) => { setSuggestName(e.target.value); setNotice(''); }}
                  placeholder={`Add a ${singular}\u2026`}
                />
                <button
                  type="button"
                  className="cat__suggest-btn"
                  onClick={submitSuggestion}
                  disabled={submitting || suggestName.trim().length < 2}
                >
                  {submitting ? '\u2026' : 'Submit'}
                </button>
              </div>

              {nearest && !exactExists && (
                <p className="cat__hint">
                  Similar to <strong>{nearest.cat.name}</strong> —{' '}
                  <button
                    type="button"
                    className="cat__hint-link"
                    onClick={() => {
                      if (!selectedSet.has(nearest.cat.id)) toggle(nearest.cat.id);
                      setSuggestName('');
                    }}
                  >
                    use that instead?
                  </button>
                </p>
              )}
              {notice && <p className="cat__notice">{notice}</p>}
            </div>
          )}

          <button type="button" className="cat__done" onClick={() => setOpen(false)}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}
