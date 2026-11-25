// Zips extension/lichen-coupons into public/downloads/lichen-coupons.zip —
// the file Profile → Connections offers for "Load unpacked" installs until
// the extension is in the Chrome Web Store. Run after editing the extension.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
mkdirSync('public/downloads', { recursive: true });
rmSync('public/downloads/lichen-coupons.zip', { force: true });
execFileSync('zip', ['-rqX', '../../public/downloads/lichen-coupons.zip', '.'], { cwd: 'extension/lichen-coupons' });
console.log('public/downloads/lichen-coupons.zip');
