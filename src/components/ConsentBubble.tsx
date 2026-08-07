import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import './ConsentBubble.css';

/** A setting that comes to you (founder 2026-08-07: "a bubble, if/when the
 *  person gets to the pertinent decision in their platform journey... with a
 *  link that says Edit <setting name>, which takes you to the exact place in
 *  your profile where you can edit even more settings").
 *
 *  Lichen's consents are opt-OUT and uniform, which is only fair if people
 *  actually meet them. Buried in a settings page they're technically available
 *  and practically invisible — so each one surfaces once, anchored to the
 *  control it governs, at the moment it starts mattering: presence when you
 *  open the app, findability when you first browse the member list.
 *
 *  Every bubble carries the same Edit door, so learning one teaches the rest.
 *
 *  The bubble points at a real element. If the anchor isn't on screen yet it
 *  simply doesn't render — a tooltip aimed at nothing is worse than silence. */
// ONE AT A TIME. Presence fires on app open and findability on the member
// list; land on /directory from a cold start and both were on screen at once,
// arguing for attention. First to mount holds the floor, the next claims it
// when that one closes.
let holder: symbol | null = null;
const waiting = new Set<() => void>();

export default function ConsentBubble({
  anchor, title, children, actions, editLabel, editTo, onClose, align = 'below',
}: {
  anchor: HTMLElement | null;
  title: string;
  children: ReactNode;
  /** Custom choices. Without them the bubble is purely informative. */
  actions?: ReactNode;
  /** "Presence", "who can find you" — the words after "Edit". */
  editLabel: string;
  editTo: string;
  onClose: () => void;
  align?: 'below';
}) {
  const navigate = useNavigate();
  const [box, setBox] = useState<{ top: number; left: number; tail: number; w: number } | null>(null);

  const mine = useRef(Symbol('cbub'));
  const [hasFloor, setHasFloor] = useState(false);
  useEffect(() => {
    const claim = () => {
      if (holder === null) holder = mine.current;
      setHasFloor(holder === mine.current);
    };
    waiting.add(claim);
    claim();
    return () => {
      waiting.delete(claim);
      if (holder === mine.current) {
        holder = null;
        waiting.forEach((fn) => fn());
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (!anchor) { setBox(null); return; }
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const w = Math.min(320, window.innerWidth - 16);
      const centre = a.left + a.width / 2;
      const left = Math.max(8, Math.min(centre - w / 2, window.innerWidth - w - 8));
      setBox({ top: a.bottom + 10, left, tail: centre - left, w });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, align]);

  // Lift whatever we're pointing at, so the eye lands on the control itself.
  useEffect(() => {
    if (!anchor || !hasFloor) return;   // a bubble waiting its turn stays quiet
    anchor.classList.add('is-pointed');
    return () => anchor.classList.remove('is-pointed');
  }, [anchor, hasFloor]);

  if (!anchor || !box || !hasFloor) return null;

  return (
    <>
      <div className="cbub__catch" onClick={onClose} />
      <div className="cbub" role="dialog" aria-label={title}
        style={{ top: box.top, left: box.left, width: box.w }}>
        <span className="cbub__tail" style={{ left: box.tail }} aria-hidden />
        <h2 className="cbub__title">{title}</h2>
        <div className="cbub__body">{children}</div>

        {actions ? <div className="cbub__acts">{actions}</div> : (
          <div className="cbub__acts">
            <button className="btn btn-primary" onClick={onClose}>Got it</button>
          </div>
        )}

        <button className="cbub__edit"
          onClick={() => { onClose(); navigate(editTo); }}>
          Edit {editLabel}
        </button>
      </div>
    </>
  );
}

/** Seen-once bookkeeping. Per device, which is the right grain for a teaching
 *  prompt — a new phone is a new place to be told. */
export const consentSeen = (id: string): boolean =>
  !!localStorage.getItem('consent-seen-' + id);
export const markConsentSeen = (id: string): void => {
  localStorage.setItem('consent-seen-' + id, '1');
};
