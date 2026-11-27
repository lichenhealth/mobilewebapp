/** THE BRAIN THAT FOLLOWS YOU (founder 2026-11-27: "your brain should just
 *  be there with you everywhere and at all times… I think it just needs to
 *  follow us around the platform"). The companion panel (BrainCompanion)
 *  holds the REAL conversation screen in a same-origin frame that stays
 *  mounted while the member moves around the app, so every card the brain
 *  can hand (drafts, Send buttons, doors) works there too. This module is
 *  the shared vocabulary between the panel and the frame inside it. */

export const COMPANION_NAME = 'lichen-companion';

/** True inside the companion's frame. window.name survives navigation
 *  inside the frame, unlike a query parameter. */
export function inCompanion(): boolean {
  try { return window.name === COMPANION_NAME && window.top !== window; } catch { return false; }
}

export interface CompanionPage { path: string; title: string; doc_id?: string }

/** What the member is looking at in the main app, read from the parent
 *  window (same origin). The page's own heading names it; a doc page also
 *  carries the doc's id so the server can read it. */
export function companionPage(): CompanionPage | null {
  if (!inCompanion()) return null;
  try {
    const p = window.parent;
    const path = p.location.pathname + p.location.search;
    const doc = p.document;
    const docTitle = doc.querySelector('input.cdocp__title') as HTMLInputElement | null;
    const head = (docTitle?.value || doc.querySelector('.cdocp__title-ro, main h1')?.textContent || '').trim();
    const title = (head || doc.title || '').replace(/\s+/g, ' ').slice(0, 160);
    const m = /^\/docs\/([0-9a-f-]{36})/i.exec(p.location.pathname);
    return { path: path.slice(0, 300), title, ...(m ? { doc_id: m[1] } : {}) };
  } catch { return null; }
}

/** Messages the frame sends its parent. */
export type CompanionMsg =
  | { type: 'lichen:navigate'; path: string }
  | { type: 'lichen:companion-at'; url: string };

export function tellParent(msg: CompanionMsg) {
  try { window.parent.postMessage(msg, window.location.origin); } catch { /* ignore */ }
}
