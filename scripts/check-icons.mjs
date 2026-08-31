// WHY THIS EXISTS (founder 2026-08-28: "the icons have been misplaced before,
// can we do an audit and build a solid fix for that?").
//
// An icon looks off-centre when its viewBox doesn't frame its own artwork.
// Nothing catches that by eye until it's shipped, and the glyphs came out of
// a design file with absolute coordinates, so mis-framing is the DEFAULT
// failure — not a rare slip. Twelve of sixty-nine were off when this was
// first run, the worst by 6% of its own box.
//
// This measures every icon the only way that is actually correct: render it
// and ask the browser for the artwork's real bounds (getBBox handles curves;
// eyeballing coordinates does not). It compares that to the declared viewBox
// and reports anything sitting more than 3% off centre.
//
//   node scripts/check-icons.mjs          → report
//   node scripts/check-icons.mjs --fix    → print corrected viewBoxes
//
// Needs Playwright's Chromium: `npx playwright install chromium` once.
// A correction moves the viewBox ORIGIN only, never its size, so a recentred
// icon never changes scale — it just stops sitting off to one side.
//
// ⚠ If an icon is deliberately offset for optical balance, say so in a
// comment beside it and add its name to DELIBERATE below, or the next person
// to run this will "fix" your intent.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DELIBERATE = new Set([]);
const THRESHOLD = 0.03;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'src/components/Icon.tsx'), 'utf8');

const icons = [];
// ⚠ Each block runs to the NEXT icon key, not to the first "\n  },". Some
// glyphs contain a nested close, which ends a lazy match early and desyncs
// every name from its body after it — measurements then belong to a
// neighbour, which is a very convincing way to "fix" the wrong icon.
const keys = [...src.matchAll(/\n  '([a-z0-9-]+)':\s*\{/g)].map((m) => ({ at: m.index, name: m[1] }));
keys.forEach((k, i) => {
  const body = src.slice(k.at, i + 1 < keys.length ? keys[i + 1].at : src.length);
  const vb = body.match(/viewBox:\s*'([^']+)'/);
  if (!vb) return;
  icons.push({
    name: k.name,
    viewBox: vb[1],
    d: [...body.matchAll(/d="([^"]+)"/g)].map((m) => m[1]),
    circle: [...body.matchAll(/<circle([^/>]+)\/?>/g)].map((m) => m[1]),
    rect: [...body.matchAll(/<rect([^/>]+)\/?>/g)].map((m) => m[1]),
  });
});

const html = `<html><body>${icons.map((ic, i) => {
  const inner = ic.d.map((d) => `<path d="${d.replace(/"/g, '&quot;')}"/>`).join('')
    + ic.circle.map((c) => `<circle ${c}/>`).join('')
    + ic.rect.map((r) => `<rect ${r}/>`).join('');
  return `<svg id="i${i}" viewBox="${ic.viewBox}" width="100" height="100" fill="none" stroke="currentColor"><g id="g${i}">${inner}</g></svg>`;
}).join('')}</body></html>`;

const tmp = path.join(root, 'node_modules', '.icons-check.html');
fs.writeFileSync(tmp, html);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('file://' + tmp);
const measured = await page.evaluate((n) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const g = document.getElementById('g' + i);
    const svg = document.getElementById('i' + i);
    let bb; try { bb = g.getBBox(); } catch { out.push(null); continue; }
    out.push({ bb: { x: bb.x, y: bb.y, w: bb.width, h: bb.height },
               vb: svg.getAttribute('viewBox').split(/[\s,]+/).map(Number) });
  }
  return out;
}, icons.length);
await browser.close();
fs.unlinkSync(tmp);

const bad = [];
measured.forEach((m, i) => {
  const ic = icons[i];
  if (!m || !m.bb.w || !m.bb.h || DELIBERATE.has(ic.name)) return;
  const [vx, vy, vw, vh] = m.vb;
  const cx = m.bb.x + m.bb.w / 2;
  const cy = m.bb.y + m.bb.h / 2;
  const offX = (cx - (vx + vw / 2)) / vw;
  const offY = (cy - (vy + vh / 2)) / vh;
  if (Math.abs(offX) <= THRESHOLD && Math.abs(offY) <= THRESHOLD) return;
  bad.push({ name: ic.name, offX, offY,
             fixed: `${+(cx - vw / 2).toFixed(2)} ${+(cy - vh / 2).toFixed(2)} ${vw} ${vh}` });
});

if (!bad.length) {
  console.log(`✓ all ${icons.length} icons sit within ${THRESHOLD * 100}% of their own centre`);
  process.exit(0);
}
console.log(`${bad.length} of ${icons.length} icons sit off centre:\n`);
for (const b of bad) {
  console.log(`  ${b.name.padEnd(18)} x ${(b.offX * 100).toFixed(1).padStart(5)}%  y ${(b.offY * 100).toFixed(1).padStart(5)}%`
    + (process.argv.includes('--fix') ? `   →  viewBox: '${b.fixed}'` : ''));
}
if (!process.argv.includes('--fix')) console.log('\nRe-run with --fix to print corrected viewBoxes.');
process.exit(1);
