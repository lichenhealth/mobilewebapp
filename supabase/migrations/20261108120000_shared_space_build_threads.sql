-- A space's build thread is SHARED by its stewards (founder 2026-11-08:
-- "keep all conversations in there for all admins to see" — past and future).
-- Rows stay each author's own (profile_id = who wrote / whose turn Claude
-- answered); this adds a READ arm so every current admin of the space sees
-- every steward's exchanges in `space:<uuid>`. Only the build stream — the
-- `space:<uuid>:currentcy` treasury room and personal threads stay owner-only.

create or replace function public.steward_of_build_thread(p_thread text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $func$
begin
  if p_thread is null or p_thread !~* '^space:[0-9a-f-]{36}$' then
    return false;
  end if;
  return public.is_space_admin(substring(p_thread from 7)::uuid, auth.uid());
exception when others then
  return false;
end;
$func$;

revoke all on function public.steward_of_build_thread(text) from public, anon;
grant execute on function public.steward_of_build_thread(text) to authenticated;

drop policy if exists "space build thread: stewards read" on public.assistant_feed_posts;
create policy "space build thread: stewards read" on public.assistant_feed_posts
  for select to authenticated
  using (thread like 'space:%' and public.steward_of_build_thread(thread));
