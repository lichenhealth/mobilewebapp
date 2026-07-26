import { supabase } from './supabase';

// Self-run video hosting (founder 2026-07-26): originals go to the 'videos'
// bucket, a video_jobs row queues them for the ffmpeg worker (worker/ in the
// repo), and playback prefers the adaptive HLS rendition once it's ready.
// No external video platform ever touches member media.

export interface VideoJob {
  id: string;
  status: 'uploaded' | 'processing' | 'ready' | 'failed';
  hls_path: string | null;
  poster_path: string | null;
  duration_secs: number | null;
}

export function videoPublicUrl(path: string): string {
  return supabase.storage.from('videos').getPublicUrl(path).data.publicUrl;
}

/** Upload an original + queue its transcode. Returns the public URL of the
 *  original (immediate playback fallback) and the job id. */
export async function uploadVideo(file: Blob, ext: string): Promise<{ url: string; jobId: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage.from('videos').upload(path, file);
  if (upErr) throw upErr;
  const { data, error } = await supabase
    .from('video_jobs')
    .insert({ profile_id: user.id, src_path: path })
    .select('id')
    .single();
  if (error) throw error;
  return { url: videoPublicUrl(path), jobId: (data as { id: string }).id };
}

export async function getVideoJob(id: string): Promise<VideoJob | null> {
  const { data, error } = await supabase
    .from('video_jobs')
    .select('id, status, hls_path, poster_path, duration_secs')
    .eq('id', id)
    .maybeSingle();
  if (error) { console.warn('getVideoJob:', error.message); return null; }
  return (data as VideoJob | null);
}
