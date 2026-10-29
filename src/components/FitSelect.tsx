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
export default function FitSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const selRef = useRef<HTMLSelectElement>(null);
  const [label, setLabel] = useState('');
  // Runs every render; React bails when the label hasn't changed. Layout
  // effect so the first paint already has the right width (no flicker).
  useLayoutEffect(() => {
    setLabel(selRef.current?.selectedOptions[0]?.label ?? '');
  });
  return (
    <span className="fitsel">
      <span aria-hidden="true" className={'fitsel__ghost' + (props.className ? ' ' + props.className : '')}>
        {label || ' '}
      </span>
      <select {...props} ref={selRef} />
    </span>
  );
}
