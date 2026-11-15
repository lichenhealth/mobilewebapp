// GOOGLE DRIVE → LICHEN DRIVE (founder 2026-11-15: "import files from Google
// drive to Lichen Drive… identify the file and re-create it as a Lichen file.
// I want to clean up my various drives and transfer what I want and trash the
// rest"). Rides the Lichen Mail Google connection (mail_accounts); the
// gdrive-api edge fn reads live from Google, and THIS file re-creates each
// file as a real Lichen thing:
//   Google Doc / .txt / .md  → a Lichen doc (formatting carried, images not yet)
//   Google Sheet / .xlsx / .csv → a Lichen spreadsheet (formulas + tabs)
//   Google Slides             → a Lichen presentation (titles, words, speaker notes)
//   photos / video / audio / PDFs / everything else → a Lichen Drive file
// Nothing is copied into a database except the result, and gdrive_imports
// remembers what's already been carried over.
import { supabase } from './supabase';
import { call } from './mailApi';
import { createPersonalDoc } from './chatDocsApi';
import { uploadDriveFile, type DriveFileKind } from './driveFilesApi';
import { sanitizeHtml, htmlToText, textToHtml } from './richText';
import type { SheetTab } from './formula';

export type GFile = {
  id: string; name: string; mimeType: string; size?: string; modifiedTime?: string;
  parents?: string[]; shared?: boolean; owners?: { emailAddress?: string; me?: boolean }[];
};
export type GView = 'folder' | 'recent' | 'shared' | 'trash';
export type LichenKind = 'doc' | 'sheet' | 'slides' | 'photo' | 'video' | 'audio' | 'file' | 'folder' | 'none';
export type ImportRow = { google_file_id: string; account_email: string; name: string; lichen_kind: string; lichen_id: string | null; imported_at: string };

/** How a Google file becomes a Lichen one (mirrors _shared/gdrive.ts). */
export function lichenKindFor(mime: string, name = ''): { kind: LichenKind; label: string } {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (mime === 'application/vnd.google-apps.folder') return { kind: 'folder', label: 'Folder' };
  if (mime === 'application/vnd.google-apps.document') return { kind: 'doc', label: 'becomes a Lichen doc' };
  if (mime === 'application/vnd.google-apps.spreadsheet') return { kind: 'sheet', label: 'becomes a Lichen spreadsheet' };
  if (mime === 'application/vnd.google-apps.presentation') return { kind: 'slides', label: 'becomes a Lichen presentation' };
  if (mime === 'application/vnd.google-apps.drawing') return { kind: 'photo', label: 'comes over as an image' };
  if (mime.startsWith('application/vnd.google-apps.')) return { kind: 'none', label: 'can’t come over yet' };
  if (/spreadsheetml|ms-excel|opendocument\.spreadsheet|text\/csv/.test(mime) || ['xlsx', 'xls', 'csv', 'ods'].includes(ext)) return { kind: 'sheet', label: 'becomes a Lichen spreadsheet' };
  if (mime === 'text/plain' || mime === 'text/markdown' || ['txt', 'md'].includes(ext)) return { kind: 'doc', label: 'becomes a Lichen doc' };
  if (mime.startsWith('image/')) return { kind: 'photo', label: 'photo' };
  if (mime.startsWith('video/')) return { kind: 'video', label: 'video' };
  if (mime.startsWith('audio/')) return { kind: 'audio', label: 'audio' };
  return { kind: 'file', label: 'file' };
}

export async function listGDrive(accountId: string, opts: { folder?: string; q?: string; view?: GView; pageToken?: string }): Promise<{ files: GFile[]; next: string | null }> {
  return call('gdrive-api', { action: 'list', accountId, ...opts });
}

export async function trashGDrive(accountId: string, ids: string[], restore = false): Promise<{ done: string[]; failed: { id: string; error: string }[] }> {
  return call('gdrive-api', { action: 'trash', accountId, ids, restore });
}

export async function listGDriveImports(): Promise<ImportRow[]> {
  const { data } = await supabase.from('gdrive_imports').select('google_file_id, account_email, name, lichen_kind, lichen_id, imported_at');
  return (data as ImportRow[] | null) ?? [];
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Google's Docs export styles by CLASS (`.c3{font-weight:700}`); Lichen's
 *  sanitizer keeps only inline styles. Fold the classes in first so bold,
 *  italics, underline, colour and alignment come across. */
function inlineGoogleClasses(html: string): { html: string; images: number } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rules = new Map<string, string>();
  for (const st of Array.from(doc.querySelectorAll('style'))) {
    for (const m of (st.textContent ?? '').matchAll(/\.([a-zA-Z0-9_-]+)\s*\{([^}]*)\}/g)) {
      const keep = m[2].split(';').map((d) => d.trim()).filter((d) =>
        /^(font-weight|font-style|text-decoration|color|background-color|text-align)\s*:/i.test(d)
        && !/font-weight\s*:\s*(400|normal)/i.test(d) && !/color\s*:\s*#000000/i.test(d)
        && !/background-color\s*:\s*(transparent|#ffffff)/i.test(d) && !/text-align\s*:\s*left/i.test(d)
        && !/text-decoration\s*:\s*none/i.test(d));
      if (keep.length) rules.set(m[1], keep.join(';'));
    }
  }
  for (const el of Array.from(doc.body.querySelectorAll('[class]'))) {
    const add = (el.getAttribute('class') ?? '').split(/\s+/).map((c) => rules.get(c)).filter(Boolean).join(';');
    if (add) el.setAttribute('style', `${add};${el.getAttribute('style') ?? ''}`);
    el.removeAttribute('class');
  }
  // Google wraps links in a redirect; keep the real address.
  for (const a of Array.from(doc.body.querySelectorAll('a[href]'))) {
    const h = a.getAttribute('href') ?? '';
    const m = h.match(/^https:\/\/www\.google\.com\/url\?q=([^&]+)/);
    if (m) a.setAttribute('href', decodeURIComponent(m[1]));
  }
  const images = doc.body.querySelectorAll('img').length;
  return { html: doc.body.innerHTML, images };
}

async function xlsxToTabs(b64: string): Promise<SheetTab[]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(b64ToBytes(b64), { type: 'array', cellFormula: true });
  const tabs: SheetTab[] = [];
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    if (!ws['!ref']) { tabs.push({ name: sn.slice(0, 40), cells: [['']] }); continue; }
    const rng = XLSX.utils.decode_range(ws['!ref']);
    const cells: string[][] = [];
    for (let r = rng.s.r; r <= Math.min(rng.e.r, 2000); r++) {
      const row: string[] = [];
      for (let c = rng.s.c; c <= Math.min(rng.e.c, 51); c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })] as { f?: string; w?: string; v?: unknown } | undefined;
        row.push(cell ? (cell.f ? `=${cell.f}` : String(cell.w ?? cell.v ?? '')) : '');
      }
      cells.push(row);
    }
    tabs.push({ name: sn.slice(0, 40), cells, frozen: 1, fmt: Object.fromEntries((cells[0] ?? []).map((_, c) => [`0,${c}`, { b: true }])) });
  }
  return tabs.length ? tabs : [{ name: 'Sheet1', cells: [['']] }];
}

export type ImportResult = { kind: LichenKind; id: string; path: string; note?: string };

/** Carry ONE Google file over as a Lichen thing, and remember it. */
export async function importGDriveFile(account: { id: string; email: string }, f: GFile): Promise<ImportResult> {
  const { kind } = lichenKindFor(f.mimeType, f.name);
  if (kind === 'folder') throw new Error('Open the folder and pick what’s inside.');
  if (kind === 'none') throw new Error('Google Forms, Sites and Maps can’t come over yet.');
  const title = f.name.replace(/\.(docx?|txt|md|xlsx?|csv|ods)$/i, '').slice(0, 200) || 'Untitled';
  let res: ImportResult;

  if (kind === 'slides') {
    const deck = await call<{ title: string; slides: { title: string; body: string; notes: string }[] }>('gdrive-api', { action: 'slides', accountId: account.id, fileId: f.id });
    const slides = (deck.slides.length ? deck.slides : [{ title: deck.title || title, body: '', notes: '' }]).map((s, i) => ({
      title: s.title, body: s.body, notes: s.notes || undefined,
      layout: i === 0 ? 'title' : s.body.includes('\n') ? 'bullets' : 'text',
    }));
    const row = await createPersonalDoc('slides', deck.title || title, { data: { theme: 'paper', slides } as never, body: slides.map((s) => `${s.title}\n${s.body}`).join('\n\n').slice(0, 20000) });
    res = { kind, id: row.id, path: `/docs/${row.id}` };
  } else {
    const c = await call<{ mime: string; data?: string; html?: string }>('gdrive-api', { action: 'fetch', accountId: account.id, fileId: f.id });
    if (kind === 'doc') {
      let html: string; let images = 0;
      if (c.html) { const g = inlineGoogleClasses(c.html); html = sanitizeHtml(g.html); images = g.images; }
      else html = sanitizeHtml(textToHtml(new TextDecoder().decode(b64ToBytes(c.data ?? ''))));
      const row = await createPersonalDoc('doc', title, { data: { html } as never, body: htmlToText(html).slice(0, 50000) });
      res = { kind, id: row.id, path: `/docs/${row.id}`, note: images ? `${images} image${images === 1 ? '' : 's'} stayed behind in Google — images don’t come over yet` : undefined };
    } else if (kind === 'sheet') {
      let tabs: SheetTab[];
      if (/csv/.test(c.mime) || f.name.toLowerCase().endsWith('.csv')) {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(new TextDecoder().decode(b64ToBytes(c.data ?? '')), { type: 'string' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false }) as string[][];
        tabs = [{ name: 'Sheet1', cells: rows.length ? rows.map((r) => r.map((x) => String(x ?? ''))) : [['']] }];
      } else tabs = await xlsxToTabs(c.data ?? '');
      const row = await createPersonalDoc('sheet', title, { data: { sheets: tabs, cells: tabs[0].cells } as never });
      res = { kind, id: row.id, path: `/docs/${row.id}` };
    } else {
      const mime = kind === 'photo' && c.mime === 'image/png' ? 'image/png' : (c.mime || f.mimeType || 'application/octet-stream');
      const name = f.mimeType === 'application/vnd.google-apps.drawing' ? `${f.name}.png` : f.name;
      const file = new File([b64ToBytes(c.data ?? '')], name, { type: mime });
      const row = await uploadDriveFile(file, kind as DriveFileKind);
      res = { kind, id: row.id, path: '/drive' };
    }
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase.from('gdrive_imports').upsert({
      profile_id: user.id, account_email: account.email, google_file_id: f.id, name: f.name,
      lichen_kind: res.kind, lichen_id: res.id, imported_at: new Date().toISOString(),
    }, { onConflict: 'profile_id,google_file_id' });
  }
  return res;
}

export function fmtSize(size?: string): string {
  const n = Number(size ?? 0);
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
