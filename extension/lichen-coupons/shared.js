// Shared by the background worker and the popup.
export const API = 'https://mjqnaevertyzgjlpwynr.supabase.co/functions/v1/coupons-ext';
export const APP = 'https://lichen.health';

const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// "shop.chewy.com" → "chewy"; "amazon.co.uk" → "amazon"
function brandLabel(host) {
  const parts = host.split('.');
  if (parts.length >= 3 && parts[parts.length - 2].length <= 3 && parts[parts.length - 1].length <= 2) return parts[parts.length - 3];
  return parts.length >= 2 ? parts[parts.length - 2] : host;
}
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const live = (c) => !c.expires_on || c.expires_on >= todayIso();

/** Coupons that work on this page's site — decided here, on the device. */
export function couponsFor(url, coupons) {
  const host = hostOf(url);
  if (!host || !/^https?:/.test(url)) return [];
  const brand = slug(brandLabel(host));
  return (coupons || []).filter((c) => {
    if (!live(c) || c.where_valid === 'in_store') return false;
    const d = hostOf(c.url || '');
    if (d) return host === d || host.endsWith('.' + d);
    const m = slug(c.merchant);
    return m.length >= 3 && (m === brand || (brand.length >= 4 && m.startsWith(brand)));
  });
}
export const atCheckout = (url) => { try { return /cart|checkout|basket|\/bag\b|payment|place-?order/i.test(new URL(url).pathname); } catch { return false; } };

export function couponLine(c) {
  const bits = [c.offer];
  if (c.min_spend_cents) bits.push(`$${Math.round(c.min_spend_cents / 100)} minimum`);
  if (c.expires_on) bits.push('until ' + new Date(c.expires_on + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  return bits.join(' · ');
}
