import { Icon, IconName } from '../components/Icon';
import './Placeholder.css';

interface PlaceholderProps {
  title: string;
  icon: IconName;
  intro: string;
  hint?: string;
}

export default function Placeholder({ title, icon, intro, hint }: PlaceholderProps) {
  return (
    <div className="placeholder">
      <div className="placeholder__mark" aria-hidden="true">
        <Icon name={icon} size={28} strokeWidth={1.3} />
      </div>
      <p className="eyebrow">Lichen · {title}</p>
      <h1 className="placeholder__title">
        <span className="display-italic">Not here yet —</span>{' '}
        <span className="display">growing into place.</span>
      </h1>
      <p className="placeholder__body">{intro}</p>
      {hint && <p className="placeholder__hint">{hint}</p>}
    </div>
  );
}
