import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import './ScopeEscape.css';

/** A scoped section is the whole platform seen through a filter (founder
 *  2026-08-11) — Countryman Stables' Marketplace is the Marketplace, just
 *  narrowed. So it has to read as ITSELF even at zero, and always offer the
 *  way out to the unfiltered thing.
 *
 *  `ScopeEscape` is the door, sitting to the LEFT of the section's own mark.
 *  `ScopeEmpty` is what an empty filter should say: whose shelf is bare, and
 *  where the full one is. */
export function ScopeEscape({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  return (
    <button className="scope-esc" onClick={() => navigate(to)}>
      <Icon name="arrow-left" size={12} /> {label}
    </button>
  );
}

export function ScopeEmpty({ icon, section, who, to, label }: {
  icon: Parameters<typeof Icon>[0]['name'];
  /** The section's own name — "Library", "Marketplace". */
  section: string;
  /** Whose view this is — "Countryman Stables", "your web". */
  who: string;
  to: string;
  label: string;
}) {
  const navigate = useNavigate();
  return (
    <div className="scope-empty">
      <Icon name={icon} size={20} />
      <p className="scope-empty__line">
        No {section} content from {who} yet!
      </p>
      <button className="scope-empty__link" onClick={() => navigate(to)}>{label}</button>
    </div>
  );
}
