-- Signed-in members couldn't read what signed-out visitors could.
--
-- 20260909120000 granted anon SELECT on profiles.contact and public_page for
-- the public-pages layer, but never added them to the AUTHENTICATED
-- column-scoped grant. It went unnoticed because the web template only ever
-- rendered for signed-out visitors — who use the anon role.
--
-- Merging the profile and the web page into one structure (founder
-- 2026-08-05) makes a signed-in member read the same columns, and the
-- select was failing silently, dropping every profile to the fallback shell.
--
-- Nothing new is exposed: anon has read these since 20260909120000, and both
-- are public-by-definition — contact is the details a member chose to publish,
-- public_page is the flag saying whether they published them.

grant select (contact, public_page) on public.profiles to authenticated;
