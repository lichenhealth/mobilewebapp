-- TAKE OFFLINE (founder 2026-08-17, the same afternoon delete shipped): "If
-- they just don't want the Group, Place, etc live but aren't sure they want to
-- delete it yet, they have an option." Two doors total: Take Offline, which
-- can be put back online later, and Delete, which is permanent and immediate.
--
-- What matters is that offline means INVISIBLY GONE for the whole hold: off
-- the directories, maps and search, out of every member's inbox and calendar,
-- posts in the space's own voice hidden — while the rows quietly persist, so
-- restore is one update and everything reappears exactly as it was. If it were
-- still faintly visible anywhere it would be "hidden", not "offline", and the
-- members would rightly feel lied to. Only the super admin ever sees the held
-- list (my_offline_spaces) — never through the table.
--
-- Why this protects more than the admin: a super admin acts on what OTHER
-- people co-created — the group's chat, its members' posts, its events. Now
-- there's a door short of ending all that for everyone.
--
-- The refusals (treasury Current, a stewarded member, an open trade) block
-- this door too — value and beings are never parked in limbo.

alter table public.spaces
  add column if not exists status text not null default 'live'
    check (status in ('live', 'offline')),
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_changed_by uuid references public.profiles(id) on delete set null;

-- One question, asked from many policies. SECURITY DEFINER so it reads spaces
-- regardless of who's asking (and so a spaces policy that references it isn't
-- a recursion — the function bypasses RLS).
create or replace function public.space_alive(p_space uuid)
returns boolean language sql stable security definer set search_path to 'public' as $func$
  select coalesce((select s.status = 'live' from public.spaces s where s.id = p_space), false);
$func$;
revoke all on function public.space_alive(uuid) from public;
grant execute on function public.space_alive(uuid) to anon, authenticated;

-- ── The gates: an offline space is not readable, and neither is what hangs on it
drop policy if exists "Spaces readable by authenticated" on public.spaces;
create policy "Spaces readable by authenticated" on public.spaces
  for select to authenticated using (status = 'live');
drop policy if exists "spaces: public pages" on public.spaces;
create policy "spaces: public pages" on public.spaces
  for select to anon using (public_page = true and status = 'live');

-- space_members: gating this hides the space from every member's own lists
-- (side menu, calendar chips, Profile's kind lists) and from the posts policy's
-- audience arm in one move. is_space_member/is_space_admin are SECURITY
-- DEFINER and read the table directly, so admin checks keep working — which is
-- what lets the super admin restore.
drop policy if exists "Memberships readable by authenticated" on public.space_members;
create policy "Memberships readable by authenticated" on public.space_members
  for select to authenticated using (public.space_alive(space_id));

-- chats: one choke point. is_chat_member gates chat_messages, reactions,
-- media and chat_unread_counts alike, so an offline space's room leaves every
-- inbox and stops counting unread.
create or replace function public.is_chat_member(p_chat uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $func$
  select exists (select 1 from public.chat_members m where m.chat_id = p_chat and m.profile_id = p_uid)
     and not exists (select 1 from public.chats c
                      where c.id = p_chat and c.space_id is not null
                        and not public.space_alive(c.space_id));
$func$;

-- posts in the space's own voice hide with it. Posts merely addressed to it
-- (audience_space_ids) already hide via the space_members gate above; a
-- member's own PUBLIC post that also mentioned the space stays theirs.
drop policy if exists "posts: read" on public.posts;
create policy "posts: read" on public.posts
  for select to authenticated using (
    (author_space_id is null or public.space_alive(author_space_id))
    and (
      is_public
      or author_id = auth.uid()
      or (to_mycelium and exists (
            select 1 from public.mycelium my
             where my.truster_id = auth.uid()
               and ((my.target_type = 'profile' and my.target_id = posts.author_id)
                 or (my.target_type = 'space' and my.target_id = posts.author_space_id))))
      or exists (select 1 from public.space_members m
                  where m.profile_id = auth.uid() and m.space_id = any (posts.audience_space_ids))
    ));
drop policy if exists "posts: public read (anon)" on public.posts;
create policy "posts: public read (anon)" on public.posts
  for select to anon using (
    visibility = 'public'
    and (author_space_id is null or public.space_alive(author_space_id)));

drop policy if exists "events read" on public.events;
create policy "events read" on public.events
  for select to authenticated using (
    (owner_space_id is null or public.space_alive(owner_space_id))
    and (
      creator_id = auth.uid()
      or owner_profile_id = auth.uid()
      or (owner_space_id is not null and public.is_space_member(owner_space_id, auth.uid()))
      or public.is_event_attendee(id, auth.uid())
      or exists (select 1 from public.posts p where p.linked_event_id = events.id)
    ));

drop policy if exists "resources: read" on public.resources;
create policy "resources: read" on public.resources
  for select to authenticated using (space_id is null or public.space_alive(space_id));

drop policy if exists "collections: read own, public, or space" on public.collections;
create policy "collections: read own, public, or space" on public.collections
  for select to authenticated using (
    (space_id is null or public.space_alive(space_id))
    and (
      owner_id = auth.uid()
      or is_public
      or (space_id is not null and exists (
            select 1 from public.space_members m
             where m.space_id = collections.space_id and m.profile_id = auth.uid()))
    ));
drop policy if exists "collections: public read (anon)" on public.collections;
create policy "collections: public read (anon)" on public.collections
  for select to anon using (is_public and (space_id is null or public.space_alive(space_id)));

-- ── The door ────────────────────────────────────────────────────────────────
-- Same refusals as delete: nothing is parked in limbo. Then one stamp.
create or replace function public.take_space_offline(p_space uuid)
returns void language plpgsql security definer set search_path to 'public' as $func$
declare
  v_uid uuid := auth.uid();
  v_bal numeric;
  v_n int;
  v_name text;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.space_members
                  where space_id = p_space and profile_id = v_uid and role = 'super_admin') then
    raise exception 'only the super admin can do this';
  end if;
  select coalesce(sum(case when to_type = 'space' and to_id = p_space then amount else 0 end), 0)
       - coalesce(sum(case when from_type = 'space' and from_id = p_space then amount else 0 end), 0)
    into v_bal from public.ledger_entries
   where (to_type = 'space' and to_id = p_space) or (from_type = 'space' and from_id = p_space);
  if v_bal > 0 then
    raise exception 'The treasury still holds % Current — send it on first.', trim(to_char(v_bal, 'FM999999990.##'));
  end if;
  select count(*) into v_n from public.profiles where steward_space_id = p_space;
  if v_n > 0 then
    raise exception 'This space stewards % member(s) — hand them to another steward first.', v_n;
  end if;
  select count(*) into v_n from public.exchanges
   where (buyer_space_id = p_space or seller_space_id = p_space) and status in ('pending', 'accepted');
  if v_n > 0 then
    raise exception 'There are % open trade(s) with this space — finish or cancel them first.', v_n;
  end if;

  update public.spaces
     set status = 'offline', status_changed_at = now(), status_changed_by = v_uid
   where id = p_space and status = 'live'
   returning name into v_name;

  -- The bell says where the way back is.
  perform public.notify(
    v_uid, 'profile', null, 'space_offline',
    v_name || ' is off the network',
    'Held with everything intact. Put it back online any time from your Profile.',
    '/profile#offline', null);
end;
$func$;
revoke all on function public.take_space_offline(uuid) from public;
grant execute on function public.take_space_offline(uuid) to authenticated;

create or replace function public.restore_space(p_space uuid)
returns void language plpgsql security definer set search_path to 'public' as $func$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.space_members
                  where space_id = p_space and profile_id = auth.uid() and role = 'super_admin') then
    raise exception 'only the super admin can restore this';
  end if;
  update public.spaces
     set status = 'live', status_changed_at = now(), status_changed_by = auth.uid()
   where id = p_space and status = 'offline';
end;
$func$;
revoke all on function public.restore_space(uuid) from public;
grant execute on function public.restore_space(uuid) to authenticated;

-- The super admin's held list — the ONLY door to an offline space. Delete
-- works from here too (delete_space checks the same super_admin row).
create or replace function public.my_offline_spaces()
returns table (id uuid, name text, kind text, avatar_url text, status_changed_at timestamptz)
language sql stable security definer set search_path to 'public' as $func$
  select s.id, s.name, s.kind::text, s.avatar_url, s.status_changed_at
    from public.spaces s
    join public.space_members m on m.space_id = s.id
   where m.profile_id = auth.uid() and m.role = 'super_admin'
     and s.status = 'offline'
   order by s.status_changed_at desc;
$func$;
revoke all on function public.my_offline_spaces() from public;
grant execute on function public.my_offline_spaces() to authenticated;
