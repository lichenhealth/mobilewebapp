import { useState, useMemo, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import './CategoryPicker.css';

export type Category = {
  id: string;
  domain: 'good' | 'service' | 'place' | 'identity';
  name: string;
  sort: number;
  /** Two labeled worlds (founder 2026-07-28): the healing taxonomy in one
   *  place — ignorable if you're not a healer — everyday commerce in the
   *  other. Absent pre-migration → flat list. */
  section?: 'healing' | 'everyday' | null;
  /** Hierarchy (founder 2026-10-15: "clothing > shirts, clothing > shoes") —
   *  a child nests under its parent in the list; null/absent = a root. */
  parent_id?: string | null;
};

type Pending = { id: string; name: string };

type Props = {
  domain: 'good' | 'service' | 'place' | 'identity';
  categories: Category[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /** When provided, enables "suggest a new one" (routed to admin approval). */
  userId?: string;
  /** Narrow toggle, floating panel — for sitting 3-across on mobile (e.g.
   *  the marketplace filter row) instead of stacking full-width. */
  compact?: boolean;
  /** CARE AT THE TOP (founder 2026-10-19, the US-at-top country-select
   *  pattern — "we know they selected practitioner… bring Healthcare related
   *  goods and services to the top and highlight them in peach, then have
   *  all the other goods and services in alphabetical order"): healing-
   *  section families lead, peach-lit; everything else follows A→Z. Curate,
   *  never restrict — the accountant invited as a practitioner still
   *  declares, and search spans the whole vocabulary either way. */
  careFirst?: boolean;
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

export default function CategoryPicker({ domain, categories, selected, onChange, userId, compact, careFirst }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Compact mode floats its panel over the page rather than pushing layout
  // around — behave like a normal dropdown and close on an outside tap.
  useEffect(() => {
    if (!compact || !open) return;
    const onOutside = (e: Event) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('touchstart', onOutside);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('touchstart', onOutside);
    };
  }, [compact, open]);

  // Compact pickers sit narrow, side by side — two floating panels open at
  // once collide and run off the screen. Only one may be open at a time;
  // opening one broadcasts to close any other (scoped to compact so
  // Profile/Compose/Onboarding's stacked, full-width pickers are unaffected).
  useEffect(() => {
    if (!compact) return;
    const onOtherOpen = (e: Event) => {
      const openedDomain = (e as CustomEvent<{ domain: string }>).detail?.domain;
      if (openedDomain !== domain) setOpen(false);
    };
    document.addEventListener('lichen:cat-open', onOtherOpen);
    return () => document.removeEventListener('lichen:cat-open', onOtherOpen);
  }, [compact, domain]);

  function toggleOpen() {
    setOpen((o) => {
      const next = !o;
      if (compact && next) {
        document.dispatchEvent(new CustomEvent('lichen:cat-open', { detail: { domain } }));
      }
      return next;
    });
  }
  const [query, setQuery] = useState('');
  const [suggestName, setSuggestName] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');

  const noun = domain === 'good' ? 'goods' : domain === 'service' ? 'services'
    : domain === 'identity' ? 'identities' : 'places & spaces';
  const singular = domain === 'good' ? 'good' : domain === 'identity' ? 'identity' : 'service';

  const pool = useMemo(
    () => categories.filter((c) => c.domain === domain).sort((a, b) => a.name.localeCompare(b.name)),
    [categories, domain],
  );
  // The list is hierarchy-aware (founder 2026-10-15): roots in order, each
  // followed by its indented children. Searching keeps families honest — a
  // matching child surfaces WITH its parent for context, and a matching
  // parent shows its whole tree.
  type Row = { c: Category; child?: boolean };
  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const hit = (c: Category) => c.name.toLowerCase().includes(q);
    const kidsOf = (id: string) => pool.filter((c) => c.parent_id === id);
    const out: Row[] = [];
    for (const r of pool.filter((c) => !c.parent_id)) {
      const kids = kidsOf(r.id);
      if (!q) { out.push({ c: r }, ...kids.map((k) => ({ c: k, child: true }))); continue; }
      const kidHits = kids.filter(hit);
      if (hit(r)) out.push({ c: r }, ...kids.map((k) => ({ c: k, child: true })));
      else if (kidHits.length) out.push({ c: r }, ...kidHits.map((k) => ({ c: k, child: true })));
    }
    return out;
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
    setNotice('Sent for review — you’ll get a bell when it’s decided.');
  }

  return (
    <div className={'cat' + (compact ? ' cat--compact' : '')} ref={rootRef}>
      <button type="button" className="cat__toggle" onClick={toggleOpen}>
        <span className="cat__toggle-label">{chosen.length ? `${chosen.length} selected` : noun.charAt(0).toUpperCase() + noun.slice(1)}</span>
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
            {rows.length === 0 && <p className="cat__empty">No matches.</p>}
            {(() => {
              const row = ({ c, child }: Row, care = false) => {
                const on = selectedSet.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={'cat__item' + (on ? ' is-on' : '') + (child ? ' cat__item--child' : '') + (care ? ' cat__item--care' : '')}
                    onClick={() => toggle(c.id)}
                  >
                    <span className="cat__box">{on ? '\u2713' : ''}</span>
                    <span>{c.name}</span>
                  </button>
                );
              };
              // Children ride their ROOT's section \u2014 the split groups families whole.
              const everyday = rows.filter((r) => ((r.child ? pool.find((p) => p.id === r.c.parent_id) : r.c)?.section ?? 'everyday') !== 'healing');
              const healing = rows.filter((r) => ((r.child ? pool.find((p) => p.id === r.c.parent_id) : r.c)?.section ?? 'everyday') === 'healing');
              if (careFirst) {
                // CARE AT THE TOP (founder 2026-10-19 \u2014 the US-at-top
                // country-select pattern): healing leads, peach-lit; the
                // rest follows A\u2192Z by family. Search spans everything \u2014
                // the order holds even on filtered rows.
                const byName = (a: Row, b: Row) => a.c.name.localeCompare(b.c.name);
                const roots = everyday.filter((r) => !r.child).sort(byName);
                const alpha = roots.flatMap((rt) =>
                  [rt, ...everyday.filter((r) => r.child && r.c.parent_id === rt.c.id)]);
                // Safety: a child whose root didn't make the filtered list
                // still renders rather than silently vanishing.
                const seen = new Set(alpha.map((r) => r.c.id));
                const strays = everyday.filter((r) => !seen.has(r.c.id));
                return (
                  <>
                    {healing.length > 0 && <p className="cat__section cat__section--care">Care &amp; healing</p>}
                    {healing.map((r) => row(r, true))}
                    {(alpha.length > 0 || strays.length > 0) && (
                      <p className="cat__section">Everything else — A to Z</p>
                    )}
                    {alpha.map((r) => row(r))}
                    {strays.map((r) => row(r))}
                  </>
                );
              }
              if (!everyday.length || !healing.length) return rows.map((r) => row(r));
              return (
                <>
                  <p className="cat__section">Commerce</p>
                  {everyday.map((r) => row(r))}
                  <p className="cat__section">Healing</p>
                  {healing.map((r) => row(r))}
                </>
              );
            })()}
          </div>

          {userId && (
            <div className="cat__suggest">
              <p className="cat__suggest-lead">
                {domain === 'identity'
                  ? 'Don’t see yours? Suggest an identity to Lichen:'
                  : `Don’t see your ${singular}? Suggest one:`}
              </p>
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
