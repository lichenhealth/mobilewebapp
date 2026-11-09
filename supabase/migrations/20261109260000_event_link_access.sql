-- THE SHAREABLE LINK HAS ITS OWN PERMISSION (founder 2026-11-09: "the link
-- should have a permissions field in case people change their mind: anyone
-- with the link, invited individuals with the link, lichen members with the
-- link"). events.link_access: null = follow the event's visibility (the
-- 2026-11-04 Drive-ladder default). 'anyone' admits whoever opens it;
-- 'invited' recognizes the invite list and everyone else asks the host;
-- 'members' lets any signed-in Lichen member in (join_event_by_link), and an
-- off-Lichen opener is told it's for members.
alter table public.events add column if not exists link_access text;
alter table public.events drop constraint if exists events_link_access_check;
alter table public.events add constraint events_link_access_check
  check (link_access is null or link_access in ('anyone', 'invited', 'members'));

create or replace function public._event_link_tier(p_event uuid)
returns text language sql stable security definer set search_path = public
as $f$
  select coalesce(e.link_access,
    case (select po.visibility from public.posts po where po.linked_event_id = e.id limit 1)
      when 'public' then 'anyone' when 'lichen' then 'members' else 'invited' end)
  from public.events e where e.id = p_event;
$f$;
revoke all on function public._event_link_tier(uuid) from public, anon, authenticated;

create or replace function public.request_event_spot(p_link text, p_name text, p_email text default null, p_phone text default null)
returns jsonb language plpgsql security definer set search_path = public
as $func$
declare
  v_ev public.events%rowtype;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  v_name text := trim(coalesce(p_name, ''));
  v_tok text; v_status text; v_post uuid; v_tier text;
begin
  select * into v_ev from public.events where guest_link_token = p_link;
  if v_ev.id is null then raise exception 'This event link isn''t valid anymore.'; end if;
  if v_name = '' then raise exception 'Please tell the host your name.'; end if;
  if v_email is null and v_phone is null then
    raise exception 'An email or a phone number is how the host reaches you.';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then
    raise exception 'That email doesn''t look complete.';
  end if;
  if v_phone is not null and (length(v_phone) < 7 or length(v_phone) > 16) then
    raise exception 'That phone number doesn''t look complete.';
  end if;

  -- Already on the invite list? Their own invitation answers, every tier.
  select token, status into v_tok, v_status from public.event_guests
   where event_id = v_ev.id
     and ((v_email is not null and lower(coalesce(email, '')) = v_email)
       or (v_phone is not null and regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_phone))
   limit 1;
  if v_tok is not null then
    return jsonb_build_object('on_list', v_status <> 'requested', 'token', v_tok);
  end if;

  select po.id into v_post from public.posts po where po.linked_event_id = v_ev.id limit 1;
  v_tier := public._event_link_tier(v_ev.id);

  if v_tier = 'members' then
    raise exception 'This link is for Lichen members — sign in to come, or ask the host to invite you.';
  end if;

  if v_tier = 'anyone' then
    if (select count(*) from public.event_guests where event_id = v_ev.id) >= 200 then
      raise exception 'This event''s guest list is full — reach out to the host directly.';
    end if;
    insert into public.event_guests (event_id, invited_by, name, email, phone, status)
    values (v_ev.id, v_ev.creator_id, v_name, v_email, v_phone, 'invited')
    returning token into v_tok;
    return jsonb_build_object('on_list', true, 'token', v_tok);
  end if;

  -- 'invited': ask and wait on the host.
  if (select count(*) from public.event_guests where event_id = v_ev.id and status = 'requested') >= 25 then
    raise exception 'The host''s request list is full right now — reach out to them directly.';
  end if;
  insert into public.event_guests (event_id, invited_by, name, email, phone, status)
  values (v_ev.id, v_ev.creator_id, v_name, v_email, v_phone, 'requested')
  returning token into v_tok;
  perform public.notify(v_ev.creator_id, 'calendar', null, 'event_request',
    v_name, 'asked to come: ' || coalesce(v_ev.title, 'your event'),
    case when v_post is not null then '/events/' || v_post else '/calendar' end, null);
  return jsonb_build_object('on_list', false, 'token', v_tok);
end $func$;

-- A signed-in member with a members/anyone link joins as themselves.
create or replace function public.join_event_by_link(p_link text)
returns uuid language plpgsql security definer set search_path = public
as $func$
declare v_ev public.events%rowtype; v_post uuid; v_tier text;
begin
  if auth.uid() is null then raise exception 'Sign in to come as yourself.'; end if;
  select * into v_ev from public.events where guest_link_token = p_link;
  if v_ev.id is null then raise exception 'This event link isn''t valid anymore.'; end if;
  v_tier := public._event_link_tier(v_ev.id);
  if v_tier not in ('anyone', 'members') then
    raise exception 'This link is for the people the host invited — ask them to add you.';
  end if;
  insert into public.event_attendees (event_id, profile_id, status, invited_by)
  values (v_ev.id, auth.uid(), 'invited', v_ev.creator_id)
  on conflict (event_id, profile_id) do nothing;
  select po.id into v_post from public.posts po where po.linked_event_id = v_ev.id limit 1;
  return v_post;
end $func$;
revoke all on function public.join_event_by_link(text) from public, anon;
grant execute on function public.join_event_by_link(text) to authenticated;

-- The host sets it (creator or co-host).
create or replace function public.set_event_link_access(p_event uuid, p_access text)
returns void language plpgsql security definer set search_path = public
as $func$
begin
  if not public.is_event_host(p_event, auth.uid()) then raise exception 'Only the host can change who the link lets in.'; end if;
  if p_access is not null and p_access not in ('anyone', 'invited', 'members') then raise exception 'Unknown link setting.'; end if;
  update public.events set link_access = p_access where id = p_event;
end $func$;
revoke all on function public.set_event_link_access(uuid, text) from public, anon;
grant execute on function public.set_event_link_access(uuid, text) to authenticated;

-- open_event says which tier the link is (the page shapes its ask from it).
drop function if exists public.open_event(text);
create function public.open_event(p_link text)
returns table(title text, description text, location text, start_date date, end_date date, all_day boolean, start_min smallint, end_min smallint, recurrence jsonb, host_name text, post_id uuid, photo_url text, invite jsonb, event_tz text, link_tier text)
language sql stable security definer set search_path = public
as $func$
  select e.title, e.description, e.location,
         e.start_date, e.end_date, e.all_day, e.start_min, e.end_min, e.recurrence,
         public._event_host_line(e.id),
         p.id,
         coalesce(
           (select m->>'url'
            from jsonb_array_elements(
              case when jsonb_typeof(p.details->'media') = 'array'
                   then p.details->'media' else '[]'::jsonb end) m
            where m->>'type' = 'photo' limit 1),
           p.image_url),
         case when jsonb_typeof(p.details->'invite') = 'object' then p.details->'invite' end,
         coalesce(e.timezone, (select timezone from public.profiles where id = e.creator_id)),
         public._event_link_tier(e.id)
  from public.events e
  left join lateral (
    select po.id, po.details, po.image_url
    from public.posts po where po.linked_event_id = e.id limit 1
  ) p on true
  where e.guest_link_token = p_link;
$func$;
revoke all on function public.open_event(text) from public;
grant execute on function public.open_event(text) to anon, authenticated;
