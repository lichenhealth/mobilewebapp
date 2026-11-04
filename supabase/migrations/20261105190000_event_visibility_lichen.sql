-- EVENT VISIBILITY, THE LADDER (founder 2026-11-04: "Both invitation options
-- and visibility should be Open: Anyone, Anyone on Lichen, then subsets,
-- like groups… If you don't put an audience you have to choose one before
-- it goes live"). "Anyone on Lichen" is a NEW tier for posts: visible to
-- every member, dark to the open web. Representation: is_public = TRUE (the
-- authenticated read policy's is_public arm already shows it to all
-- members — no policy change) with visibility = 'lichen' (the ANON policy
-- reads only visibility='public', so the open web never sees it; the vanity
-- resolver's anon arm and open_link exposure both key on ='public' too).
-- The bridge trigger must KEEP 'lichen' — its new-frontend branch would
-- otherwise rewrite is_public=true rows to 'public'.

alter table public.posts drop constraint posts_visibility_check;
alter table public.posts add constraint posts_visibility_check
  check (visibility = any (array['public'::text, 'mycelium'::text, 'space'::text, 'invite'::text, 'lichen'::text]));

create or replace function public.posts_audience_sync()
returns trigger
language plpgsql
as $function$
begin
  -- ANYONE ON LICHEN (2026-11-04): every member (is_public arm), never the
  -- open web (anon reads only visibility='public'). Keep as sent.
  if new.visibility = 'lichen' and new.is_public then
    null;
  -- INVITE-ONLY EVENT (2026-11-04): a linked-event post deliberately carries
  -- NO network audience — the seats on the event are the audience (the posts
  -- RLS attendee arm). Named so neither bridge branch widens it. A row with
  -- invited CIRCLES (audience_space_ids) keeps the ordinary 'space' path —
  -- the circles see it, the public doesn't.
  elsif new.visibility = 'invite'
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
