-- =============================================================================
-- Maps phase 1: structured coordinates.
--
-- NOT auto-applied. Run in the Supabase SQL editor. Idempotent.
--
-- Locations stay human text (events.location / posts.details.location /
-- spaces.location) — these columns add the machine half, filled when a
-- composer's LocationField autocomplete suggestion is PICKED (free-typed
-- text and video links carry no coordinates on purpose). Posts need no
-- columns: their coords ride in details.geo = {lat, lng}.
--
-- No PostGIS yet — at beta scale the map filters client-side. PostGIS (and
-- real "near me" queries) arrives with a later phase, alongside the
-- location_shares privacy table (calendar_shares pattern; see CLAUDE.md
-- thread #9 for the decided model).
-- =============================================================================

alter table public.events add column if not exists lat double precision;
alter table public.events add column if not exists lng double precision;

-- Groundwork for space/place pins — the admin "set location" UI is the next
-- phase; columns land now so it needs no second migration.
alter table public.spaces add column if not exists lat double precision;
alter table public.spaces add column if not exists lng double precision;
