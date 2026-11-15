// Supabase Edge Function: mail-api (LICHEN MAIL, founder 2026-11-11)
//
// POST (authenticated, Mail testers only). The Mail screen's one door:
//   inbox  { accountId?, q? }                  → threads across the member's inboxes, newest first
//   thread { accountId, threadId }             → one thread: words + the sender's HTML + files (marks it read)
//   attachment { accountId, messageId, attachmentId } → one file's bytes (base64url)
//   modify { accountId, threadId, add?, remove? } → archive / unread / star
//   send   { accountId, threadId?, to, cc?, subject, body }
//   draft  { ...same }                         → a Gmail draft
// Every account is checked against the CALLER's own mail_accounts row.
import { mailTester, mailAccountsOf, listThreads, readThread, attachmentData, modifyThread, trashThread, unsubscribeThread, sendMail, draftMail, sendDraft, updateDraft, discardDraft, type ThreadSummary } from '../_shared/gmail.ts';

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
      case 'attachment': {
        return json(await attachmentData(me, s('accountId'), s('messageId'), s('attachmentId')));
      }
      case 'modify': {
        const arr = (k: string) => (Array.isArray(b[k]) ? (b[k] as unknown[]).map(String) : []);
        await modifyThread(me, s('accountId'), s('threadId'), arr('add'), arr('remove'));
        return json({ ok: true });
      }
      case 'trash': {
        await trashThread(me, s('accountId'), s('threadId'));
        return json({ ok: true });
      }
      case 'unsubscribe': {
        const acct = (await mailAccountsOf(me)).find((a) => a.id === s('accountId'));
        if (!acct) return json({ error: 'That inbox isn’t connected to your Lichen.' }, 400);
        return json(await unsubscribeThread(me, acct, s('threadId')));
      }
      case 'send':
      case 'draft': {
        if (!s('to').trim()) return json({ error: 'Who is it to?' }, 400);
        if (!s('body').trim()) return json({ error: 'There are no words to send yet.' }, 400);
        const o = { accountId: s('accountId'), threadId: s('threadId') || undefined, to: s('to'), cc: s('cc') || undefined, subject: s('subject'), body: s('body') };
        const id = b.action === 'send' ? await sendMail(me, o) : await draftMail(me, o);
        return json({ ok: true, id });
      }
      // A draft already in Gmail (often the brain's): send it, save edits, or discard.
      case 'send_draft':
      case 'update_draft': {
        if (!s('messageId')) return json({ error: 'Which draft?' }, 400);
        const edits = s('body').trim()
          ? { accountId: s('accountId'), threadId: s('threadId') || undefined, to: s('to'), cc: s('cc') || undefined, subject: s('subject'), body: s('body') }
          : undefined;
        if (edits && !edits.to.trim()) return json({ error: 'Who is it to?' }, 400);
        if (b.action === 'update_draft') {
          if (!edits) return json({ error: 'There are no words to save yet.' }, 400);
          return json({ ok: true, messageId: await updateDraft(me, s('accountId'), s('messageId'), edits) });
        }
        return json({ ok: true, id: await sendDraft(me, s('accountId'), s('messageId'), edits) });
      }
      case 'discard_draft': {
        await discardDraft(me, s('accountId'), s('messageId'));
        return json({ ok: true });
      }
      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
