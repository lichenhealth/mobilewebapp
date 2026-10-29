import { TIME_STEPS, minToLabel } from '../lib/calendarApi';
import FitSelect from './FitSelect';

interface Props {
  value: number;                    // minutes since local midnight
  onChange: (min: number) => void;
  min?: number;                     // earliest selectable step (exclusive lower bound off)
  ariaLabel?: string;
  /** Calendar settings passes this so the time dropdowns carry the
   *  ask-the-brain teaching door too; other composers leave it off. */
  onBrain?: () => void;
}

/** Time-of-day select in 15-minute steps ("9am", "9:15am", …). */
export default function TimeField({ value, onChange, min, ariaLabel, onBrain }: Props) {
  const steps = min == null ? TIME_STEPS : TIME_STEPS.filter((m) => m > min);
  // Keep the current value selectable even if it violates min (transient states).
  const options = steps.includes(value) ? steps : [value, ...steps].sort((a, b) => a - b);
  // FitSelect (founder 2026-10-29): the pill is as wide as "9am", not as
  // wide as "12:45pm" — the platform's hug-the-selection rule.
  return (
    <FitSelect
      className="timefield"
      value={value}
      aria-label={ariaLabel ?? 'Time'}
      onBrain={onBrain}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {options.map((m) => <option key={m} value={m}>{minToLabel(m)}</option>)}
    </FitSelect>
  );
}
