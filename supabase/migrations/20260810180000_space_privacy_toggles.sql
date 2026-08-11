-- Privacy toggles for spaces, mirroring profiles' own (founder 2026-08-10
-- profile-features spreadsheet: every space kind gets a Privacy section).
-- Purely additive; the existing "Admins update their space" RLS policy
-- already covers these new columns (full-row UPDATE for space admins).

alter table spaces
  add column findable boolean not null default true,
  add column assistant_readable boolean not null default true,
  add column content_ai_default boolean not null default true,
  add column content_download_default boolean not null default true;

comment on column spaces.findable is 'Appears in directory/search — mirrors profiles.findable.';
comment on column spaces.assistant_readable is 'Other members'' assistants may read this space''s content when briefing — mirrors profiles.assistant_readable. Distinct from assistant_enabled (whether THIS space''s own assistant is on).';
comment on column spaces.content_ai_default is 'Default AI-readable flag for this space''s new posts — mirrors profiles.content_ai_default.';
comment on column spaces.content_download_default is 'Default downloadable-media flag for this space''s new posts — mirrors profiles.content_download_default.';
