-- Per-member content defaults (founder 2026-08-05): every new post starts
-- from these two switches — AI-readable and downloadable, BOTH TRUE by
-- default (the platform's uniform on-by-default doctrine; protection is a
-- choice, not a wall). Compose reads them to pre-select its per-post
-- toggles; the per-post truth lives in posts.details (aiExcluded /
-- noDownload, stored only when switched OFF).

alter table public.profiles
  add column if not exists content_ai_default boolean not null default true,
  add column if not exists content_download_default boolean not null default true;

-- profiles SELECT is column-scoped (the email-privacy pattern) — new columns
-- must be granted explicitly or even the owner can't read them. These two
-- are not sensitive: they're authoring preferences.
grant select (content_ai_default, content_download_default) on public.profiles to authenticated;
