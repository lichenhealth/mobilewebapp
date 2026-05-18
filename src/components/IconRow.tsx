import { Icon, IconName } from './Icon';
import './IconRow.css';

export interface IconRowItem {
  icon: IconName;
  label: string;
}

interface IconRowProps {
  items: IconRowItem[];
  onSelect?: (label: string) => void;
}

export default function IconRow({ items, onSelect }: IconRowProps) {
  return (
    <div className="icon-row h-scroll" role="toolbar" aria-label="Categories">
      {items.map(({ icon, label }) => (
        <button
          key={label}
          className="icon-row__btn"
          onClick={() => onSelect?.(label)}
          aria-label={label}
          title={label}
        >
          <Icon name={icon} size={16} />
        </button>
      ))}
    </div>
  );
}
