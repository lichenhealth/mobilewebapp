// COUPONS (founder 2026-11-25: "take pics of things and organize them for me
// to coupons! And then when they expire, delete them… step 1 is just
// organizing coupons so we don't have to keep paper").
// Owner-only rows; photos live in the private `drive` bucket under
// <uid>/coupons/. The `coupons` edge fn reads a photo into fields; Lichen
// bells three days before expiry and deletes the coupon (and its photo) once
// it has expired.
import { supabase } from './supabase';
import { downscaleImage } from './avatarApi';

export type Coupon = {
  id: string;
  merchant: string;
  offer: string;
  code: string | null;
  min_spend_cents: number | null;
  expires_on: string | null;
  terms: string | null;
  url: string | null;
  where_valid: 'online' | 'in_store' | 'both' | null;
  category: string | null;
  photo_path: string | null;
  created_at: string;
};
export type CouponDraft = Omit<Coupon, 'id' | 'created_at'> & { id?: string };
export type ScannedCoupon = {
  merchant: string; offer: string; code: string | null; min_spend: number | null; expires_on: string | null;
  where_valid: Coupon['where_valid']; url: string | null; category: string | null; terms: string | null;
};

const COLS = 'id, merchant, offer, code, min_spend_cents, expires_on, terms, url, where_valid, category, photo_path, created_at';

export async function listCoupons(): Promise<Coupon[]> {
  const { data } = await supabase.from('coupons').select(COLS).order('expires_on', { ascending: true, nullsFirst: false });
  return (data as Coupon[] | null) ?? [];
}

export async function saveCoupon(c: CouponDraft): Promise<void> {
  const row = {
    merchant: c.merchant.trim().slice(0, 120), offer: c.offer.trim().slice(0, 240),
    code: c.code?.trim() || null, min_spend_cents: c.min_spend_cents, expires_on: c.expires_on || null,
    terms: c.terms?.trim() || null, url: c.url?.trim() || null, where_valid: c.where_valid,
    category: c.category?.trim() || null, photo_path: c.photo_path,
  };
  if (!row.merchant) throw new Error('Name the store.');
  if (!row.offer) throw new Error('Say what the deal is.');
  if (row.url && !/^https:\/\/\S+$/.test(row.url)) throw new Error('The website has to start with https://');
  const { error } = c.id
    ? await supabase.from('coupons').update(row).eq('id', c.id)
    : await supabase.from('coupons').insert(row);
  if (error) throw new Error(error.message);
}

/** A real delete — the row and its photo. */
export async function deleteCoupon(c: Coupon): Promise<void> {
  const { error } = await supabase.from('coupons').delete().eq('id', c.id);
  if (error) throw new Error(error.message);
  if (c.photo_path) await supabase.storage.from('drive').remove([c.photo_path]);
}

/** Store the photo privately, then ask the edge fn to read it. */
export async function scanCouponPhoto(file: File): Promise<{ photoPath: string; coupons: ScannedCoupon[]; note: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in first.');
  const blob = await downscaleImage(file, 1800);
  const path = `${user.id}/coupons/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error: upErr } = await supabase.storage.from('drive').upload(path, blob, { contentType: 'image/jpeg' });
  if (upErr) throw new Error(upErr.message);
  const image = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).replace(/^data:[^,]+,/, ''));
    r.onerror = () => rej(new Error('Could not read the photo.'));
    r.readAsDataURL(blob);
  });
  const { data, error } = await supabase.functions.invoke('coupons', { body: { image, media_type: 'image/jpeg' } });
  if (error) {
    let msg = 'I couldn’t read that photo — type it in instead.';
    try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* keep the plain words */ }
    return { photoPath: path, coupons: [], note: msg };
  }
  return { photoPath: path, coupons: (data?.coupons ?? []) as ScannedCoupon[], note: String(data?.note ?? '') };
}

export async function signCouponPhotos(paths: string[]): Promise<Record<string, string>> {
  const list = [...new Set(paths.filter(Boolean))];
  if (!list.length) return {};
  const { data } = await supabase.storage.from('drive').createSignedUrls(list, 3600);
  const out: Record<string, string> = {};
  for (const r of data ?? []) if (r.path && r.signedUrl) out[r.path] = r.signedUrl;
  return out;
}

/** Drop an unsaved scan's photo (Never mind after a scan). */
export async function discardCouponPhoto(path: string): Promise<void> {
  await supabase.storage.from('drive').remove([path]);
}
