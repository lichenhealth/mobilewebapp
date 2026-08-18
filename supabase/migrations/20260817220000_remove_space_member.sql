-- REMOVE A MEMBER (founder 2026-08-17: "for each member, you should be able
-- to remove them or make them an admin within the settings section"). Making
-- someone an admin already existed (set_member_role); removal didn't — the
-- only DELETE policy on space_members is "leave" (your own row).
--
-- Who may remove whom: an admin holding the members duty can remove a plain
-- member; only the super admin can remove an admin; nobody removes the super
-- admin (they hand the space on or delete it). The person is told, once and
-- plainly — a room that quietly vanishes from your inbox is a bug, not a
-- kindness. The chat roster follows through the existing sync trigger.

create or replace function public.remove_space_member(p_space uuid, p_profile uuid)
returns void language plpgsql security definer set search_path to 'public' as $func$
declare
  v_uid uuid := auth.uid();
  v_me record; v_them record; v_name text;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_profile = v_uid then raise exception 'To leave, use Leave — this door is for removing someone else.'; end if;
  select role, duties into v_me from public.space_members where space_id = p_space and profile_id = v_uid;
  select role into v_them from public.space_members where space_id = p_space and profile_id = p_profile;
  if v_them.role is null then return; end if;   -- already gone
  if v_them.role = 'super_admin' then raise exception 'The super admin can''t be removed.'; end if;
  if v_me.role = 'super_admin' then
    null;
  elsif v_me.role = 'admin' and (v_me.duties is null or 'members' = any (v_me.duties)) then
    if v_them.role = 'admin' then raise exception 'Only the super admin can remove another admin.'; end if;
  else
    raise exception 'Only an admin who tends members can do this.';
  end if;

  delete from public.space_members where space_id = p_space and profile_id = p_profile;
  select name into v_name from public.spaces where id = p_space;
  perform public.notify(
    p_profile, 'home', p_space, 'space_member_removed',
    'You''re no longer part of ' || coalesce(v_name, 'a space'),
    'A steward removed you. Your own posts and everything else of yours are untouched.',
    null, v_uid);
end;
$func$;
revoke all on function public.remove_space_member(uuid, uuid) from public;
grant execute on function public.remove_space_member(uuid, uuid) to authenticated;
