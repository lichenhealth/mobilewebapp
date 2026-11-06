import { supabase } from './supabase';
import { APP_ORIGIN } from './customDomain';

// PRIVATE LISTING LINKS + GUEST CHECKOUT (founder 2026-11-06). A seller
// shares a post with people off Lichen — each gets their own /p/<token>
// link (the event_guests pattern). A guest can ask to buy; the seller
// accepts; the guest pays by card; the dollars land 1:1 as Current-cy with
// the seller (record_post_payment, server-side only).

export interface GuestPostInfo {
  guest_name: string | null;
  post_id: string;
  title: string | null;
  body: string | null;
  photos: string[];
  price: string | null;
  price_cents: number | null;
  modes: string[];
  seller_name: string;
  seller_kind: string;
  order_id: string | null;
  order_status: 'requested' | 'accepted' | 'declined' | 'cancelled' | 'paid' | null;
  order_price_cents: number | null;
  order_paid_at: string | null;
  order_pending_at: string | null;
}

/** Surface an edge function's own words from a non-2xx answer. */
async function fnError(error: unknown, fallback: string): Promise<never> {
  const ctx = (error as { context?: Response }).context;
  if (ctx) {
    const j = await ctx.json().catch(() => null) as { error?: string } | null;
    if (j?.error) throw new Error(j.error);
  }
  throw new Error(fallback);
}

export async function loadGuestPost(token: string): Promise<GuestPostInfo | null> {
  const { data, error } = await supabase.rpc('guest_post', { p_token: token });
  if (error) throw error;
  const row = (data as GuestPostInfo[] | null)?.[0];
  if (!row) return null;
  return { ...row, photos: row.photos ?? [], modes: Array.isArray(row.modes) ? row.modes : [] };
}

export async function requestPurchase(token: string, note: string): Promise<string> {
  const { data, error } = await supabase.rpc('guest_request_purchase', { p_token: token, p_note: note || null });
  if (error) throw new Error(error.message);
  const id = data as string;
  void supabase.functions.invoke('send-post-share', { body: { order_id: id } }).catch(() => undefined);
  return id;
}

export async function cancelPurchase(token: string): Promise<void> {
  const { error } = await supabase.rpc('guest_cancel_purchase', { p_token: token });
  if (error) throw new Error(error.message);
}

export async function startPostCheckout(token: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('post-checkout', { body: { token } });
  if (error) return fnError(error, 'Checkout couldn’t start — try again in a moment.');
  const url = (data as { url?: string })?.url;
  if (!url) throw new Error('Checkout couldn’t start — try again in a moment.');
  return url;
}

// ── the seller's side ───────────────────────────────────────────────────

export interface PostGuest {
  id: string; name: string | null; email: string | null; phone: string | null;
  token: string; emailed_at: string | null; created_at: string;
}
export interface PostOrder {
  id: string; guest_id: string | null; buyer_name: string | null; buyer_email: string | null;
  buyer_phone: string | null; note: string | null; price_cents: number; status: string;
  paid_at: string | null; payment_pending_at: string | null; created_at: string;
}

export async function listPostGuests(postId: string): Promise<PostGuest[]> {
  const { data } = await supabase.from('post_guests')
    .select('id, name, email, phone, token, emailed_at, created_at')
    .eq('post_id', postId).order('created_at', { ascending: false });
  return (data as PostGuest[] | null) ?? [];
}

export async function listPostOrders(postId: string): Promise<PostOrder[]> {
  const { data } = await supabase.from('post_orders')
    .select('id, guest_id, buyer_name, buyer_email, buyer_phone, note, price_cents, status, paid_at, payment_pending_at, created_at')
    .eq('post_id', postId).order('created_at', { ascending: false });
  return (data as PostOrder[] | null) ?? [];
}

export async function addPostGuest(postId: string, me: string,
  c: { name: string; email?: string; phone?: string }): Promise<PostGuest> {
  const { data, error } = await supabase.from('post_guests').insert({
    post_id: postId, invited_by: me, name: c.name || null,
    email: c.email ?? null, phone: c.phone ?? null,
  }).select('id, name, email, phone, token, emailed_at, created_at').single();
  if (error) throw new Error(error.message);
  return data as PostGuest;
}

export async function emailPostGuest(guestId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('send-post-share', { body: { guest_id: guestId } });
  if (error) return fnError(error, 'The email didn’t go out — try again.');
}

export async function removePostGuest(id: string): Promise<void> {
  await supabase.from('post_guests').delete().eq('id', id);
}

export async function respondPostOrder(orderId: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc('respond_post_order', { p_order: orderId, p_accept: accept });
  if (error) throw new Error(error.message);
  void supabase.functions.invoke('send-post-share', { body: { order_id: orderId } }).catch(() => undefined);
}

export const guestPostLink = (token: string) => `${APP_ORIGIN}/p/${token}`;

/** A prepared text from the seller's OWN Messages (no SMS provider —
 *  standing doctrine). */
export function postShareSmsHref(sms: string, seller: string, title: string, token: string): string {
  const body = `${seller} shared “${title}” with you on Lichen — no account needed to look: ${guestPostLink(token)}`;
  return `sms:${sms}?&body=${encodeURIComponent(body)}`;
}

export const centsLabel = (c: number) => {
  const v = c / 100;
  return '$' + (Number.isInteger(v) ? String(v) : v.toFixed(2));
};
