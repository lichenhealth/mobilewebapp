import { SelectHTMLAttributes, useLayoutEffect, useRef, useState } from 'react';
import './FitSelect.css';

/** A native <select> that hugs its CURRENT selection (founder 2026-10-29,
 *  from "Monday – Friday" carrying dead air while "5pm" fell off the row:
 *  "Can the layout be smart enough to see the extra white space… Can we have
 *  that design rule for each aspect of the platform"). A bare <select> sizes
 *  to its WIDEST option, not the chosen one — this wrapper renders a hidden
 *  ghost span wearing the select's OWN className, so the pill is exactly as
 *  wide as what it says, whatever class styles it. THE PLATFORM RULE: any
 *  select sitting on a wrapping inline row goes through FitSelect, and the
 *  row keeps its gap and wraps whole pills — never crushes them.
 *  (Deliberate exceptions keep their own solve: Compose's per-unit select is
 *  CAPPED with ellipsis so the price input keeps its room.) */
export default function FitSelect(
  { onBrain, children, onChange, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & {
    /** When set, the dropdown's LAST option is "✨ Ask the brain…" — picking
     *  it fires this instead of changing the value (founder 2026-10-29: a
     *  teaching door on every dropdown — "they don't have to do manual
     *  setup, but can go to the brain for cal and type in rules"). The
     *  caller decides where the brain lives; the select keeps its
     *  controlled value. */
    onBrain?: () => void;
  },
) {
  const selRef = useRef<HTMLSelectElement>(null);
  const [label, setLabel] = useState('');
  // Runs every render; React bails when the label hasn't changed. Layout
  // effect so the first paint already has the right width (no flicker).
  useLayoutEffect(() => {
    const l = selRef.current?.selectedOptions[0]?.label ?? '';
    if (l !== '✨ Ask the brain…') setLabel(l);
  });
  return (
    <span className="fitsel">
      <span aria-hidden="true" className={'fitsel__ghost' + (rest.className ? ' ' + rest.className : '')}>
        {label || ' '}
      </span>
      <select
        {...rest}
        ref={selRef}
        onChange={(e) => {
          if (onBrain && e.target.value === '__brain') { onBrain(); return; }
          onChange?.(e);
        }}
      >
        {children}
        {onBrain && <option value="__brain">✨ Ask the brain…</option>}
      </select>
    </span>
  );
}
