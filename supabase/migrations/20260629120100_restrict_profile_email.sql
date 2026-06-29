-- =============================================================================
-- Privacy hardening, part 2 of 2 — RESTRICTIVE (apply LAST)
--
-- Stops regular members from reading other members' email addresses.
--
-- Postgres privileges are per-column only when you remove the table-wide SELECT
-- and re-grant the safe columns explicitly. So: revoke SELECT on the whole
-- profiles table, then grant SELECT back on every column EXCEPT `email`.
--
-- Row visibility is unchanged (the existing RLS policy still lets members see
-- each other's rows) — members just can't read the email column anymore.
-- Names, headlines, bios, etc. still work everywhere (chat, care team, admin).
--
-- Apply this only AFTER part 1 (the RPCs) is in place AND the matching frontend
-- is deployed, so nothing is still reading the email column directly.
--
-- Preserved access to email after this runs:
--   * a member's OWN email  -> read from the auth session, not this table
--   * care-invite lookup     -> public.find_member_by_email()  (part 1)
--   * admin supporters list  -> public.admin_list_supporters() (part 1)
-- =============================================================================

REVOKE SELECT ON public.profiles FROM anon, authenticated;

GRANT SELECT (
  id, full_name, handle, headline, bio, avatar_url, location,
  created_at, updated_at, onboarded, is_admin
) ON public.profiles TO authenticated;

-- anon stays with no SELECT on profiles (it never needed it; signup runs through
-- a SECURITY DEFINER trigger, not the anon role).
