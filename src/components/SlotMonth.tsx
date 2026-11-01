import { useMemo, useState } from 'react';
import { Icon } from './Icon';
import './SlotMonth.css';

/** The booking pickers' SCREEN ONE (founder 2026-11-01, from her Calendly
 *  screenshots: "let's edit the cal so we can fit more days on it...this is
 *  screen 1, and then once you select a day, screen 2"): a whole month at a
 *  glance — days with open times wear the light-peach lit circle, picking
 *  one reveals that day's slots below. Monday-first, the KOC calendar's
 *  grammar. The caller owns what "available" means (provider hours minus
 *  busy, via slotsForDay) — this only draws the month. */

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function SlotMonth({ availableDays, selected, onSelect, minIso, maxIso }: {
  /** ISO dates carrying at least one open slot. */
  availableDays: Set<string>;
  selected: string | null;
  onSelect: (iso: string) => void;
  /** The browsable range — arrows clamp to the months these fall in. */
  minIso: string;
  maxIso: string;
}) {
  // Open on the month holding the selection, else the first open day, else
  // today — seeded once so paging the arrows never snaps back.
  const seedMonth = useMemo(() => {
    const seed = selected ?? [...availableDays].sort()[0] ?? minIso;
    const d = new Date(seed + 'T00:00:00');
    return new Date(d.getFullYear(), d.getMonth(), 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [month, setMonth] = useState(seedMonth);

  const todayIso = isoOf(new Date());
  const monthOf = (iso: string) => { const d = new Date(iso + 'T00:00:00'); return new Date(d.getFullYear(), d.getMonth(), 1); };
  const canPrev = month > monthOf(minIso);
  const canNext = month < monthOf(maxIso);

  // Monday-first cells: leading blanks, then every day of the month.
  const cells: (string | null)[] = [];
  const firstDow = (month.getDay() + 6) % 7;
  for (let i = 0; i < firstDow; i++) cells.push(null);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) cells.push(isoOf(new Date(month.getFullYear(), month.getMonth(), d)));

  return (
    <div className="slotmon">
      <div className="slotmon__head">
        <button
          className="slotmon__nav" disabled={!canPrev} aria-label="Previous month"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
        >
          <Icon name="chevron-left" size={13} />
        </button>
        <span className="slotmon__title">
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </span>
        <button
          className="slotmon__nav" disabled={!canNext} aria-label="Next month"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
        >
          <Icon name="chevron-right" size={13} />
        </button>
      </div>
      <div className="slotmon__grid">
        {DOW.map((d) => <span className="slotmon__dow" key={d}>{d}</span>)}
        {cells.map((iso, i) => {
          if (!iso) return <span key={`b${i}`} />;
          const open = availableDays.has(iso);
          return (
            <button
              key={iso}
              className={'slotmon__day'
                + (open ? ' is-open' : '')
                + (selected === iso ? ' is-sel' : '')
                + (todayIso === iso ? ' is-today' : '')}
              disabled={!open}
              onClick={() => onSelect(iso)}
              aria-label={new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
                + (open ? ' — open times' : ' — nothing open')}
            >
              {Number(iso.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
