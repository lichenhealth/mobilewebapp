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

export function ScopeEmpty({ icon, who, what, to, label, note }: {
  icon: Parameters<typeof Icon>[0]['name'];
  /** Whose view this is — "Countryman Stables", "Your web". */
  who: string;
  /** What isn't here yet, in their words — "goods, services or places". */
  what: string;
  to: string;
  label: string;
  /** An extra line when the viewer could do something about it. */
  note?: string;
}) {
  const navigate = useNavigate();
  return (
    <div className="scope-empty">
      <Icon name={icon} size={20} />
      <p><span className="display-italic">No {what} here yet.</span></p>
      <p className="scope-empty__sub">
        {who} hasn&rsquo;t put anything on this shelf — it isn&rsquo;t missing, it&rsquo;s just early.
      </p>
      {note && <p className="scope-empty__sub">{note}</p>}
      <button className="btn scope-empty__go" onClick={() => navigate(to)}>{label}</button>
    </div>
  );
}
