-- CONSENT TRAVELS WITH YOUR WORDS (founder 2026-07-28): when a member asks
-- their assistant to brief them on chat, it reads recent messages from their
-- rooms — including messages other people wrote. Those people never chose
-- that. So each member decides whether THEIR words may be read by anyone
-- else's assistant.
--
-- Default TRUE, matching the platform's uniform opt-out stance; switching it
-- off withholds your message CONTENT from other members' briefings while
-- still letting the app say you're waiting on a reply (that fact is theirs,
-- not yours). Nothing changes about who can read the chat itself.

alter table public.profiles
  add column if not exists assistant_readable boolean not null default true;

-- Readable by members so the client can honor it when assembling a briefing.
grant select (assistant_readable) on public.profiles to authenticated;
