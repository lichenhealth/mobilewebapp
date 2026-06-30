-- =============================================================================
-- Storage bucket for post media (photos / videos / audio).
-- NOT yet applied — run in the Supabase SQL editor.
--
-- Files are stored under a per-user folder: `<auth.uid>/<file>`, so the upload
-- policy can confine each member to their own folder. Bucket is public-read so
-- the media renders via a plain public URL in the feed.
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('post-media', 'post-media', true)
on conflict (id) do nothing;

-- Members upload only into their own folder.
create policy "post-media: member upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- Anyone can read (bucket is public; media renders via public URL).
create policy "post-media: public read"
  on storage.objects for select to public
  using (bucket_id = 'post-media');

-- Members can delete their own files.
create policy "post-media: owner delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);
