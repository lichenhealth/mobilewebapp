import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import './AssistantDoor.css';

// The brain lives IN each page (founder 2026-07-28), so it reads as "the
// assistant for THIS part of my life" — and each section's door can be
// switched OFF: consent, per aspect of your presence. Off means the app
// never gathers or sends that section's data to the assistant; you lose the
// integrated help there, and that's a fine choice. Nothing is ambient either
// way — data only ever moves when YOU tap the brain.

export const aiDoorOn = (section: string): boolean =>
  localStorage.getItem(`ai-door-${section}`) !== 'off';
export const setAiDoor = (section: string, on: boolean): void =>
  localStorage.setItem(`ai-door-${section}`, on ? 'on' : 'off');

export default function AssistantDoor({ section, label }: { section: string; label?: string }) {
  const navigate = useNavigate();
  const on = aiDoorOn(section);
  return (
    <button
      className={'ai-door' + (on ? '' : ' is-off')}
      onClick={() => navigate(`/assistant?section=${section}`)}
      aria-label={on ? 'Your assistant’s briefing for this section' : 'Assistant is off here — tap to review'}
      title={on
        ? (label ?? 'Your assistant — a briefing for this part of your Lichen life')
        : 'You’ve switched the assistant off for this section. Tap to change that.'}
    >
      <Icon name="brain" size={16} />
      {!on && <span className="ai-door__slash" aria-hidden />}
    </button>
  );
}
