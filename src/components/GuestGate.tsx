import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './GuestGate.css';

/** THE GUEST GATE (founder 2026-11-01, superseding the same-day members-only
 *  nav after seeing the ☰ and bell still standing: "maybe we add back the
 *  lower nav and keep those pieces and when someone tries to use the nav,
 *  there's a pop up that says sign in to use platform features, or ask to
 *  join?"). A signed-out visitor sees the whole app chrome; tapping any
 *  member door (a nav tab, the ☰, the bell) opens this one popup instead —
 *  Sign in, or Request to join (→ the /signup knock). Event-driven so any
 *  surface can ask without wiring state through the tree. */
export function askGuestGate(): void {
  window.dispatchEvent(new Event('lichen:guest-gate'));
}

export default function GuestGate() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener('lichen:guest-gate', h);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('lichen:guest-gate', h); window.removeEventListener('keydown', esc); };
  }, []);
  if (!open) return null;
  return (
    <div className="ggate" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Members only">
      <div className="ggate__card" onClick={(e) => e.stopPropagation()}>
        {/* A visible way out (founder 2026-11-02: "put an 'x' at the top,
            right so people know they can x out" — clicking the veil still
            closes it too, deliberately kept). */}
        <button type="button" className="ggate__x" aria-label="Close" onClick={() => setOpen(false)}>
          ×
        </button>
        <p className="ggate__msg">
          That part of Lichen is for members — sign in to use platform
          features, or ask to join.
        </p>
        <div className="ggate__row">
          <button className="btn btn-primary ggate__btn" onClick={() => { setOpen(false); navigate('/login'); }}>
            Sign in
          </button>
          <button className="btn ggate__btn" onClick={() => { setOpen(false); navigate('/signup'); }}>
            Request to join
          </button>
        </div>
      </div>
    </div>
  );
}
