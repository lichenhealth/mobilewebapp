import { supabase } from './supabase';

/** PERSONAL FILES (founder 2026-10-21: Drive's + carries the paperclip's
 *  options): photos, videos and audio uploaded straight into your own Drive —
 *  a PRIVATE bucket ('drive', signed URLs only) + a drive_files row. Strictly
 *  owner-only, no sharing, and NO assistant path ever reads them (the
 *  post_drafts posture — what sits in your Drive is yours until you post). */
export type DriveFileKind = 'photo' | 'video' | 'audio';

export interface DriveFileRow {
  id: string;
  kind: DriveFileKind;
  path: string;
  title: string | null;
  created_at: string;
}

export async function uploadDriveFile(file: File, kind: DriveFileKind): Promise<DriveFileRow> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: upErr } = await supabase.storage.from('drive')
    .upload(path, file, { contentType: file.type || undefined });
  if (upErr) throw upErr;
  const { data, error } = await supabase.from('drive_files')
    .insert({ profile_id: user.id, kind, path, title: file.name })
    .select('id, kind, path, title, created_at').single();
  if (error) throw error;
  return data as DriveFileRow;
}

export async function listDriveFiles(): Promise<DriveFileRow[]> {
  const { data } = await supabase.from('drive_files')
    .select('id, kind, path, title, created_at')
    .order('created_at', { ascending: false });
  return (data as DriveFileRow[] | null) ?? [];
}

/** Batch-sign file paths (1h TTL) → map of path → signed URL. */
export async function signDriveFiles(paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths)].filter(Boolean);
  if (unique.length === 0) return {};
  const { data, error } = await supabase.storage.from('drive').createSignedUrls(unique, 3600);
  if (error || !data) return {};
  const map: Record<string, string> = {};
  for (const r of data) if (r.path && r.signedUrl) map[r.path] = r.signedUrl;
  return map;
}

/** Remove the row AND the stored file — a Drive delete is a real delete. */
export async function deleteDriveFile(row: DriveFileRow): Promise<void> {
  const { error } = await supabase.from('drive_files').delete().eq('id', row.id);
  if (error) throw error;
  await supabase.storage.from('drive').remove([row.path]);
}
