-- PRONOUNS, OPTIONAL (founder 2026-08-16)
--
-- The assistant writes ABOUT members constantly now — the briefing before you
-- meet someone, help-room replies, feed copy — and until today it had two
-- options for a pronoun: guess from a name, or write around it. Guessing
-- misgenders people (it already did, in testing: "in front of her" was a
-- lucky guess, not a correct one). Writing around it gets stilted fast.
--
-- Free text, not an enum: presets exclude people, and there is no cost to
-- leaving it open. NULL is the default and means they/them — so nothing
-- changes for anyone who skips it, and nobody is asked to declare.
--
-- Granted in the PUBLIC column set alongside identity_tags, because being
-- seen is the entire point of the field. Not in the hidden set with email
-- and phone.

alter table public.profiles
  add column if not exists pronouns text;

comment on column public.profiles.pronouns is
  'Optional, free text, public. NULL means they/them — never guess from a name.';

-- Keep it a short label, not a biography.
alter table public.profiles drop constraint if exists profiles_pronouns_len;
alter table public.profiles
  add constraint profiles_pronouns_len check (pronouns is null or char_length(pronouns) <= 40);

grant select (pronouns) on public.profiles to authenticated, anon;
