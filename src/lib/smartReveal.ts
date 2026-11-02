/** Scroll JUST ENOUGH that an element's bottom is visible — above the
 *  bottom nav when one is standing — without pushing its top under the
 *  fixed top bar (founder 2026-11-01, picking a booking day: "can the
 *  layout be smart enough that it realizes there's a bunch of blank space
 *  on the bottom, so it doesn't have to cut off as much content from the
 *  top?"). The app's scroller is #root, not window (the WowIntake rule). */
/** `behavior`: 'smooth' for a one-off jump (the booking day pick); pass
 *  'auto' (instant) when calling REPEATEDLY — per-keystroke smooth scrolls
 *  each restart the animation from zero, so rapid calls cancel into no
 *  net motion at all (found live on the composer follow, 2026-11-02). */
/** `clearance`: extra obstructed px above the bottom nav — a sticky card
 *  standing over the page's foot (the booking confirm) passes its own
 *  height so content scrolls clear of it, not just the nav. */
export function revealBelow(el: HTMLElement | null, behavior: ScrollBehavior = 'smooth', clearance = 0): void {
  if (!el) return;
  const scroller = document.getElementById('root');
  if (!scroller) { el.scrollIntoView({ behavior, block: 'nearest' }); return; }
  const navH = document.querySelector('.bottom-nav')?.getBoundingClientRect().height ?? 0;
  const topBar = document.querySelector('.top-bar');
  const topMin = (topBar ? topBar.getBoundingClientRect().bottom : 0) + 10;
  const r = el.getBoundingClientRect();
  const viewBottom = window.innerHeight - navH - clearance - 12;
  if (r.bottom <= viewBottom && r.top >= topMin) return;   // already in view
  const need = Math.max(r.bottom - viewBottom, 0);          // show the bottom…
  const cap = Math.max(r.top - topMin, 0);                  // …never past the top
  const delta = Math.min(need, cap);
  if (delta > 0) scroller.scrollBy({ top: delta, behavior });
}
