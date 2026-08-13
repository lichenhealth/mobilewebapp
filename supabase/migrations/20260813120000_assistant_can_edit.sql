-- LET CLAUDE EDIT MY PAGE DIRECTLY (founder 2026-08-11, spec in
-- docs/ASSISTANT_ACTIONS.md).
--
-- Until now the assistant could only talk: Snapshot hands over a proposal to
-- confirm, the Home summary button writes into a text box. This column is the
-- consent that lets it actually write — and only ever to the caller's own
-- public-page fields (tagline, home summary, story, contact, categories),
-- announced in the reply every time.
--
-- DEFAULT FALSE, deliberately the opposite of findable/assistant_readable.
-- Those describe what OTHERS may see; this hands over a hand that writes, and
-- a hand that writes is opted into, never inherited. With it off the assistant
-- proposes in prose and the member applies by hand — exactly today's behavior,
-- so this migration changes nothing for anyone until they say so.
--
-- The switch is read SERVER-side by the assistant-feed edge function (service
-- role, from the trigger's profile_id — the model never supplies a target).
-- The grant below is only so the client can render the checkbox.

alter table public.profiles
  add column if not exists assistant_can_edit boolean not null default false;

comment on column public.profiles.assistant_can_edit is
  'Member consent for the assistant to write their own public-page fields (page/contact/profile_categories) via assistant-feed tool use. Default false; never extends to private data, other members, or spaces.';

grant select (assistant_can_edit) on public.profiles to authenticated;
