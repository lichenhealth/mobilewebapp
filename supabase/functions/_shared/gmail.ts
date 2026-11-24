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
    throw new Error('Google asked to reconnect this inbox (testing apps re-ask about once a week). It needs one Reconnect.');
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
type Part = { partId?: string; mimeType?: string; body?: { data?: string; size?: number; attachmentId?: string }; parts?: Part[]; filename?: string; headers?: Header[] };
type GMsg = { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: Part };

const hdr = (m: GMsg, n: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? '';

export type ThreadSummary = {
  account_id: string; account: string; thread_id: string;
  from: string; subject: string; snippet: string; date: string; unread: boolean; starred: boolean; count: number;
  /** Lichen's own sorting (founder 2026-11-15) — see classifyMail. */
  kind: MailKind;
  /** A reply the member sent to a knock at the door through Lichen (its BCC
   *  copy lands in their own inbox) — Mail labels it "You → «name»". */
  lichen?: { kind: 'knock_reply'; to: string; last_is_copy: boolean };
};

/** LICHEN'S MAIL SORTING (founder 2026-11-15: "the gmail filters… are not very
 *  accurate… Subscriptions (for like, newsletters), Promotions and Updates
 *  (like etsy convos), sometimes newsletters are promotional, so lets do our
 *  best… they'll be a bit messy"). Deterministic, from how the mail was SENT
 *  (List-* headers, no-reply senders) plus words in the subject and Gmail's
 *  own label as one more signal. Order matters: updates first (an Etsy
 *  message or a refund ticket is news about YOU even when it's bulk-sent),
 *  then sales words, then anything list-sent reads as a subscription, then a
 *  person. */
export type MailKind = 'primary' | 'subscriptions' | 'promotions' | 'updates';
const UPDATE_RE = /\b(order|receipt|invoice|payment|paid|refund|shipp?ed|shipping update|deliver(ed|y)|out for delivery|tracking|ticket|case #|support request|reservation|booking|booked|appointment|confirm(ed|ation)?|verif(y|ication)|security|sign[- ]in|log[- ]?in|password|your account|account (update|alert)|statement|bill|renewal|subscription (renew|confirm)|new message|sent you a message|messaged you|replied|reply from|mentioned you|commented|invited you|shared .{0,30}with you|reminder|due (soon|today)|expir(es|ing)|alert|coming up|upcoming|rsvp|you'?re invited|invitation|starts (soon|in)|(today|tomorrow) at|your (session|appointment|booking|event|trip|stay))\b/i;
const PROMO_RE = /(\d+\s?%\s?off|\$\d+\s?off|\bsale\b|\bdeals?\b|\bdiscount|\bcoupon|\bpromo|\bsave (up to|\$|\d)|\bfree shipping|\blimited[- ]time|\bends (tonight|today|soon|sunday|midnight)|\blast chance|\bshop (now|the)\b|\bnew arrivals|\bexclusive (offer|access)|\bblack friday|\bcyber monday|\bflash\b|\bclearance|\bbogo\b|\bgift (guide|idea)|\bdon'?t miss|\bjust dropped|\bback in stock|\b(use|with|enter) (promo )?code\b|\bholiday savings|\bsavings\b|\bbest[- ]sellers?\b|\bsitewide)/i;
const NEWSLETTER_RE = /(substack|beehiiv|mailchimp|mcsv\.net|list-manage|convertkit|kit\.com|buttondown|ghost\.io|mailerlite|sendinblue|brevo|campaign-archive|constantcontact|newsletter|digest|weekly|edition|issue\s?#?\d|this week|roundup|dispatch|letter from)/i;
/** The bare address inside a From header, lowercased. */
export function senderAddress(from: string): string {
  const m = /<([^>]+)>/.exec(from || '');
  return (m ? m[1] : (from || '')).trim().toLowerCase();
}
/** A member's own corrections (mail_sort_rules): address → kind, @domain → kind. */
export type SortRules = Record<string, MailKind>;
export async function mailSortRules(profileId: string): Promise<SortRules> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/mail_sort_rules?profile_id=eq.${profileId}&select=sender,kind`, { headers: svc() }).catch(() => null);
  const rows = r ? await r.json().catch(() => []) : [];
  const out: SortRules = {};
  for (const x of Array.isArray(rows) ? rows : []) out[String(x.sender)] = x.kind;
  return out;
}
export async function saveMailSortRule(profileId: string, sender: string, kind: MailKind): Promise<boolean> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/mail_sort_rules?on_conflict=profile_id,sender`, {
    method: 'POST', headers: { ...svc(), prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ profile_id: profileId, sender, kind }),
  });
  return r.ok;
}
export function classifyMail(m: { from: string; subject: string; snippet?: string; labels: string[]; listUnsub: string; listId: string; precedence: string }, rules: SortRules = {}): MailKind {
  // Their own correction wins — the exact address first, then its domain.
  const addr = senderAddress(m.from);
  const dom = addr.includes('@') ? '@' + addr.split('@')[1] : '';
  if (rules[addr]) return rules[addr];
  if (dom && rules[dom]) return rules[dom];
  const subj = m.subject || '';
  const snip = m.snippet || '';
  const from = (m.from || '').toLowerCase();
  const noreply = /no-?reply|do-?not-?reply|notifications?@|notify@|alerts?@|mailer@|automated|support@|help@|hello@.*\b(etsy|amazon|paypal|stripe|venmo)/.test(from);
  const bulk = !!(m.listUnsub || m.listId || /bulk|list/i.test(m.precedence));
  const g = (l: string) => m.labels.includes(l);
  const promoWords = PROMO_RE.test(subj);
  if (UPDATE_RE.test(subj) && !promoWords) return 'updates';
  if (promoWords) return 'promotions';
  // Sales words in the preview line count too ("Save $15… with code HAPPY26").
  if (PROMO_RE.test(snip) && (bulk || g('CATEGORY_PROMOTIONS') || g('CATEGORY_UPDATES'))) return 'promotions';
  if (bulk || g('CATEGORY_SOCIAL') || g('CATEGORY_FORUMS')) {
    if (g('CATEGORY_PROMOTIONS') && !NEWSLETTER_RE.test(subj + ' ' + from + ' ' + m.listId)) return 'promotions';
    if (g('CATEGORY_UPDATES') && !NEWSLETTER_RE.test(subj + ' ' + from + ' ' + m.listId)) return 'updates';
    return 'subscriptions';
  }
  if (g('CATEGORY_PROMOTIONS')) return 'promotions';
  if (noreply || g('CATEGORY_UPDATES')) return 'updates';
  return 'primary';
}

/** Threads for one account — Gmail's own search grammar (default: the inbox). */
export async function listThreads(profileId: string, acct: MailAccount, q: string, max = 20, rules: SortRules = {}): Promise<ThreadSummary[]> {
  const token = await accessTokenFor(profileId, acct.id);
  const list = await gm(token, `threads?maxResults=${max}&q=${encodeURIComponent(q || 'in:inbox')}`) as { threads?: { id: string }[] };
  const ids = (list?.threads ?? []).map((t) => t.id);
  const threads = await Promise.all(ids.map((id) =>
    gm(token, `threads/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=List-Unsubscribe&metadataHeaders=List-Id&metadataHeaders=Precedence&metadataHeaders=To&metadataHeaders=X-Lichen-Kind`).catch(() => null)));
  const out: ThreadSummary[] = [];
  for (const t of threads as ({ id: string; messages?: GMsg[] } | null)[]) {
    const msgs = t?.messages ?? [];
    if (!t || !msgs.length) continue;
    const first = msgs[0], last = msgs[msgs.length - 1];
    out.push({
      account_id: acct.id, account: acct.email, thread_id: t.id,
      from: hdr(last, 'From'), subject: hdr(first, 'Subject') || '(no subject)',
      snippet: decodeEntities(last.snippet ?? ''), date: new Date(Number(last.internalDate ?? 0)).toISOString(),
      unread: msgs.some((m) => m.labelIds?.includes('UNREAD')), starred: msgs.some((m) => m.labelIds?.includes('STARRED')), count: msgs.length,
      kind: classifyMail({
        from: hdr(last, 'From'), subject: hdr(first, 'Subject'),
        labels: [...new Set(msgs.flatMap((m) => m.labelIds ?? []))],
        snippet: last.snippet ?? '',
        listUnsub: hdr(last, 'List-Unsubscribe'), listId: hdr(last, 'List-Id'), precedence: hdr(last, 'Precedence'),
      }, rules),
      ...knockReplyTag(first, last),
    });
  }
  return out;
}

/** Knock replies sent through Lichen: tagged by header since 2026-11-24, and
 *  recognized by their older subject before that. */
function knockReplyTag(first: GMsg, last: GMsg): Pick<ThreadSummary, 'lichen'> {
  const viaLichen = (m: GMsg) => /hello@lichen\.health/i.test(hdr(m, 'From'));
  const tagged = hdr(first, 'X-Lichen-Kind').toLowerCase() === 'knock-reply'
    || (viaLichen(first) && /wrote back about your note to /i.test(hdr(first, 'Subject')));
  if (!tagged) return {};
  const to = hdr(first, 'To');
  const name = (to.match(/^\s*"?([^"<]+?)"?\s*</)?.[1] ?? to).trim();
  return { lichen: { kind: 'knock_reply', to: name, last_is_copy: viaLichen(last) } };
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
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' '))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function findPart(part: Part | undefined, mime: string): string | null {
  if (!part) return null;
  if (part.mimeType === mime && part.body?.data && !part.filename) return b64dec(part.body.data);
  for (const c of part.parts ?? []) { const f = findPart(c, mime); if (f) return f; }
  return null;
}
/** The words of a message for the BRAIN — plain text, or the HTML's text
 *  when the plain part is missing or plainly thinner than the real email
 *  (some senders ship a broken text/plain alongside their HTML). */
function bodyText(p: Part | undefined): string {
  const plain = findPart(p, 'text/plain')?.trim() ?? '';
  const html = findPart(p, 'text/html');
  const fromHtml = html ? htmlToText(html) : '';
  if (plain && plain.length >= fromHtml.length * 0.25) return plain;
  return fromHtml || plain;
}
const hdrOf = (x: Part, n: string) => x.headers?.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? '';
/** A file's name wherever the sender put it: Gmail's parsed filename, the
 *  Content-Disposition filename (plain or RFC 2231 `filename*=`), or the
 *  Content-Type `name=` parameter. */
function partName(x: Part): string {
  if (x.filename) return x.filename;
  for (const h of ['Content-Disposition', 'Content-Type']) {
    const v = hdrOf(x, h);
    const star = v.match(/(?:file)?name\*=(?:[^']*'[^']*')?("?)([^";]+)\1/i);
    if (star) { try { return decodeURIComponent(star[2]); } catch { return star[2]; } }
    const plain = v.match(/(?:file)?name="?([^";]+)"?/i);
    if (plain) return plain[1].trim();
  }
  return '';
}
/** Every real file in a message: attachments AND inline images (cid:).
 *  A small file can ride INSIDE the message (body.data, no attachmentId) —
 *  those get a `part:<partId>` id that attachmentData resolves (founder
 *  2026-11-15: a WP Engine invoice PDF never showed). */
function filesOf(p: Part | undefined): MailFile[] {
  const out: MailFile[] = [];
  const walk = (x: Part) => {
    const cid = hdrOf(x, 'Content-ID').replace(/^<|>$/g, '');
    const disp = hdrOf(x, 'Content-Disposition').toLowerCase();
    const name = partName(x);
    const mime = (x.mimeType || 'application/octet-stream').toLowerCase();
    const isBody = !name && !cid && !disp.startsWith('attachment') && (mime.startsWith('text/') || mime.startsWith('multipart/'));
    const id = x.body?.attachmentId || (x.body?.data && x.partId ? `part:${x.partId}` : '');
    if (id && !isBody && (name || cid || disp.startsWith('attachment') || !mime.startsWith('multipart/'))) {
      out.push({
        name: name || (cid ? 'image' : 'attachment'), mime, size: x.body?.size ?? 0,
        attachment_id: id, cid: cid || null,
        inline: !!cid && !disp.startsWith('attachment'),
      });
    }
    (x.parts ?? []).forEach(walk);
  };
  if (p) walk(p);
  return out;
}

export type MailFile = { name: string; mime: string; size: number; attachment_id: string; cid: string | null; inline: boolean };
export type MailMessage = {
  id: string; from: string; to: string; cc: string; date: string; subject: string;
  body: string; html: string | null; attachments: string[]; files: MailFile[]; message_id: string; references: string;
  /** An unsent draft sitting in the thread — Mail renders it as an editable
   *  composer with Send, never as a received message. */
  draft: boolean;
};

/** A whole thread. `body` is the words (what the brain reads); `html` is the
 *  email as its sender designed it, for the Mail screen to render inside a
 *  sandboxed, script-less frame (founder 2026-11-15: "the mail import renders
 *  with the same fidelity as the gmail inbox"). `files` are the real
 *  attachments + inline images, fetched on demand via `attachmentData`. */
export async function readThread(profileId: string, accountId: string, threadId: string): Promise<{ subject: string; messages: MailMessage[]; unread: boolean; starred: boolean }> {
  const token = await accessTokenFor(profileId, accountId);
  const t = await gm(token, `threads/${encodeURIComponent(threadId)}?format=full`) as { messages?: GMsg[] };
  const msgs = t?.messages ?? [];
  return {
    subject: msgs[0] ? (hdr(msgs[0], 'Subject') || '(no subject)') : '',
    unread: msgs.some((m) => m.labelIds?.includes('UNREAD')),
    starred: msgs.some((m) => m.labelIds?.includes('STARRED')),
    messages: msgs.map((m) => ({
      id: m.id, from: hdr(m, 'From'), to: hdr(m, 'To'), cc: hdr(m, 'Cc'),
      date: new Date(Number(m.internalDate ?? 0)).toISOString(), subject: hdr(m, 'Subject'),
      body: bodyText(m.payload).slice(0, 40_000),
      html: (() => { const h = findPart(m.payload, 'text/html'); return h && h.length <= 1_500_000 ? h : null; })(),
      files: filesOf(m.payload),
      attachments: filesOf(m.payload).filter((f) => !f.inline).map((f) => f.name),
      message_id: hdr(m, 'Message-ID') || hdr(m, 'Message-Id'), references: hdr(m, 'References'),
      draft: !!m.labelIds?.includes('DRAFT'),
    })),
  };
}

/** One attachment's bytes (base64url, as Gmail sends them) — capped so a
 *  response stays deliverable; bigger files say so in plain words. */
export async function attachmentData(profileId: string, accountId: string, messageId: string, attachmentId: string): Promise<{ data: string; size: number }> {
  const token = await accessTokenFor(profileId, accountId);
  if (attachmentId.startsWith('part:')) {
    // A small file packed inside the message itself — read it off the part.
    const want = attachmentId.slice(5);
    const m = await gm(token, `messages/${encodeURIComponent(messageId)}?format=full`) as GMsg;
    let found: Part | null = null;
    const walk = (x: Part) => { if (x.partId === want) found = x; (x.parts ?? []).forEach(walk); };
    if (m?.payload) walk(m.payload);
    const part = found as Part | null;
    if (!part?.body?.data) throw new Error('That file couldn’t be read — open it in Gmail for now.');
    return { data: part.body.data, size: part.body.size ?? 0 };
  }
  const r = await gm(token, `messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`) as { data?: string; size?: number };
  const size = r?.size ?? 0;
  if (size > 24 * 1024 * 1024) throw new Error('That file is over 24 MB — open it in Gmail for now.');
  return { data: r?.data ?? '', size };
}

export async function modifyThread(profileId: string, accountId: string, threadId: string, add: string[], remove: string[]) {
  const ok = new Set(['INBOX', 'UNREAD', 'STARRED']);
  const token = await accessTokenFor(profileId, accountId);
  await gm(token, `threads/${encodeURIComponent(threadId)}/modify`, {
    method: 'POST', body: JSON.stringify({ addLabelIds: add.filter((l) => ok.has(l)), removeLabelIds: remove.filter((l) => ok.has(l)) }),
  });
}

// ── FILTERS (2026-11-14) — Gmail's own rules, needs gmail.settings.basic. ──
export type GFilter = { id: string; criteria?: Record<string, unknown>; action?: { addLabelIds?: string[]; removeLabelIds?: string[]; forward?: string } };
export async function listFilters(profileId: string, accountId: string): Promise<GFilter[]> {
  const token = await accessTokenFor(profileId, accountId);
  return ((await gm(token, 'settings/filters')) as { filter?: GFilter[] } | null)?.filter ?? [];
}
export async function createFilter(profileId: string, accountId: string, criteria: Record<string, unknown>, action: { addLabelIds?: string[]; removeLabelIds?: string[] }): Promise<GFilter> {
  const token = await accessTokenFor(profileId, accountId);
  return await gm(token, 'settings/filters', { method: 'POST', body: JSON.stringify({ criteria, action }) }) as GFilter;
}
export async function deleteFilter(profileId: string, accountId: string, filterId: string) {
  const token = await accessTokenFor(profileId, accountId);
  await gm(token, `settings/filters/${encodeURIComponent(filterId)}`, { method: 'DELETE' });
}
/** A user label's id by name, created when missing. */
export async function labelIdFor(profileId: string, accountId: string, name: string): Promise<string> {
  const token = await accessTokenFor(profileId, accountId);
  const all = ((await gm(token, 'labels')) as { labels?: { id: string; name: string }[] }).labels ?? [];
  const hit = all.find((l) => l.name.toLowerCase() === name.toLowerCase());
  if (hit) return hit.id;
  const made = await gm(token, 'labels', { method: 'POST', body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }) }) as { id: string };
  return made.id;
}
export async function labelNames(profileId: string, accountId: string): Promise<Map<string, string>> {
  const token = await accessTokenFor(profileId, accountId);
  const all = ((await gm(token, 'labels')) as { labels?: { id: string; name: string }[] }).labels ?? [];
  return new Map(all.map((l) => [l.id, l.name]));
}

/** Move a thread to the account's Trash — recoverable there for 30 days
 *  (gmail.modify allows trash, never permanent delete). */
export async function trashThread(profileId: string, accountId: string, threadId: string) {
  const token = await accessTokenFor(profileId, accountId);
  await gm(token, `threads/${encodeURIComponent(threadId)}/trash`, { method: 'POST' });
}

/** UNSUBSCRIBE, THE WAY GMAIL'S OWN BUTTON DOES (founder 2026-11-14: "give
 *  brain the ability to click thru and unsubscribe for me across accounts").
 *  Reads the sender's List-Unsubscribe headers (RFC 2369 / RFC 8058) — never a
 *  link from the email's body, which is a stranger's markup:
 *  · https + List-Unsubscribe-Post: One-Click → one POST, done (no page);
 *  · mailto: → an "unsubscribe" email from THAT inbox to THAT address only;
 *  · https without one-click → a page a person must confirm: handed back.
 *  Mail already in Trash still carries its headers, so this works after a
 *  clear-out too. */
export type UnsubResult = { thread_id: string; from: string; status: 'unsubscribed' | 'emailed' | 'needs_you' | 'no_option' | 'failed'; how?: string; url?: string; error?: string };
const publicHttps = (u: string) => {
  try {
    const x = new URL(u);
    if (x.protocol !== 'https:' || x.port) return false;
    const h = x.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^[\d.]+$/.test(h) || h.includes(':')) return false;
    return true;
  } catch { return false; }
};
export async function unsubscribeThread(profileId: string, acct: MailAccount, threadId: string): Promise<UnsubResult> {
  const token = await accessTokenFor(profileId, acct.id);
  const t = await gm(token, `threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=List-Unsubscribe&metadataHeaders=List-Unsubscribe-Post`) as { messages?: GMsg[] };
  const msgs = (t?.messages ?? []).slice().reverse();
  const m = msgs.find((x) => hdr(x, 'List-Unsubscribe')) ?? msgs[0];
  const from = m ? hdr(m, 'From') : '';
  const lu = m ? hdr(m, 'List-Unsubscribe') : '';
  if (!lu) return { thread_id: threadId, from, status: 'no_option' };
  const links = [...lu.matchAll(/<([^>]+)>/g)].map((x) => x[1].trim());
  const https = links.find((l) => l.toLowerCase().startsWith('https:') && publicHttps(l));
  const mailto = links.find((l) => l.toLowerCase().startsWith('mailto:'));
  const oneClick = /one-click/i.test(hdr(m, 'List-Unsubscribe-Post'));
  if (https && oneClick) {
    try {
      const r = await fetch(https, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click', signal: AbortSignal.timeout(10000) });
      if (r.status < 400) return { thread_id: threadId, from, status: 'unsubscribed', how: 'one-click' };
      if (!mailto) return { thread_id: threadId, from, status: 'needs_you', url: https, error: `their server said ${r.status}` };
    } catch (e) {
      if (!mailto) return { thread_id: threadId, from, status: 'needs_you', url: https, error: e instanceof Error ? e.message : String(e) };
    }
  }
  if (mailto) {
    try {
      const u = new URL(mailto);
      const to = decodeURIComponent(u.pathname).trim();
      if (!/^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/.test(to)) throw new Error('not a single address');
      const subject = (u.searchParams.get('subject') ?? 'unsubscribe').slice(0, 200) || 'unsubscribe';
      const body = (u.searchParams.get('body') ?? 'unsubscribe').slice(0, 500) || 'unsubscribe';
      const raw = rawMessage({ from: acct.email, to, subject, body });
      await gm(token, 'messages/send', { method: 'POST', body: JSON.stringify({ raw }) });
      return { thread_id: threadId, from, status: 'emailed', how: `sent "unsubscribe" to ${to}` };
    } catch (e) {
      if (!https) return { thread_id: threadId, from, status: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
  }
  if (https) return { thread_id: threadId, from, status: 'needs_you', url: https };
  return { thread_id: threadId, from, status: 'no_option' };
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
    // Reply to the last REAL message — never to a draft sitting in the thread.
    const sent = t.messages.filter((m) => !m.draft);
    const last = sent[sent.length - 1];
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
export async function draftMail(profileId: string, o: Outgoing): Promise<{ draftId: string; messageId: string; threadId: string }> {
  const token = await accessTokenFor(profileId, o.accountId);
  const p = await prepared(profileId, o);
  const r = await gm(token, 'drafts', { method: 'POST', body: JSON.stringify({ message: p }) }) as { id: string; message?: { id: string; threadId: string } };
  return { draftId: r.id, messageId: r.message?.id ?? '', threadId: r.message?.threadId ?? '' };
}

/** A draft's id from the message it holds (a thread shows message ids; the
 *  drafts API wants the draft's). */
async function draftIdOf(token: string, messageId: string): Promise<string | null> {
  let page = '';
  for (let i = 0; i < 5; i++) {
    const r = await gm(token, `drafts?maxResults=500${page ? `&pageToken=${page}` : ''}`) as { drafts?: { id: string; message: { id: string } }[]; nextPageToken?: string };
    const hit = r?.drafts?.find((d) => d.message?.id === messageId);
    if (hit) return hit.id;
    if (!r?.nextPageToken) return null;
    page = r.nextPageToken;
  }
  return null;
}
const GONE = 'That draft isn’t in Gmail anymore — it may have been sent or deleted there.';

/** SEND A DRAFT (founder 2026-11-15: the brain drafted her reply and Mail
 *  showed it with no Send button). Optional edits replace the draft's words
 *  first; then Gmail sends the draft itself, so it leaves Drafts cleanly. */
export async function sendDraft(profileId: string, accountId: string, messageId: string, edits?: Outgoing): Promise<string> {
  const token = await accessTokenFor(profileId, accountId);
  const id = await draftIdOf(token, messageId);
  if (!id) throw new Error(GONE);
  if (edits) {
    const p = await prepared(profileId, edits);
    await gm(token, `drafts/${id}`, { method: 'PUT', body: JSON.stringify({ id, message: p }) });
  }
  const r = await gm(token, 'drafts/send', { method: 'POST', body: JSON.stringify({ id }) }) as { id: string };
  return r?.id ?? '';
}
export async function updateDraft(profileId: string, accountId: string, messageId: string, o: Outgoing): Promise<string> {
  const token = await accessTokenFor(profileId, accountId);
  const id = await draftIdOf(token, messageId);
  if (!id) throw new Error(GONE);
  const p = await prepared(profileId, o);
  const r = await gm(token, `drafts/${id}`, { method: 'PUT', body: JSON.stringify({ id, message: p }) }) as { message?: { id: string } };
  return r?.message?.id ?? '';
}
export async function discardDraft(profileId: string, accountId: string, messageId: string): Promise<void> {
  const token = await accessTokenFor(profileId, accountId);
  const id = await draftIdOf(token, messageId);
  if (!id) return;
  await gm(token, `drafts/${id}`, { method: 'DELETE' });
}

/** Revoke at Google, then forget the account. */
export async function disconnectMail(profileId: string, accountId: string) {
  const rows = await (await fetch(`${SUPABASE_URL}/rest/v1/mail_tokens?account_id=eq.${accountId}&select=refresh_token`, { headers: svc() })).json();
  const rt = Array.isArray(rows) ? rows[0]?.refresh_token : null;
  if (rt) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(rt)}`, { method: 'POST' }).catch(() => null);
  await fetch(`${SUPABASE_URL}/rest/v1/mail_accounts?id=eq.${accountId}&profile_id=eq.${profileId}`, { method: 'DELETE', headers: { ...svc(), Prefer: 'return=minimal' } });
}
