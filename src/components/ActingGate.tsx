import { Icon, IconName } from './Icon';
import { useActing } from '../acting/ActingProvider';
import './ActingGate.css';

/** THE HAT GATE (founder 2026-10-21, after /organize showed her personal
 *  shelf while acting as Lichen Alpha Testers — "This keeps happening. Can
 *  we put that bug to bed forever?"): the ONE shared card for a
 *  PERSONAL-ONLY screen reached while wearing an entity's hat. Concierge's
 *  2026-10-06 gate is the pattern this generalizes — never show personal
 *  content under an entity's name, and never navigate someone to a personal
 *  page to fix it: say whose screen this is and offer to continue as
 *  yourself IN PLACE (`setActor`, the standing never-navigate-mid-act rule).
 *
 *  Usage, at the top of a personal-only screen's render:
 *    const { actor, ready: actingReady } = useActing();
 *    if (!actingReady) return null;            // never decide on the boot default
 *    if (actor.type !== 'self') return <ActingGate what="…" icon="…" />;
 *
 *  `what` names the screen's own noun ("a Drive shelf to arrange",
 *  "a to-do list"); the card writes the rest. Any NEW personal-only screen
 *  mounts this gate in the same commit it ships — that is what puts the
 *  whose-screen bug class to bed. */
export function ActingGate({ what, icon = 'profile' }: { what: string; icon?: IconName }) {
  const { actor, setActor } = useActing();
  if (actor.type === 'self') return null;
  return (
    <div className="actgate">
      <Icon name={icon} size={22} />
      <h3 className="actgate__title">
        {actor.name} doesn&rsquo;t have {what} yet
      </h3>
      <p className="actgate__sub">
        This is a personal screen — yours lives under your own name, and
        nothing of yours shows while you&rsquo;re acting as {actor.name}.
      </p>
      <button className="btn btn-primary" onClick={() => setActor({ type: 'self' })}>
        Continue as yourself
      </button>
    </div>
  );
}
