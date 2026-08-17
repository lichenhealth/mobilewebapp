import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { consentOn, setConsent } from '../lib/assistantConsentApi';
import './AssistantDoor.css';

// The brain lives IN each page (founder 2026-07-28), so it reads as "the
// assistant for THIS part of my life" — and each section's door can be
// switched OFF: consent, per aspect of your presence. Off means the app
// never gathers or sends that section's data to the assistant; you lose the
// integrated help there, and that's a fine choice. Nothing is ambient either
// way — data only ever moves when YOU tap the brain.
//
// Since 2026-08-17 the decision itself lives in the DATABASE
// (assistant_consent — see assistantConsentApi.ts): a new phone is not a
// changed mind, and the edge functions check the same rows server-side.

export const aiDoorOn = (section: string): boolean =>
  consentOn('section', section);
export const setAiDoor = (section: string, on: boolean): void =>
  setConsent('section', section, on);

/** `size` matches the door to the circles it sits beside — 34px on its own,
 *  30px in a row of mkt__action circles (founder 2026-08-08: the brain must
 *  not read larger than the magnifier and the +). Size means "you are here"
 *  now; it mustn't also mean "assistant". */
export default function AssistantDoor({ section, label, size = 34, scope }:
  { section: string; label?: string; size?: number;
    /** Extra query the briefing needs to know WHICH thing in the section it's
     *  reading — e.g. `collection=<id>` for one course. */
    scope?: string }) {
  const navigate = useNavigate();
  const on = aiDoorOn(section);
  return (
    <button
      className={'ai-door' + (on ? '' : ' is-off')}
      style={size === 34 ? undefined : { width: size, height: size }}
      onClick={() => navigate(`/assistant?section=${section}${scope ? `&${scope}` : ''}`)}
      aria-label={on ? 'Your assistant’s briefing for this section' : 'Assistant is off here — tap to review'}
      title={on
        ? (label ?? 'Your assistant — a briefing for this part of your Lichen life')
        : 'You’ve switched the assistant off for this section. Tap to change that.'}
    >
      <Icon name="brain" size={Math.round(size * 0.47)} />
      {!on && <span className="ai-door__slash" aria-hidden />}
    </button>
  );
}
