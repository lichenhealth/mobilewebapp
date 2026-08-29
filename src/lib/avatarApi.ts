import { supabase } from './supabase';

/** Downscale an image file to a square-ish JPEG capped at `max` px (avatars
 *  don't need originals — keeps the public bucket light and uploads fast). */
export function downscaleImage(file: File, max = 512): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process image.'))), 'image/jpeg', 0.86);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Not a readable image.')); };
    img.src = url;
  });
}

/** Upload a new profile picture and record its public URL. Timestamped
 *  filename → browser caches can never show a stale avatar. */
export async function uploadAvatar(uid: string, file: File): Promise<string> {
  const blob = await downscaleImage(file);
  const path = `${uid}/avatar-${Date.now()}.jpg`;
  const { error: upErr } = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg' });
  if (upErr) throw upErr;
  const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
  const { error: dbErr } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', uid);
  if (dbErr) throw dbErr;
  return url;
}

/** A photo for someone's page — the Gallery tab and story images (founder
 *  2026-08-06). Same bucket and per-user folder as avatars, so the existing
 *  storage policy covers it with nothing new to grant. */
export async function uploadPageImage(uid: string, file: File): Promise<string> {
  const blob = await downscaleImage(file, 1600);
  const path = `${uid}/page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from('avatars')
    .upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
}

/** Where a freshly uploaded photo should sit in its frame, as a CSS
 *  object-position percentage (0 = show the top, 100 = the bottom).
 *  `null` means "we don't know" — the caller leaves the photo centred, which
 *  is exactly what happened before this existed.
 *
 *  Founder 2026-08-28, after Rick Countryman's head was cropped off the
 *  barn's About page: nothing looked at an uploaded image, so a standing
 *  person lost their head to a centred crop every time. Fire-and-forget —
 *  never await this before showing the photo, and never let it throw into an
 *  upload. The owner's drag overwrites whatever it returns. */
export async function imageFocusPct(url: string): Promise<number | null> {
  try {
    const { data, error } = await supabase.functions.invoke('image-focus', { body: { image: url } });
    if (error) return null;
    const pct = (data as { pct?: unknown } | null)?.pct;
    return typeof pct === 'number' && pct >= 0 && pct <= 100 ? Math.round(pct) : null;
  } catch {
    return null;
  }
}

/** The colour scheme a business's logo implies — its colour, and which of
 *  the three grounds it belongs on. `null` when nothing useful came back.
 *  A PROPOSAL, never applied directly: the caller shows it to the owner to
 *  accept or refuse, and forces the accent readable first (founder
 *  2026-08-28, "let them preview it to decide if they like it"). */
export async function brandSchemeFromLogo(
  url: string,
): Promise<{ accent: string | null; ground: string } | null> {
  try {
    const { data, error } = await supabase.functions.invoke('brand-colors', { body: { image: url } });
    if (error) return null;
    const d = data as { accent?: unknown; ground?: unknown } | null;
    const accent = typeof d?.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(d.accent) ? d.accent : null;
    // A ground is a named look OR a hex the logo suggested — a tint that
    // suits it can beat plain white (founder 2026-08-28).
    const raw = typeof d?.ground === 'string' ? d.ground.trim().toLowerCase() : '';
    const ground = raw === 'white' || raw === 'warm' ? raw
      : /^#[0-9a-f]{6}$/.test(raw) ? raw
      : 'white';
    return accent === null && ground === 'white' ? null : { accent, ground };
  } catch {
    return null;
  }
}
