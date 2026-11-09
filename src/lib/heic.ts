// HEIC → JPEG AT THE DOOR (founder 2026-11-09: "I uploaded photos for mom's
// bday zoom and they don't show up in the invite" — iPhone photos arrive as
// .heic, which Safari renders and Chrome, most phones' email apps and every
// canvas do not). Every image upload runs through webSafeImage first; a
// non-HEIC file passes straight through, and the converter (heic2any) is
// loaded only when a HEIC actually arrives.

export function isHeic(file: Blob, ext?: string): boolean {
  const t = (file.type || '').toLowerCase();
  const e = (ext || ((file as File).name ?? '').split('.').pop() || '').toLowerCase();
  return t === 'image/heic' || t === 'image/heif' || e === 'heic' || e === 'heif';
}

/** Returns a browser-safe image + its extension (jpg for converted HEIC). */
export async function webSafeImage(file: Blob, ext: string): Promise<{ file: Blob; ext: string }> {
  if (!isHeic(file, ext)) return { file, ext };
  const { default: heic2any } = await import('heic2any');
  const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.88 });
  const blob = Array.isArray(out) ? out[0] : out;
  return { file: blob, ext: 'jpg' };
}
