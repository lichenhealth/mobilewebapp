// LICHEN MAIL — the shared Gmail machinery (founder 2026-11-11: "let's create
// 'Mail' on Lichen and I can test it for personal use"). Used by mail-api
// (the Mail screen) and assistant-feed (the brain's mail tools), so the two
// can't drift.
//
// Tokens live in mail_tokens (RLS on, NO policies — service role only); a
// member only ever reaches an account whose mail_accounts.profile_id is
// theirs. Nothing here stores message content: every read is live from
// Google.
//
// Secrets: MAIL_GOOGLE_CLIENT_ID, MAIL_GOOGLE_CLIENT_SECRET (a SEPARATE Google
// project in Testing mode — Gmail is a restricted scope, so it stays out of
// the calendar app's verification).

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
export const MAIL_CLIENT_ID = Deno.env.get('MAIL_GOOGLE_CLIENT_ID') ?? '';
export const MAIL_CLIENT_SECRET = Deno.env.get('MAIL_GOOGLE_CLIENT_SECRET') ?? '';
const GM = 'https://gmail.googleapis.com/gmail/v1/users/me';

const svc = () => ({ apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json' });

export type MailAccount = { id: string; email: string };

/** The accounts this member connected (their own, nobody else's). */
export async function mailAccountsOf(profileId: string): Promise<MailAccount[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/mail_accounts?profile_id=eq.${profileId}&select=id,email&order=connected_at`, { headers: svc() });
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
}

/** Is this member on the Mail test list? (platform_settings.mail_testers) */
export async function mailTester(profileId: string): Promise<boolean> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/platform_settings?key=eq.mail_testers&select=value`, { headers: svc() });
  const rows = await r.json();
  const v = Array.isArray(rows) ? rows[0]?.value : null;
  return Array.isArray(v) && v.includes(profileId);
}

async function markError(accountId: string, msg: string | null) {
  await fetch(`${SUPABASE_URL}/rest/v1/mail_accounts?id=eq.${accountId}`, {
    method: 'PATCH', headers: { ...svc(), Prefer: 'return=minimal' }, body: JSON.stringify({ last_error: msg }),
  });
}

/** A live access token for one of THIS member's accounts (refreshing when
 *  stale). Throws in plain words when the connection needs redoing. */
export async function accessTokenFor(profileId: string, accountId: string): Promise<string> {
  const own = await (await fetch(`${SUPABASE_URL}/rest/v1/mail_accounts?id=eq.${accountId}&profile_id=eq.${profileId}&select=id`, { headers: svc() })).json();
  if (!Array.isArray(own) || !own.length) throw new Error('That inbox isn’t connected to your Lichen.');
  const rows = await (await fetch(`${SUPABASE_URL}/rest/v1/mail_tokens?account_id=eq.${accountId}&select=refresh_token,access_token,expires_at`, { headers: svc() })).json();
  const t = Array.isArray(rows) ? rows[0] : null;
  if (!t) throw new Error('That inbox needs reconnecting.');
  if (t.access_token && t.expires_at && new Date(t.expires_at).getTime() - Date.now() > 60_000) return t.access_token;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: MAIL_CLIENT_ID, client_secret: MAIL_CLIENT_SECRET, refresh_token: t.refresh_token, grant_type: 'refresh_token' }),
  });
  if (!res.ok) {
    // Testing-mode Google apps expire refresh tokens after 7 days — say so.
    await markError(accountId, 'needs_reconnect');
    throw new Error('Google asked to reconnect this inbox (testing apps re-ask about once a week). Tap Reconnect on the Mail screen.');
  }
  const j = await res.json() as { access_token: string; expires_in: number };
  await fetch(`${SUPABASE_URL}/rest/v1/mail_tokens?account_id=eq.${accountId}`, {
    method: 'PATCH', headers: { ...svc(), Prefer: 'return=minimal' },
    body: JSON.stringify({ access_token: j.access_token, expires_at: new Date(Date.now() + j.expires_in * 1000).toISOString() }),
  });
  await markError(accountId, null);
  return j.access_token;
}

async function gm(token: string, path: string, init?: RequestInit) {
  const r = await fetch(`${GM}/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`Gmail said ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
}

type Header = { name: string; value: string };
type Part = { mimeType?: string; body?: { data?: string; size?: number; attachmentId?: string }; parts?: Part[]; filename?: string; headers?: Header[] };
type GMsg = { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: Part };

const hdr = (m: GMsg, n: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? '';

export type ThreadSummary = {
  account_id: string; account: string; thread_id: string;
  from: string; subject: string; snippet: string; date: string; unread: boolean; count: number;
};

/** Threads for one account — Gmail's own search grammar (default: the inbox). */
export async function listThreads(profileId: string, acct: MailAccount, q: string, max = 20): Promise<ThreadSummary[]> {
  const token = await accessTokenFor(profileId, acct.id);
  const list = await gm(token, `threads?maxResults=${max}&q=${encodeURIComponent(q || 'in:inbox')}`) as { threads?: { id: string }[] };
  const ids = (list?.threads ?? []).map((t) => t.id);
  const threads = await Promise.all(ids.map((id) =>
    gm(token, `threads/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`).catch(() => null)));
  const out: ThreadSummary[] = [];
  for (const t of threads as ({ id: string; messages?: GMsg[] } | null)[]) {
    const msgs = t?.messages ?? [];
    if (!t || !msgs.length) continue;
    const first = msgs[0], last = msgs[msgs.length - 1];
    out.push({
      account_id: acct.id, account: acct.email, thread_id: t.id,
      from: hdr(last, 'From'), subject: hdr(first, 'Subject') || '(no subject)',
      snippet: decodeEntities(last.snippet ?? ''), date: new Date(Number(last.internalDate ?? 0)).toISOString(),
      unread: msgs.some((m) => m.labelIds?.includes('UNREAD')), count: msgs.length,
    });
  }
  return out;
}

function decodeEntities(s: string) {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function b64dec(data: string): string {
  const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function htmlToText(html: string): string {
  return decodeEntities(html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' '))
    .replace(/\n{3,}/g, '\n\n').trim();
}
function bodyText(p: Part | undefined): string {
  if (!p) return '';
  const find = (part: Part, mime: string): string | null => {
    if (part.mimeType === mime && part.body?.data) return b64dec(part.body.data);
    for (const c of part.parts ?? []) { const f = find(c, mime); if (f) return f; }
    return null;
  };
  const plain = find(p, 'text/plain');
  if (plain) return plain.trim();
  const html = find(p, 'text/html');
  return html ? htmlToText(html) : '';
}
function attachmentsOf(p: Part | undefined): string[] {
  const out: string[] = [];
  const walk = (x: Part) => { if (x.filename) out.push(x.filename); (x.parts ?? []).forEach(walk); };
  if (p) walk(p);
  return out;
}

export type MailMessage = {
  id: string; from: string; to: string; cc: string; date: string; subject: string;
  body: string; attachments: string[]; message_id: string; references: string;
};

/** A whole thread as plain text — never raw HTML (an email's HTML is a
 *  stranger's markup; it never renders inside Lichen). */
export async function readThread(profileId: string, accountId: string, threadId: string): Promise<{ subject: string; messages: MailMessage[]; unread: boolean }> {
  const token = await accessTokenFor(profileId, accountId);
  const t = await gm(token, `threads/${encodeURIComponent(threadId)}?format=full`) as { messages?: GMsg[] };
  const msgs = t?.messages ?? [];
  return {
    subject: msgs[0] ? (hdr(msgs[0], 'Subject') || '(no subject)') : '',
    unread: msgs.some((m) => m.labelIds?.includes('UNREAD')),
    messages: msgs.map((m) => ({
      id: m.id, from: hdr(m, 'From'), to: hdr(m, 'To'), cc: hdr(m, 'Cc'),
      date: new Date(Number(m.internalDate ?? 0)).toISOString(), subject: hdr(m, 'Subject'),
      body: bodyText(m.payload).slice(0, 40_000), attachments: attachmentsOf(m.payload),
      message_id: hdr(m, 'Message-ID') || hdr(m, 'Message-Id'), references: hdr(m, 'References'),
    })),
  };
}

export async function modifyThread(profileId: string, accountId: string, threadId: string, add: string[], remove: string[]) {
  const ok = new Set(['INBOX', 'UNREAD', 'STARRED']);
  const token = await accessTokenFor(profileId, accountId);
  await gm(token, `threads/${encodeURIComponent(threadId)}/modify`, {
    method: 'POST', body: JSON.stringify({ addLabelIds: add.filter((l) => ok.has(l)), removeLabelIds: remove.filter((l) => ok.has(l)) }),
  });
}

/** Encode an RFC 2822 message (UTF-8 headers via RFC 2047). */
function rawMessage(o: { from: string; to: string; cc?: string; subject: string; body: string; inReplyTo?: string; references?: string }): string {
  const enc = (s: string) => /[^\x20-\x7E]/.test(s) ? `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(s)))}?=` : s;
  const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
  const lines = [
    `From: ${clean(o.from)}`, `To: ${clean(o.to)}`,
    ...(o.cc ? [`Cc: ${clean(o.cc)}`] : []),
    `Subject: ${enc(clean(o.subject))}`,
    ...(o.inReplyTo ? [`In-Reply-To: ${clean(o.inReplyTo)}`] : []),
    ...(o.references ? [`References: ${clean(o.references)}`] : []),
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '',
    btoa(String.fromCharCode(...new TextEncoder().encode(o.body))).replace(/.{76}/g, '$&\r\n'),
  ];
  return btoa(lines.join('\r\n')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export type Outgoing = { accountId: string; threadId?: string; to: string; cc?: string; subject: string; body: string };

/** Fills reply headers from the thread when threadId is given. */
async function prepared(profileId: string, o: Outgoing) {
  const accts = await mailAccountsOf(profileId);
  const acct = accts.find((a) => a.id === o.accountId);
  if (!acct) throw new Error('That inbox isn’t connected to your Lichen.');
  let inReplyTo: string | undefined, references: string | undefined, subject = o.subject;
  if (o.threadId) {
    const t = await readThread(profileId, o.accountId, o.threadId);
    const last = t.messages[t.messages.length - 1];
    if (last?.message_id) { inReplyTo = last.message_id; references = `${last.references} ${last.message_id}`.trim(); }
    if (!subject) subject = /^re:/i.test(t.subject) ? t.subject : `Re: ${t.subject}`;
  }
  const raw = rawMessage({ from: acct.email, to: o.to, cc: o.cc, subject, body: o.body, inReplyTo, references });
  return { raw, threadId: o.threadId };
}

export async function sendMail(profileId: string, o: Outgoing): Promise<string> {
  const token = await accessTokenFor(profileId, o.accountId);
  const p = await prepared(profileId, o);
  const r = await gm(token, 'messages/send', { method: 'POST', body: JSON.stringify(p) }) as { id: string };
  return r.id;
}

/** A draft in the account itself — shows in Gmail AND in Lichen Mail. The
 *  brain only ever drafts; the person sends. */
export async function draftMail(profileId: string, o: Outgoing): Promise<string> {
  const token = await accessTokenFor(profileId, o.accountId);
  const p = await prepared(profileId, o);
  const r = await gm(token, 'drafts', { method: 'POST', body: JSON.stringify({ message: p }) }) as { id: string };
  return r.id;
}

/** Revoke at Google, then forget the account. */
export async function disconnectMail(profileId: string, accountId: string) {
  const rows = await (await fetch(`${SUPABASE_URL}/rest/v1/mail_tokens?account_id=eq.${accountId}&select=refresh_token`, { headers: svc() })).json();
  const rt = Array.isArray(rows) ? rows[0]?.refresh_token : null;
  if (rt) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(rt)}`, { method: 'POST' }).catch(() => null);
  await fetch(`${SUPABASE_URL}/rest/v1/mail_accounts?id=eq.${accountId}&profile_id=eq.${profileId}`, { method: 'DELETE', headers: { ...svc(), Prefer: 'return=minimal' } });
}
