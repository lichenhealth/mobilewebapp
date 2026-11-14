-- CALENDAR-EVENT DRAFTS (founder 2026-11-14: "when i click to another tab and
-- go back to the cal invite compose, the changes seem to be lost… i want there
-- to be draft cal events somewhere if you leave, navigate out or click out of
-- a cal compose"). A calendar draft is an ordinary events row with
-- is_draft=true and NO draft_id (Compose's event drafts keep draft_id →
-- post_drafts). The things that would reach other people — invitees, outside
-- emails, the send-to-calendars and invite-link choices — wait here, unsent,
-- until the Save that publishes it. No attendees are seated on a draft.
alter table public.events add column if not exists draft_state jsonb;
