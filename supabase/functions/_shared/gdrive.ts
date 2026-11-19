// GOOGLE DRIVE → LICHEN DRIVE (founder 2026-11-15: "import files from Google
// drive to Lichen Drive… identify the file and re-create it as a Lichen file.
// I want to clean up my various drives and transfer what I want and trash the
// rest"). Rides the SAME Google connection as Lichen Mail (mail_accounts +
// mail_tokens, the lichen-mail project in Testing mode) — the consent now asks
// for Drive too, so an inbox connected before needs one Reconnect.
//
// Nothing here stores file content: listings and bytes are read live and the
// CLIENT re-creates each file as a Lichen doc / sheet / slides / Drive file.
// Trash is Google's own (recoverable in that account's Trash for 30 days).
import { accessTokenFor } from './gmail.ts';

const DR = 'https://www.googleapis.com/drive/v3';

export type GFile = {
  id: string; name: string; mimeType: string; size?: string; modifiedTime?: string;
  iconLink?: string; parents?: string[]; owners?: { emailAddress?: string; me?: boolean }[]; shared?: boolean;
};

const FIELDS = 'id,name,mimeType,size,modifiedTime,parents,shared,owners(emailAddress,me)';

/** Turn Google's errors into words a person can act on. */
async function failWords(r: Response): Promise<never> {
  const t = (await r.text()).slice(0, 600);
  if (r.status === 403 && /accessNotConfigured|has not been used|is disabled/i.test(t)) {
    // Google names the exact project + the enable link — pass both on, so
    // "still not on" can be told apart from "switched on in another project".
    console.error('gdrive-disabled', t);
    const proj = t.match(/project (\d{6,})/)?.[1];
    const api = /slides/i.test(t) ? 'Google Slides API' : 'Google Drive API';
    const link = t.match(/https:\/\/console\.developers\.google\.com\/apis\/[^\s"\\]+/)?.[0];
    throw new Error(`The ${api} isn’t switched on for Lichen’s Google project yet${proj ? ` (Google project number ${proj})` : ''}. If it was just enabled, Google can take a few minutes.${link ? ` Enable link: ${link}` : ''}`);
  }
  if (r.status === 403 && /insufficient|scope/i.test(t)) {
    throw new Error('This Google account needs one Reconnect so Lichen can see its Drive.');
  }
  if (r.status === 404) throw new Error('That file isn’t there anymore (or this account can’t see it).');
  throw new Error(`Google Drive said ${r.status}: ${t.slice(0, 160)}`);
}

async function dr(token: string, path: string, init?: RequestInit) {
  const r = await fetch(`${DR}/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } });
  if (!r.ok) await failWords(r);
  return r.status === 204 ? null : r;
}

/** One page of a folder (or a search across the whole Drive). view:
 *  'folder' (default — the folder's children), 'recent', 'shared', 'trash'. */
export async function listDrive(profileId: string, accountId: string, opts: { folder?: string; q?: string; view?: string; pageToken?: string }) {
  const token = await accessTokenFor(profileId, accountId);
  const clauses: string[] = [];
  const q = (opts.q ?? '').replace(/['\\]/g, ' ').trim().slice(0, 120);
  if (opts.view === 'trash') clauses.push('trashed = true');
  else clauses.push('trashed = false');
  if (q) clauses.push(`(name contains '${q}' or fullText contains '${q}')`);
  else if (opts.view === 'shared') clauses.push('sharedWithMe = true');
  else if (opts.view !== 'recent' && opts.view !== 'trash') clauses.push(`'${(opts.folder || 'root').replace(/[^A-Za-z0-9_-]/g, '')}' in parents`);
  const order = opts.view === 'recent' || q ? 'modifiedTime desc' : 'folder,name';
  const params = new URLSearchParams({
    q: clauses.join(' and '), orderBy: order, pageSize: '100',
    fields: `nextPageToken,files(${FIELDS})`, supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
  });
  if (opts.pageToken) params.set('pageToken', opts.pageToken);
  const r = await dr(token, `files?${params}`);
  const j = await r!.json() as { files?: GFile[]; nextPageToken?: string };
  return { files: j.files ?? [], next: j.nextPageToken ?? null };
}

export async function fileMeta(profileId: string, accountId: string, fileId: string): Promise<GFile> {
  const token = await accessTokenFor(profileId, accountId);
  const r = await dr(token, `files/${encodeURIComponent(fileId)}?fields=${FIELDS}&supportsAllDrives=true`);
  return await r!.json() as GFile;
}

const MAX_BYTES = 15 * 1024 * 1024;

function b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** A Google-native file EXPORTED (Docs → html, Sheets → xlsx, Drawings → png)
 *  or any other file's own bytes. Returns base64 + the mime it came as. */
export async function fetchContent(profileId: string, accountId: string, fileId: string): Promise<{ meta: GFile; mime: string; data?: string; html?: string }> {
  const token = await accessTokenFor(profileId, accountId);
  const meta = await fileMeta(profileId, accountId, fileId);
  const native: Record<string, string> = {
    'application/vnd.google-apps.document': 'text/html',
    'application/vnd.google-apps.spreadsheet': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.google-apps.drawing': 'image/png',
    'application/vnd.google-apps.presentation': 'application/pdf',
  };
  if (meta.mimeType === 'application/vnd.google-apps.folder') throw new Error('That’s a folder — open it and pick the files inside.');
  if (meta.mimeType.startsWith('application/vnd.google-apps.') && !native[meta.mimeType]) {
    throw new Error('Google Forms, Sites and Maps can’t be carried over yet.');
  }
  const exp = native[meta.mimeType];
  const r = exp
    ? await dr(token, `files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exp)}`)
    : await dr(token, `files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`);
  const len = Number(r!.headers.get('content-length') ?? meta.size ?? 0);
  if (len > MAX_BYTES) throw new Error('That file is over 15 MB — too big to carry over here yet.');
  const buf = await r!.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) throw new Error('That file is over 15 MB — too big to carry over here yet.');
  const mime = exp ?? meta.mimeType ?? 'application/octet-stream';
  if (mime === 'text/html') {
    const html = new TextDecoder().decode(buf);
    return { meta, mime, html, images: await docImages(token, html) };
  }
  return { meta, mime, data: b64(buf) };
}

/** The pictures inside an exported Google Doc (founder 2026-11-19: "import
 *  photos in docs, i want an import to be exactly what is exported"). The
 *  export points at Google-hosted copies; fetch each here (the browser can't —
 *  cross-origin) so the client can store them beside the new Lichen doc.
 *  Google image hosts only; up to 80 pictures / 30 MB. */
async function docImages(token: string, html: string): Promise<{ src: string; mime: string; data: string }[]> {
  const srcs = [...new Set([...html.matchAll(/<img[^>]+src="([^"]+)"/gi)].map((m) => m[1].replace(/&amp;/g, '&')))];
  const out: { src: string; mime: string; data: string }[] = [];
  let total = 0;
  for (const src of srcs.slice(0, 80)) {
    try {
      const u = new URL(src);
      if (u.protocol !== 'https:' || !/(^|\.)(googleusercontent\.com|google\.com|gstatic\.com)$/.test(u.hostname)) continue;
      let r = await fetch(src);
      if (!r.ok) r = await fetch(src, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) continue;
      const mime = (r.headers.get('content-type') ?? 'image/png').split(';')[0];
      if (!mime.startsWith('image/')) continue;
      const bytes = await r.arrayBuffer();
      total += bytes.byteLength;
      if (total > 30 * 1024 * 1024) break;
      out.push({ src, mime, data: b64(bytes) });
    } catch { /* one picture failing never sinks the doc */ }
  }
  return out;
}

/** Each slide as Google draws it — a full picture of the slide, so an
 *  imported deck LOOKS exactly like the original. Up to 10 per call. */
export async function slidePictures(profileId: string, accountId: string, fileId: string, pageIds: string[]): Promise<{ id: string; mime: string; data: string }[]> {
  const token = await accessTokenFor(profileId, accountId);
  const out: { id: string; mime: string; data: string }[] = [];
  for (const id of pageIds.slice(0, 10)) {
    const r = await fetch(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(fileId)}/pages/${encodeURIComponent(id)}/thumbnail?thumbnailProperties.thumbnailSize=LARGE&thumbnailProperties.mimeType=PNG`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) { if (r.status === 403 || r.status === 404) await failWords(r); continue; }
    const j = await r.json() as { contentUrl?: string };
    if (!j.contentUrl) continue;
    const pic = await fetch(j.contentUrl);
    if (!pic.ok) continue;
    out.push({ id, mime: 'image/png', data: b64(await pic.arrayBuffer()) });
  }
  return out;
}

/** A Google Slides deck read as slides: each slide's title + body text +
 *  speaker notes (the Slides API — the Drive scope covers it). */
export async function readSlides(profileId: string, accountId: string, fileId: string) {
  const token = await accessTokenFor(profileId, accountId);
  const r = await fetch(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(fileId)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) await failWords(r);
  type TE = { textRun?: { content?: string } };
  type El = { shape?: { placeholder?: { type?: string }; text?: { textElements?: TE[] } }; table?: { tableRows?: { tableCells?: { text?: { textElements?: TE[] } }[] }[] } };
  type Pg = { objectId?: string; pageElements?: El[]; slideProperties?: { notesPage?: { pageElements?: El[] } } };
  const p = await r.json() as { title?: string; slides?: Pg[] };
  const text = (t?: { textElements?: TE[] }) => (t?.textElements ?? []).map((e) => e.textRun?.content ?? '').join('').replace(/\n{3,}/g, '\n\n').trim();
  const slides = (p.slides ?? []).map((s) => {
    let title = ''; const body: string[] = [];
    for (const el of s.pageElements ?? []) {
      const type = el.shape?.placeholder?.type ?? '';
      const words = text(el.shape?.text);
      if (el.table) {
        for (const row of el.table.tableRows ?? []) body.push((row.tableCells ?? []).map((c) => text(c.text)).join(' · '));
        continue;
      }
      if (!words) continue;
      if (!title && (type === 'TITLE' || type === 'CENTERED_TITLE')) title = words;
      else body.push(words);
    }
    if (!title && body.length) title = body.shift()!.split('\n')[0];
    const notes = (s.slideProperties?.notesPage?.pageElements ?? [])
      .filter((el) => el.shape?.placeholder?.type === 'BODY').map((el) => text(el.shape?.text)).filter(Boolean).join('\n');
    return { id: s.objectId ?? '', title: title.slice(0, 200), body: body.join('\n\n').slice(0, 4000), notes: notes.slice(0, 4000) };
  });
  return { title: p.title ?? '', slides };
}

/** Move files to that account's Google Drive Trash (recoverable 30 days). */
export async function trashFiles(profileId: string, accountId: string, ids: string[], restore = false) {
  const token = await accessTokenFor(profileId, accountId);
  const done: string[] = []; const failed: { id: string; error: string }[] = [];
  for (const id of ids.slice(0, 50)) {
    try {
      await dr(token, `files/${encodeURIComponent(id)}?supportsAllDrives=true`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: !restore }),
      });
      done.push(id);
    } catch (e) { failed.push({ id, error: e instanceof Error ? e.message : String(e) }); }
  }
  return { done, failed };
}

/** How a Google file becomes a Lichen one — the ONE mapping the screen and the
 *  brain both read. */
export function lichenKindFor(mime: string, name = ''): { kind: 'doc' | 'sheet' | 'slides' | 'photo' | 'video' | 'audio' | 'file' | 'folder' | 'none'; label: string } {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (mime === 'application/vnd.google-apps.folder') return { kind: 'folder', label: 'Folder' };
  if (mime === 'application/vnd.google-apps.document') return { kind: 'doc', label: 'Google Doc → Lichen doc' };
  if (mime === 'application/vnd.google-apps.spreadsheet') return { kind: 'sheet', label: 'Google Sheet → Lichen spreadsheet' };
  if (mime === 'application/vnd.google-apps.presentation') return { kind: 'slides', label: 'Google Slides → Lichen presentation' };
  if (mime === 'application/vnd.google-apps.drawing') return { kind: 'photo', label: 'Drawing → image' };
  if (mime.startsWith('application/vnd.google-apps.')) return { kind: 'none', label: 'Can’t be carried over yet' };
  if (/spreadsheetml|ms-excel|opendocument\.spreadsheet|text\/csv/.test(mime) || ['xlsx', 'xls', 'csv', 'ods'].includes(ext)) return { kind: 'sheet', label: 'Spreadsheet → Lichen spreadsheet' };
  if (mime === 'text/plain' || mime === 'text/markdown' || ['txt', 'md'].includes(ext)) return { kind: 'doc', label: 'Text → Lichen doc' };
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx') return { kind: 'doc', label: 'Word → Lichen doc' };
  if (mime.startsWith('image/')) return { kind: 'photo', label: 'Photo' };
  if (mime.startsWith('video/')) return { kind: 'video', label: 'Video' };
  if (mime.startsWith('audio/')) return { kind: 'audio', label: 'Audio' };
  return { kind: 'file', label: 'File' };
}
