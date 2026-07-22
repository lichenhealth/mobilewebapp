interface Props {
  value: number;                    // minutes since local midnight
  onChange: (min: number) => void;
  ariaLabel?: string;
}

/** Per-minute time picker (native <input type="time">) — an hour + minute wheel
 *  on mobile, so reminders can alert at an exact minute, not a 15-min step. */
export default function TimeInput({ value, onChange, ariaLabel }: Props) {
  const hh = String(Math.floor(value / 60)).padStart(2, '0');
  const mm = String(value % 60).padStart(2, '0');
  return (
    <input
      type="time"
      className="timefield timefield--native"
      value={`${hh}:${mm}`}
      aria-label={ariaLabel ?? 'Time'}
      onChange={(e) => {
        const [h, m] = e.target.value.split(':').map(Number);
        if (!Number.isNaN(h) && !Number.isNaN(m)) onChange(h * 60 + m);
      }}
    />
  );
}
