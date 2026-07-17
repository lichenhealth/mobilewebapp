import { ReactNode, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import './ScrollHintRow.css';

interface HintBox { left: number; top: number; size: number; }
interface Hints { l: HintBox | null; r: HintBox | null; }

const near = (a: HintBox | null, b: HintBox | null) =>
  (a === null && b === null) || (!!a && !!b
    && Math.abs(a.left - b.left) < 0.5
    && Math.abs(a.top - b.top) < 0.5
    && Math.abs(a.size - b.size) < 0.5);

/** Horizontal-scroll wrapper that never shows a half-cut icon (founder,
 *  2026-07-17): items straddling EITHER edge hide until scrolling reveals
 *  them whole, and a ghost circle — same size and spot as the icon it
 *  stands in for, hollow center, not clickable — marks each direction
 *  that has more. `gutter` puts the side margins on the WRAPPER, so they
 *  hold at every scroll position instead of scrolling away with the row's
 *  own padding (strip the row's horizontal padding when using it). */
export function ScrollHintRow({ className, role, ariaLabel, gutter, children }: {
  className?: string;
  role?: string;
  ariaLabel?: string;
  gutter?: boolean;
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
    const whole = (k: HTMLElement) => {
      const kr = k.getBoundingClientRect();
      return kr.left >= rect.left - 1 && kr.right <= rect.right + 1;
    };

    let cutR: HTMLElement | null = null;
    let cutL: HTMLElement | null = null;
    for (const kid of kids) {
      const kr = kid.getBoundingClientRect();
      const straddlesR = kr.left < rect.right - 1 && kr.right > rect.right + 1;
      const straddlesL = kr.right > rect.left + 1 && kr.left < rect.left - 1;
      kid.style.visibility = straddlesR || straddlesL ? 'hidden' : '';
      if (straddlesR && !cutR && eligible(kid)) cutR = kid;
      if (straddlesL && eligible(kid)) cutL = kid; // last one wins = nearest the edge
    }
    // Clean breaks: content continues but nothing straddles — stand in for
    // the nearest fully visible item so the direction still shows.
    const wholeKids = kids.filter((k) => eligible(k) && whole(k));
    if (!cutR && el.scrollWidth - el.scrollLeft - el.clientWidth > 8 && wholeKids.length > 1) {
      cutR = wholeKids[wholeKids.length - 1];
      cutR.style.visibility = 'hidden';
    }
    if (!cutL && el.scrollLeft > 8 && wholeKids.length > 1 && wholeKids[0] !== cutR) {
      cutL = wholeKids[0];
      cutL.style.visibility = 'hidden';
    }

    const geom = (child: HTMLElement): HintBox => {
      const anchor = (child.querySelector('[class*="circle"]') as HTMLElement | null) ?? child;
      const ar = anchor.getBoundingClientRect();
      const size = Math.min(ar.width, ar.height);
      return {
        left: ar.left - wrapRect.left + (ar.width - size) / 2,
        top: ar.top - wrapRect.top + (ar.height - size) / 2,
        size,
      };
    };
    // A ghost at a straddler's spot pokes past the edge like the icon it
    // replaces — when it won't fit whole, step inward to the next whole item.
    let r = cutR ? geom(cutR) : null;
    if (r && cutR && r.left + r.size > rect.right - wrapRect.left - 2) {
      const prev = [...wholeKids].reverse().find((k) => k !== cutL && k.style.visibility !== 'hidden');
      if (prev) { prev.style.visibility = 'hidden'; r = geom(prev); }
    }
    let l = cutL ? geom(cutL) : null;
    if (l && cutL && l.left < rect.left - wrapRect.left + 2) {
      const nextKid = wholeKids.find((k) => k !== cutR && k.style.visibility !== 'hidden');
      if (nextKid) { nextKid.style.visibility = 'hidden'; l = geom(nextKid); }
    }

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

  const ghost = (h: HintBox, dir: 'l' | 'r') => (
    <span
      className={'scrollrow__hint' + (dir === 'l' ? ' scrollrow__hint--left' : '')}
      style={{ left: h.left, top: h.top, width: h.size, height: h.size }}
      aria-hidden="true"
    >
      <Icon name="chevron-right" size={13} />
    </span>
  );

  return (
    <div className={'scrollrow' + (gutter ? ' scrollrow--gutter' : '')} ref={wrapRef}>
      <div className={className} ref={ref} role={role} aria-label={ariaLabel}>{children}</div>
      {hints.l && ghost(hints.l, 'l')}
      {hints.r && ghost(hints.r, 'r')}
    </div>
  );
}
