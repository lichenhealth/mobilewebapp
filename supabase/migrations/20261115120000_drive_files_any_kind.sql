-- Drive holds any file now (founder 2026-11-15: "build the not built yet stuff"
-- — saving an email attachment, a PDF invoice, to Drive). 'file' = anything
-- that isn't a photo, video or audio. Additive: widens the CHECK only.
alter table public.drive_files drop constraint if exists drive_files_kind_check;
alter table public.drive_files add constraint drive_files_kind_check
  check (kind = any (array['photo','video','audio','file']));
