import { useState } from 'react';
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

// THE HINT IS SMART PER SECTION (founder 2026-11-02, rewriting Profile
// admin's "Or just ask": "let's change the copy to read 'Or work with Ai to
// build and edit your profile.' Have the text be smart relevant to each
// section. So for marketplace, 'Or work with Ai to manage goods and
// services on Marketplace' and have 'Or work with Ai to manage your Travel'
// for travel, 'Or work with Ai to build and manage your courses' etc"):
// ONE vocabulary — the full sentences for hint LINES beside a brain
// (Profile/SpaceProfile admin today; any new manage surface joins), and the
// short twins for the brain circles' tooltips, which are nowrap pills.
// profile/market/travel/courses are her verbatim lines; the rest are easy
// one-line rewords in her grammar.
const AI_HINTS: Record<string, { line: string; tip: string }> = {
  profile: { line: 'Or work with AI to build and edit your profile.', tip: 'Work with AI — your profile' },
  market: { line: 'Or work with AI to manage goods and services on Marketplace.', tip: 'Work with AI — Marketplace' },
  travel: { line: 'Or work with AI to manage your Travel.', tip: 'Work with AI — Travel' },
  courses: { line: 'Or work with AI to build and manage your courses.', tip: 'Work with AI — your courses' },
  calendar: { line: 'Or work with AI to manage your calendar and sessions.', tip: 'Work with AI — your calendar' },
  events: { line: 'Or work with AI to create and manage your events.', tip: 'Work with AI — Events' },
  concierge: { line: 'Or work with AI on your care.', tip: 'Work with AI — your care' },
  currentcy: { line: 'Or work with AI on your Current-cy.', tip: 'Work with AI — Current-cy' },
  mycelium: { line: 'Or work with AI on your web.', tip: 'Work with AI — My-celium' },
  maps: { line: 'Or work with AI on Maps.', tip: 'Work with AI — Maps' },
  chat: { line: 'Or work with AI across your conversations.', tip: 'Work with AI — Chat' },
};

/** The full hint sentence for a section's brain row. */
export const aiWorkHint = (section: string): string =>
  AI_HINTS[section]?.line ?? 'Or work with AI here.';
/** The short tooltip a section's brain circle wears. */
const aiTip = (section: string): string => AI_HINTS[section]?.tip ?? 'Assistant';

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
  // THE BRAIN IS ALWAYS A DOOR, AND NOW IT WEARS THE HOMEPAGE'S › TAB
  // (founder 2026-11-04, retiring the 2026-10-06 ask-in-place popup after it
  // rendered BURIED under Marketplace's lens circles: "let's have clicking
  // it turn it on and that creates the click thru arrow, so you can click
  // thru to it, just like homepage"): a lit brain carries the peach › tab
  // (the icon-row__door grammar) that opens this section's briefing — the
  // circle opens it too, members learned brain=briefing long ago. An OFF
  // brain turns the assistant back ON right here in one tap — no popup, no
  // navigation; the circle lighting and the tab appearing are the receipt.
  // The catch-up truth needs no card now: consent gates at READ time, so
  // the briefing itself reads the section as it stands, including whatever
  // happened while it was off. Turning OFF stays a deliberate act elsewhere
  // (Profile → Privacy, or the brief's own checkbox) — a tap must never
  // silently close the eyes it just opened.
  const [, bump] = useState(0);
  const on = aiDoorOn(section);
  const go = () => navigate(`/assistant?section=${section}${scope ? `&${scope}` : ''}`);
  return (
    <span className="ai-door-wrap">
      <button
        className={'ai-door' + (on ? '' : ' is-off')}
        style={size === 34 ? undefined : { width: size, height: size }}
        onClick={() => {
          if (on) { go(); return; }
          setAiDoor(section, true);
          bump((n) => n + 1);   // aiDoorOn reads a module cache — re-render to light up
        }}
        aria-label={on ? (label ?? 'Your assistant’s briefing for this section') : 'Assistant is off here — tap to turn it back on'}
        data-tip={on ? aiTip(section) : 'Assistant — off. Tap to turn on'}
      >
        <Icon name="brain" size={Math.round(size * 0.47)} />
        {!on && <span className="ai-door__slash" aria-hidden />}
      </button>
      {on && (
        <button
          className="ai-door__tab"
          onClick={go}
          aria-label={label ?? 'Open the briefing'}
          data-tip="Open the briefing"
        >
          <Icon name="chevron-right" size={11} />
        </button>
      )}
    </span>
  );
}
