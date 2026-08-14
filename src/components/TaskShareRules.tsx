import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { supabase } from '../lib/supabase';
import {
  loadMyTaskShares, upsertTaskShare, deleteTaskShare,
  type TaskLevel, type TaskShareRule,
} from '../lib/tasksApi';

const LEVEL_LABELS: Record<TaskLevel, string> = { hidden: 'Hidden', see: 'Can see my list' };
const KIND_LABEL: Record<string, string> = {
  group: 'Group', community: 'Community', organization: 'Organization', place: 'Place',
};
interface RulePick { type: 'profile' | 'space'; id: string; name: string; label: string }

/** Who may see your tasks (founder 2026-08-14) — ShareRulesEditor's grammar
 *  with task levels and a standing MY-CELIUM row: Everyone and your web up
 *  top, then person/space rules, most-specific-wins, exclude = a specific
 *  rule set to Hidden. Default (no rules at all): hidden — a task list is
 *  undone work, and it stays yours until you open it. */
export default function TaskShareRules({ me }: { me: string }) {
  const [rules, setRules] = useState<TaskShareRule[]>([]);
  const [query, setQuery] = useState('');
  const [pick, setPick] = useState<RulePick | null>(null);
  const [results, setResults] = useState<RulePick[]>([]);
  const [level, setLevel] = useState<TaskLevel>('see');
  const [error, setError] = useState('');

  const reload = async () => setRules(await loadMyTaskShares(me));
  useEffect(() => { if (me) void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [me]);

  const everyoneRule = rules.find((r) => r.audience_type === 'everyone');
  const myceliumRule = rules.find((r) => r.audience_type === 'mycelium');
  const specific = rules.filter((r) => r.audience_type === 'space' || r.audience_type === 'profile');

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || pick) { setResults([]); return; }
    let live = true;
    const t = window.setTimeout(async () => {
      const [mem, sp] = await Promise.all([
        supabase.from('profiles').select('id, full_name').ilike('full_name', `%${q}%`).neq('id', me).limit(4),
        supabase.from('spaces').select('id, name, kind').ilike('name', `%${q}%`).limit(4),
      ]);
      if (!live) return;
      setResults([
        ...(((mem.data as { id: string; full_name: string | null }[] | null) ?? [])
          .map((m) => ({ type: 'profile' as const, id: m.id, name: m.full_name ?? 'Member', label: 'Member' }))),
        ...(((sp.data as { id: string; name: string; kind: string }[] | null) ?? [])
          .map((s) => ({ type: 'space' as const, id: s.id, name: s.name, label: KIND_LABEL[s.kind] ?? 'Group' }))),
      ]);
    }, 250);
    return () => { live = false; window.clearTimeout(t); };
  }, [query, pick, me]);

  const act = async (fn: () => Promise<void>) => {
    setError('');
    try { await fn(); await reload(); }
    catch (e) { setError((e as { message?: string } | null)?.message || 'Could not save.'); }
  };

  const standingRow = (label: string, type: 'everyone' | 'mycelium', rule?: TaskShareRule) => (
    <div className="cset__row">
      <span className="cset__aud">{label}</span>
      <select
        className="cset__select cset__select--grow"
        value={rule?.level ?? 'hidden'}
        onChange={(e) => act(() => upsertTaskShare(me, { type }, e.target.value as TaskLevel))}
        aria-label={`${label} sees`}
      >
        {(Object.keys(LEVEL_LABELS) as TaskLevel[]).map((l) => (
          <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="shre">
      {error && <p className="shre__error">{error}</p>}
      {standingRow('Everyone', 'everyone', everyoneRule)}
      {standingRow('My-celium (your web)', 'mycelium', myceliumRule)}
      {specific.map((r) => (
        <div className="cset__row" key={r.id}>
          <span className="cset__aud">
            {r.audience_type === 'space' ? (r.space?.name ?? 'A space') : (r.profile?.full_name || 'A member')}
          </span>
          <select
            className="cset__select cset__select--grow" value={r.level}
            onChange={(e) => act(() => upsertTaskShare(
              me,
              r.audience_type === 'space'
                ? { type: 'space', id: r.audience_space_id! }
                : { type: 'profile', id: r.audience_profile_id! },
              e.target.value as TaskLevel,
            ))}
            aria-label="Sees"
          >
            {(Object.keys(LEVEL_LABELS) as TaskLevel[]).map((l) => (
              <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
            ))}
          </select>
          <button className="cedit__remove" onClick={() => act(() => deleteTaskShare(r.id))} aria-label="Remove">
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
      <div className="cset__add cset__add--wrap">
        {pick ? (
          <button className="calp__invitee" onClick={() => { setPick(null); setQuery(''); }}>
            {pick.name} <span className="cset__kind">{pick.label}</span> ×
          </button>
        ) : (
          <input
            className="cedit__input cset__grow"
            placeholder="Search Members, Groups/Communities, Organizations and/or Places…"
            value={query} onChange={(e) => setQuery(e.target.value)}
          />
        )}
        <select className="cset__select" value={level} onChange={(e) => setLevel(e.target.value as TaskLevel)} aria-label="Level">
          {(Object.keys(LEVEL_LABELS) as TaskLevel[]).map((l) => (
            <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
          ))}
        </select>
        <button
          className="cedit__add cedit__add--sm"
          onClick={() => act(async () => {
            if (!pick) return;
            await upsertTaskShare(me, { type: pick.type, id: pick.id }, level);
            setPick(null); setQuery('');
          })}
        >
          <Icon name="plus" size={12} /> Add rule
        </button>
      </div>
      {results.map((r) => (
        <button className="calp__match" key={r.type + r.id} onClick={() => { setPick(r); setQuery(''); }}>
          {r.name} <span className="cset__kind">{r.label}</span>
        </button>
      ))}
    </div>
  );
}
