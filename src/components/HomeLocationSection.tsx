import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import LocationField from './LocationField';
import { supabase } from '../lib/supabase';
import type { GeoPoint } from '../lib/geoApi';
import {
  loadMyHome, saveMyHome, loadMyLocationShares, upsertLocationShare, deleteLocationShare,
  areaLabel,
  type LocationLevel, type LocationShareRule,
} from '../lib/locationApi';
import './HomeLocationSection.css';

const LEVEL_LABELS: Record<LocationLevel, string> = {
  hidden: 'Hidden',
  state: 'State only',
  county: 'County',
  area: 'Town',
  exact: 'Exact address',
};

interface RulePick { type: 'profile' | 'space'; id: string; name: string; label: string }

type ProfileLocation = {
  id: string; label: string; location: string; lat: number | null; lng: number | null;
  show_on_maps: boolean; show_on_profile: boolean;
};

/** The Location section's content (founder 2026-08-11: "Have Home Location
 *  just be Location and make it a drop down"): the caller supplies the
 *  CollapsibleSection chrome. Two kinds of address live here —
 *  · Home address: hidden by default, revealed per-audience through the
 *    location_shares ladder ("Who can find you on the map").
 *  · Goods & Services addresses: as many as you need — the studio, the farm
 *    stand — deliberately member-visible, because their point is being found. */
export default function HomeLocationSection({ me }: { me: string }) {
  const [location, setLocation] = useState('');
  const [geo, setGeo] = useState<GeoPoint | null>(null);
  const [area, setArea] = useState('');
  const [county, setCounty] = useState('');
  const [homeState, setHomeState] = useState('');
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

  // Goods & Services addresses — more than one location (founder 2026-08-11).
  const [bizLocs, setBizLocs] = useState<ProfileLocation[]>([]);
  const [bizLabel, setBizLabel] = useState('');
  const [bizText, setBizText] = useState('');
  const [bizGeo, setBizGeo] = useState<GeoPoint | null>(null);
  const [bizBusy, setBizBusy] = useState(false);

  async function loadBizLocs() {
    const { data } = await supabase.from('profile_locations')
      .select('id, label, location, lat, lng, show_on_maps, show_on_profile')
      .eq('profile_id', me).order('created_at');
    setBizLocs((data as ProfileLocation[] | null) ?? []);
  }

  async function toggleBizLoc(id: string, field: 'show_on_maps' | 'show_on_profile', on: boolean) {
    setError('');
    setBizLocs((cur) => cur.map((b) => (b.id === id ? { ...b, [field]: on } : b)));
    const { error: e } = await supabase.from('profile_locations').update({ [field]: on }).eq('id', id);
    if (e) { setError(e.message); await loadBizLocs(); }
  }

  async function addBizLoc() {
    if (!bizText.trim()) return;
    setBizBusy(true); setError('');
    const { error: e } = await supabase.from('profile_locations').insert({
      profile_id: me, label: bizLabel.trim(), location: bizText.trim(),
      lat: bizGeo?.lat ?? null, lng: bizGeo?.lng ?? null,
    });
    if (e) setError(e.message);
    else { setBizLabel(''); setBizText(''); setBizGeo(null); await loadBizLocs(); }
    setBizBusy(false);
  }

  async function removeBizLoc(id: string) {
    setError('');
    const { error: e } = await supabase.from('profile_locations').delete().eq('id', id);
    if (e) setError(e.message); else await loadBizLocs();
  }

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
      setCounty(home.county); setHomeState(home.state);
      setRules(myRules);
      setMembers((memRes.data as { id: string; full_name: string | null }[] | null) ?? []);
      void loadBizLocs();
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      await saveMyHome(me, { location, geo, area, county, state: homeState });
      setMsg('Saved');
      setTimeout(() => setMsg(''), 2000);
    } catch (e) {
      setError((e as Error)?.message || 'Could not save. Please try again.');
    }
    setSaving(false);
  }

  return (
    <>
      <p className="prof__privacy-sub">Home address</p>
      <div className="prof__field">
        <LocationField
          className="prof__input"
          value={location}
          geo={geo}
          onChange={(text, g, suggestion) => {
            setLocation(text);
            setGeo(g);
            setArea(g && suggestion?.areaLabel ? suggestion.areaLabel : '');
            setCounty(g && suggestion?.countyLabel ? suggestion.countyLabel : '');
            setHomeState(g && suggestion?.stateLabel ? suggestion.stateLabel : '');
          }}
          placeholder="Your home address or town"
        />
        <p className="prof__hint">
          Pick a suggestion to be findable on Maps. Hidden by default — choose who can see it below.
        </p>
      </div>
      <h3 className="homeloc__h3">Who can find you on the map</h3>
      <p className="prof__care-lead">
        Town shows you as {area ? (areaLabel(area) ?? 'your town') : 'your town'}; county and state zoom further out; nothing shows your address but Exact. Rules for a person beat
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

      {/* Save sits after the privacy rules so the flow reads: address →
          choose who can see it → save. (Rules themselves apply instantly.) */}
      <div className="prof__save-row homeloc__save">
        <button className="btn btn-primary" onClick={saveHome} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {msg && <span className="prof__msg">{msg}</span>}
      </div>

      {/* Goods & Services addresses (founder 2026-08-11): as many as you
          need. Unlike home these are member-visible by design — the studio
          or farm stand exists to be found. Adds and removes apply
          instantly, like the map rules above. */}
      <p className="prof__privacy-sub">Goods &amp; Services addresses</p>
      <p className="prof__care-lead">
        Where you offer what you make and do — a studio, a stand, a workshop.
        Add as many as you need; other members can see these.
      </p>
      {bizLocs.map((b) => (
        <div className="homeloc__biz" key={b.id}>
          <div className="homeloc__row">
            <span className="homeloc__aud">
              {b.label ? <strong>{b.label} · </strong> : null}{b.location}
            </span>
            <button className="homeloc__remove" onClick={() => void removeBizLoc(b.id)} aria-label="Remove this address">
              <Icon name="close" size={13} />
            </button>
          </div>
          {/* Each address decides where it appears (founder 2026-08-11) —
              changes apply instantly, like the map rules above. */}
          <div className="homeloc__biz-toggles">
            <label className="homeloc__biz-toggle">
              <input type="checkbox" checked={b.show_on_maps}
                onChange={(e) => void toggleBizLoc(b.id, 'show_on_maps', e.target.checked)} />
              Show on Maps
            </label>
            <label className="homeloc__biz-toggle">
              <input type="checkbox" checked={b.show_on_profile}
                onChange={(e) => void toggleBizLoc(b.id, 'show_on_profile', e.target.checked)} />
              Show on my profile
            </label>
          </div>
        </div>
      ))}
      <div className="homeloc__add">
        <input
          className="prof__input"
          value={bizLabel}
          onChange={(e) => setBizLabel(e.target.value)}
          placeholder="Label — Studio, Farm stand… (optional)"
        />
      </div>
      <div className="homeloc__add">
        <LocationField
          className="prof__input homeloc__grow"
          value={bizText}
          geo={bizGeo}
          onChange={(text, g) => { setBizText(text); setBizGeo(g); }}
          placeholder="Address or town"
        />
        <button className="btn btn-primary homeloc__add-btn" disabled={bizBusy || !bizText.trim()} onClick={() => void addBizLoc()}>
          {bizBusy ? '…' : 'Add'}
        </button>
      </div>
      <p className="prof__hint">Pick a suggestion to pin it on Maps — free text saves, but won&rsquo;t pin.</p>
    </>
  );
}
