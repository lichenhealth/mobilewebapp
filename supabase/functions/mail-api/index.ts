// Supabase Edge Function: mail-api (LICHEN MAIL, founder 2026-11-11)
//
// POST (authenticated, Mail testers only). The Mail screen's one door:
//   inbox  { accountId?, q? }                  → threads across the member's inboxes, newest first
//   thread { accountId, threadId }             → one thread as plain text (marks it read)
//   modify { accountId, threadId, add?, remove? } → archive / unread / star
//   send   { accountId, threadId?, to, cc?, subject, body }
//   draft  { ...same }                         → a Gmail draft
// Every account is checked against the CALLER's own mail_accounts row.
import { mailTester, mailAccountsOf, listThreads, readThread, modifyThread, sendMail, draftMail, type ThreadSummary } from '../_shared/gmail.ts';

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
  if (!(await mailTester(me))) return json({ error: 'Mail is in a personal test right now.' }, 403);

  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { /* empty */ }
  const s = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : '');
  try {
    switch (b.action) {
      case 'inbox': {
        const accts = await mailAccountsOf(me);
        const pick = s('accountId') ? accts.filter((a) => a.id === s('accountId')) : accts;
        const errors: { account: string; error: string }[] = [];
        const lists = await Promise.all(pick.map((a) => listThreads(me, a, s('q').slice(0, 300), 20).catch((e) => {
          errors.push({ account: a.email, error: e instanceof Error ? e.message : String(e) }); return [] as ThreadSummary[];
        })));
        const threads = lists.flat().sort((x, y) => y.date.localeCompare(x.date));
        return json({ threads, errors });
      }
      case 'thread': {
        const t = await readThread(me, s('accountId'), s('threadId'));
        if (t.unread && b.markRead !== false) await modifyThread(me, s('accountId'), s('threadId'), [], ['UNREAD']).catch(() => null);
        return json(t);
      }
      case 'modify': {
        const arr = (k: string) => (Array.isArray(b[k]) ? (b[k] as unknown[]).map(String) : []);
        await modifyThread(me, s('accountId'), s('threadId'), arr('add'), arr('remove'));
        return json({ ok: true });
      }
      case 'send':
      case 'draft': {
        if (!s('to').trim()) return json({ error: 'Who is it to?' }, 400);
        if (!s('body').trim()) return json({ error: 'There are no words to send yet.' }, 400);
        const o = { accountId: s('accountId'), threadId: s('threadId') || undefined, to: s('to'), cc: s('cc') || undefined, subject: s('subject'), body: s('body') };
        const id = b.action === 'send' ? await sendMail(me, o) : await draftMail(me, o);
        return json({ ok: true, id });
      }
      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
