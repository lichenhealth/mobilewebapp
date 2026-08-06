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
