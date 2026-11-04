-- THE LINK INHERITS THE AUDIENCE — tiered like Drive (founder 2026-11-04:
-- "Let's have link access be tiered like on google drive… so that would
-- mean generating a link would auto apply the restrictions of audience to
-- the link?"): one shareable /e/ link per event, and its behavior DERIVES
-- from the linked post's visibility — never a second setting to drift.
--   'public'  (Anyone — the open web)   → the link ADMITS: an opener lands
--             as an ordinary guest (status 'invited') and RSVPs straight
--             away; no approval bell (the RSVP list is the record); a
--             modest 200-guest ceiling — the rotate stays the kill switch.
--   'lichen'  (Everyone on Lichen)      → members RSVP inside the app (the
--             /e/ page's open-this-event-inside door); an off-Lichen opener
--             asks and waits — the standing approval gate.
--   subsets   (invite/mycelium/space)   → Restricted: on-list contacts are
--             handed their own standing token, anyone else asks and waits.
-- On-list recognition always runs FIRST, every tier.
create or replace function public.request_event_spot(
  p_link text, p_name text, p_email text default null, p_phone text default null
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_ev public.events%rowtype;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  v_name text := trim(coalesce(p_name, ''));
  v_tok text; v_status text; v_post uuid; v_vis text;
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

  -- Already on the invite list? Their own invitation answers, every tier.
  select token, status into v_tok, v_status from public.event_guests
   where event_id = v_ev.id
     and ((v_email is not null and lower(coalesce(email, '')) = v_email)
       or (v_phone is not null and regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_phone))
   limit 1;
  if v_tok is not null then
    return jsonb_build_object('on_list', v_status <> 'requested', 'token', v_tok);
  end if;

  select po.id, po.visibility into v_post, v_vis
    from public.posts po where po.linked_event_id = v_ev.id limit 1;

  -- ANYONE tier: the open-web link admits directly.
  if v_vis = 'public' then
    if (select count(*) from public.event_guests where event_id = v_ev.id) >= 200 then
      raise exception 'This event''s guest list is full — reach out to the host directly.';
    end if;
    insert into public.event_guests (event_id, invited_by, name, email, phone, status)
    values (v_ev.id, v_ev.creator_id, v_name, v_email, v_phone, 'invited')
    returning token into v_tok;
    return jsonb_build_object('on_list', true, 'token', v_tok);
  end if;

  -- Everyone-on-Lichen and subset tiers: ask and wait on the host.
  if (select count(*) from public.event_guests
       where event_id = v_ev.id and status = 'requested') >= 25 then
    raise exception 'The host''s request list is full right now — reach out to them directly.';
  end if;

  insert into public.event_guests (event_id, invited_by, name, email, phone, status)
  values (v_ev.id, v_ev.creator_id, v_name, v_email, v_phone, 'requested')
  returning token into v_tok;

  perform public.notify(v_ev.creator_id, 'calendar', null, 'event_request',
    v_name, 'asked to come: ' || coalesce(v_ev.title, 'your event'),
    case when v_post is not null then '/events/' || v_post else '/calendar' end, null);

  return jsonb_build_object('on_list', false, 'token', v_tok);
end $fn$;
revoke all on function public.request_event_spot(text, text, text, text) from public;
grant execute on function public.request_event_spot(text, text, text, text) to anon, authenticated;
