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
  return (
    <div className="bmode">
      <button className="bmode__side is-on" type="button">
        <strong>Build manually</strong>
        <em>Fill in the fields yourself</em>
      </button>
      <button
        className="bmode__side bmode__side--ai"
        type="button"
        onClick={() => navigate(`/assistant/feed?thread=profile&back=${encodeURIComponent(back)}`)}
      >
        <strong><Icon name="brain" size={14} /> Build with Claude</strong>
        <em>Tell it about you, or paste your website</em>
      </button>
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
        `/assistant/feed?thread=profile&back=${encodeURIComponent(back)}`
        + (ask ? `&ask=${encodeURIComponent(ask)}` : ''),
      )}
    >
      <Icon name="brain" size={12} /> {label}
    </button>
  );
}
