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

/** A thin shelf deserves the same pointer as a bare one (founder 2026-08-13:
 *  "it should also have a notification in the results section, if there are
 *  none, OR JUST A FEW, to go to Lichen's marketplace to get more results").
 *  Sits UNDER the results rather than replacing them — what's here is still
 *  the point; this only says where the rest lives. */
export const FEW_RESULTS = 5;

export function ScopeMore({ count, section, who, to, label }: {
  count: number;
  section: string;
  who: string;
  to: string;
  label: string;
}) {
  const navigate = useNavigate();
  if (count === 0 || count >= FEW_RESULTS) return null;   // 0 is ScopeEmpty's job
  return (
    <div className="scope-more">
      <p className="scope-more__line">
        That&rsquo;s all {count === 1 ? 'the one thing' : `${count} things`} {who} has
        in {section} so far.
      </p>
      <button className="scope-more__link" onClick={() => navigate(to)}>{label}</button>
    </div>
  );
}
