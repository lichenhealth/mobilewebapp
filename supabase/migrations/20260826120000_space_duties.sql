-- Scoped admin duties + space-owned collections + collection suggestions
-- (founder, 2026-07-24): the super admin chooses admins AND what they steward
-- ("one admin curates the library, another TAs a course"). Duties are a
-- nullable text[] on the admin grant — null = everything (today's admins,
-- nothing changes). v1 duty keys with real teeth: 'library', 'courses',
-- 'members'. Collections gain a space_id (a group's Library/Courses that
-- duty-holders organize), and members can SUGGEST pieces or changes —
-- the category-suggestion consent pattern, applied to collections.

-- ── 1. Duties on the admin grant ──────────────────────────────────────────────
alter table public.space_members add column if not exists duties text[];

create or replace function public.has_space_duty(p_space uuid, p_uid uuid, p_duty text)
returns boolean
language sql stable security definer set search_path = public
as $fn$
  select exists (
    select 1 from public.space_members m
    where m.space_id = p_space and m.profile_id = p_uid
      and (m.role = 'super_admin'
           or (m.role = 'admin' and (m.duties is null or p_duty = any(m.duties))))
  );
$fn$;
revoke all on function public.has_space_duty(uuid, uuid, text) from public, anon;
grant execute on function public.has_space_duty(uuid, uuid, text) to authenticated;

-- The super admin grants/edits/revokes admin, with an optional duty subset.
-- No UPDATE policy exists on space_members — this RPC is the only door.
create or replace function public.set_member_role(
  p_space uuid, p_profile uuid, p_role text, p_duties text[] default null
) returns void
language plpgsql security definer set search_path = public
as $fn$
declare v_name text; v_line text;
begin
  if not exists (
    select 1 from public.space_members m
    where m.space_id = p_space and m.profile_id = auth.uid() and m.role = 'super_admin'
  ) then
    raise exception 'Only the super admin can change roles';
  end if;
  if p_profile = auth.uid() then
    raise exception 'You already run this space';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception 'Role must be admin or member';
  end if;
  if not exists (
    select 1 from public.space_members m
    where m.space_id = p_space and m.profile_id = p_profile and m.role <> 'super_admin'
  ) then
    raise exception 'Not a member of this space';
  end if;
  update public.space_members
  set role = p_role::public.space_member_role,
      duties = case when p_role = 'admin' then p_duties else null end
  where space_id = p_space and profile_id = p_profile;
  -- Bell on the grant; demotion stays silent (no shame bells).
  if p_role = 'admin' then
    select name into v_name from public.spaces where id = p_space;
    v_line := case when p_duties is null
      then 'You steward everything admins can.'
      else 'You steward: ' || array_to_string(p_duties, ', ') || '.' end;
    perform public.notify(
      p_profile, 'home', p_space, 'space_role',
      'You''re now an admin of ' || coalesce(v_name, 'a space'),
      v_line, '/spaces/' || p_space, auth.uid());
  end if;
end; $fn$;
revoke all on function public.set_member_role(uuid, uuid, text, text[]) from public, anon;
grant execute on function public.set_member_role(uuid, uuid, text, text[]) to authenticated;

-- ── 2. The 'members' duty gets teeth: approvals/invites/endorsements now ask
--       has_space_duty(…, 'members') instead of any-admin. Admins with null
--       duties pass exactly as before. ─────────────────────────────────────────
create or replace function public.approve_join_request(p_space uuid, p_profile uuid)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare v_name text;
begin
  if not public.has_space_duty(p_space, auth.uid(), 'members') then
    raise exception 'Only admins who steward members can approve join requests';
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
end; $fn$;

create or replace function public.endorse_member_suggestion(p_space uuid, p_profile uuid)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare v_name text; v_who text;
begin
  if not public.has_space_duty(p_space, auth.uid(), 'members') then
    raise exception 'Only admins who steward members can endorse suggestions';
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
  select name into v_name from public.spaces where id = p_space;
  select full_name into v_who from public.profiles where id = auth.uid();
  perform public.notify(
    p_profile, 'home', p_space, 'space_invite',
    coalesce(v_who, 'An admin') || ' invited you to ' || coalesce(v_name, 'a space'),
    'Accept or decline on the profile page.',
    '/spaces/' || p_space, auth.uid()
  );
end; $fn$;

-- Accepting still requires a REAL invite: the initiator must hold the
-- members duty (a scoped admin without it initiates a mere suggestion).
create or replace function public.accept_space_invite(p_space uuid)
returns void
language plpgsql security definer set search_path = public
as $fn$
begin
  if not exists (
    select 1
    from public.space_membership_requests r
    where r.space_id = p_space and r.profile_id = auth.uid()
      and r.initiated_by <> r.profile_id
      and public.has_space_duty(r.space_id, r.initiated_by, 'members')
  ) then
    raise exception 'No invitation to accept';
  end if;
  insert into public.space_members (space_id, profile_id, role)
  values (p_space, auth.uid(), 'member')
  on conflict do nothing;
  delete from public.space_membership_requests
  where space_id = p_space and profile_id = auth.uid();
end; $fn$;

-- Bells route to the duty-holders; an add by a scoped admin WITHOUT the
-- members duty now (correctly) reads as a member suggestion.
create or replace function public.handle_new_space_request()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
declare v_name text; v_who text; v_target text; v_admin uuid;
begin
  select name into v_name from public.spaces where id = new.space_id;
  if new.initiated_by = new.profile_id then
    -- join request → tell the member-stewards
    select full_name into v_who from public.profiles where id = new.profile_id;
    for v_admin in
      select m.profile_id from public.space_members m
      where m.space_id = new.space_id and m.role in ('admin', 'super_admin')
        and public.has_space_duty(new.space_id, m.profile_id, 'members')
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

  if public.has_space_duty(new.space_id, new.initiated_by, 'members') then
    -- invite → tell the invitee
    select full_name into v_who from public.profiles where id = new.initiated_by;
    perform public.notify(
      new.profile_id, 'home', new.space_id, 'space_invite',
      coalesce(v_who, 'An admin') || ' invited you to ' || coalesce(v_name, 'a space'),
      'Accept or decline on the profile page.',
      '/spaces/' || new.space_id, new.initiated_by
    );
  else
    -- member suggestion → tell the member-stewards; the suggested person waits
    select full_name into v_who from public.profiles where id = new.initiated_by;
    select full_name into v_target from public.profiles where id = new.profile_id;
    for v_admin in
      select m.profile_id from public.space_members m
      where m.space_id = new.space_id and m.role in ('admin', 'super_admin')
        and public.has_space_duty(new.space_id, m.profile_id, 'members')
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
end; $fn$;

-- ── 3. Space-owned collections: a group's Library/Courses that duty-holders
--       organize. owner_id stays = the human who made it (attribution). ────────
alter table public.collections
  add column if not exists space_id uuid references public.spaces(id) on delete cascade;
create index if not exists collections_space_idx on public.collections (space_id);

-- Which duty tends a collection of this kind.
create or replace function public.collection_duty(p_kind text)
returns text language sql immutable
as $fn$ select case when p_kind = 'course' then 'courses' else 'library' end $fn$;
grant execute on function public.collection_duty(text) to authenticated;

drop policy if exists "collections: read own or public" on public.collections;
create policy "collections: read own, public, or space" on public.collections
  for select to authenticated using (
    owner_id = auth.uid() or is_public
    or (space_id is not null and exists (
      select 1 from public.space_members m
      where m.space_id = collections.space_id and m.profile_id = auth.uid()))
  );

drop policy if exists "collections: insert own" on public.collections;
create policy "collections: insert own or stewarded" on public.collections
  for insert to authenticated with check (
    owner_id = auth.uid()
    and (space_id is null
         or public.has_space_duty(space_id, auth.uid(), public.collection_duty(kind)))
  );

drop policy if exists "collections: update own" on public.collections;
create policy "collections: update own or stewarded" on public.collections
  for update to authenticated
  using (
    owner_id = auth.uid()
    or (space_id is not null
        and public.has_space_duty(space_id, auth.uid(), public.collection_duty(kind)))
  ) with check (
    owner_id = auth.uid()
    or (space_id is not null
        and public.has_space_duty(space_id, auth.uid(), public.collection_duty(kind)))
  );

drop policy if exists "collections: delete own" on public.collections;
create policy "collections: delete own or stewarded" on public.collections
  for delete to authenticated using (
    owner_id = auth.uid()
    or (space_id is not null
        and public.has_space_duty(space_id, auth.uid(), public.collection_duty(kind)))
  );

drop policy if exists "citems: read via collection" on public.collection_items;
create policy "citems: read via collection" on public.collection_items
  for select to authenticated using (
    exists (select 1 from public.collections c
            where c.id = collection_items.collection_id
              and (c.owner_id = auth.uid() or c.is_public
                   or (c.space_id is not null and exists (
                     select 1 from public.space_members m
                     where m.space_id = c.space_id and m.profile_id = auth.uid()))))
  );

drop policy if exists "citems: write own" on public.collection_items;
create policy "citems: write own or stewarded" on public.collection_items
  for all to authenticated using (
    exists (select 1 from public.collections c
            where c.id = collection_items.collection_id
              and (c.owner_id = auth.uid()
                   or (c.space_id is not null
                       and public.has_space_duty(c.space_id, auth.uid(), public.collection_duty(c.kind)))))
  ) with check (
    exists (select 1 from public.collections c
            where c.id = collection_items.collection_id
              and (c.owner_id = auth.uid()
                   or (c.space_id is not null
                       and public.has_space_duty(c.space_id, auth.uid(), public.collection_duty(c.kind)))))
  );

-- ── 4. Members SUGGEST additions or organizational changes; the curators
--       (owner + duty-holders) decide. Silent until accepted. ──────────────────
create table if not exists public.collection_suggestions (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,   -- null = a note
  note text,
  suggested_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  check (post_id is not null or note is not null)
);
create index if not exists csugg_collection_idx on public.collection_suggestions (collection_id, status);
alter table public.collection_suggestions enable row level security;

create or replace function public.is_collection_curator(p_collection uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $fn$
  select exists (
    select 1 from public.collections c
    where c.id = p_collection
      and (c.owner_id = p_uid
           or (c.space_id is not null
               and public.has_space_duty(c.space_id, p_uid, public.collection_duty(c.kind))))
  );
$fn$;
revoke all on function public.is_collection_curator(uuid, uuid) from public, anon;
grant execute on function public.is_collection_curator(uuid, uuid) to authenticated;

-- Anyone who can SEE the collection may suggest to it (the subquery runs
-- through collections' own read policy).
create policy "csugg: suggest to visible collections" on public.collection_suggestions
  for insert to authenticated with check (
    suggested_by = auth.uid()
    and exists (select 1 from public.collections c where c.id = collection_id)
  );
create policy "csugg: read own or curator" on public.collection_suggestions
  for select to authenticated using (
    suggested_by = auth.uid()
    or public.is_collection_curator(collection_id, auth.uid())
  );
create policy "csugg: withdraw own pending" on public.collection_suggestions
  for delete to authenticated using (
    suggested_by = auth.uid() and status = 'pending'
  );
-- no UPDATE policy — resolution goes through the RPC below.

create or replace function public.resolve_collection_suggestion(p_id uuid, p_accept boolean)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare v_sugg public.collection_suggestions; v_name text; v_pos int;
begin
  select * into v_sugg from public.collection_suggestions
  where id = p_id and status = 'pending';
  if v_sugg.id is null then
    raise exception 'No pending suggestion';
  end if;
  if not public.is_collection_curator(v_sugg.collection_id, auth.uid()) then
    raise exception 'Only the collection''s organizers can decide this';
  end if;
  if p_accept and v_sugg.post_id is not null then
    select coalesce(max(position) + 1, 0) into v_pos
    from public.collection_items where collection_id = v_sugg.collection_id;
    insert into public.collection_items (collection_id, target_type, target_id, position)
    values (v_sugg.collection_id, 'post', v_sugg.post_id, v_pos)
    on conflict do nothing;
  end if;
  update public.collection_suggestions
  set status = case when p_accept then 'accepted' else 'declined' end
  where id = p_id;
  -- Tell the suggester on accept; declines stay quiet.
  if p_accept then
    select name into v_name from public.collections where id = v_sugg.collection_id;
    perform public.notify(
      v_sugg.suggested_by, 'home', null, 'collection_suggestion_accepted',
      'Your suggestion was added to ' || coalesce(v_name, 'the collection'),
      case when v_sugg.post_id is not null
        then 'The piece you suggested is now part of it.'
        else 'The organizers took your note on board.' end,
      '/collections/' || v_sugg.collection_id, auth.uid());
  end if;
end; $fn$;
revoke all on function public.resolve_collection_suggestion(uuid, boolean) from public, anon;
grant execute on function public.resolve_collection_suggestion(uuid, boolean) to authenticated;

-- New suggestion → bell the curators (owner + duty-holders, minus the suggester).
create or replace function public.handle_new_collection_suggestion()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
declare v_name text; v_owner uuid; v_space uuid; v_kind text; v_who text; v_cur uuid;
begin
  select c.name, c.owner_id, c.space_id, c.kind
  into v_name, v_owner, v_space, v_kind
  from public.collections c where c.id = new.collection_id;
  select full_name into v_who from public.profiles where id = new.suggested_by;
  for v_cur in
    select distinct p from (
      select v_owner as p
      union
      select m.profile_id from public.space_members m
      where v_space is not null and m.space_id = v_space
        and m.role in ('admin', 'super_admin')
        and public.has_space_duty(v_space, m.profile_id, public.collection_duty(v_kind))
    ) t where t.p is not null and t.p <> new.suggested_by
  loop
    perform public.notify(
      v_cur, 'home', v_space, 'collection_suggestion',
      coalesce(v_who, 'A member') || ' suggests '
        || case when new.post_id is not null then 'a piece for ' else 'a change to ' end
        || coalesce(v_name, 'your collection'),
      'Review it on the collection page.',
      '/collections/' || new.collection_id, new.suggested_by);
  end loop;
  return new;
end; $fn$;

drop trigger if exists on_collection_suggestion_created on public.collection_suggestions;
create trigger on_collection_suggestion_created
  after insert on public.collection_suggestions
  for each row execute function public.handle_new_collection_suggestion();
