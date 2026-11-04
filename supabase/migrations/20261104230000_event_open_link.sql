-- THE OPEN EVENT URL + THE APPROVAL GATE (founder 2026-11-04: "An Event
-- URL is really handy, so let's build it and try to be smart about spam.
-- How about with the URL; if you're not also on an invite list, the
-- request to attend prompts an approval from the host?" — greenlighting
-- the flyer case the recruiting-door ship deliberately held back).
--
-- The spam posture, in order: the link is unguessable and the host can
-- ROTATE it (the kill switch); a typed contact that matches someone
-- already on the invite list goes straight to THEIR token (no second
-- row, no approval needed); an unknown person becomes a 'requested' row
-- the host approves — they can't RSVP themselves in (guest_rsvp refuses
-- requested rows); pending requests cap at 25 per event.

-- 1) The shareable address lives on the event, host-minted on demand.
alter table public.events add column if not exists guest_link_token text unique;

create or replace function public.mint_event_link(p_event uuid, p_rotate boolean default false)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_tok text; v_creator uuid;
begin
  select creator_id, guest_link_token into v_creator, v_tok
    from public.events where id = p_event;
  if v_creator is null or v_creator <> auth.uid() then
    raise exception 'Only the host can share this event''s link.';
  end if;
  if v_tok is null or p_rotate then
    v_tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    update public.events set guest_link_token = v_tok where id = p_event;
  end if;
  return v_tok;
end $fn$;
revoke all on function public.mint_event_link(uuid, boolean) from public;
grant execute on function public.mint_event_link(uuid, boolean) to authenticated;

-- 2) A guest row can be WAITING on the host now.
alter table public.event_guests drop constraint event_guests_status_check;
alter table public.event_guests add constraint event_guests_status_check
  check (status in ('invited', 'going', 'tentative', 'declined', 'requested'));

-- 3) The open landing: event details by LINK token (no guest fields).
create or replace function public.open_event(p_link text)
returns table (
  title text, description text, location text,
  start_date date, end_date date, all_day boolean, start_min smallint, end_min smallint,
  recurrence jsonb, host_name text, post_id uuid, photo_url text
) language sql security definer set search_path = public stable as $fn$
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
           p.image_url)
  from public.events e
  left join public.profiles pr on pr.id = e.owner_profile_id
  left join public.spaces sp on sp.id = e.owner_space_id
  left join lateral (
    select po.id, po.details, po.image_url
    from public.posts po where po.linked_event_id = e.id limit 1
  ) p on true
  where e.guest_link_token = p_link;
$fn$;
revoke all on function public.open_event(text) from public;
grant execute on function public.open_event(text) to anon, authenticated;

-- 4) Ask to come. On-the-list contacts are RECOGNIZED and handed their
--    own standing token; everyone else waits on the host.
create or replace function public.request_event_spot(
  p_link text, p_name text, p_email text default null, p_phone text default null
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_ev public.events%rowtype;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  v_name text := trim(coalesce(p_name, ''));
  v_tok text; v_status text; v_post uuid;
begin
  select * into v_ev from public.events where guest_link_token = p_link;
  if v_ev.id is null then
    raise exception 'This event link isn''t valid anymore.';
  end if;
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

  -- Already on the invite list? Their own invitation answers.
  select token, status into v_tok, v_status from public.event_guests
   where event_id = v_ev.id
     and ((v_email is not null and lower(coalesce(email, '')) = v_email)
       or (v_phone is not null and regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_phone))
   limit 1;
  if v_tok is not null then
    return jsonb_build_object('on_list', v_status <> 'requested', 'token', v_tok);
  end if;

  -- The pending cap — a modest ceiling, the rotate is the real kill switch.
  if (select count(*) from public.event_guests
       where event_id = v_ev.id and status = 'requested') >= 25 then
    raise exception 'The host''s request list is full right now — reach out to them directly.';
  end if;

  insert into public.event_guests (event_id, invited_by, name, email, phone, status)
  values (v_ev.id, v_ev.creator_id, v_name, v_email, v_phone, 'requested')
  returning token into v_tok;

  select po.id into v_post from public.posts po where po.linked_event_id = v_ev.id limit 1;
  perform public.notify(v_ev.creator_id, 'calendar', null, 'event_request',
    v_name, 'asked to come: ' || coalesce(v_ev.title, 'your event'),
    case when v_post is not null then '/events/' || v_post else '/calendar' end, null);

  return jsonb_build_object('on_list', false, 'token', v_tok);
end $fn$;
revoke all on function public.request_event_spot(text, text, text, text) from public;
grant execute on function public.request_event_spot(text, text, text, text) to anon, authenticated;

-- 5) A requested guest can't RSVP themselves in — the host's yes comes first.
create or replace function public.guest_rsvp(p_token text, p_status text)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_status text;
begin
  if p_status not in ('going', 'tentative', 'declined') then return; end if;
  select status into v_status from public.event_guests where token = p_token;
  if v_status = 'requested' then
    raise exception 'This request is still with the host — you''ll be able to RSVP once they say yes.';
  end if;
  update public.event_guests set status = p_status where token = p_token;
end $fn$;
