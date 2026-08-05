-- A profile or a space can opt OUT of the assistant entirely (founder
-- 2026-08-05: "the grayed out AI with the line thru for all profiles that
-- don't want to use it").
--
-- This is a DIFFERENT consent from profiles.assistant_readable, which governs
-- whether OTHER members' assistants may read your message content. This one
-- says: this profile/space doesn't work with the assistant at all — its door
-- shows slashed to everyone who visits.
--
-- Default TRUE, matching the platform's uniform opt-out stance. The door
-- still opens when tapped; a member always reaches their own assistant.

alter table public.profiles
  add column if not exists assistant_enabled boolean not null default true;
alter table public.spaces
  add column if not exists assistant_enabled boolean not null default true;

-- profiles' SELECT is column-scoped (the email-privacy pattern), so the new
-- column needs its own grant; spaces are granted wholesale already.
grant select (assistant_enabled) on public.profiles to authenticated, anon;
grant update (assistant_enabled) on public.profiles to authenticated;
