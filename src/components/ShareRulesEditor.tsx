import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { supabase } from '../lib/supabase';
import type { ShareLevel, ShareRule } from '../lib/calendarApi';

const LEVEL_LABELS: Record<ShareLevel, string> = {
  hidden: 'Nothing', busy: 'Busy times only', details: 'Full details',
};

interface RulePick { type: 'profile' | 'space'; id: string; name: string; label: string }
const KIND_LABEL: Record<string, string> = {
  group: 'Group', community: 'Community', organization: 'Organization', place: 'Place',
};

/** The audience-rules editor — one grammar for every calendar (the Lichen
 *  calendar and each imported one): an Everyone row + as many person/space
 *  rules as you like, most-specific-wins. `everyoneUnsetLabel` (imported
 *  calendars) adds a default option meaning "no everyone rule — follow my
 *  Lichen rules, busy at most". */
export default function ShareRulesEditor({
  me, rules, onChanged, everyoneUnsetLabel,
  onUpsert, onDeleteRule, onUnsetEveryone,
}: {
  me: string;
  rules: ShareRule[];
  onChanged: () => Promise<void> | void;
  everyoneUnsetLabel?: string;
  onUpsert: (
    audience: { type: 'everyone' } | { type: 'space'; spaceId: string } | { type: 'profile'; profileId: string },
    level: ShareLevel,
  ) => Promise<void>;
  onDeleteRule: (id: string) => Promise<void>;
  onUnsetEveryone?: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [pick, setPick] = useState<RulePick | null>(null);
  const [results, setResults] = useState<RulePick[]>([]);
  const [level, setLevel] = useState<ShareLevel>('details');
  const [error, setError] = useState('');

  const everyoneRule = rules.find((r) => r.audience_type === 'everyone');
  const specific = rules.filter((r) => r.audience_type !== 'everyone');

  // One smart search across members AND spaces, labeled by what they are.
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
    try { await fn(); await onChanged(); }
    catch (e) { setError((e as { message?: string } | null)?.message || 'Could not save.'); }
  };

  return (
    <div className="shre">
      {error && <p className="shre__error">{error}</p>}

      <div className="cset__row">
        <span className="cset__aud">Everyone</span>
        <select
          className="cset__select cset__select--grow"
          value={everyoneRule?.level ?? (everyoneUnsetLabel ? '' : 'busy')}
          onChange={(e) => act(async () => {
            if (e.target.value === '' && onUnsetEveryone) await onUnsetEveryone();
            else await onUpsert({ type: 'everyone' }, e.target.value as ShareLevel);
          })}
          aria-label="Everyone sees"
        >
          {everyoneUnsetLabel && <option value="">{everyoneUnsetLabel}</option>}
          {(Object.keys(LEVEL_LABELS) as ShareLevel[]).map((l) => (
            <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
          ))}
        </select>
      </div>

      {specific.map((r) => (
        <div className="cset__row" key={r.id}>
          <span className="cset__aud">
            {r.audience_type === 'space' ? (r.space?.name ?? 'A space') : (r.profile?.full_name || 'A member')}
          </span>
          <select
            className="cset__select cset__select--grow" value={r.level}
            onChange={(e) => act(() => onUpsert(
              r.audience_type === 'space'
                ? { type: 'space', spaceId: r.audience_space_id! }
                : { type: 'profile', profileId: r.audience_profile_id! },
              e.target.value as ShareLevel,
            ))}
            aria-label="Sees"
          >
            {(Object.keys(LEVEL_LABELS) as ShareLevel[]).map((l) => (
              <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
            ))}
          </select>
          <button className="cedit__remove" onClick={() => act(() => onDeleteRule(r.id))} aria-label="Remove">
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
        <select className="cset__select" value={level} onChange={(e) => setLevel(e.target.value as ShareLevel)} aria-label="Level">
          {(Object.keys(LEVEL_LABELS) as ShareLevel[]).map((l) => (
            <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
          ))}
        </select>
        <button
          className="cedit__add cedit__add--sm"
          onClick={() => act(async () => {
            if (!pick) return;
            await onUpsert(
              pick.type === 'space' ? { type: 'space', spaceId: pick.id } : { type: 'profile', profileId: pick.id },
              level,
            );
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
