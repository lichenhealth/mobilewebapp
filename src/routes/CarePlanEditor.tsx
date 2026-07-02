import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import {
  loadCarePlanForEdit, loadCareTeam, upsertCarePlan, replacePlanItems,
  weekDays, mondayOfWeek, type CareTeamProvider, type PlanItemInput,
} from '../lib/conciergeApi';
import './Concierge.css';

const CUSTOM = '__custom__';
interface Row { key: number; day: string; provider: string; providerLabel: string; body: string }

/** Caregiver-only editor for a client's KOC weekly care plan. */
export default function CarePlanEditor() {
  const { patientId = '' } = useParams();
  const { user } = useAuth();
  const me = user?.id ?? '';
  const navigate = useNavigate();
  const back = () => navigate(`/concierge/client/${patientId}/koc`);
  const nextKey = useRef(1);
  const mkRow = (r: Partial<Row> = {}): Row =>
    ({ key: nextKey.current++, day: 'daily', provider: '', providerLabel: '', body: '', ...r });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [weekStart, setWeekStart] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [team, setTeam] = useState<CareTeamProvider[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [plan, providers] = await Promise.all([loadCarePlanForEdit(patientId), loadCareTeam(patientId)]);
      if (!active) return;
      setWeekStart(plan.weekStart);
      setTeam(providers);
      setRows(plan.items.map((i: PlanItemInput) => mkRow({
        day: i.isDaily ? 'daily' : (i.itemDate ?? 'daily'),
        provider: i.providerId ?? (i.providerLabel ? CUSTOM : ''),
        providerLabel: i.providerLabel ?? '',
        body: i.body,
      })));
      setLoading(false);
    })();
    return () => { active = false; };
  }, [patientId]);

  const days = weekStart ? weekDays(weekStart) : [];
  const patchRow = (key: number, p: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  function changeWeek(iso: string) {
    const wk = mondayOfWeek(iso);
    const valid = new Set(weekDays(wk).map((d) => d.iso));
    setWeekStart(wk);
    setRows((rs) => rs.map((r) => (r.day !== 'daily' && !valid.has(r.day) ? { ...r, day: 'daily' } : r)));
  }

  async function save() {
    if (!me) return;
    const active = rows.filter((r) => r.body.trim());
    const bad = active.find((r) => !r.provider || (r.provider === CUSTOM && !r.providerLabel.trim()));
    if (bad) { setError('Every item needs a provider (pick a team member or enter a name).'); return; }
    setSaving(true); setError('');
    const items: PlanItemInput[] = active.map((r, idx) => ({
      isDaily: r.day === 'daily',
      itemDate: r.day === 'daily' ? null : r.day,
      providerId: r.provider && r.provider !== CUSTOM ? r.provider : null,
      providerLabel: r.provider === CUSTOM ? r.providerLabel.trim() : null,
      body: r.body,
      sort: idx,
    }));
    try {
      const planId = await upsertCarePlan(me, patientId, weekStart);
      await replacePlanItems(planId, items);
      back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the plan.');
      setSaving(false);
    }
  }

  if (loading) return <div className="cedit"><p className="conc__care-hint">Loading…</p></div>;

  return (
    <div className="cedit">
      <header className="cedit__head">
        <button className="conc__back" onClick={back} aria-label="Back"><Icon name="arrow-left" size={18} /></button>
        <h1 className="cedit__title">Care plan</h1>
        <button className="btn btn-primary cedit__save" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </header>

      {error && <p className="cedit__error">{error}</p>}

      <div className="cedit__body">
        <label className="cedit__field">
          <span className="cedit__label">Week starting (Monday)</span>
          <input className="cedit__input" type="date" value={weekStart} onChange={(e) => changeWeek(e.target.value)} />
        </label>

        <div className="cedit__field">
          <div className="cedit__row-head">
            <span className="cedit__label">Items</span>
            <button className="cedit__add" onClick={() => setRows((rs) => [...rs, mkRow()])}>
              <Icon name="plus" size={13} /> Add item
            </button>
          </div>
          <p className="cedit__hint">
            Use <code>[phrase]</code> for a link and <code>{'{icon-name}'}</code> for an inline icon. &ldquo;Daily&rdquo; = recurring all week.
          </p>

          {rows.length === 0 && <p className="conc__care-hint">No items yet — add the first one.</p>}

          {rows.map((r) => (
            <div className="cedit__plan-row" key={r.key}>
              <div className="cedit__plan-selects">
                <select className="cedit__select" value={r.day} onChange={(e) => patchRow(r.key, { day: e.target.value })}>
                  <option value="daily">Daily</option>
                  {days.map((d) => <option key={d.iso} value={d.iso}>{d.label}</option>)}
                </select>
                <select className="cedit__select" value={r.provider} onChange={(e) => patchRow(r.key, { provider: e.target.value })}>
                  <option value="">Provider…</option>
                  {team.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  <option value={CUSTOM}>Custom…</option>
                </select>
                {r.provider === CUSTOM && (
                  <input className="cedit__input" placeholder="Provider name / handle" value={r.providerLabel}
                    onChange={(e) => patchRow(r.key, { providerLabel: e.target.value })} />
                )}
                <button className="cedit__remove" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label="Remove item">
                  <Icon name="close" size={14} />
                </button>
              </div>
              <textarea className="cedit__textarea" rows={2} placeholder="What to do…" value={r.body}
                onChange={(e) => patchRow(r.key, { body: e.target.value })} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
