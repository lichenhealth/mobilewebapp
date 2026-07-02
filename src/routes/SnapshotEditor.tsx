import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import {
  AXIS_ORDER, AXIS_META, type AxisScores,
  loadSnapshotForEdit, upsertSnapshot, todayISO,
} from '../lib/conciergeApi';
import type { SnapshotSection } from '../data/concierge';
import './Concierge.css';

const BLANK_SCORES = (): AxisScores =>
  AXIS_ORDER.reduce((a, n) => { a[n] = 50; return a; }, {} as AxisScores);

/** Caregiver-only editor for a client's WOW health snapshot. */
export default function SnapshotEditor() {
  const { patientId = '' } = useParams();
  const { user } = useAuth();
  const me = user?.id ?? '';
  const navigate = useNavigate();
  const back = () => navigate(`/concierge/client/${patientId}`);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [date, setDate] = useState(todayISO());
  const [summary, setSummary] = useState('');
  const [scores, setScores] = useState<AxisScores>(BLANK_SCORES());
  const [sections, setSections] = useState<SnapshotSection[]>([]);

  useEffect(() => {
    let active = true;
    loadSnapshotForEdit(patientId).then((s) => {
      if (!active) return;
      if (s) { setDate(s.snapshotDate); setSummary(s.summary); setScores(s.scores); setSections(s.sections); }
      setLoading(false);
    });
    return () => { active = false; };
  }, [patientId]);

  const setScore = (name: keyof AxisScores, v: number) => setScores((s) => ({ ...s, [name]: v }));
  const addSection = () => setSections((s) => [...s, { title: '', items: [], body: '' }]);
  const patchSection = (i: number, p: Partial<SnapshotSection>) =>
    setSections((s) => s.map((sec, idx) => (idx === i ? { ...sec, ...p } : sec)));
  const removeSection = (i: number) => setSections((s) => s.filter((_, idx) => idx !== i));

  async function save() {
    if (!me) return;
    setSaving(true); setError('');
    const cleaned = sections
      .map((s) => ({ ...s, items: s.items.map((x) => x.trim()).filter(Boolean) }))
      .filter((s) => s.title.trim() || s.body.trim() || s.items.length);
    try {
      await upsertSnapshot(me, { patientId, snapshotDate: date, summary, scores, sections: cleaned });
      back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the snapshot.');
      setSaving(false);
    }
  }

  if (loading) return <div className="cedit"><p className="conc__care-hint">Loading…</p></div>;

  return (
    <div className="cedit">
      <header className="cedit__head">
        <button className="conc__back" onClick={back} aria-label="Back"><Icon name="arrow-left" size={18} /></button>
        <h1 className="cedit__title">Wellness snapshot</h1>
        <button className="btn btn-primary cedit__save" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </header>

      {error && <p className="cedit__error">{error}</p>}

      <div className="cedit__body">
        <label className="cedit__field">
          <span className="cedit__label">Date</span>
          <input className="cedit__input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        <label className="cedit__field">
          <span className="cedit__label">Summary</span>
          <textarea className="cedit__textarea" rows={3} value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="The through-line of where this member is right now." />
        </label>

        <div className="cedit__field">
          <span className="cedit__label">Wellness dimensions</span>
          <div className="cedit__scores">
            {AXIS_ORDER.map((name) => (
              <div className="cedit__score" key={name}>
                <span className="cedit__score-label"><Icon name={AXIS_META[name]} size={14} /> {name}</span>
                <input type="range" min={0} max={100} value={scores[name]}
                  onChange={(e) => setScore(name, Number(e.target.value))} />
                <span className="cedit__score-val">{scores[name]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="cedit__field">
          <div className="cedit__row-head">
            <span className="cedit__label">Sections</span>
            <button className="cedit__add" onClick={addSection}><Icon name="plus" size={13} /> Add section</button>
          </div>
          <p className="cedit__hint">Wrap AI-attributed phrases in <code>{'{{ai:…}}'}</code> to highlight them.</p>
          {sections.map((sec, i) => (
            <div className="cedit__section" key={i}>
              <div className="cedit__section-head">
                <input className="cedit__input" placeholder="Title (e.g. Mental)" value={sec.title}
                  onChange={(e) => patchSection(i, { title: e.target.value })} />
                <button className="cedit__remove" onClick={() => removeSection(i)} aria-label="Remove section">
                  <Icon name="close" size={14} />
                </button>
              </div>
              <ItemsEditor items={sec.items} onChange={(items) => patchSection(i, { items })} />
              <textarea className="cedit__textarea" rows={3} placeholder="Narrative…" value={sec.body}
                onChange={(e) => patchSection(i, { body: e.target.value })} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ItemsEditor({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
  return (
    <div className="cedit__items">
      {items.map((it, i) => (
        <div className="cedit__item-row" key={i}>
          <input className="cedit__input" placeholder="Key finding" value={it}
            onChange={(e) => onChange(items.map((x, idx) => (idx === i ? e.target.value : x)))} />
          <button className="cedit__remove" onClick={() => onChange(items.filter((_, idx) => idx !== i))} aria-label="Remove">
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
      <button className="cedit__add cedit__add--sm" onClick={() => onChange([...items, ''])}>
        <Icon name="plus" size={12} /> Add finding
      </button>
    </div>
  );
}
