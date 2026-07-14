-- Member suggestions (founder, 2026-07-14): a third pending-row kind —
-- any MEMBER of a space may suggest someone to its admins. Admins endorse
-- a suggestion into a real invite; the person then accepts. Consent at
-- every step; the suggested person hears nothing until an admin endorses.

-- ── 1. INSERT policy grows a third arm: member suggestions ───────────────────
drop policy if exists "smr: request or invite" on public.space_membership_requests;
create policy "smr: request, invite, or suggest" on public.space_membership_requests
  for insert to authenticated
  with check (
    -- self-request
    (profile_id = auth.uid() and initiated_by = auth.uid())
    -- admin invite OR member suggestion: any member of the space may
    -- initiate a row for someone else (the trigger + accept RPC below
    -- treat admin- and member-initiated rows differently)
    or (
      initiated_by = auth.uid()
      and profile_id <> auth.uid()
      and exists (
        select 1 from public.space_members m
        where m.space_id = space_membership_requests.space_id
          and m.profile_id = auth.uid()
      )
    )
  );

-- ── 2. Notifications branch on WHO initiated ─────────────────────────────────
create or replace function public.handle_new_space_request()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_name text; v_who text; v_target text; v_admin uuid; v_role public.space_member_role;
begin
  select name into v_name from public.spaces where id = new.space_id;
  if new.initiated_by = new.profile_id then
    -- join request → tell every admin
    select full_name into v_who from public.profiles where id = new.profile_id;
    for v_admin in
      select m.profile_id from public.space_members m
      where m.space_id = new.space_id and m.role in ('admin', 'super_admin')
    loop
      perform public.notify(
        v_admin, 'home', new.space_id, 'space_join_request',
        coalesce(v_who, 'A member') || ' asked to join ' || coalesce(v_name, 'your space'),
        'Approve or decline on the profile page.',
        '/spaces/' || new.space_id, new.profile_id
      );
    end loop;
    return new;
  end if;

  select role into v_role from public.space_members
  where space_id = new.space_id and profile_id = new.initiated_by;

  if v_role in ('admin', 'super_admin') then
    -- invite → tell the invitee
    select full_name into v_who from public.profiles where id = new.initiated_by;
    perform public.notify(
      new.profile_id, 'home', new.space_id, 'space_invite',
      coalesce(v_who, 'An admin') || ' invited you to ' || coalesce(v_name, 'a space'),
      'Accept or decline on the profile page.',
      '/spaces/' || new.space_id, new.initiated_by
    );
  else
    -- member suggestion → tell the admins; the suggested person waits
    select full_name into v_who from public.profiles where id = new.initiated_by;
    select full_name into v_target from public.profiles where id = new.profile_id;
    for v_admin in
      select m.profile_id from public.space_members m
      where m.space_id = new.space_id and m.role in ('admin', 'super_admin')
    loop
      perform public.notify(
        v_admin, 'home', new.space_id, 'space_member_suggested',
        coalesce(v_who, 'A member') || ' suggests ' || coalesce(v_target, 'someone')
          || ' for ' || coalesce(v_name, 'your space'),
        'Send them an invite (or decline) on the profile page.',
        '/spaces/' || new.space_id, new.initiated_by
      );
    end loop;
  end if;
  return new;
end; $$;

-- ── 3. Accepting requires a REAL invite (admin-initiated) ────────────────────
-- Without this, a merely-suggested person could accept before any admin
-- endorsed the suggestion.
create or replace function public.accept_space_invite(p_space uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.space_membership_requests r
    join public.space_members m
      on m.space_id = r.space_id and m.profile_id = r.initiated_by
       and m.role in ('admin', 'super_admin')
    where r.space_id = p_space and r.profile_id = auth.uid()
      and r.initiated_by <> r.profile_id
  ) then
    raise exception 'No invitation to accept';
  end if;
  insert into public.space_members (space_id, profile_id, role)
  values (p_space, auth.uid(), 'member')
  on conflict do nothing;
  delete from public.space_membership_requests
  where space_id = p_space and profile_id = auth.uid();
end; $$;

-- ── 4. Admin endorses a suggestion → it becomes their invite ─────────────────
create or replace function public.endorse_member_suggestion(p_space uuid, p_profile uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_name text; v_who text;
begin
  if not exists (
    select 1 from public.space_members m
    where m.space_id = p_space and m.profile_id = auth.uid()
      and m.role in ('admin', 'super_admin')
  ) then
    raise exception 'Only admins can endorse suggestions';
  end if;
  if not exists (
    select 1 from public.space_membership_requests r
    where r.space_id = p_space and r.profile_id = p_profile
      and r.initiated_by <> r.profile_id
  ) then
    raise exception 'No suggestion to endorse';
  end if;
  update public.space_membership_requests
  set initiated_by = auth.uid()
  where space_id = p_space and profile_id = p_profile;
  -- the insert trigger doesn't refire on update — notify the invitee here
  select name into v_name from public.spaces where id = p_space;
  select full_name into v_who from public.profiles where id = auth.uid();
  perform public.notify(
    p_profile, 'home', p_space, 'space_invite',
    coalesce(v_who, 'An admin') || ' invited you to ' || coalesce(v_name, 'a space'),
    'Accept or decline on the profile page.',
    '/spaces/' || p_space, auth.uid()
  );
end; $$;

revoke all on function public.endorse_member_suggestion(uuid, uuid) from public, anon;
grant execute on function public.endorse_member_suggestion(uuid, uuid) to authenticated;
