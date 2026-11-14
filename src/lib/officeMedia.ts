import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { downscaleImage } from './avatarApi';

/** Images inside Docs and Slides (founder 2026-11-14). They live in PRIVATE
 *  storage beside the doc — a personal doc's in the owner's `drive` folder, a
 *  room doc's in that room's `chat-media` folder — and the doc stores only a
 *  reference ("drive/<path>" / "chat-media/<path>"). Viewers get short-lived
 *  signed links, so an image is only ever as readable as the doc it sits in. */

export type ImgRef = string;  // "<bucket>/<path>"
const OK = /^(drive|chat-media)\/[\w\-./]+$/;
export const isImgRef = (s: unknown): s is ImgRef => typeof s === 'string' && OK.test(s) && !s.includes('..');

export async function uploadOfficeImage(file: File, chatId: string | null): Promise<ImgRef> {
  const blob = await downscaleImage(file, 2000);
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  let bucket: 'drive' | 'chat-media', path: string;
  if (chatId) { bucket = 'chat-media'; path = `${chatId}/office-${name}`; }
  else {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not signed in');
    bucket = 'drive'; path = `${user.id}/office-${name}`;
  }
  const { error } = await supabase.storage.from(bucket).upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return `${bucket}/${path}`;
}

const cache = new Map<ImgRef, { url: string; at: number }>();
const TTL = 3600, FRESH = 45 * 60 * 1000;

export async function signImgRefs(refs: ImgRef[]): Promise<Record<ImgRef, string>> {
  const out: Record<ImgRef, string> = {};
  const need: Record<string, string[]> = {};
  for (const r of new Set(refs.filter(isImgRef))) {
    const hit = cache.get(r);
    if (hit && Date.now() - hit.at < FRESH) { out[r] = hit.url; continue; }
    const [bucket, ...rest] = r.split('/');
    (need[bucket] ??= []).push(rest.join('/'));
  }
  await Promise.all(Object.entries(need).map(async ([bucket, paths]) => {
    const { data } = await supabase.storage.from(bucket).createSignedUrls(paths, TTL);
    for (const d of data ?? []) if (d.path && d.signedUrl) {
      const ref = `${bucket}/${d.path}`;
      cache.set(ref, { url: d.signedUrl, at: Date.now() }); out[ref] = d.signedUrl;
    }
  }));
  return out;
}

/** Signed URLs for a list of refs, re-signed when the list changes. */
export function useSignedImgs(refs: (ImgRef | undefined)[]): Record<ImgRef, string> {
  const list = refs.filter(isImgRef);
  const keyStr = [...new Set(list)].sort().join('|');
  const [map, setMap] = useState<Record<ImgRef, string>>({});
  useEffect(() => {
    if (!keyStr) return;
    let live = true;
    void signImgRefs(keyStr.split('|')).then((m) => { if (live) setMap((cur) => ({ ...cur, ...m })); });
    return () => { live = false; };
  }, [keyStr]);
  return map;
}

/** Fill every <img data-store> under `root` with a fresh signed src. */
export async function hydrateImgs(root: HTMLElement): Promise<void> {
  const imgs = [...root.querySelectorAll<HTMLImageElement>('img[data-store]')];
  if (!imgs.length) return;
  const map = await signImgRefs(imgs.map((i) => i.dataset.store ?? ''));
  for (const i of imgs) { const u = map[i.dataset.store ?? '']; if (u && i.src !== u) i.src = u; }
}
