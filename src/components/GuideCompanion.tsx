import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { GUIDES, endGuide, onGuideChange, readGuide, setGuideStep } from '../lib/guide';
import { markPrompt } from '../lib/promptsApi';
import { PRESENCE_LESSONS } from './PresencePrompt';
import './GuideCompanion.css';

/* The floating Claude companion (founder 2026-10-19 — "kinda like clippy the
 * paperclip"): rides every screen while a walkthrough is active, names the
 * screen it stands on, and walks the member to the next one. Templated and
 * instant — the "Ask me to do it" door is where the real model conversation
 * begins, prefilled UNSENT in the general thread. Dismiss or finish marks
 * the member (member_prompts `guide-<path>`) so it never returns. */

export default function GuideCompanion() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [state, setState] = useState(readGuide);

  useEffect(() => onGuideChange(() => setState(readGuide())), []);

  // A step that TEACHES something another prompt would pop for counts as
  // that prompt's whole lesson (founder 2026-10-19) — the candle step stands
  // in for all of PresencePrompt's visits, so the bubble never doubles up
  // after the tour either.
  useEffect(() => {
    if (!state || !user) return;
    if (GUIDES[state.path][state.step]?.teaches === 'presence') {
      void markPrompt(user.id, 'presence', PRESENCE_LESSONS);
    }
  }, [state?.path, state?.step, user?.id]);

  if (!state || !user) return null;
  const steps = GUIDES[state.path];
  const step = steps[state.step];
  if (!step) return null;
  const last = state.step === steps.length - 1;

  function next() {
    if (!state) return;
    if (last) { endGuide(user?.id, state.path); return; }
    const to = steps[state.step + 1];
    setGuideStep(state.path, state.step + 1);
    navigate(to.route);
  }

  return (
    <aside className="guide" aria-label="Claude's walkthrough">
      <button type="button" className="guide__close" aria-label="End the walkthrough"
        onClick={() => endGuide(user?.id, state.path)}>×</button>
      <div className="guide__head">
        <img className="guide__face" src="/claude-avatar.svg" alt="" />
        <div className="guide__who">
          <strong>Claude</strong>
          <span>walking you in · {state.step + 1} of {steps.length}</span>
        </div>
      </div>
      <h2 className="guide__title">{step.title}</h2>
      <p className="guide__body">{step.body}</p>
      <div className="guide__row">
        <button type="button" className="btn btn-primary guide__next" onClick={next}>
          {last ? 'Done ✓' : 'Next ›'}
        </button>
        <button type="button" className="guide__ask"
          onClick={() => navigate('/assistant/feed?thread=general&convo=new&ask=' + encodeURIComponent(step.ask))}>
          Ask me to do it
        </button>
      </div>
    </aside>
  );
}
