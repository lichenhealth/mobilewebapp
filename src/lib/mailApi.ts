import { supabase } from './supabase';

/** LICHEN MAIL (founder 2026-11-11: "let's create 'Mail' on Lichen and I can
 *  test it for personal use"). Gmail inboxes a member connects; every read is
 *  live from Google through the mail-api edge function — Lichen stores no
 *  message content. A personal test today: platform_settings.mail_testers. */

export type MailAccount = { id: string; email: string; connected_at: string; last_error: string | null };
export type ThreadSummary = {
  account_id: string; account: string; thread_id: string;
  from: string; subject: string; snippet: string; date: string; unread: boolean; starred?: boolean; count: number;
};
export type MailFile = { name: string; mime: string; size: number; attachment_id: string; cid: string | null; inline: boolean };
export type MailMessage = {
  id: string; from: string; to: string; cc: string; date: string; subject: string;
  body: string; html: string | null; attachments: string[]; files: MailFile[]; message_id: string; references: string;
  /** An unsent draft in the thread — rendered as an editable composer with Send. */
  draft?: boolean;
};
export type MailThread = { subject: string; messages: MailMessage[]; unread: boolean; starred?: boolean };

export async function mailEnabled(me: string | undefined): Promise<boolean> {
  if (!me) return false;
  const { data } = await supabase.from('platform_settings').select('value').eq('key', 'mail_testers').maybeSingle();
  const v = (data as { value: unknown } | null)?.value;
  return Array.isArray(v) && v.includes(me);
}

export async function listMailAccounts(): Promise<MailAccount[]> {
  const { data } = await supabase.from('mail_accounts').select('id, email, connected_at, last_error').order('connected_at');
  return (data as MailAccount[] | null) ?? [];
}

export async function call<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    // The function's own words ride the response body.
    let msg = error.message;
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* keep */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

/** Off to Google's consent screen; it returns to /mail — or to `returnPath`
 *  (an in-app path, e.g. the brain conversation that asked for it). */
export async function connectMail(hint?: string, returnPath?: string): Promise<void> {
  const origin = window.location.origin;
  const { url } = await call<{ url: string }>('mail-oauth-start', { returnTo: origin, hint, returnPath });
  window.location.assign(url);
}

export async function disconnectMail(accountId: string): Promise<void> {
  await call('mail-oauth-start', { action: 'disconnect', accountId });
}

export async function loadInbox(accountId: string | null, q: string): Promise<{ threads: ThreadSummary[]; errors: { account: string; error: string }[] }> {
  return call('mail-api', { action: 'inbox', accountId: accountId ?? undefined, q });
}

export async function loadMailThread(accountId: string, threadId: string): Promise<MailThread> {
  return call('mail-api', { action: 'thread', accountId, threadId });
}

/** One attachment's bytes, base64url — fetched live from Gmail, never stored. */
export async function mailAttachment(accountId: string, messageId: string, attachmentId: string): Promise<{ data: string; size: number }> {
  return call('mail-api', { action: 'attachment', accountId, messageId, attachmentId });
}

export async function trashMailThread(accountId: string, threadId: string): Promise<void> {
  await call('mail-api', { action: 'trash', accountId, threadId });
}

export async function modifyMailThread(accountId: string, threadId: string, add: string[], remove: string[]): Promise<void> {
  await call('mail-api', { action: 'modify', accountId, threadId, add, remove });
}

export type Outgoing = { accountId: string; threadId?: string; to: string; cc?: string; subject: string; body: string };
export async function sendMail(o: Outgoing): Promise<void> { await call('mail-api', { action: 'send', ...o }); }
export async function saveMailDraft(o: Outgoing): Promise<void> { await call('mail-api', { action: 'draft', ...o }); }
/** A draft already in Gmail (often the brain's): send it — with edits, or as
 *  it stands — save edits, or discard it. */
export async function sendMailDraft(accountId: string, messageId: string, edits?: Outgoing): Promise<void> {
  await call('mail-api', { ...(edits ?? {}), action: 'send_draft', accountId, messageId });
}
export async function updateMailDraft(accountId: string, messageId: string, edits: Outgoing): Promise<string> {
  const r = await call<{ messageId: string }>('mail-api', { ...edits, action: 'update_draft', accountId, messageId });
  return r.messageId;
}
export async function discardMailDraft(accountId: string, messageId: string): Promise<void> {
  await call('mail-api', { action: 'discard_draft', accountId, messageId });
}

/** "Galyn Burke <g@x.com>" → "Galyn Burke"; a bare address stays itself. */
export function senderName(from: string): string {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  return (m ? m[1] : from).trim() || from;
}
export function senderAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}

/** Unsubscribe from the sender of a thread — Gmail's own List-Unsubscribe way. */
export type UnsubResult = { thread_id: string; from: string; status: 'unsubscribed' | 'emailed' | 'needs_you' | 'no_option' | 'failed'; how?: string; url?: string; error?: string };
export async function unsubscribeMailThread(accountId: string, threadId: string): Promise<UnsubResult> {
  return call('mail-api', { action: 'unsubscribe', accountId, threadId });
}
