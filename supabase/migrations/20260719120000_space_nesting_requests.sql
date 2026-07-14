-- Real spaces arc (founder, 2026-07-14): group NESTING under communities/
-- organizations, plus membership by REQUEST + APPROVAL — either side starts:
-- a member requests (admins approve) or an admin invites (the member accepts).
-- The care-team pattern, applied to spaces.

-- ── 1. Nesting ────────────────────────────────────────────────────────────────
alter table public.spaces
  add column if not exists parent_space_id uuid references public.spaces(id) on delete set null;
create index if not exists spaces_parent_idx on public.spaces (parent_space_id);

-- ── 2. Membership requests (one row per pending request OR invite) ───────────
create table if not exists public.space_membership_requests (
  space_id uuid not null references public.spaces(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,   -- the would-be member
  initiated_by uuid not null references public.profiles(id) on delete cascade, -- = profile_id → join request · an admin → invite
  created_at timestamptz not null default now(),
  primary key (space_id, profile_id)
);
alter table public.space_membership_requests enable row level security;

-- Subject sees their own; admins see their space's.
create policy "smr: read own or admin" on public.space_membership_requests
  for select to authenticated
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from public.space_members m
      where m.space_id = space_membership_requests.space_id
        and m.profile_id = auth.uid()
        and m.role in ('admin', 'super_admin')
    )
  );

-- Self-request, or an admin inviting someone.
create policy "smr: request or invite" on public.space_membership_requests
  for insert to authenticated
  with check (
    (profile_id = auth.uid() and initiated_by = auth.uid())
    or (
      initiated_by = auth.uid()
      and exists (
        select 1 from public.space_members m
        where m.space_id = space_membership_requests.space_id
          and m.profile_id = auth.uid()
          and m.role in ('admin', 'super_admin')
      )
    )
  );

-- Cancel/decline from either side.
create policy "smr: withdraw or decline" on public.space_membership_requests
  for delete to authenticated
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from public.space_members m
      where m.space_id = space_membership_requests.space_id
        and m.profile_id = auth.uid()
        and m.role in ('admin', 'super_admin')
    )
  );

-- ── 3. RPCs ───────────────────────────────────────────────────────────────────
-- Admin approves a join request → membership (the chat-sync trigger takes it
-- from there) + a welcome notification.
create or replace function public.approve_join_request(p_space uuid, p_profile uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_name text;
begin
  if not exists (
    select 1 from public.space_members m
    where m.space_id = p_space and m.profile_id = auth.uid()
      and m.role in ('admin', 'super_admin')
  ) then
    raise exception 'Only admins can approve join requests';
  end if;
  if not exists (
    select 1 from public.space_membership_requests r
    where r.space_id = p_space and r.profile_id = p_profile
      and r.initiated_by = r.profile_id
  ) then
    raise exception 'No pending join request';
  end if;
  insert into public.space_members (space_id, profile_id, role)
  values (p_space, p_profile, 'member')
  on conflict do nothing;
  delete from public.space_membership_requests
  where space_id = p_space and profile_id = p_profile;
  select name into v_name from public.spaces where id = p_space;
  perform public.notify(
    p_profile, 'home', p_space, 'space_join_approved',
    'Welcome to ' || coalesce(v_name, 'the space'),
    'Your request to join was approved.',
    '/spaces/' || p_space, auth.uid()
  );
end; $$;

-- Invitee accepts an admin's invite → membership.
create or replace function public.accept_space_invite(p_space uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.space_membership_requests r
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

revoke all on function public.approve_join_request(uuid, uuid) from public, anon;
revoke all on function public.accept_space_invite(uuid) from public, anon;
grant execute on function public.approve_join_request(uuid, uuid) to authenticated;
grant execute on function public.accept_space_invite(uuid) to authenticated;

-- ── 4. Notifications on new requests/invites ─────────────────────────────────
create or replace function public.handle_new_space_request()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_name text; v_who text; v_admin uuid;
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
  else
    -- invite → tell the invitee
    select full_name into v_who from public.profiles where id = new.initiated_by;
    perform public.notify(
      new.profile_id, 'home', new.space_id, 'space_invite',
      coalesce(v_who, 'An admin') || ' invited you to ' || coalesce(v_name, 'a space'),
      'Accept or decline on the profile page.',
      '/spaces/' || new.space_id, new.initiated_by
    );
  end if;
  return new;
end; $$;

drop trigger if exists on_space_request_created on public.space_membership_requests;
create trigger on_space_request_created
  after insert on public.space_membership_requests
  for each row execute function public.handle_new_space_request();

-- ── 5. Group nesting is CONSENSUAL (founder): a group PROPOSES itself to a
--       community/organization; the parent's admins approve or decline.
--       Proposing a brand-new group = create it standalone + propose. ──────────
create table if not exists public.space_nesting_requests (
  group_id uuid primary key references public.spaces(id) on delete cascade,
  parent_id uuid not null references public.spaces(id) on delete cascade,
  initiated_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.space_nesting_requests enable row level security;

-- Group admins and the prospective parent's admins can see it.
create policy "snr: read either side" on public.space_nesting_requests
  for select to authenticated
  using (
    exists (
      select 1 from public.space_members m
      where m.space_id = space_nesting_requests.group_id
        and m.profile_id = auth.uid() and m.role in ('admin', 'super_admin')
    )
    or exists (
      select 1 from public.space_members m
      where m.space_id = space_nesting_requests.parent_id
        and m.profile_id = auth.uid() and m.role in ('admin', 'super_admin')
    )
  );

-- Only the group's own admins propose it somewhere.
create policy "snr: group admins propose" on public.space_nesting_requests
  for insert to authenticated
  with check (
    initiated_by = auth.uid()
    and exists (
      select 1 from public.space_members m
      where m.space_id = space_nesting_requests.group_id
        and m.profile_id = auth.uid() and m.role in ('admin', 'super_admin')
    )
  );

-- Withdraw (group side) or decline (parent side).
create policy "snr: withdraw or decline" on public.space_nesting_requests
  for delete to authenticated
  using (
    exists (
      select 1 from public.space_members m
      where m.space_id = space_nesting_requests.group_id
        and m.profile_id = auth.uid() and m.role in ('admin', 'super_admin')
    )
    or exists (
      select 1 from public.space_members m
      where m.space_id = space_nesting_requests.parent_id
        and m.profile_id = auth.uid() and m.role in ('admin', 'super_admin')
    )
  );

-- Parent admin approves → the group moves in.
create or replace function public.approve_group_nesting(p_group uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_parent uuid; v_gname text; v_pname text; v_admin uuid;
begin
  select parent_id into v_parent from public.space_nesting_requests where group_id = p_group;
  if v_parent is null then
    raise exception 'No nesting proposal for this group';
  end if;
  if not exists (
    select 1 from public.space_members m
    where m.space_id = v_parent and m.profile_id = auth.uid()
      and m.role in ('admin', 'super_admin')
  ) then
    raise exception 'Only the community''s admins can approve this';
  end if;
  update public.spaces set parent_space_id = v_parent where id = p_group;
  delete from public.space_nesting_requests where group_id = p_group;
  select name into v_gname from public.spaces where id = p_group;
  select name into v_pname from public.spaces where id = v_parent;
  for v_admin in
    select m.profile_id from public.space_members m
    where m.space_id = p_group and m.role in ('admin', 'super_admin')
  loop
    perform public.notify(
      v_admin, 'home', p_group, 'group_nesting_approved',
      coalesce(v_gname, 'Your group') || ' is now part of ' || coalesce(v_pname, 'the community'),
      'The admins welcomed your group in.',
      '/spaces/' || p_group, auth.uid()
    );
  end loop;
end; $$;

revoke all on function public.approve_group_nesting(uuid) from public, anon;
grant execute on function public.approve_group_nesting(uuid) to authenticated;

-- DIRECT parent changes need the parent's consent too: setting a parent is
-- only allowed for that parent's admins (the approve RPC runs as definer and
-- bypasses this); clearing back to standalone is always the group's right.
create or replace function public.enforce_parent_consent()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.parent_space_id is not null
     and new.parent_space_id is distinct from old.parent_space_id
     and auth.uid() is not null
     and not exists (
       select 1 from public.space_members m
       where m.space_id = new.parent_space_id and m.profile_id = auth.uid()
         and m.role in ('admin', 'super_admin')
     ) then
    raise exception 'Propose the group to that community — its admins decide';
  end if;
  return new;
end; $$;

drop trigger if exists on_space_parent_change on public.spaces;
create trigger on_space_parent_change
  before update of parent_space_id on public.spaces
  for each row execute function public.enforce_parent_consent();

-- Tell the parent's admins a group is knocking.
create or replace function public.handle_new_nesting_request()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_gname text; v_pname text; v_admin uuid;
begin
  select name into v_gname from public.spaces where id = new.group_id;
  select name into v_pname from public.spaces where id = new.parent_id;
  for v_admin in
    select m.profile_id from public.space_members m
    where m.space_id = new.parent_id and m.role in ('admin', 'super_admin')
  loop
    perform public.notify(
      v_admin, 'home', new.parent_id, 'group_nesting_request',
      'The group ' || coalesce(v_gname, 'a group') || ' proposes to join ' || coalesce(v_pname, 'your community'),
      'Approve or decline on your community''s profile page.',
      '/spaces/' || new.parent_id, new.initiated_by
    );
  end loop;
  return new;
end; $$;

drop trigger if exists on_nesting_request_created on public.space_nesting_requests;
create trigger on_nesting_request_created
  after insert on public.space_nesting_requests
  for each row execute function public.handle_new_nesting_request();

-- ── 6. Un-nesting cuts both ways: the parent's admins may release a nested
--       group back to standalone (the group's admins could already leave). ────
create or replace function public.eject_group(p_group uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_parent uuid; v_gname text; v_pname text; v_admin uuid;
begin
  select parent_space_id into v_parent from public.spaces where id = p_group;
  if v_parent is null then
    raise exception 'This group is not nested anywhere';
  end if;
  if not exists (
    select 1 from public.space_members m
    where m.space_id = v_parent and m.profile_id = auth.uid()
      and m.role in ('admin', 'super_admin')
  ) then
    raise exception 'Only the community''s admins can release a group';
  end if;
  select name into v_gname from public.spaces where id = p_group;
  select name into v_pname from public.spaces where id = v_parent;
  update public.spaces set parent_space_id = null where id = p_group;
  for v_admin in
    select m.profile_id from public.space_members m
    where m.space_id = p_group and m.role in ('admin', 'super_admin')
  loop
    perform public.notify(
      v_admin, 'home', p_group, 'group_unnested',
      coalesce(v_gname, 'Your group') || ' now stands on its own',
      coalesce(v_pname, 'The community') || '''s admins released it — everything else about the group is unchanged.',
      '/spaces/' || p_group, auth.uid()
    );
  end loop;
end; $$;

revoke all on function public.eject_group(uuid) from public, anon;
grant execute on function public.eject_group(uuid) to authenticated;
