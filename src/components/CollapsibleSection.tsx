import type { ReactNode } from 'react';
import { Icon } from './Icon';
import './CollapsibleSection.css';

export interface CollapsibleSectionProps {
  title: string;
  /** Peach dot beside the title — "this section is contributing/set right now" (founder 2026-08-10: reuse SmartSearchCore's manual-search criteria pattern). */
  active?: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/** A section that opens inline to edit, then collapses back down — lifted
 *  from SmartSearchCore's manual-search criteria panel (founder
 *  2026-08-10: "the expandable dropdown you built for manual search could
 *  be a design build to re-use for the profile dropdown") so Profile and
 *  SpaceProfile's backstage share the exact same interaction, not a
 *  lookalike. Controlled — the caller owns open/onToggle, same as the
 *  search panel's own `openSects` Set, so callers can choose independent
 *  or exclusive-accordion behavior. */
export default function CollapsibleSection({ title, active, open, onToggle, children }: CollapsibleSectionProps) {
  return (
    <div className={'coll' + (open ? ' is-open' : '')}>
      <button className="coll__head" onClick={onToggle} aria-expanded={open}>
        <span className="coll__label">
          {title}
          {active && <span className="coll__dot" aria-label="active" />}
        </span>
        <span className="coll__chev" aria-hidden>
          <Icon name="chevron-right" size={13} />
        </span>
      </button>
      {open && <div className="coll__body">{children}</div>}
    </div>
  );
}
