import { ReactNode, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import './ScrollHintRow.css';

interface HintBox { left: number; top: number; size: number; }

/** Horizontal-scroll wrapper that never shows a half-cut icon (founder,
 *  2026-07-17): the first item straddling the right edge is hidden until
 *  scrolling reveals it fully, and a ghost circle — same size and spot as
 *  the icon it stands in for, hollow center, not clickable — holds its
 *  place as the "more this way" prompt. Pass the row's own classes via
 *  className; they land on the inner scroller so existing CSS applies. */
export function ScrollHintRow({ className, role, ariaLabel, children }: {
  className?: string;
  role?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState<HintBox | null>(null);

  const update = () => {
    const el = ref.current, wrap = wrapRef.current;
    if (!el || !wrap) return;
    const rect = el.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    let firstCut: HTMLElement | null = null;
    for (const kid of Array.from(el.children) as HTMLElement[]) {
      const kr = kid.getBoundingClientRect();
      // Straddling the right edge = would render sliced. Hide until whole.
      const cut = kr.left < rect.right - 1 && kr.right > rect.right + 1;
      kid.style.visibility = cut ? 'hidden' : '';
      if (cut && !firstCut && kr.width >= 24) firstCut = kid;
    }
    let next: HintBox | null = null;
    if (firstCut) {
      // Anchor the ghost to the item's inner icon circle when it has one
      // (marketplace/events slots are circle-plus-label columns).
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
      next = geom(firstCut);
      // The cut item pokes past the edge, so a ghost at ITS spot would clip
      // too. When it doesn't fit whole, stand in for the last fully visible
      // icon instead (hiding it as well) — the ghost is always intact.
      const boundary = rect.right - wrapRect.left;
      if (next.left + next.size > boundary - 2) {
        const kids = Array.from(el.children) as HTMLElement[];
        for (let j = kids.indexOf(firstCut) - 1; j >= 0; j--) {
          if (kids[j].getBoundingClientRect().width >= 24) {
            kids[j].style.visibility = 'hidden';
            next = geom(kids[j]);
            break;
          }
        }
      }
    }
    // Same-value guard: update() runs after every render, so returning the
    // previous reference on no-change is what stops a render loop.
    setHint((prev) => {
      if (prev === null && next === null) return prev;
      if (prev && next
        && Math.abs(prev.left - next.left) < 0.5
        && Math.abs(prev.top - next.top) < 0.5
        && Math.abs(prev.size - next.size) < 0.5) return prev;
      return next;
    });
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

  return (
    <div className="scrollrow" ref={wrapRef}>
      <div className={className} ref={ref} role={role} aria-label={ariaLabel}>{children}</div>
      {hint && (
        <span
          className="scrollrow__hint"
          style={{ left: hint.left, top: hint.top, width: hint.size, height: hint.size }}
          aria-hidden="true"
        >
          <Icon name="chevron-right" size={13} />
        </span>
      )}
    </div>
  );
}
