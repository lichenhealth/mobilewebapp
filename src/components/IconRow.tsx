import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, IconName } from './Icon';
import { ScrollHintRow } from './ScrollHintRow';
import './IconRow.css';

export interface IconRowItem {
  icon: IconName;
  label: string;
  /** Optional route to navigate to when this icon is tapped */
  to?: string;
  /** When true, render a visual gap before this item — used to separate
   *  "compose" actions (search, post) from "destinations" (marketplace, work, etc.) */
  divider?: boolean;
  /** Extra class for a door that carries state — e.g. the assistant brain,
   *  peach when it's switched on for you (founder 2026-07-28). */
  variant?: string;
  /** Override the glyph size. The row default is 16 (34px circles since
   *  2026-10-12 — every door still one size, founder 2026-08-08), so reach
   *  for this only with a real reason. */
  size?: number;
  /** THE DOOR RIDES THE LIT LENS (founder 2026-10-23, replacing the stacked
   *  "Open «Section» ›" text doors: "it gets clunky to have open
   *  marketplace, open travel, etc, get added on each time I select a
   *  filter"; on the proposal, "yes, let's deploy the tab — will it have a
   *  little arrow in it?"): a small peach › tab attached to the circle's
   *  right edge. Tap the circle = toggle the filter; tap the tab = walk into
   *  the section. Pass it only while the lens is lit. */
  door?: { label: string; onClick: () => void };
}

interface IconRowProps {
  items: IconRowItem[];
  onSelect?: (label: string) => void;
  /** Extra class on the row — the tools/lenses split renders TWO rows
   *  stacked (founder 2026-10-12, the brain feed's shape as the overall
   *  UI), and each needs its own spacing. */
  className?: string;
  ariaLabel?: string;
  /** Rendered after the circles, on the same line (wrapping with the row).
   *  Its original tenant — the stacked "Open «Section» ›" doors — retired
   *  2026-10-23 for the per-lens door tab below; the slot stays generic. */
  trailing?: ReactNode;
}

export default function IconRow({ items, onSelect, className, ariaLabel, trailing }: IconRowProps) {
  const navigate = useNavigate();
  return (
    <ScrollHintRow className={'icon-row h-scroll' + (className ? ' ' + className : '')} role="toolbar" ariaLabel={ariaLabel ?? 'Categories'} gutter>
      {items.flatMap(({ icon, label, to, divider, variant, size, door }, i) => {
        const nodes = [];
        if (divider && i > 0) {
          nodes.push(<span key={`${label}-div`} className="icon-row__divider" aria-hidden="true" />);
        }
        const circle = (
          <button
            key={door ? undefined : label}
            className={'icon-row__btn' + (variant ? ' ' + variant : '')}
            onClick={() => {
              if (to) navigate(to);
              onSelect?.(label);
            }}
            aria-label={label}
            title={label}
          >
            <Icon name={icon} size={size ?? 16} />
          </button>
        );
        nodes.push(door ? (
          <span key={label} className="icon-row__lenswrap">
            {circle}
            <button
              className="icon-row__door"
              onClick={door.onClick}
              aria-label={door.label}
              title={door.label}
            >
              <Icon name="chevron-right" size={11} />
            </button>
          </span>
        ) : circle);
        return nodes;
      })}
      {trailing}
    </ScrollHintRow>
  );
}
