-- CONVERSATIONS IN THE ASSISTANT FEED (founder 2026-10-05: being dropped
-- "midway between two chat bubbles" by a thread icon felt wrong — "you're
-- dropped at a chronological order (maybe most recent to oldest, like
-- email) of only chats that pertain to Marketplace"). A thread is a LIST of
-- conversations now, so each entry carries which conversation it belongs
-- to. New rows mint their convo_id client-side (postToAssistantFeed);
-- replies echo the trigger's. History is backfilled by the honest
-- self-organizing rule: a gap of more than 6 hours between entries in a
-- thread starts a new conversation.
alter table public.assistant_feed_posts add column if not exists convo_id uuid;

with breaks as (
  select id, profile_id, thread, created_at,
    case when lag(created_at) over w is null
           or created_at - lag(created_at) over w > interval '6 hours'
      then 1 else 0 end as brk
  from public.assistant_feed_posts
  window w as (partition by profile_id, thread order by created_at)
), grp as (
  select id, profile_id, thread,
    sum(brk) over (partition by profile_id, thread order by created_at
                   rows unbounded preceding) as g
  from breaks
), ids as (
  select profile_id, thread, g, gen_random_uuid() as cid
  from grp group by profile_id, thread, g
)
update public.assistant_feed_posts p
   set convo_id = ids.cid
  from grp join ids on ids.profile_id = grp.profile_id
                   and ids.thread = grp.thread and ids.g = grp.g
 where grp.id = p.id and p.convo_id is null;

create index if not exists assistant_feed_posts_convo_idx
  on public.assistant_feed_posts (profile_id, thread, convo_id, created_at);
