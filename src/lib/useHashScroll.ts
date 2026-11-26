import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** CLICK THROUGH AS FAR AS IT GOES (founder 2026-11-26: "click through as
 *  far as you possibly can"): a link carrying #id lands ON that part of the
 *  page, not at its top. Waits for the element (pages load their data
 *  first), then scrolls it under the top bar. `onHash` lets a page open the
 *  fold the hash names before the scroll. */
export function useHashScroll(onHash?: (id: string) => void) {
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash || hash.length < 2) return;
    const id = decodeURIComponent(hash.slice(1));
    onHash?.(id);
    // The app scrolls #root, under a fixed top bar; content above the target
    // often keeps loading after the first jump, so it re-settles until the
    // target holds still (or the person scrolls themselves).
    const root = document.getElementById('root') ?? document.scrollingElement;
    const barH = () => (document.querySelector('.top-bar') as HTMLElement | null)?.offsetHeight ?? 0;
    let tries = 0, still = 0, touched = false;
    const stop = () => { touched = true; };
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchmove', stop, { passive: true });
    const tick = window.setInterval(() => {
      const el = document.getElementById(id);
      if (el && root && !touched) {
        const off = el.getBoundingClientRect().top - barH() - 10;
        if (Math.abs(off) > 4) { root.scrollBy({ top: off }); still = 0; } else still++;
      }
      if (touched || still >= 4 || ++tries > 60) done();
    }, 150);
    function done() {
      window.clearInterval(tick);
      window.removeEventListener('wheel', stop); window.removeEventListener('touchmove', stop);
    }
    return done;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);
}
