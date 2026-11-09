-- A FOURTH LINK PERMISSION — CIRCLES (founder 2026-11-09: "and also the
-- customizable audiences features that we have like, a community"): the
-- shareable link lets in signed-in members of the communities / groups /
-- organizations / places the host picks (events.link_space_ids).
alter table public.events add column if not exists link_space_ids uuid[];
alter table public.events drop constraint if exists events_link_access_check;
alter table public.events add constraint events_link_access_check
  check (link_access is null or link_access in ('anyone', 'invited', 'members', 'circles'));

create or replace function public.set_event_link_access(p_event uuid, p_access text, p_spaces uuid[] default null)
returns void language plpgsql security definer set search_path = public
as $func$
begin
  if not public.is_event_host(p_event, auth.uid()) then raise exception 'Only the host can change who the link lets in.'; end if;
  if p_access is not null and p_access not in ('anyone', 'invited', 'members', 'circles') then raise exception 'Unknown link setting.'; end if;
  if p_access = 'circles' and coalesce(array_length(p_spaces, 1), 0) = 0 then raise exception 'Pick at least one circle.'; end if;
  -- Only circles the host belongs to.
  if p_access = 'circles' and exists (select 1 from unnest(p_spaces) s where not public.is_space_member(s, auth.uid())) then
    raise exception 'You can only open the link to circles you''re part of.';
  end if;
  update public.events set link_access = p_access,
    link_space_ids = case when p_access = 'circles' then p_spaces else null end
   where id = p_event;
end $func$;
drop function if exists public.set_event_link_access(uuid, text);
revoke all on function public.set_event_link_access(uuid, text, uuid[]) from public, anon;
grant execute on function public.set_event_link_access(uuid, text, uuid[]) to authenticated;

create or replace function public.join_event_by_link(p_link text)
returns uuid language plpgsql security definer set search_path = public
as $func$
declare v_ev public.events%rowtype; v_post uuid; v_tier text;
begin
  if auth.uid() is null then raise exception 'Sign in to come as yourself.'; end if;
  select * into v_ev from public.events where guest_link_token = p_link;
  if v_ev.id is null then raise exception 'This event link isn''t valid anymore.'; end if;
  v_tier := public._event_link_tier(v_ev.id);
  if v_tier = 'circles' then
    if not exists (select 1 from unnest(coalesce(v_ev.link_space_ids, '{}')) s where public.is_space_member(s, auth.uid())) then
      raise exception 'This link is for members of the host''s chosen circles — ask the host to invite you.';
    end if;
  elsif v_tier not in ('anyone', 'members') then
    raise exception 'This link is for the people the host invited — ask them to add you.';
  end if;
  insert into public.event_attendees (event_id, profile_id, status, invited_by)
  values (v_ev.id, auth.uid(), 'invited', v_ev.creator_id)
  on conflict (event_id, profile_id) do nothing;
  select po.id into v_post from public.posts po where po.linked_event_id = v_ev.id limit 1;
  return v_post;
end $func$;

-- Off Lichen, a circles link answers like a members link: sign in to come.
do $mig$
declare v text;
begin
  v := pg_get_functiondef('public.request_event_spot(text,text,text,text)'::regprocedure);
  v := replace(v, 'if v_tier = ''members'' then', 'if v_tier in (''members'', ''circles'') then');
  execute v;
end $mig$;
