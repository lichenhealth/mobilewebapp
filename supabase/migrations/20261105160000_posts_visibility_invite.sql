-- INVITE-ONLY EVENTS, part 2 (founder 2026-11-04). Part 1 (20261105150000)
-- gave event attendees a read arm on posts; this makes the no-network-
-- audience state REPRESENTABLE. The bridge trigger treated all-booleans-
-- false as "old frontend" and re-derived the booleans FROM visibility —
-- visibility='mycelium' would have flipped to_mycelium back ON, and
-- visibility='space' with no space trips posts_space_required. A fourth
-- legacy value names the state: 'invite'. Nothing grants access through it
-- (the authenticated policy reads the booleans + the attendee arm; the anon
-- policy reads only ='public'), and no client filters on visibility — it's
-- the legacy mirror, kept coherent.

alter table public.posts drop constraint posts_visibility_check;
alter table public.posts add constraint posts_visibility_check
  check (visibility = any (array['public'::text, 'mycelium'::text, 'space'::text, 'invite'::text]));

create or replace function public.posts_audience_sync()
returns trigger
language plpgsql
as $function$
begin
  -- INVITE-ONLY EVENT (2026-11-04): a linked-event post deliberately carries
  -- NO network audience — the seats on the event are the audience (the posts
  -- RLS attendee arm). Named so neither bridge branch widens it. A row with
  -- invited CIRCLES (audience_space_ids) keeps the ordinary 'space' path —
  -- the circles see it, the public doesn't.
  if new.visibility = 'invite'
     or (new.linked_event_id is not null
         and coalesce(new.details->>'inviteOnly', '') = 'true'
         and new.is_public = false and new.to_mycelium = false
         and new.audience_space_ids = '{}'::uuid[]) then
    new.visibility := 'invite';
    new.is_public := false;
    new.to_mycelium := false;
  elsif new.is_public = false and new.to_mycelium = false and new.audience_space_ids = '{}'::uuid[] then
    -- Old frontend: only `visibility` set → derive the new columns.
    new.is_public := (new.visibility = 'public');
    new.to_mycelium := (new.visibility = 'mycelium');
    if new.visibility = 'space' and new.space_id is not null then
      new.audience_space_ids := array[new.space_id];
    end if;
  else
    -- New frontend → keep legacy columns coherent (and their CHECKs satisfied).
    new.visibility := case when new.is_public then 'public'
                           when new.to_mycelium then 'mycelium'
                           else 'space' end;
    if new.visibility = 'space' and new.space_id is null then
      new.space_id := new.audience_space_ids[1];
    end if;
  end if;
  if new.service_areas = '{}' and new.service_area is not null then
    new.service_areas := array[new.service_area];
  elsif new.service_area is null and cardinality(new.service_areas) > 0 then
    new.service_area := new.service_areas[1];
  end if;
  return new;
end; $function$;
