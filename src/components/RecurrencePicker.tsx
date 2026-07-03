import { useState } from 'react';
import DateRangeCalendar, { DateRange } from './DateRangeCalendar';
import { todayISO } from '../lib/conciergeApi';
import {
  Recurrence, Freq, RecEnd, presetsFor, recurrenceLabel, matchPresetLabel,
  weekdayMon0, WEEKDAYS_SHORT,
} from '../lib/recurrence';

interface Props {
  range: DateRange;                 // start = anchor; end only used when not repeating
  recurrence: Recurrence | null;
  onRangeChange: (r: DateRange) => void;
  onRecurrenceChange: (r: Recurrence | null) => void;
}

const FREQ_NOUN: Record<Freq, string> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };

/** KOC scheduling: pick an anchor day on the calendar, then a Gmail-style
 *  recurrence (Daily quick-button + dropdown + Custom panel). */
export default function RecurrencePicker({ range, recurrence, onRangeChange, onRecurrenceChange }: Props) {
  const anchor = range.start ?? todayISO();
  const [showCustom, setShowCustom] = useState(false);
  const presets = presetsFor(anchor);
  const currentLabel = showCustom ? 'Custom…' : matchPresetLabel(recurrence, anchor);

  // A repeating post is anchored to a single start day; ensure one exists.
  const withAnchor = (r: Recurrence | null) => {
    if (r) onRangeChange({ start: range.start ?? todayISO(), end: null });
    onRecurrenceChange(r);
  };

  const choosePreset = (label: string) => {
    const p = presets.find((x) => x.label === label);
    if (!p) return;
    if (p.custom) {
      // Seed Custom with a sensible weekly-on-anchor default if not already repeating.
      setShowCustom(true);
      withAnchor(recurrence ?? { freq: 'weekly', interval: 1, byday: [weekdayMon0(anchor)], end: { type: 'never' } });
      return;
    }
    setShowCustom(false);
    withAnchor(p.recurrence);
  };

  const patch = (p: Partial<Recurrence>) =>
    onRecurrenceChange({ ...(recurrence ?? { freq: 'weekly', interval: 1, end: { type: 'never' } }), ...p });

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
    onRecurrenceChange(base);
  };

  const setEnd = (end: RecEnd) => patch({ end });

  return (
    <div className="rec">
      <div className="rec__controls">
        <button
          className={'rec__daily' + (currentLabel === 'Daily' ? ' is-on' : '')}
          onClick={() => choosePreset(currentLabel === 'Daily' ? 'Does not repeat' : 'Daily')}
          type="button"
        >
          Daily
        </button>
        <select className="rec__select" value={currentLabel} onChange={(e) => choosePreset(e.target.value)}>
          {presets.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
        </select>
      </div>

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
              <input type="radio" checked={recurrence.end.type === 'until'} onChange={() => setEnd({ type: 'until', date: range.start ?? todayISO() })} /> On
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

      <DateRangeCalendar
        value={recurrence ? { start: range.start, end: range.start } : range}
        onChange={(r) => onRangeChange(recurrence ? { start: r.start, end: null } : r)}
      />

      <p className="rec__summary">
        {recurrence
          ? `${recurrenceLabel(recurrence, anchor)} · starts ${new Date(anchor + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
          : range.start && range.end
            ? (range.start === range.end ? 'One day' : 'Date range')
            : 'Pick a day, or a start and end'}
      </p>
    </div>
  );
}
