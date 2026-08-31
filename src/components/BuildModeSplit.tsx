import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { spaceThreadId } from '../lib/assistantFeedApi';
import './BuildModeSplit.css';

/** Where a build door lands. A member's builder → the profile thread's build
 *  page; a SPACE's builder → that space's own build thread (founder
 *  2026-08-22: the shared door hardcoded the member destination, so building
 *  Countryman Stables dropped its admin into their personal thread). */
export interface BuildSpace { id: string; name: string }
function buildDoorPath(back: string, space?: BuildSpace, ask?: string, pagePane = true): string {
  const askPart = ask ? `&ask=${encodeURIComponent(ask)}` : '';
  // `page=1`: arriving from a PAGE builder, the page pane opens with the
  // conversation and the thread dresses as the Public Profile Builder's
  // Claude mode (founder 2026-08-31: landing on a bare chat about tagline/
  // description read as "the Lichen Profile builder", not the website's).
  // The LICHEN builder's door passes pagePane={false} — the plain thread IS
  // the right framing for the in-Lichen profile.
  const pagePart = pagePane ? '&page=1' : '';
  return space
    ? `/assistant/feed?thread=${spaceThreadId(space.id)}&back=${encodeURIComponent(back)}${pagePart}${askPart}`
    : `/assistant?section=profile&intent=build&back=${encodeURIComponent(back)}${askPart}`;
}

/** The fork at the top of any builder (founder 2026-08-11): fill it in
 *  yourself on the left, or hand it to Claude on the right. Manual is the
 *  standing state — the form sits right below — so the split teaches the
 *  AI option without ever standing between someone and their own fields.
 *
 *  `back` rides along so the Snapshot screen can offer the way home in the
 *  founder's words: "back to manual mode". */
export default function BuildModeSplit({ back, onBeforeGo, space, pagePane = true }: {
  back: string;
  /** Persist any unsaved manual work before crossing over (founder
   *  2026-08-21: "import and remember anything you've entered in the manual
   *  build") — the two modes are one document, so what you typed must be IN
   *  the document when Claude opens it. */
  onBeforeGo?: () => Promise<void> | void;
  /** Present on a SPACE's builder — the door then opens the space's own
   *  build thread instead of the member's profile thread. */
  space?: BuildSpace;
  /** false = a builder about the IN-LICHEN profile, not the website — the
   *  thread opens plain, without the page pane or builder dressing. */
  pagePane?: boolean;
}) {
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
          onClick={() => {
            void Promise.resolve(onBeforeGo?.()).then(() =>
              navigate(buildDoorPath(back, space, undefined, pagePane)));
          }}
        >
          <Icon name="brain" size={12} /> Build with Claude
        </button>
      </span>
      <span className="bmode-row__hint">
        {space
          ? `Fill in the fields yourself, or tell Claude about ${space.name}.`
          : 'Fill in the fields yourself, or tell Claude about you.'}
      </span>
    </div>
  );
}

/** The nudge that lives under a single field — same door, arriving with
 *  that field's job in mind. */
export function FillWithClaude({ back, label = 'Fill this out with Claude', ask, onBeforeGo, space }: {
  back: string; label?: string;
  /** The errand this door is for, prefilled into the composer unsent — so the
   *  ask arrives ready to send, or to add to first. */
  ask?: string;
  /** Persist unsaved manual work before crossing over — see BuildModeSplit. */
  onBeforeGo?: () => Promise<void> | void;
  /** Present on a SPACE's builder — the errand goes to its build thread. */
  space?: BuildSpace;
}) {
  const navigate = useNavigate();
  return (
    <button
      className="bmode__inline"
      type="button"
      onClick={() => {
        void Promise.resolve(onBeforeGo?.()).then(() => navigate(buildDoorPath(back, space, ask)));
      }}
    >
      <Icon name="brain" size={12} /> {label}
    </button>
  );
}
