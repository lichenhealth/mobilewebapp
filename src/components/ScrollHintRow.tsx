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
 *  the row's own horizontal padding when using it). */
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

    for (const kid of kids) {
      const kr = kid.getBoundingClientRect();
      const straddlesR = kr.left < rect.right - 1 && kr.right > rect.right + 1;
      const straddlesL = kr.right > rect.left + 1 && kr.left < rect.left - 1;
      kid.style.visibility = straddlesR || straddlesL ? 'hidden' : '';
    }
    const overflowR = el.scrollWidth - el.scrollLeft - el.clientWidth > 8;
    const overflowL = el.scrollLeft > 8;

    // The pinned chevron needs ~18px of clear floor — if the nearest whole
    // icon crowds the edge, it steps aside too.
    const visible = () => kids.filter((k) => eligible(k) && k.style.visibility !== 'hidden'
      && k.getBoundingClientRect().left >= rect.left - 1
      && k.getBoundingClientRect().right <= rect.right + 1);
    if (overflowR) {
      const vis = visible();
      const last = vis[vis.length - 1];
      if (last && rect.right - last.getBoundingClientRect().right < 18) last.style.visibility = 'hidden';
    }
    if (overflowL) {
      const vis = visible();
      const first = vis[0];
      if (first && first.getBoundingClientRect().left - rect.left < 18) first.style.visibility = 'hidden';
    }

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

  const ghost = (h: HintBox, side: 'l' | 'r') => (
    <span
      className={'scrollrow__hint scrollrow__hint--' + side}
      style={{ top: h.top, height: h.size }}
      aria-hidden="true"
    >
      <Icon name="chevron-right" size={16} />
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
