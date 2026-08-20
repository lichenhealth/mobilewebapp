import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import './BuildModeSplit.css';

/** The fork at the top of any builder (founder 2026-08-11): fill it in
 *  yourself on the left, or hand it to Claude on the right. Manual is the
 *  standing state — the form sits right below — so the split teaches the
 *  AI option without ever standing between someone and their own fields.
 *
 *  `back` rides along so the Snapshot screen can offer the way home in the
 *  founder's words: "back to manual mode". */
export default function BuildModeSplit({ back }: { back: string }) {
  const navigate = useNavigate();
  // The app's ONE segmented-toggle idiom (view-toggle — the same control as
  // ADMIN | LICHEN VIEW | PUBLIC VIEW right above it; founder 2026-08-20:
  // "the other button doesn't go away, it just signifies a toggle"). Manual
  // is the side you're on; the other side switches to building with Claude —
  // the assistant's page for this section, arriving with build context.
  return (
    <div className="view-toggle-row bmode-row">
      <span className="view-toggle" role="group" aria-label="How to build this page">
        <button className="view-toggle__side is-on" type="button">
          Build manually
        </button>
        <button
          className="view-toggle__side"
          type="button"
          onClick={() => navigate(`/assistant?section=profile&intent=build&back=${encodeURIComponent(back)}`)}
        >
          <Icon name="brain" size={12} /> Build with Claude
        </button>
      </span>
      <span className="bmode-row__hint">Fill in the fields yourself, or tell Claude about you.</span>
    </div>
  );
}

/** The nudge that lives under a single field — same door, arriving with
 *  that field's job in mind. */
export function FillWithClaude({ back, label = 'Fill this out with Claude', ask }: {
  back: string; label?: string;
  /** The errand this door is for, prefilled into the composer unsent — so the
   *  ask arrives ready to send, or to add to first. */
  ask?: string;
}) {
  const navigate = useNavigate();
  return (
    <button
      className="bmode__inline"
      type="button"
      onClick={() => navigate(
        `/assistant?section=profile&intent=build&back=${encodeURIComponent(back)}`
        + (ask ? `&ask=${encodeURIComponent(ask)}` : ''),
      )}
    >
      <Icon name="brain" size={12} /> {label}
    </button>
  );
}
