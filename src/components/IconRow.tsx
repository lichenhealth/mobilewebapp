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
  /** Override the glyph size (the brain reads better a little larger). */
  size?: number;
}

interface IconRowProps {
  items: IconRowItem[];
  onSelect?: (label: string) => void;
}

export default function IconRow({ items, onSelect }: IconRowProps) {
  const navigate = useNavigate();
  return (
    <ScrollHintRow className="icon-row h-scroll" role="toolbar" ariaLabel="Categories" gutter>
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
            <Icon name={icon} size={size ?? 18} />
          </button>
        );
        return nodes;
      })}
    </ScrollHintRow>
  );
}
