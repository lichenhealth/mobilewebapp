// Auto-update (2026-07-22): installed iOS PWAs cache the app hard and keep
// running an old build long after a new one deploys — which repeatedly hid new
// features (the push toggle, the fixed calendar toolbar) until the home-screen
// icon was removed and re-added. This detects a fresh deploy and reloads the app
// at a safe moment, so members always run the latest build without any manual
// re-adding.
//
// How: each Vite build fingerprints the entry bundle (/assets/index-<hash>.js).
// We record the hash the app booted with, then periodically re-fetch index.html
// (network, no-store) and compare. A different hash = a new deploy is live.

const BUNDLE_RE = /\/assets\/index-[A-Za-z0-9_-]+\.js/;

function bootedBundle(): string | null {
  const scripts = Array.from(document.querySelectorAll('script[src]')) as HTMLScriptElement[];
  for (const s of scripts) {
    const src = s.getAttribute('src') || '';
    if (BUNDLE_RE.test(src)) return src.match(BUNDLE_RE)![0];
  }
  return null;
}

/** Don't yank the page out from under someone mid-action. */
function safeToReload(): boolean {
  const el = document.activeElement;
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return false;
  if (el && (el as HTMLElement).isContentEditable) return false;
  return true;
}

export function startAutoUpdate(): void {
  const booted = bootedBundle();
  if (!booted) return;                     // dev server / unexpected markup — skip

  let checking = false;
  const check = async (force = false) => {
    if (checking) return;
    checking = true;
    try {
      const html = await (await fetch('/index.html', { cache: 'no-store' })).text();
      const latest = html.match(BUNDLE_RE)?.[0];
      if (!latest || latest === booted) return;
      // A new build is live. One plain reload per target build — but if we
      // ALREADY reloaded for this build and still booted the old one, the
      // browser served a cached shell: escalate ONCE with a cache-busting
      // query instead of going quiet for the whole session (founder
      // 2026-09-13, the stale-build class of "recurring" bugs).
      const reloadedFor = sessionStorage.getItem('lichen:reloadedFor');
      if (reloadedFor === latest) {
        if (sessionStorage.getItem('lichen:bustedFor') === latest) return;
        if (force || safeToReload()) {
          sessionStorage.setItem('lichen:bustedFor', latest);
          const u = new URL(location.href);
          u.searchParams.set('fresh', String(Date.now()));
          location.replace(u.toString());
        }
        return;
      }
      if (force || safeToReload()) {
        sessionStorage.setItem('lichen:reloadedFor', latest);
        location.reload();
      }
    } catch {
      /* offline or transient — try again next tick */
    } finally {
      checking = false;
    }
  };

  // Returning to the app (from background / another tab) is the natural moment
  // to pick up a new build.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void check(); });
  window.addEventListener('focus', () => { void check(); });
  // A little after boot (catches opening the app right after a deploy) and on a
  // gentle interval while it stays open.
  window.setTimeout(() => void check(), 30_000);
  window.setInterval(() => void check(), 20 * 60_000);
}

/** Short fingerprint of the build this page booted with — SideMenu's foot
 *  wears it so a screenshot always says which build it came from. */
export function buildStamp(): string | null {
  const b = bootedBundle();
  const m = b?.match(/index-([A-Za-z0-9_-]+)\.js/);
  return m ? m[1].slice(0, 8) : null;
}
