import { useEffect, useState } from 'react';
import { CONSENT_SECTIONS, listConsentOff, setConsent } from '../lib/assistantConsentApi';
import './AssistantConsentList.css';

// The member's own de-selection list (founder 2026-08-17): "You can say 'all
// on' or you can de-select certain aspects of your identity." Everything is
// on by default — collaboration between Ai and Oi is the premise of the
// platform, so this is the one place unknown IS yes — and each unticked box
// is one deliberate "not here", stored as one row the edge functions check
// server-side. The brain on each page flips the same switch in place.

export default function AssistantConsentList() {
  const [off, setOff] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    void listConsentOff().then((rows) => {
      if (!live) return;
      setOff(new Set(rows.filter((r) => r.scope_type === 'section').map((r) => r.scope_id)));
      setReady(true);
    });
    return () => { live = false; };
  }, []);

  const toggle = (id: string) => {
    const turningOn = off.has(id);
    setOff((cur) => {
      const next = new Set(cur);
      if (turningOn) next.delete(id); else next.add(id);
      return next;
    });
    setConsent('section', id, turningOn);
  };

  return (
    <div className="aicl" aria-busy={!ready}>
      <div className="aicl__grid">
        {CONSENT_SECTIONS.map((s) => (
          <label key={s.id} className={'aicl__item' + (off.has(s.id) ? ' is-off' : '')}>
            <input
              type="checkbox"
              checked={!off.has(s.id)}
              disabled={!ready}
              onChange={() => toggle(s.id)}
            />
            <span>{s.label}</span>
          </label>
        ))}
      </div>
      <p className="aicl__note">
        Unticked, the assistant never reads, gathers or answers in that part of
        your Lichen life — on any of your devices. The brain on each page flips
        the same switch.
      </p>
    </div>
  );
}
