-- =============================================================================
-- Profile pictures — public `avatars` storage bucket.
--
-- NOT auto-applied. Run in the Supabase SQL editor, then refresh the init.sql
-- baseline with pg_dump. Idempotent.
--
-- Avatars are display identity, meant to be seen by every member wherever a
-- person appears (unlike chat-media / care-media, which stay private) — so the
-- bucket is PUBLIC for reads. Writes are folder-scoped: members may only
-- upload/replace files under their own uid folder. profiles.avatar_url (column
-- exists since the original schema; SELECT already granted) stores the public
-- URL. Uploads use a timestamped filename so browser caches never show a stale
-- picture.
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "avatars: own insert" on storage.objects;
drop policy if exists "avatars: own update" on storage.objects;
drop policy if exists "avatars: own delete" on storage.objects;

create policy "avatars: own insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: own update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: own delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
