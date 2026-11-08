#!/usr/bin/env node
// THE PARITY CENSUS (founder 2026-11-08: "these foundational rules that will
// help the platform get built out faster and with higher performance Ai need
// to stick and they often don't. How can we remedy that?").
//
// A rule in prose drifts; a census can't be forgotten. Every exported
// function in src/lib/*Api.ts that WRITES (insert/update/upsert/delete/rpc/
// functions.invoke) must be accounted for in docs/parity.json as one of:
//   { "tool": "<assistant tool name(s)>" }   — the assistant can do it
//   { "gap":  "<ladder rung 1|2|3>" }         — owed, on the ladder
//   { "exempt": "<why: admin desk, internal plumbing, money-in checkout…>" }
// A new write with no entry FAILS this check — so shipping a manual feature
// forces the parity decision in the same commit. `--list` prints the census.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const libDir = join(root, 'src/lib');
const reg = JSON.parse(readFileSync(join(root, 'docs/parity.json'), 'utf8'));
const WRITE = /\.(insert|update|upsert|delete)\(|\.rpc\(|functions\.invoke\(/;

const found = [];
for (const f of readdirSync(libDir).filter((n) => /Api\.ts$/.test(n)).sort()) {
  const src = readFileSync(join(libDir, f), 'utf8');
  const re = /export\s+(?:async\s+)?function\s+(\w+)/g;
  const marks = [];
  let m;
  while ((m = re.exec(src))) marks.push({ name: m[1], at: m.index });
  marks.forEach((mk, i) => {
    const body = src.slice(mk.at, i + 1 < marks.length ? marks[i + 1].at : src.length);
    if (WRITE.test(body)) found.push(`${f.replace(/\.ts$/, '')}:${mk.name}`);
  });
}

const missing = found.filter((k) => !reg[k]);
const stale = Object.keys(reg).filter((k) => !k.startsWith('_') && !found.includes(k));
if (process.argv.includes('--list')) {
  const tally = { tool: 0, gap: 0, exempt: 0 };
  for (const k of found) { const e = reg[k] ?? {}; for (const t of Object.keys(tally)) if (e[t]) tally[t]++; }
  console.log(`${found.length} write functions — ${tally.tool} with tools, ${tally.gap} on the ladder, ${tally.exempt} exempt`);
  for (const k of found) if (reg[k]?.gap) console.log(`  gap(${reg[k].gap}) ${k}${reg[k].note ? ' — ' + reg[k].note : ''}`);
}
if (stale.length) console.warn(`parity.json names functions that no longer write/exist:\n  ${stale.join('\n  ')}`);
if (missing.length) {
  console.error(`\n✗ ${missing.length} write function(s) with no parity decision (add each to docs/parity.json as tool | gap | exempt):\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
console.log('✓ parity census clean');
