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
}

interface IconRowProps {
  items: IconRowItem[];
  onSelect?: (label: string) => void;
  /** Extra class on the row — the tools/lenses split renders TWO rows
   *  stacked (founder 2026-10-12, the brain feed's shape as the overall
   *  UI), and each needs its own spacing. */
  className?: string;
  ariaLabel?: string;
  /** Rendered after the circles, on the same line (wrapping with the row) —
   *  the lit lenses' "Open «Section» ›" doors ride the TOOLS row here
   *  (founder 2026-10-15 markup: "maybe up by the search and plus bars"). */
  trailing?: ReactNode;
}

export default function IconRow({ items, onSelect, className, ariaLabel, trailing }: IconRowProps) {
  const navigate = useNavigate();
  return (
    <ScrollHintRow className={'icon-row h-scroll' + (className ? ' ' + className : '')} role="toolbar" ariaLabel={ariaLabel ?? 'Categories'} gutter>
      {items.flatMap(({ icon, label, to, divider, variant, size }, i) => {
        const nodes = [];
        if (divider && i > 0) {
          nodes.push(<span key={`${label}-div`} className="icon-row__divider" aria-hidden="true" />);
        }
        nodes.push(
          <button
            key={label}
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
        return nodes;
      })}
      {trailing}
    </ScrollHintRow>
  );
}
