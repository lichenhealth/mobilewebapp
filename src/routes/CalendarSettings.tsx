import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import TimeField from '../components/TimeField';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { WEEKDAYS_SHORT, WEEKDAYS_FULL } from '../lib/recurrence';
import {
  AvailabilityKind, AvailabilityWindow, ShareLevel, ShareRule, minToLabel,
  loadMyAvailability, addAvailability, deleteAvailability,
  loadMyShares, upsertShare, deleteShare,
} from '../lib/calendarApi';
import './Concierge.css';
import './Calendar.css';

interface SpaceOpt { id: string; name: string }
interface MemberOpt { id: string; full_name: string | null }

const LEVEL_LABELS: Record<ShareLevel, string> = {
  hidden: 'Nothing', busy: 'Busy times only', details: 'Full details',
};

/** Calendar settings: declared weekly hours (availability / on-call) and
 *  audience visibility rules (most-specific wins). */
export default function CalendarSettings() {
  const { user } = useAuth();
  const me = user?.id ?? '';
  const navigate = useNavigate();

  const [windows, setWindows] = useState<AvailabilityWindow[]>([]);
  const [rules, setRules] = useState<ShareRule[]>([]);
  const [spaces, setSpaces] = useState<SpaceOpt[]>([]);
  const [members, setMembers] = useState<MemberOpt[]>([]);
  const [error, setError] = useState('');

  // add-hours form
  const [wDay, setWDay] = useState(0);
  const [wStart, setWStart] = useState(9 * 60);
  const [wEnd, setWEnd] = useState(17 * 60);
  const [wKind, setWKind] = useState<AvailabilityKind>('available');

  // add-rule form
  const [rType, setRType] = useState<'profile' | 'space'>('profile');
  const [rSpace, setRSpace] = useState('');
  const [rQuery, setRQuery] = useState('');
  const [rPerson, setRPerson] = useState<MemberOpt | null>(null);
  const [rLevel, setRLevel] = useState<ShareLevel>('details');

  const load = useCallback(async () => {
    if (!me) return;
    const [w, r, spRes, memRes] = await Promise.all([
      loadMyAvailability(me),
      loadMyShares(me),
      supabase.from('space_members').select('spaces(id, name)').eq('profile_id', me),
      supabase.from('profiles').select('id, full_name').neq('id', me).order('full_name').limit(500),
    ]);
    setWindows(w); setRules(r);
    setSpaces(((spRes.data as unknown as { spaces: SpaceOpt | null }[] | null) ?? [])
      .map((x) => x.spaces).filter((s): s is SpaceOpt => !!s));
    setMembers((memRes.data as MemberOpt[] | null) ?? []);
  }, [me]);
  useEffect(() => { load(); }, [load]);

  const everyoneLevel: ShareLevel =
    (rules.find((r) => r.audience_type === 'everyone')?.level) ?? 'busy';
  const specificRules = rules.filter((r) => r.audience_type !== 'everyone');

  const matches = useMemo(() => {
    const q = rQuery.trim().toLowerCase();
    if (!q || rPerson) return [];
    return members.filter((m) => (m.full_name ?? '').toLowerCase().includes(q)).slice(0, 6);
  }, [rQuery, members, rPerson]);

  const act = async (fn: () => Promise<void>) => {
    if (!me) return; // session still resolving — never write with an empty id
    setError('');
    try { await fn(); await load(); }
    catch (e) { setError((e as { message?: string } | null)?.message || 'Something went wrong.'); }
  };

  // Don't render interactive controls until the session (and data) are ready —
  // acting before `me` resolves produced uuid "" errors.
  if (!me) {
    return (
      <div className="cedit">
        <header className="cedit__head">
          <button className="conc__back" onClick={() => navigate('/calendar')} aria-label="Back"><Icon name="arrow-left" size={18} /></button>
          <h1 className="cedit__title">Calendar settings</h1>
          <span />
        </header>
        <p className="cedit__hint" style={{ padding: 'var(--s-4)' }}>Loading…</p>
      </div>
    );
  }

  return (
    <div className="cedit">
      <header className="cedit__head">
        <button className="conc__back" onClick={() => navigate('/calendar')} aria-label="Back"><Icon name="arrow-left" size={18} /></button>
        <h1 className="cedit__title">Calendar settings</h1>
        <span />
      </header>

      {error && <p className="cedit__error">{error}</p>}

      <div className="cedit__body">
        {/* ── My hours ── */}
        <div className="cedit__field">
          <span className="cedit__label">My hours</span>
          <p className="cedit__hint">
            Times you're generally available. Groups use this (plus your events) to find meeting
            times; on-call windows power your care team's urgent coverage.
          </p>
          {windows.map((w) => (
            <div className="cset__row" key={w.id}>
              <span className="cset__day">{WEEKDAYS_SHORT[w.weekday]}</span>
              <span className="cset__time">{minToLabel(w.start_min)} – {minToLabel(w.end_min)}</span>
              <span className={'cset__kind' + (w.kind === 'on_call' ? ' is-oncall' : '')}>
                {w.kind === 'on_call' ? 'On call' : 'Available'}
              </span>
              <button className="cedit__remove" onClick={() => act(() => deleteAvailability(w.id))} aria-label="Remove"><Icon name="close" size={13} /></button>
            </div>
          ))}
          <div className="cset__add">
            <select className="cset__select" value={wDay} onChange={(e) => setWDay(Number(e.target.value))} aria-label="Weekday">
              {WEEKDAYS_FULL.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
            <TimeField value={wStart} onChange={(m) => { setWStart(m); if (wEnd <= m) setWEnd(Math.min(m + 60, 1440)); }} ariaLabel="From" />
            <span className="rec__lbl">to</span>
            <TimeField value={wEnd} onChange={setWEnd} min={wStart} ariaLabel="Until" />
            <select className="cset__select" value={wKind} onChange={(e) => setWKind(e.target.value as AvailabilityKind)} aria-label="Kind">
              <option value="available">Available</option>
              <option value="on_call">On call</option>
            </select>
            <button
              className="cedit__add cedit__add--sm"
              onClick={() => act(() => addAvailability(me, { weekday: wDay, startMin: wStart, endMin: wEnd, kind: wKind }))}
            >
              <Icon name="plus" size={12} /> Add
            </button>
          </div>
        </div>

        {/* ── Who sees my calendar ── */}
        <div className="cedit__field">
          <span className="cedit__label">Who sees my calendar</span>
          <p className="cedit__hint">
            The most specific rule wins: a rule for a person beats their group's rule, which beats
            the everyone rule. "Busy times only" hides what and where — people just see you're taken.
          </p>

          <div className="cset__row">
            <span className="cset__aud">Everyone</span>
            <select
              className="cset__select cset__select--grow" value={everyoneLevel}
              onChange={(e) => act(() => upsertShare(me, { type: 'everyone' }, e.target.value as ShareLevel))}
              aria-label="Everyone sees"
            >
              {(Object.keys(LEVEL_LABELS) as ShareLevel[]).map((l) => <option key={l} value={l}>{LEVEL_LABELS[l]}</option>)}
            </select>
          </div>

          {specificRules.map((r) => (
            <div className="cset__row" key={r.id}>
              <span className="cset__aud">
                {r.audience_type === 'space'
                  ? (r.space?.name ?? 'A space')
                  : (r.profile?.full_name || 'A member')}
              </span>
              <select
                className="cset__select cset__select--grow" value={r.level}
                onChange={(e) => act(() =>
                  upsertShare(
                    me,
                    r.audience_type === 'space'
                      ? { type: 'space', spaceId: r.audience_space_id! }
                      : { type: 'profile', profileId: r.audience_profile_id! },
                    e.target.value as ShareLevel,
                  ))}
                aria-label="Sees"
              >
                {(Object.keys(LEVEL_LABELS) as ShareLevel[]).map((l) => <option key={l} value={l}>{LEVEL_LABELS[l]}</option>)}
              </select>
              <button className="cedit__remove" onClick={() => act(() => deleteShare(r.id))} aria-label="Remove"><Icon name="close" size={13} /></button>
            </div>
          ))}

          <div className="cset__add cset__add--wrap">
            <select className="cset__select" value={rType} onChange={(e) => { setRType(e.target.value as 'profile' | 'space'); setRPerson(null); setRQuery(''); }} aria-label="Rule for">
              <option value="profile">Person</option>
              <option value="space">Group / community</option>
            </select>
            {rType === 'space' ? (
              <select className="cset__select cset__select--grow" value={rSpace} onChange={(e) => setRSpace(e.target.value)} aria-label="Which space">
                <option value="">Choose…</option>
                {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            ) : rPerson ? (
              <button className="calp__invitee" onClick={() => { setRPerson(null); setRQuery(''); }}>
                {rPerson.full_name ?? 'Member'} ×
              </button>
            ) : (
              <input className="cedit__input cset__grow" placeholder="Search members…" value={rQuery} onChange={(e) => setRQuery(e.target.value)} />
            )}
            <select className="cset__select" value={rLevel} onChange={(e) => setRLevel(e.target.value as ShareLevel)} aria-label="Level">
              {(Object.keys(LEVEL_LABELS) as ShareLevel[]).map((l) => <option key={l} value={l}>{LEVEL_LABELS[l]}</option>)}
            </select>
            <button
              className="cedit__add cedit__add--sm"
              onClick={() => act(async () => {
                if (rType === 'space' && rSpace) await upsertShare(me, { type: 'space', spaceId: rSpace }, rLevel);
                else if (rType === 'profile' && rPerson) await upsertShare(me, { type: 'profile', profileId: rPerson.id }, rLevel);
                setRSpace(''); setRPerson(null); setRQuery('');
              })}
            >
              <Icon name="plus" size={12} /> Add rule
            </button>
          </div>
          {matches.map((m) => (
            <button className="calp__match" key={m.id} onClick={() => { setRPerson(m); setRQuery(''); }}>
              {m.full_name ?? 'Member'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
