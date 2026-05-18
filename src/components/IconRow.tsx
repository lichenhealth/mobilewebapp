import { useNavigate } from 'react-router-dom';
import { Icon, IconName } from './Icon';
import './IconRow.css';

export interface IconRowItem {
  icon: IconName;
  label: string;
  /** Optional route to navigate to when this icon is tapped */
  to?: string;
}

interface IconRowProps {
  items: IconRowItem[];
  onSelect?: (label: string) => void;
}

export default function IconRow({ items, onSelect }: IconRowProps) {
  const navigate = useNavigate();
  return (
    <div className="icon-row h-scroll" role="toolbar" aria-label="Categories">
      {items.map(({ icon, label, to }) => (
        <button
          key={label}
          className="icon-row__btn"
          onClick={() => {
            if (to) navigate(to);
            onSelect?.(label);
          }}
          aria-label={label}
          title={label}
        >
          <Icon name={icon} size={16} />
        </button>
      ))}
    </div>
  );
}
