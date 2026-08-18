import type { ReactNode } from 'react';
import { Icon } from './Icon';
import './CollapsibleSection.css';

export interface CollapsibleSectionProps {
  id?: string;
  title: string;
  /** Peach dot beside the title — "this section is contributing/set right now" (founder 2026-08-10: reuse SmartSearchCore's manual-search criteria pattern). */
  active?: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** Muted words on the header line after the title — "No groups yet",
   *  "3 groups" (founder 2026-08-17: the empty copy belongs on the same
   *  line as the title, not in a body you have to open to read). */
  meta?: ReactNode;
  /** A + on the header — "add one" without opening anything. */
  action?: { label: string; onClick: () => void };
  /** False when there is nothing to open (an empty list): the header keeps
   *  its place in the accordion but drops the chevron. Default true. */
  expandable?: boolean;
}

/** A section that opens inline to edit, then collapses back down — lifted
 *  from SmartSearchCore's manual-search criteria panel (founder
 *  2026-08-10: "the expandable dropdown you built for manual search could
 *  be a design build to re-use for the profile dropdown") so Profile and
 *  SpaceProfile's backstage share the exact same interaction, not a
 *  lookalike. Controlled — the caller owns open/onToggle, same as the
 *  search panel's own `openSects` Set, so callers can choose independent
 *  or exclusive-accordion behavior. */
export default function CollapsibleSection({ id, title, active, open, onToggle, children, meta, action, expandable = true }: CollapsibleSectionProps) {
  const canOpen = expandable;
  return (
    <div id={id} className={'coll' + (open && canOpen ? ' is-open' : '') + (canOpen ? '' : ' is-flat')}>
      <div className="coll__row">
        <button className="coll__head" onClick={canOpen ? onToggle : undefined} aria-expanded={canOpen ? open : undefined} disabled={!canOpen}>
          <span className="coll__label">
            {title}
            {active && <span className="coll__dot" aria-label="active" />}
            {meta && <span className="coll__meta">{meta}</span>}
          </span>
        </button>
        {action && (
          <button className="coll__action" onClick={action.onClick} aria-label={action.label} title={action.label}>
            <Icon name="plus" size={13} />
          </button>
        )}
        {canOpen && (
          <button className="coll__chev" onClick={onToggle} aria-label={open ? 'Collapse' : 'Expand'}>
            <Icon name="chevron-right" size={13} />
          </button>
        )}
      </div>
      {open && canOpen && <div className="coll__body">{children}</div>}
    </div>
  );
}
