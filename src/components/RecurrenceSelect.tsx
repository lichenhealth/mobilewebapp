import { useState } from 'react';
import {
  Recurrence, Freq, RecEnd, presetsFor, recurrenceLabel, matchPresetLabel,
  weekdayMon0, WEEKDAYS_SHORT,
} from '../lib/recurrence';

interface Props {
  anchor: string;                   // yyyy-mm-dd the pattern is anchored to
  recurrence: Recurrence | null;    // null = does not repeat
  onChange: (r: Recurrence | null) => void;
}

const FREQ_NOUN: Record<Freq, string> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };

/** Gmail-style recurrence control: preset dropdown (smart-defaulted to the
 *  anchor day) + a Custom panel (interval, weekdays, monthly mode, ends).
 *  Shared by the KOC care-plan composer and the event composer. */
export default function RecurrenceSelect({ anchor, recurrence, onChange }: Props) {
  const [showCustom, setShowCustom] = useState(false);
  const presets = presetsFor(anchor);
  const currentLabel = showCustom ? 'Custom…' : matchPresetLabel(recurrence, anchor);

  const choosePreset = (label: string) => {
    const p = presets.find((x) => x.label === label);
    if (!p) return;
    if (p.custom) {
      // Seed Custom with a sensible weekly-on-anchor default if not already repeating.
      setShowCustom(true);
      onChange(recurrence ?? { freq: 'weekly', interval: 1, byday: [weekdayMon0(anchor)], end: { type: 'never' } });
      return;
    }
    setShowCustom(false);
    onChange(p.recurrence);
  };

  const patch = (p: Partial<Recurrence>) =>
    onChange({ ...(recurrence ?? { freq: 'weekly', interval: 1, end: { type: 'never' } }), ...p });

  const toggleDay = (d: number) => {
    const cur = recurrence?.byday ?? [weekdayMon0(anchor)];
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d];
    patch({ byday: next.length ? next.sort((a, b) => a - b) : [weekdayMon0(anchor)] });
  };

  const setFreq = (freq: Freq) => {
    const base: Recurrence = { ...(recurrence ?? { interval: 1, end: { type: 'never' } }), freq } as Recurrence;
    if (freq === 'weekly' && !base.byday?.length) base.byday = [weekdayMon0(anchor)];
    if (freq !== 'weekly') delete base.byday;
    if (freq === 'monthly' && !base.monthMode) base.monthMode = 'weekday';
    if (freq !== 'monthly') delete base.monthMode;
    onChange(base);
  };

  const setEnd = (end: RecEnd) => patch({ end });

  return (
    <>
      <select className="rec__select" value={currentLabel} onChange={(e) => choosePreset(e.target.value)}>
        {presets.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
      </select>

      {showCustom && recurrence && (
        <div className="rec__custom">
          <div className="rec__row">
            <span className="rec__lbl">Repeat every</span>
            <input
              className="rec__num" type="number" min={1} max={99} value={recurrence.interval}
              onChange={(e) => patch({ interval: Math.max(1, Number(e.target.value) || 1) })}
            />
            <select className="rec__freq" value={recurrence.freq} onChange={(e) => setFreq(e.target.value as Freq)}>
              {(['daily', 'weekly', 'monthly', 'yearly'] as Freq[]).map((f) => (
                <option key={f} value={f}>{FREQ_NOUN[f]}{recurrence.interval > 1 ? 's' : ''}</option>
              ))}
            </select>
          </div>

          {recurrence.freq === 'weekly' && (
            <div className="rec__days">
              {WEEKDAYS_SHORT.map((d, i) => (
                <button
                  key={i} type="button"
                  className={'rec__day' + ((recurrence.byday ?? [weekdayMon0(anchor)]).includes(i) ? ' is-on' : '')}
                  onClick={() => toggleDay(i)}
                >
                  {d[0]}
                </button>
              ))}
            </div>
          )}

          {recurrence.freq === 'monthly' && (
            <div className="rec__row rec__row--wrap">
              <label className="rec__radio">
                <input type="radio" checked={recurrence.monthMode !== 'date'} onChange={() => patch({ monthMode: 'weekday' })} />
                On the {recurrenceLabel({ freq: 'monthly', interval: 1, monthMode: 'weekday', end: { type: 'never' } }, anchor).replace(/^Monthly on the /, '')}
              </label>
              <label className="rec__radio">
                <input type="radio" checked={recurrence.monthMode === 'date'} onChange={() => patch({ monthMode: 'date' })} />
                On day {new Date(anchor + 'T00:00').getDate()}
              </label>
            </div>
          )}

          <div className="rec__ends">
            <span className="rec__lbl">Ends</span>
            <label className="rec__radio">
              <input type="radio" checked={recurrence.end.type === 'never'} onChange={() => setEnd({ type: 'never' })} /> Never
            </label>
            <label className="rec__radio">
              <input type="radio" checked={recurrence.end.type === 'until'} onChange={() => setEnd({ type: 'until', date: anchor })} /> On
              <input
                className="rec__date" type="date" disabled={recurrence.end.type !== 'until'}
                value={recurrence.end.type === 'until' ? recurrence.end.date : ''}
                min={anchor}
                onChange={(e) => e.target.value && setEnd({ type: 'until', date: e.target.value })}
              />
            </label>
            <label className="rec__radio">
              <input type="radio" checked={recurrence.end.type === 'count'} onChange={() => setEnd({ type: 'count', n: 10 })} /> After
              <input
                className="rec__num" type="number" min={1} max={999} disabled={recurrence.end.type !== 'count'}
                value={recurrence.end.type === 'count' ? recurrence.end.n : 10}
                onChange={(e) => setEnd({ type: 'count', n: Math.max(1, Number(e.target.value) || 1) })}
              /> times
            </label>
          </div>
        </div>
      )}
    </>
  );
}
