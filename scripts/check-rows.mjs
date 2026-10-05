// SCROLL-ROW CENSUS (founder 2026-10-05, after circling the THIRD dead-space
// hole a ScrollHintRow left: "This bug has happened many times, so how can
// you ensure it won't happen again?"). The check:icons lesson applied to
// rows: measure the real thing across the whole width range, never eyeball
// two screenshots.
//
// Drives the BUILT app (vite preview + the test session, the cloud-harness
// setup) across widths 340–1440 on the row-bearing screens and asserts, for
// every .scrollrow on screen:
//   1. NO DEAD GAP: with more content to the right, the space between the
//      last visible item and the content edge stays under GAP_MAX (64px) —
//      a hidden straddler's box is at most ~60px; anything bigger means an
//      icon was hidden that should be showing (the retired 18px step-aside
//      bug, or a regression of this class).
//   2. NO HALF-CUT ITEM in hide mode: every visible child is whole.
//   3. THE ARROW MOVES THE ROW: the right hint is a real button and
//      clicking it changes scrollLeft (founder 2026-10-05: a mouse has no
//      other way to move the row).
//
// Run it after ANY change to ScrollHintRow or a row that uses it:
//   node scripts/check-rows.mjs [base-url] [session-file]
// Defaults: http://localhost:4191 + the scratchpad test-session.json the
// harness mints. Exits 1 on any violation, printing page/width/row.
import { chromium } from 'playwright-core';
import fs from 'fs';

const BASE = process.argv[2] ?? 'http://localhost:4191';
const SESS_FILE = process.argv[3]
  ?? process.env.LICHEN_TEST_SESSION
  ?? '/tmp/claude-0/-home-user-mobilewebapp/a0406c70-dda9-5e1a-9075-4445d12a7bb7/scratchpad/test-session.json';
const PAGES = ['/home', '/market', '/mycelium', '/assistant/feed'];
const WIDTHS = [];
for (let w = 340; w <= 1440; w += 20) WIDTHS.push(w);
const GAP_MAX = 64;

const sess = fs.readFileSync(SESS_FILE, 'utf8');
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
  proxy: process.env.HTTPS_PROXY
    ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' }
    : undefined,
});

const violations = [];
const ctx = await browser.newContext({ viewport: { width: 400, height: 900 } });
const page = await ctx.newPage();
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
await page.evaluate((s) => localStorage.setItem('sb-mjqnaevertyzgjlpwynr-auth-token', s), sess);

for (const path of PAGES) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.scrollrow', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(180);
    const rows = await page.evaluate((gapMax) => {
      const out = [];
      document.querySelectorAll('.scrollrow').forEach((wrap, i) => {
        const el = wrap.querySelector(':scope > div');
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0) return;
        const hintR = wrap.querySelector('.scrollrow__hint--r');
        const fade = !!wrap.querySelector('.scrollrow__hint--fade')
          || !!(hintR && hintR.classList.contains('scrollrow__hint--fade'));
        const kids = [...el.children].filter((k) => k.getBoundingClientRect().width >= 24);
        const visible = kids.filter((k) => getComputedStyle(k).visibility !== 'hidden');
        // 1. dead gap before the right edge while more content exists
        const overflowR = el.scrollWidth - el.scrollLeft - el.clientWidth > 8;
        if (overflowR && !fade) {
          const within = visible.filter((k) => k.getBoundingClientRect().right <= rect.right + 1);
          const last = within[within.length - 1];
          if (last) {
            const gap = rect.right - last.getBoundingClientRect().right;
            if (gap > gapMax) out.push({ i, kind: 'dead-gap', gap: Math.round(gap) });
          }
        }
        // 2. no half-cut item in hide mode
        if (!fade) {
          for (const k of visible) {
            const kr = k.getBoundingClientRect();
            const cutR = kr.left < rect.right - 1 && kr.right > rect.right + 2;
            const cutL = kr.right > rect.left + 1 && kr.left < rect.left - 2;
            if (cutR || cutL) { out.push({ i, kind: 'half-cut' }); break; }
          }
        }
        // 3. the arrow is a button
        if (hintR && hintR.tagName !== 'BUTTON') out.push({ i, kind: 'hint-not-button' });
      });
      return out;
    }, GAP_MAX);
    rows.forEach((r) => violations.push({ page: path, width: w, ...r }));
  }
  // 3b. clicking the arrow moves the row (once per page, at phone width)
  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForTimeout(300);
  const moved = await page.evaluate(async () => {
    const wrap = [...document.querySelectorAll('.scrollrow')]
      .find((s) => s.querySelector('.scrollrow__hint--r'));
    if (!wrap) return 'no-overflow-row';
    const el = wrap.querySelector(':scope > div');
    const before = el.scrollLeft;
    wrap.querySelector('.scrollrow__hint--r').click();
    await new Promise((r) => setTimeout(r, 900));
    return el.scrollLeft > before + 40 ? 'moved' : 'did-not-move';
  });
  if (moved === 'did-not-move') violations.push({ page: path, kind: 'arrow-click-no-scroll' });
}

await browser.close();
if (violations.length) {
  console.error('check-rows: FAIL');
  violations.slice(0, 40).forEach((v) => console.error(' ', JSON.stringify(v)));
  process.exit(1);
}
console.log('check-rows: OK — no dead gaps, no half-cut items, arrows scroll.');
