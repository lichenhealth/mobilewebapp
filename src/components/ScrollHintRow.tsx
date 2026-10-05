import { ReactNode, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import './ScrollHintRow.css';

interface HintBox { top: number; size: number; }
interface Hints { l: HintBox | null; r: HintBox | null; }

const near = (a: HintBox | null, b: HintBox | null) =>
  (a === null && b === null) || (!!a && !!b
    && Math.abs(a.top - b.top) < 0.5
    && Math.abs(a.size - b.size) < 0.5);

/** Horizontal-scroll wrapper that never shows a half-cut icon (founder,
 *  2026-07-17): items straddling either edge hide until scrolled whole,
 *  and a bare peach chevron PINNED at the content edge — the same line
 *  the tab text aligns to — marks each direction that has more. Icons
 *  pack the full row width up to the chevron. `gutter` puts the side
 *  margins on the WRAPPER so they hold at every scroll position (strip
 *  the row's own horizontal padding when using it).
 *
 *  `fade` (founder 2026-08-13, "fill the space — maximum visibility"): the
 *  hide-until-whole rule was written for 48px icon circles, where the hidden
 *  item's leftover layout box reads as breathing room. On a TEXT-chip row the
 *  same rule leaves an 85–120px hole — the "empty space before the chevron"
 *  the founder circled was a hidden chip's box. Fade mode never hides:
 *  a cut chip tapers out under a gradient instead, so every pixel of the row
 *  is a real, visible option. */
export function ScrollHintRow({ className, role, ariaLabel, gutter, fade, children }: {
  className?: string;
  role?: string;
  ariaLabel?: string;
  gutter?: boolean;
  fade?: boolean;
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [hints, setHints] = useState<Hints>({ l: null, r: null });

  const update = () => {
    const el = ref.current, wrap = wrapRef.current;
    if (!el || !wrap) return;
    const rect = el.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const kids = Array.from(el.children) as HTMLElement[];
    const eligible = (k: HTMLElement) => k.getBoundingClientRect().width >= 24;

    for (const kid of kids) {
      const kr = kid.getBoundingClientRect();
      const straddlesR = kr.left < rect.right - 1 && kr.right > rect.right + 1;
      const straddlesL = kr.right > rect.left + 1 && kr.left < rect.left - 1;
      kid.style.visibility = !fade && (straddlesR || straddlesL) ? 'hidden' : '';
    }
    const overflowR = el.scrollWidth - el.scrollLeft - el.clientWidth > 8;
    const overflowL = el.scrollLeft > 8;

    // The old "clear floor" rule — hiding the nearest WHOLE icon when it sat
    // within 18px of the edge so the chevron had room — is RETIRED (founder
    // 2026-10-05, circling the one-icon hole it left: "there's room for 1
    // more icon"). A whole icon always shows; the chevron wears a narrow
    // bone taper instead, so it stays legible if an icon edge comes close.

    // Vertical center: the icons' circle line (first hidden child if any,
    // else the first eligible child).
    const anchorChild = kids.find((k) => k.style.visibility === 'hidden' && eligible(k))
      ?? kids.find(eligible);
    let box: HintBox | null = null;
    if (anchorChild) {
      const anchor = (anchorChild.querySelector('[class*="circle"]') as HTMLElement | null) ?? anchorChild;
      const ar = anchor.getBoundingClientRect();
      const size = Math.min(ar.width, ar.height);
      box = { top: ar.top - wrapRect.top + (ar.height - size) / 2, size };
    }

    const l = overflowL && box ? box : null;
    const r = overflowR && box ? box : null;
    // Same-value guard: update() runs after every render — returning the
    // previous reference on no-change is what stops a render loop.
    setHints((prev) => (near(prev.l, l) && near(prev.r, r) ? prev : { l, r }));
  };

  // No deps: re-measure after every render so chip/filter changes are caught.
  useEffect(update);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); };
  }, []);

  // THE ARROW IS A BUTTON NOW (founder 2026-10-05: with a mouse there was
  // no way to move the row — "you should also be able to click the arrow to
  // create movement"): a tap scrolls most of a row-width in that direction;
  // the scroll listener re-runs update(), so hides and hints follow along.
  const nudge = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(el.clientWidth - 72, 120), behavior: 'smooth' });
  };
  const ghost = (h: HintBox, side: 'l' | 'r') => (
    <button
      type="button"
      className={'scrollrow__hint scrollrow__hint--' + side + (fade ? ' scrollrow__hint--fade' : '')}
      style={{ top: h.top, height: h.size }}
      aria-label={side === 'r' ? 'Scroll for more' : 'Scroll back'}
      onClick={() => nudge(side === 'r' ? 1 : -1)}
    >
      <Icon name="chevron-right" size={16} />
    </button>
  );

  return (
    <div className={'scrollrow' + (gutter ? ' scrollrow--gutter' : '')} ref={wrapRef}>
      <div className={className} ref={ref} role={role} aria-label={ariaLabel}>{children}</div>
      {hints.l && ghost(hints.l, 'l')}
      {hints.r && ghost(hints.r, 'r')}
    </div>
  );
}
