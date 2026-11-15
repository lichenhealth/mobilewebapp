// GOOGLE DRIVE, BY WORD (founder 2026-11-15: "import files from Google drive
// to Lichen Drive… clean up my various drives and transfer what I want and
// trash the rest"). The brain LISTS and SEARCHES the member's connected Google
// Drives, TRASHES what they ask (Google's Trash — recoverable 30 days), and
// hands an IMPORT CARD for what they want brought over: the person's tap runs
// the conversion in their own browser (the same importer as /drive/import),
// so every Lichen file is born through the member's own session.
// Every account resolves against the SENDER's own mail_accounts rows.
import { mailAccountsOf } from './gmail.ts';
import { listDrive, trashFiles, fileMeta, lichenKindFor, type GFile } from './gdrive.ts';

type Out = { ok: boolean; [k: string]: unknown };

export const GDRIVE_TOOLS = [
  {
    name: 'google_drive',
    description: 'The member\'s connected Google Drives (same Google accounts as their Lichen Mail). action: "list" (a folder\'s files — folder = a folder id from an earlier list, empty = My Drive), "search" (query matches names and contents across that Drive), "recent", "shared" (shared with them), "trash_view" (what\'s in Google\'s Trash). account = one of their addresses (empty = the first). Returns files with id, name, kind (what it would become on Lichen), size and modified date. '
      + 'action "trash" moves file_ids to that account\'s Google Trash (recoverable 30 days) — ONLY when they asked in their own words, ONLY ids you listed in this conversation. action "restore" brings them back out of Google Trash. '
      + 'action "import" puts an import card under your reply for file_ids — the card\'s button re-creates each file as a Lichen doc / spreadsheet / presentation / Drive file; set then_trash=true if they want the Google copy trashed after. It does NOT import by itself: say the card is waiting for their tap. Folders can\'t be imported whole — list inside them.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'search', 'recent', 'shared', 'trash_view', 'trash', 'restore', 'import'] },
        account: { type: 'string' }, folder: { type: 'string' }, query: { type: 'string' },
        file_ids: { type: 'array', items: { type: 'string' } }, then_trash: { type: 'boolean' },
      },
      required: ['action'],
    },
  },
];
export const GDRIVE_TOOL_NAMES = new Set(GDRIVE_TOOLS.map((t) => t.name));

// Files listed in this exchange (ids from earlier messages are re-checked).
const seen = new Map<string, Map<string, GFile>>();

export async function runGDriveTool(profileId: string, input: Record<string, unknown>): Promise<Out & { importCard?: Record<string, unknown>; reconnect?: string[] }> {
  const accts = await mailAccountsOf(profileId);
  if (!accts.length) return { ok: false, error: 'No Google account is connected yet — they can connect one on Drive → + → From Google Drive.' };
  const want = String(input.account ?? '').trim().toLowerCase();
  const acct = want ? accts.find((a) => a.email.toLowerCase() === want) : accts[0];
  if (!acct) return { ok: false, error: `That isn't one of their connected Google accounts. Connected: ${accts.map((a) => a.email).join(', ')}.` };
  const key = `${profileId}:${acct.id}`;
  if (!seen.has(key)) seen.set(key, new Map());
  const known = seen.get(key)!;
  const action = String(input.action ?? 'list');
  const ids = Array.isArray(input.file_ids) ? (input.file_ids as unknown[]).map(String).slice(0, 50) : [];
  try {
    if (['list', 'search', 'recent', 'shared', 'trash_view'].includes(action)) {
      const view = action === 'recent' ? 'recent' : action === 'shared' ? 'shared' : action === 'trash_view' ? 'trash' : 'folder';
      const r = await listDrive(profileId, acct.id, { folder: String(input.folder ?? ''), q: action === 'search' ? String(input.query ?? '') : '', view });
      for (const f of r.files) known.set(f.id, f);
      return {
        ok: true, account: acct.email, more: !!r.next,
        files: r.files.slice(0, 80).map((f) => ({
          id: f.id, name: f.name, kind: lichenKindFor(f.mimeType, f.name).kind,
          size: f.size ? Number(f.size) : undefined, modified: f.modifiedTime?.slice(0, 10),
          from: f.owners?.find((o) => !o.me)?.emailAddress,
        })),
      };
    }
    if (!ids.length) return { ok: false, error: 'Name the file_ids (from a list or search in this conversation).' };
    // An id from an earlier message: look it up through THEIR token (an
    // invented id simply isn't found).
    for (const id of ids.filter((x) => !known.has(x))) {
      try { known.set(id, await fileMeta(profileId, acct.id, id)); }
      catch { return { ok: false, error: `One of those ids (${id}) isn't in ${acct.email}'s Drive — list or search again and use the ids that come back.` }; }
    }
    if (action === 'trash' || action === 'restore') {
      const t = await trashFiles(profileId, acct.id, ids, action === 'restore');
      return { ok: true, account: acct.email, moved: t.done.map((id) => known.get(id)?.name ?? id), failed: t.failed, note: action === 'trash' ? 'In that account\'s Google Trash, recoverable for 30 days.' : 'Restored in Google.' };
    }
    if (action === 'import') {
      const files = ids.map((id) => known.get(id)!).filter((f) => !['folder', 'none'].includes(lichenKindFor(f.mimeType, f.name).kind));
      if (!files.length) return { ok: false, error: 'None of those can come over (folders, Forms and Sites can\'t).' };
      return {
        ok: true, account: acct.email, waiting_for_tap: files.length,
        importCard: { type: 'gdrive_import', account_id: acct.id, account: acct.email, then_trash: input.then_trash === true,
          files: files.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: f.size, modifiedTime: f.modifiedTime })) },
      };
    }
    return { ok: false, error: 'Unknown action.' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, ...(/reconnect/i.test(msg) ? { reconnect: [acct.email] } : {}) };
  }
}
