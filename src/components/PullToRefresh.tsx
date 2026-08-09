import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import './PullToRefresh.css';

// Pull-to-refresh (founder 2026-08-09): installed PWAs have no browser chrome
// to refresh from, so an already-open window keeps running whatever build it
// last loaded until autoUpdate.ts's own checks happen to fire (focus/interval).
// This gives members a way to force it themselves, the way any native app
// would — drag down from the top. Touch AND wheel (for the installed
// DESKTOP app, no touchscreen involved) both drive the same gesture.
// Standalone-only: a normal browser tab already has its own refresh (pull,
// Cmd+R, F5) — this would just be redundant chrome there.

const REFRESH_THRESHOLD = 70;
const MAX_PULL = 90;
const WHEEL_IDLE_MS = 150;

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}

/** True if some scrollable ancestor between `el` and <body> still has room to
 *  scroll up — that gesture belongs to that inner region (a chat thread's
 *  message list, a modal), not to this page-level pull. */
function hasScrollableAncestorAboveTop(target: EventTarget | null): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    const scrollable = /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
    if (scrollable && node.scrollTop > 0) return true;
    node = node.parentElement;
  }
  return false;
}

const STANDALONE = isStandalone();

export function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const wheelAccum = useRef(0);
  const wheelTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!STANDALONE) return;

    function settle() {
      setPull((p) => {
        if (p >= REFRESH_THRESHOLD) {
          setRefreshing(true);
          window.setTimeout(() => location.reload(), 250);
          return REFRESH_THRESHOLD;
        }
        return 0;
      });
    }
    function resetWheel() {
      wheelAccum.current = 0;
      if (wheelTimer.current) { window.clearTimeout(wheelTimer.current); wheelTimer.current = null; }
      setPull(0);
    }

    function onTouchStart(e: TouchEvent) {
      if (refreshing) return;
      if (window.scrollY > 0 || hasScrollableAncestorAboveTop(e.target)) { startY.current = null; return; }
      startY.current = e.touches[0].clientY;
    }
    function onTouchMove(e: TouchEvent) {
      if (startY.current == null || refreshing) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) { setPull(0); return; }
      setPull(Math.min(MAX_PULL, dy * 0.5)); // resistance — a 1:1 drag feels twitchy
      if (dy > 4 && e.cancelable) e.preventDefault(); // own the gesture once it's clearly a pull
    }
    function onTouchEnd() {
      if (startY.current == null) return;
      startY.current = null;
      settle();
    }
    function onWheel(e: WheelEvent) {
      if (refreshing) return;
      if (window.scrollY > 0 || hasScrollableAncestorAboveTop(e.target)) { resetWheel(); return; }
      if (e.deltaY < 0) {
        wheelAccum.current = Math.min(MAX_PULL, wheelAccum.current + -e.deltaY * 0.4);
        setPull(wheelAccum.current);
        if (wheelTimer.current) window.clearTimeout(wheelTimer.current);
        wheelTimer.current = window.setTimeout(() => { settle(); wheelAccum.current = 0; }, WHEEL_IDLE_MS);
      } else if (e.deltaY > 0) {
        resetWheel();
      }
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('wheel', onWheel);
      if (wheelTimer.current) window.clearTimeout(wheelTimer.current);
    };
  }, [refreshing]);

  if (!STANDALONE) return null;

  const progress = Math.min(1, pull / REFRESH_THRESHOLD);
  return (
    <div className={'ptr' + (pull > 0 || refreshing ? ' is-active' : '')}
      style={{ height: refreshing ? REFRESH_THRESHOLD : pull }}>
      <div className={'ptr__spinner' + (refreshing ? ' is-spinning' : '')}
        style={refreshing ? undefined : { transform: `rotate(${180 - progress * 180}deg)`, opacity: Math.max(0.35, progress) }}>
        <Icon name="arrow-up" size={18} />
      </div>
    </div>
  );
}
