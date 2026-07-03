import { TIME_STEPS, minToLabel } from '../lib/calendarApi';

interface Props {
  value: number;                    // minutes since local midnight
  onChange: (min: number) => void;
  min?: number;                     // earliest selectable step (exclusive lower bound off)
  ariaLabel?: string;
}

/** Time-of-day select in 15-minute steps ("9am", "9:15am", …). */
export default function TimeField({ value, onChange, min, ariaLabel }: Props) {
  const steps = min == null ? TIME_STEPS : TIME_STEPS.filter((m) => m > min);
  // Keep the current value selectable even if it violates min (transient states).
  const options = steps.includes(value) ? steps : [value, ...steps].sort((a, b) => a - b);
  return (
    <select
      className="timefield"
      value={value}
      aria-label={ariaLabel ?? 'Time'}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {options.map((m) => <option key={m} value={m}>{minToLabel(m)}</option>)}
    </select>
  );
}
