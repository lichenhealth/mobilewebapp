-- SEVERAL CIRCLES PER SESSION TYPE (founder 2026-11-01: "I'd like to have
-- each meeting type have a selection toggle for visibility: Everyone,
-- Lichen Members, Mycelium, or a specific set of groups, organizations,
-- communities, places, etc"). The first three tiers existed; this adds the
-- SET: audience='space' may now name several spaces. booking_type_spaces
-- holds the set; booking_types.audience_space_id stays as the legacy single
-- and mirrors the set's first pick, so every old reader keeps working.

create table if not exists public.booking_type_spaces (
  type_id  uuid not null references public.booking_types(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  primary key (type_id, space_id)
);
alter table public.booking_type_spaces enable row level security;

-- The owner manages the set through the type. One-directional subquery only:
-- booking_types' own policy must NEVER read this table directly (the 42P17
-- recursion shape) — it goes through the SECURITY DEFINER helper below.
create policy "btspaces owner all" on public.booking_type_spaces
  for all
  using (exists (select 1 from public.booking_types bt
                  where bt.id = type_id and bt.profile_id = auth.uid()))
  with check (exists (select 1 from public.booking_types bt
                  where bt.id = type_id and bt.profile_id = auth.uid()));
grant select, insert, update, delete on public.booking_type_spaces to authenticated;

-- Seed the set from every standing single-space type — one model holds.
insert into public.booking_type_spaces (type_id, space_id)
  select id, audience_space_id from public.booking_types
   where audience = 'space' and audience_space_id is not null
  on conflict do nothing;

-- The recursion-safe read: is the viewer a member of ANY circle in the set?
create or replace function public.booking_type_space_member(p_type uuid, p_viewer uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $func$
  select exists (select 1 from public.booking_type_spaces s
    where s.type_id = p_type and public.is_space_member(s.space_id, p_viewer));
$func$;
revoke all on function public.booking_type_space_member(uuid, uuid) from anon;

-- BOTH visibility homes change together (the 2026-10-03 "public types were
-- invisible for a day" trap): the function AND the RLS policy.
create or replace function public.booking_type_visible(p_type uuid, p_viewer uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $func$
  select exists (select 1 from public.booking_types t
    where t.id = p_type and t.active and (
      t.profile_id = p_viewer
      or t.audience in ('everyone', 'public')
      or (t.audience = 'mycelium' and exists (
        select 1 from public.mycelium m
        where m.truster_id = t.profile_id and m.target_type = 'profile' and m.target_id = p_viewer))
      or (t.audience = 'space' and (
        (t.audience_space_id is not null and public.is_space_member(t.audience_space_id, p_viewer))
        or public.booking_type_space_member(t.id, p_viewer)))));
$func$;

drop policy "booking_types visible" on public.booking_types;
create policy "booking_types visible" on public.booking_types
  for select using (
    active and (
      audience in ('everyone', 'public')
      or (audience = 'mycelium' and exists (
        select 1 from public.mycelium m
        where m.truster_id = booking_types.profile_id
          and m.target_type = 'profile' and m.target_id = auth.uid()))
      or (audience = 'space' and (
        (audience_space_id is not null and public.is_space_member(audience_space_id, auth.uid()))
        or public.booking_type_space_member(booking_types.id, auth.uid())))));

-- delete_space: a type whose SET still holds other circles KEEPS them —
-- only a set emptied by this deletion narrows to my-celium (the standing
-- never-silently-widen rule). Full function recreated; only the booking
-- clause changed.
CREATE OR REPLACE FUNCTION public.delete_space(p_space uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $func$
declare
  v_uid uuid := auth.uid();
  v_bal numeric;
  v_n int;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.space_members
                  where space_id = p_space and profile_id = v_uid and role = 'super_admin') then
    raise exception 'only the super admin can delete this';
  end if;

  -- The treasury: Current is value held on someone's behalf. It leaves by
  -- being sent, never by being deleted (the float rule).
  select coalesce(sum(case when to_type = 'space' and to_id = p_space then amount else 0 end), 0)
       - coalesce(sum(case when from_type = 'space' and from_id = p_space then amount else 0 end), 0)
    into v_bal from public.ledger_entries
   where (to_type = 'space' and to_id = p_space) or (from_type = 'space' and from_id = p_space);
  if v_bal > 0 then
    raise exception 'The treasury still holds % Current — send it on before deleting.', trim(to_char(v_bal, 'FM999999990.##'));
  end if;

  -- Stewarded members: a being must always have a steward.
  select count(*) into v_n from public.profiles where steward_space_id = p_space;
  if v_n > 0 then
    raise exception 'This space stewards % member(s) — hand them to another steward first.', v_n;
  end if;

  -- Open trades: someone on the other side is waiting.
  select count(*) into v_n from public.exchanges
   where (buyer_space_id = p_space or seller_space_id = p_space)
     and status in ('pending', 'accepted');
  if v_n > 0 then
    raise exception 'There are % open trade(s) with this space — finish or cancel them first.', v_n;
  end if;

  -- ── Rows the FKs can't reach ─────────────────────────────────────────────
  -- Edges pointing AT the space (polymorphic, no FK).
  delete from public.mycelium where target_type = 'space' and target_id = p_space;
  delete from public.recommendations where target_type = 'space' and target_id = p_space;
  delete from public.saved_items where target_type = 'space' and target_id = p_space;
  -- Members' per-space AI de-selections for it (scope_id is text).
  delete from public.assistant_consent where scope_type = 'space' and scope_id = p_space::text;
  -- Closed trades where the space was a party: the FK would null the space
  -- column, and for "the barn bought its admin's saddle" that trips the
  -- not-self CHECK. The money already moved and the ledger keeps that
  -- history; the request rows go with the space.
  delete from public.exchanges where buyer_space_id = p_space or seller_space_id = p_space;
  -- Booking types aimed at this space's members (2026-11-01, multi-space
  -- audiences): a type whose SET still holds other circles just re-points
  -- its legacy single; a set emptied by this deletion is an audience with
  -- nobody in it — narrow to the provider's own web rather than widen to
  -- everyone, never a silent public exposure.
  update public.booking_types bt set audience_space_id = (
      select s.space_id from public.booking_type_spaces s
       where s.type_id = bt.id and s.space_id <> p_space limit 1)
   where bt.audience = 'space' and bt.audience_space_id = p_space
     and exists (select 1 from public.booking_type_spaces s
                  where s.type_id = bt.id and s.space_id <> p_space);
  update public.booking_types set audience = 'mycelium', audience_space_id = null
   where audience = 'space' and audience_space_id = p_space;
  -- What the space said in its own voice goes with it (posts authored AS the
  -- space); posts merely addressed to it are cascaded by posts.space_id.
  delete from public.posts where author_space_id = p_space;

  -- Everything else cascades: members, chat + messages, membership and
  -- nesting requests, section shares, events + attendees, resources +
  -- bookings, collections, notifications, share rules. Child groups become
  -- standalone (parent_space_id set null).
  delete from public.spaces where id = p_space;
end;
$func$;
