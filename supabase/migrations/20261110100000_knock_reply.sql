-- REPLY WITHOUT LETTING THEM IN (founder 2026-11-10: someone knocked after a
-- Facebook post, interested in therapy — "reply to them with a custom
-- message and some time to chat with me via my booking link, but not accept
-- them into lichen… that interim step feels like it might be necessary as
-- things begin to pick up with word of mouth"). A reply is a conversation at
-- the door: the knock stays 'new' (still waiting), the row remembers that it
-- was answered. Writes ride the knock-reply edge function (service role) only.
alter table public.join_requests
  add column if not exists replied_at timestamptz,
  add column if not exists reply_count int not null default 0,
  add column if not exists last_reply text,
  add column if not exists replied_by uuid references public.profiles(id) on delete set null;
