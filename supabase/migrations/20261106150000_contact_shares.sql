-- PER-GROUP CONTACT PERMISSION (founder 2026-11-06: "it should be in
-- permissions whether you want other members of the group to know your
-- contact info - as they may not have it"). For each space a member belongs
-- to, email and phone each carry a level:
--   nobody   (default — no row means nobody)
--   stewards (the space's admins may see/export it)
--   members  (fellow members may see/export it too)
-- profiles.email/phone stay out of every column grant; the ONE door that
-- reads them for another person is space_member_contacts(), which applies
-- these levels server-side.
create table if not exists public.contact_shares (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  email_level text not null default 'nobody' check (email_level in ('nobody','stewards','members')),
  phone_level text not null default 'nobody' check (phone_level in ('nobody','stewards','members')),
  updated_at timestamptz not null default now(),
  primary key (profile_id, space_id)
);
alter table public.contact_shares enable row level security;
drop policy if exists "contact_shares owner" on public.contact_shares;
create policy "contact_shares owner" on public.contact_shares
  for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
grant select, insert, update, delete on public.contact_shares to authenticated;

-- The member list of a space as the CALLER may see it: every member's name
-- and handle (members can already see these), plus email/phone only where
-- that member's level admits the caller. Caller must be a member.
create or replace function public.space_member_contacts(p_space uuid)
returns table (profile_id uuid, full_name text, handle text, role text, email text, phone text, shared boolean)
language plpgsql security definer set search_path = public, auth
as $func$
declare
  v_uid uuid := auth.uid();
  v_steward boolean;
begin
  if v_uid is null or not public.space_alive(p_space) or not public.is_space_member(p_space, v_uid) then
    raise exception 'Only members of this group can see its member list.';
  end if;
  v_steward := public.is_space_admin(p_space, v_uid);
  return query
  select m.profile_id, p.full_name, p.handle, m.role::text,
    case when m.profile_id = v_uid
           or coalesce(cs.email_level,'nobody') = 'members'
           or (coalesce(cs.email_level,'nobody') = 'stewards' and v_steward)
         then coalesce(nullif(p.email,''), u.email::text) end,
    case when m.profile_id = v_uid
           or coalesce(cs.phone_level,'nobody') = 'members'
           or (coalesce(cs.phone_level,'nobody') = 'stewards' and v_steward)
         then nullif(p.phone,'') end,
    (coalesce(cs.email_level,'nobody') = 'members' or coalesce(cs.phone_level,'nobody') = 'members'
      or (v_steward and (coalesce(cs.email_level,'nobody') <> 'nobody' or coalesce(cs.phone_level,'nobody') <> 'nobody')))
  from public.space_members m
  join public.profiles p on p.id = m.profile_id
  left join auth.users u on u.id = m.profile_id
  left join public.contact_shares cs on cs.profile_id = m.profile_id and cs.space_id = p_space
  where m.space_id = p_space
  order by p.full_name nulls last;
end;
$func$;
revoke all on function public.space_member_contacts(uuid) from public, anon;
grant execute on function public.space_member_contacts(uuid) to authenticated;
