import { useRef, useState } from 'react';
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
  // THE BRAIN IS ALWAYS A DOOR (founder 2026-10-06, "Ai brain consistency"):
  // on, it opens this section's briefing; OFF, it stays grayed and pressing
  // it asks IN PLACE whether to turn the assistant back on — turning on
  // clicks straight through. The popup also says the catch-up truth: while
  // off, nothing here reached any assistant; back on, the briefing reads the
  // section as it stands, so what was missed is caught up there.
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [ask, setAsk] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const on = aiDoorOn(section);
  const go = () => navigate(`/assistant?section=${section}${scope ? `&${scope}` : ''}`);
  return (
    <span className="ai-door-wrap" ref={wrapRef}>
      <button
        className={'ai-door' + (on ? '' : ' is-off')}
        style={size === 34 ? undefined : { width: size, height: size }}
        onClick={() => {
          if (on) { go(); return; }
          const r = wrapRef.current?.getBoundingClientRect();
          setAlignRight(!!r && r.left > window.innerWidth / 2);
          setAsk((a) => !a);
        }}
        aria-label={on ? 'Your assistant’s briefing for this section' : 'Assistant is off here — tap to turn it back on'}
        aria-expanded={on ? undefined : ask}
        title={on
          ? (label ?? 'Your assistant — a briefing for this part of your Lichen life')
          : 'The assistant is off for this section — tap to turn it back on.'}
      >
        <Icon name="brain" size={Math.round(size * 0.47)} />
        {!on && <span className="ai-door__slash" aria-hidden />}
      </button>
      {!on && ask && (
        <span className={'ai-door__pop' + (alignRight ? ' ai-door__pop--right' : '')} role="dialog" aria-label="Turn the assistant back on?">
          <span className="ai-door__pop-text">
            The assistant’s eyes are off here — nothing from this section reaches it.
            Turn it back on and the briefing catches you up: it reads the section as it
            stands, including what happened while it was off.
          </span>
          <span className="ai-door__pop-row">
            <button className="ai-door__pop-on" onClick={() => { setAiDoor(section, true); setAsk(false); go(); }}>
              Turn on &amp; open
            </button>
            <button className="ai-door__pop-no" onClick={() => setAsk(false)}>Keep off</button>
          </span>
        </span>
      )}
    </span>
  );
}
