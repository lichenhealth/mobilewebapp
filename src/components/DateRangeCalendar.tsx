import { useState } from 'react';
import { Icon } from './Icon';
import { toISO, localDate, todayISO } from '../lib/conciergeApi';
import './DateRangeCalendar.css';

export interface DateRange { start: string | null; end: string | null }

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Hotel-style range picker: first click sets the start, second click ≥ start sets
 *  the end; clicking earlier restarts. A single day = start === end. No deps. */
export default function DateRangeCalendar({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  const base = value.start ? localDate(value.start) : new Date();
  const [view, setView] = useState({ y: base.getFullYear(), m: base.getMonth() });
  const [hover, setHover] = useState<string | null>(null);
  const today = todayISO();

  const monthName = new Date(view.y, view.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const firstOffset = (new Date(view.y, view.m, 1).getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array(firstOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => toISO(new Date(view.y, view.m, i + 1))),
  ];

  const prev = () => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }));
  const next = () => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }));

  function pick(iso: string) {
    const { start, end } = value;
    if (!start || (start && end)) onChange({ start: iso, end: null });      // begin a new range
    else if (iso >= start) onChange({ start, end: iso });                    // close the range
    else onChange({ start: iso, end: null });                               // clicked earlier → restart
  }

  const inRange = (iso: string) => {
    const s = value.start;
    const e = value.end ?? (value.start && !value.end ? hover : null);
    if (!s || !e) return false;
    const [lo, hi] = s < e ? [s, e] : [e, s];
    return iso > lo && iso < hi;
  };

  return (
    <div className="cal">
      <div className="cal__head">
        <button className="cal__nav" onClick={prev} aria-label="Previous month"><Icon name="chevron-left" size={16} /></button>
        <span className="cal__month">{monthName}</span>
        <button className="cal__nav" onClick={next} aria-label="Next month"><Icon name="chevron-right" size={16} /></button>
      </div>
      <div className="cal__grid cal__weekdays">
        {WEEKDAYS.map((d, i) => <span key={i} className="cal__wd">{d}</span>)}
      </div>
      <div className="cal__grid" onMouseLeave={() => setHover(null)}>
        {cells.map((iso, i) => iso === null ? (
          <span key={i} className="cal__cell cal__cell--empty" />
        ) : (
          <button
            key={i}
            className={'cal__cell'
              + (iso === value.start ? ' is-start' : '')
              + (iso === value.end ? ' is-end' : '')
              + (inRange(iso) ? ' is-in-range' : '')
              + (iso === today ? ' is-today' : '')}
            onClick={() => pick(iso)}
            onMouseEnter={() => setHover(iso)}
          >
            {localDate(iso).getDate()}
          </button>
        ))}
      </div>
    </div>
  );
}
