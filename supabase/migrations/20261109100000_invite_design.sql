-- THE INVITATION STUDIO (founder 2026-11-08: "Preview and edit should also be
-- possible. The edit goes to a template to build out an invite… parity to
-- paperless post"). The design is DATA on the event's door-post
-- (posts.details.invite — template, words, font, colours, envelope, liner);
-- the guest page needs it, so both guest RPCs carry it out alongside the
-- cover photo. Return types grew → DROP/recreate; grants re-applied.

drop function if exists public.guest_event(text);
create function public.guest_event(p_token text)
returns table(guest_name text, guest_status text, title text, description text, location text,
  start_date date, end_date date, all_day boolean, start_min smallint, end_min smallint,
  recurrence jsonb, host_name text, post_id uuid, photo_url text, invite jsonb)
language sql stable security definer set search_path = public
as $f$
  select g.name, g.status, e.title, e.description, e.location,
         e.start_date, e.end_date, e.all_day, e.start_min, e.end_min, e.recurrence,
         coalesce(sp.name, pr.full_name, 'A member'),
         p.id,
         coalesce(
           (select m->>'url'
            from jsonb_array_elements(
              case when jsonb_typeof(p.details->'media') = 'array'
                   then p.details->'media' else '[]'::jsonb end) m
            where m->>'type' = 'photo' limit 1),
           p.image_url),
         case when jsonb_typeof(p.details->'invite') = 'object' then p.details->'invite' end
  from public.event_guests g
  join public.events e on e.id = g.event_id
  left join public.profiles pr on pr.id = e.owner_profile_id
  left join public.spaces sp on sp.id = e.owner_space_id
  left join lateral (
    select po.id, po.details, po.image_url
    from public.posts po where po.linked_event_id = e.id limit 1
  ) p on true
  where g.token = p_token;
$f$;
revoke all on function public.guest_event(text) from public;
grant execute on function public.guest_event(text) to anon, authenticated;

drop function if exists public.open_event(text);
create function public.open_event(p_link text)
returns table(title text, description text, location text, start_date date, end_date date,
  all_day boolean, start_min smallint, end_min smallint, recurrence jsonb, host_name text,
  post_id uuid, photo_url text, invite jsonb)
language sql stable security definer set search_path = public
as $f$
  select e.title, e.description, e.location,
         e.start_date, e.end_date, e.all_day, e.start_min, e.end_min, e.recurrence,
         coalesce(sp.name, pr.full_name, 'A member'),
         p.id,
         coalesce(
           (select m->>'url'
            from jsonb_array_elements(
              case when jsonb_typeof(p.details->'media') = 'array'
                   then p.details->'media' else '[]'::jsonb end) m
            where m->>'type' = 'photo' limit 1),
           p.image_url),
         case when jsonb_typeof(p.details->'invite') = 'object' then p.details->'invite' end
  from public.events e
  left join public.profiles pr on pr.id = e.owner_profile_id
  left join public.spaces sp on sp.id = e.owner_space_id
  left join lateral (
    select po.id, po.details, po.image_url
    from public.posts po where po.linked_event_id = e.id limit 1
  ) p on true
  where e.guest_link_token = p_link;
$f$;
revoke all on function public.open_event(text) from public;
grant execute on function public.open_event(text) to anon, authenticated;
