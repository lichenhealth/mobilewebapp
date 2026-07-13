import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import LocationField from './LocationField';
import { supabase } from '../lib/supabase';
import type { GeoPoint } from '../lib/geoApi';
import {
  loadMyHome, saveMyHome, loadMyLocationShares, upsertLocationShare, deleteLocationShare,
  type LocationLevel, type LocationShareRule,
} from '../lib/locationApi';
import './HomeLocationSection.css';

const LEVEL_LABELS: Record<LocationLevel, string> = {
  hidden: 'Hidden',
  area: 'Town-level',
  exact: 'Exact address',
};

interface RulePick { type: 'profile' | 'space'; id: string; name: string; label: string }

/** Home location + "Who can find you on the map" (founder privacy model).
 *  Default is HIDDEN — adding an address shows it to nobody until rules say
 *  otherwise. An exclude is a specific rule set to Hidden: rules for a person
 *  beat rules for a group; at a tie, the more private rule wins. */
export default function HomeLocationSection({ me }: { me: string }) {
  const [location, setLocation] = useState('');
  const [geo, setGeo] = useState<GeoPoint | null>(null);
  const [area, setArea] = useState('');
  const [rules, setRules] = useState<LocationShareRule[]>([]);
  const [members, setMembers] = useState<{ id: string; full_name: string | null }[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // add-rule form (CalendarSettings audience type-ahead pattern)
  const [rQuery, setRQuery] = useState('');
  const [rPick, setRPick] = useState<RulePick | null>(null);
  const [rResults, setRResults] = useState<RulePick[]>([]);
  const [rLevel, setRLevel] = useState<LocationLevel>('area');

  useEffect(() => {
    if (!me) return;
    let live = true;
    (async () => {
      const [home, myRules, memRes] = await Promise.all([
        loadMyHome(),
        loadMyLocationShares(me),
        supabase.from('profiles').select('id, full_name').neq('id', me).order('full_name').limit(500),
      ]);
      if (!live) return;
      setLocation(home.location); setGeo(home.geo); setArea(home.area);
      setRules(myRules);
      setMembers((memRes.data as { id: string; full_name: string | null }[] | null) ?? []);
    })();
    return () => { live = false; };
  }, [me]);

  useEffect(() => {
    const q = rQuery.trim();
    if (q.length < 2 || rPick) { setRResults([]); return; }
    let live = true;
    (async () => {
      const { data } = await supabase.from('spaces').select('id, name, kind').ilike('name', `%${q}%`).limit(5);
      if (!live) return;
      const spaceHits = ((data as { id: string; name: string; kind: string }[] | null) ?? []).map((s) => ({
        type: 'space' as const, id: s.id, name: s.name,
        label: s.kind === 'community' ? 'Community' : s.kind === 'organization' ? 'Organization' : s.kind === 'place' ? 'Place' : 'Group',
      }));
      const memberHits = members
        .filter((m) => (m.full_name ?? '').toLowerCase().includes(q.toLowerCase()))
        .slice(0, 5)
        .map((m) => ({ type: 'profile' as const, id: m.id, name: m.full_name || 'Member', label: 'Member' }));
      setRResults([...memberHits, ...spaceHits]);
    })();
    return () => { live = false; };
  }, [rQuery, rPick, members]);

  const everyoneLevel: LocationLevel =
    (rules.find((r) => r.audience_type === 'everyone')?.level) ?? 'hidden';
  const specificRules = rules.filter((r) => r.audience_type !== 'everyone');

  async function reloadRules() { setRules(await loadMyLocationShares(me)); }

  async function act(fn: () => Promise<void>) {
    setError('');
    try { await fn(); await reloadRules(); } catch (e) { setError((e as Error)?.message || 'Something went wrong.'); }
  }

  async function saveHome() {
    setSaving(true); setMsg(''); setError('');
    try {
      await saveMyHome(me, { location, geo, area });
      setMsg('Saved');
      setTimeout(() => setMsg(''), 2000);
    } catch (e) {
      setError((e as Error)?.message || 'Could not save. Please try again.');
    }
    setSaving(false);
  }

  return (
    <section className="prof__section">
      <h2 className="prof__h2">Home location</h2>
      <div className="prof__field">
        <LocationField
          className="prof__input"
          value={location}
          geo={geo}
          onChange={(text, g, suggestion) => {
            setLocation(text);
            setGeo(g);
            setArea(g && suggestion?.areaLabel ? suggestion.areaLabel : '');
          }}
          placeholder="Your home address or town"
        />
        <p className="prof__hint">
          Pick a suggestion to be findable on Maps. Hidden by default — choose who can see it below.
        </p>
      </div>
      <div className="prof__save-row">
        <button className="btn btn-primary" onClick={saveHome} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {msg && <span className="prof__msg">{msg}</span>}
      </div>

      <h3 className="homeloc__h3">Who can find you on the map</h3>
      <p className="prof__care-lead">
        Town-level shows you near {area || 'your town'} without your address. Rules for a person beat
        rules for a group; at a tie, the more private rule wins — so a person set to Hidden stays
        hidden no matter what.
      </p>
      {error && <p className="prof__error">{error}</p>}

      <div className="homeloc__row">
        <span className="homeloc__aud">Everyone</span>
        <select
          className="homeloc__select"
          value={everyoneLevel}
          onChange={(e) => act(() => upsertLocationShare(me, { type: 'everyone' }, e.target.value as LocationLevel))}
          aria-label="Everyone sees"
        >
          {(Object.keys(LEVEL_LABELS) as LocationLevel[]).map((l) => (
            <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
          ))}
        </select>
      </div>

      {specificRules.map((r) => (
        <div className="homeloc__row" key={r.id}>
          <span className="homeloc__aud">
            {r.audience_type === 'space' ? (r.space?.name ?? 'A group') : (r.profile?.full_name ?? 'A member')}
          </span>
          <select
            className="homeloc__select"
            value={r.level}
            onChange={(e) => act(() =>
              upsertLocationShare(
                me,
                r.audience_type === 'space'
                  ? { type: 'space', spaceId: r.audience_space_id! }
                  : { type: 'profile', profileId: r.audience_profile_id! },
                e.target.value as LocationLevel,
              ))}
            aria-label={`Level for this audience`}
          >
            {(Object.keys(LEVEL_LABELS) as LocationLevel[]).map((l) => (
              <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
            ))}
          </select>
          <button className="homeloc__remove" onClick={() => act(() => deleteLocationShare(r.id))} aria-label="Remove rule">
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}

      <div className="homeloc__add">
        {rPick ? (
          <span className="homeloc__pick">
            {rPick.name} <em>{rPick.label}</em>
            <button className="homeloc__remove" onClick={() => { setRPick(null); setRQuery(''); }} aria-label="Clear">
              <Icon name="close" size={12} />
            </button>
          </span>
        ) : (
          <input
            className="prof__input homeloc__grow"
            value={rQuery}
            onChange={(e) => setRQuery(e.target.value)}
            placeholder="A person, group, community…"
          />
        )}
        <select className="homeloc__select" value={rLevel} onChange={(e) => setRLevel(e.target.value as LocationLevel)} aria-label="Level">
          {(Object.keys(LEVEL_LABELS) as LocationLevel[]).map((l) => (
            <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
          ))}
        </select>
        <button
          className="btn btn-primary homeloc__add-btn"
          disabled={!rPick}
          onClick={() => {
            if (!rPick) return;
            void act(() => upsertLocationShare(
              me,
              rPick.type === 'space' ? { type: 'space', spaceId: rPick.id } : { type: 'profile', profileId: rPick.id },
              rLevel,
            ));
            setRPick(null); setRQuery('');
          }}
        >
          Add
        </button>
      </div>
      {rResults.length > 0 && (
        <div className="homeloc__matches">
          {rResults.map((r) => (
            <button key={r.type + r.id} className="homeloc__match" onClick={() => { setRPick(r); setRResults([]); }}>
              {r.name} <em>{r.label}</em>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
