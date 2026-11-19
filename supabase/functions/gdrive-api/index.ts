// Supabase Edge Function: gdrive-api (GOOGLE DRIVE → LICHEN DRIVE, founder 2026-11-15)
//
// POST (authenticated, Mail testers — it rides the Mail Google connection):
//   list   { accountId, folder?, q?, view?, pageToken? } → one page of files
//   fetch  { accountId, fileId }   → the file's content (Docs as html, Sheets as xlsx, the rest as bytes)
//   slides { accountId, fileId }   → a Google Slides deck as slides (title/body/notes)
//   trash  { accountId, ids, restore? } → into (or back out of) that account's Google Trash
// Every account is checked against the CALLER's own mail_accounts row (accessTokenFor).
import { mailTester } from '../_shared/gmail.ts';
import { listDrive, fetchContent, readSlides, slidePictures, trashFiles } from '../_shared/gdrive.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: req.headers.get('Authorization') ?? '' } });
  if (!userRes.ok) return json({ error: 'Not signed in' }, 401);
  const me = (await userRes.json()).id as string;
  if (!(await mailTester(me))) return json({ error: 'Google Drive import is in a personal test right now.' }, 403);

  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { /* empty */ }
  const s = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : '');
  try {
    switch (b.action) {
      case 'list':
        return json(await listDrive(me, s('accountId'), { folder: s('folder'), q: s('q'), view: s('view'), pageToken: s('pageToken') }));
      case 'fetch':
        return json(await fetchContent(me, s('accountId'), s('fileId')));
      case 'slides':
        return json(await readSlides(me, s('accountId'), s('fileId')));
      case 'slide_pictures': {
        const ids = Array.isArray(b.pageIds) ? (b.pageIds as unknown[]).map(String) : [];
        return json({ pictures: await slidePictures(me, s('accountId'), s('fileId'), ids) });
      }
      case 'trash': {
        const ids = Array.isArray(b.ids) ? (b.ids as unknown[]).map(String) : [];
        return json(await trashFiles(me, s('accountId'), ids, b.restore === true));
      }
      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const reconnect = /Reconnect|reconnect/.test(msg);
    return json({ error: msg, reconnect }, reconnect ? 409 : 400);
  }
});
