import { supabase } from './supabase';

/** LICHEN MAIL (founder 2026-11-11: "let's create 'Mail' on Lichen and I can
 *  test it for personal use"). Gmail inboxes a member connects; every read is
 *  live from Google through the mail-api edge function — Lichen stores no
 *  message content. A personal test today: platform_settings.mail_testers. */

export type MailAccount = { id: string; email: string; connected_at: string; last_error: string | null };
export type ThreadSummary = {
  account_id: string; account: string; thread_id: string;
  from: string; subject: string; snippet: string; date: string; unread: boolean; count: number;
};
export type MailMessage = {
  id: string; from: string; to: string; cc: string; date: string; subject: string;
  body: string; attachments: string[]; message_id: string; references: string;
};
export type MailThread = { subject: string; messages: MailMessage[]; unread: boolean };

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

async function call<T>(fn: string, body: Record<string, unknown>): Promise<T> {
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

/** Off to Google's consent screen; it returns to /mail. */
export async function connectMail(hint?: string): Promise<void> {
  const origin = window.location.origin;
  const { url } = await call<{ url: string }>('mail-oauth-start', { returnTo: origin, hint });
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

export async function modifyMailThread(accountId: string, threadId: string, add: string[], remove: string[]): Promise<void> {
  await call('mail-api', { action: 'modify', accountId, threadId, add, remove });
}

export type Outgoing = { accountId: string; threadId?: string; to: string; cc?: string; subject: string; body: string };
export async function sendMail(o: Outgoing): Promise<void> { await call('mail-api', { action: 'send', ...o }); }
export async function saveMailDraft(o: Outgoing): Promise<void> { await call('mail-api', { action: 'draft', ...o }); }

/** "Galyn Burke <g@x.com>" → "Galyn Burke"; a bare address stays itself. */
export function senderName(from: string): string {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  return (m ? m[1] : from).trim() || from;
}
export function senderAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}
