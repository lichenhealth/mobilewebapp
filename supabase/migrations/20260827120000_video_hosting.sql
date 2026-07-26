-- SELF-RUN VIDEO HOSTING (founder, 2026-07-26): members record/upload video
-- into Lichen itself — no external platform consuming their data. Originals
-- land in the 'videos' bucket; a self-run ffmpeg worker (worker/ in the repo,
-- service-role) transcodes to adaptive HLS + poster and marks the job ready.
-- The player falls back to the original until then.

-- ── 1. The job queue ─────────────────────────────────────────────────────────
create table if not exists public.video_jobs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  src_path text not null,              -- original upload, videos bucket
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'ready', 'failed')),
  error text,
  hls_path text,                       -- master.m3u8, videos bucket
  poster_path text,
  duration_secs integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists video_jobs_status_idx on public.video_jobs (status, created_at);
alter table public.video_jobs enable row level security;

-- Members create jobs for their own uploads.
create policy "vjobs: insert own" on public.video_jobs
  for insert to authenticated with check (profile_id = auth.uid());
-- Playback metadata is readable by any member (paths only — the media itself
-- inherits the post-media posture: public bucket, unguessable paths).
create policy "vjobs: read for playback" on public.video_jobs
  for select to authenticated using (true);
-- No UPDATE/DELETE policies: only the worker (service role) advances jobs.

-- ── 2. The videos bucket (public, like post-media; unguessable paths) ────────
insert into storage.buckets (id, name, public)
values ('videos', 'videos', true)
on conflict (id) do nothing;

-- Members upload originals into their own folder.
create policy "videos: upload own folder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
