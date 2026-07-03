import DateRangeCalendar, { DateRange } from './DateRangeCalendar';
import RecurrenceSelect from './RecurrenceSelect';
import { todayISO } from '../lib/conciergeApi';
import { Recurrence, recurrenceLabel } from '../lib/recurrence';

interface Props {
  range: DateRange;                 // start = anchor; end only used when not repeating
  recurrence: Recurrence | null;
  onRangeChange: (r: DateRange) => void;
  onRecurrenceChange: (r: Recurrence | null) => void;
}

/** KOC scheduling: pick an anchor day on the calendar, plus the shared
 *  Gmail-style RecurrenceSelect (dropdown + Custom panel). */
export default function RecurrencePicker({ range, recurrence, onRangeChange, onRecurrenceChange }: Props) {
  const anchor = range.start ?? todayISO();

  // A repeating post is anchored to a single start day; ensure one exists.
  const handleRecurrence = (r: Recurrence | null) => {
    if (r) onRangeChange({ start: range.start ?? todayISO(), end: null });
    onRecurrenceChange(r);
  };

  return (
    <div className="rec">
      <RecurrenceSelect anchor={anchor} recurrence={recurrence} onChange={handleRecurrence} />

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
