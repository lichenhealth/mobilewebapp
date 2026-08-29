#!/usr/bin/env node
/**
 * check:sections — the guard on the Facilities class of bug.
 *
 * Founder, 2026-08-28: "the facilities bug is still live, how has this
 * persisted after 4+ requests to fix it?" — because the fixes were aimed at
 * the SYMPTOM. Facilities was a writable template tab in the library AND a
 * hand-written section in PublicPage, so its own door drew both: the tab's
 * title and body, then the section's heading and text. Hiding one heading
 * left the second renderer in place, ready to show through the next time the
 * page took a slightly different branch.
 *
 * The invariant, checked here so it can't quietly lapse again:
 *
 *   Every id PublicPage draws a section for is in SECTION_IDS,
 *   and every id in SECTION_IDS is a builtIn tab in the library.
 *
 * Run: npm run check:sections
 */
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const tabs = read('src/lib/pageTabs.ts');
const page = read('src/components/PublicPage.tsx');
const editor = read('src/components/PageTabsEditor.tsx');

const fail = [];

// 1 · The registered sections.
const idsSrc = tabs.match(/export const SECTION_IDS = \[([^\]]*)\]/);
if (!idsSrc) {
  console.error('check:sections — SECTION_IDS not found in src/lib/pageTabs.ts');
  process.exit(1);
}
const registered = [...idsSrc[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

// 2 · Every registered section must be a builtIn tab in the library.
for (const id of registered) {
  const entry = tabs.match(new RegExp(`\\{ id: '${id}',[\\s\\S]*?\\},`));
  if (!entry) {
    fail.push(`"${id}" is in SECTION_IDS but there is no such tab in TAB_TEMPLATES.`);
  } else if (!/builtIn:\s*true/.test(entry[0])) {
    fail.push(
      `"${id}" is a section PublicPage draws itself, but its tab is not builtIn — `
      + 'picking it would render the section twice on its own door.',
    );
  }
}

// 3 · Every section PublicPage draws must be registered. show('x') is the
//     gate every hand-written section sits behind, so it is the census.
const drawn = new Set([...page.matchAll(/\bshow\('([a-z-]+)'\)/g)].map((m) => m[1]));
for (const id of drawn) {
  if (!registered.includes(id)) {
    fail.push(
      `PublicPage draws a "${id}" section (show('${id}')) that is not in SECTION_IDS — `
      + `add it there and mark the "${id}" tab builtIn, or it will render twice.`,
    );
  }
}

// 4 · One list, not two. The editor used to keep its own copy.
if (/const SECTIONED = \[/.test(editor)) {
  fail.push('PageTabsEditor keeps its own section list again — it must read SECTION_IDS.');
}

if (fail.length) {
  console.error('check:sections — ' + fail.length + ' problem(s):\n');
  for (const f of fail) console.error('  · ' + f);
  console.error('');
  process.exit(1);
}
console.log(`check:sections — ok (${registered.length} sections, all builtIn, all registered)`);
