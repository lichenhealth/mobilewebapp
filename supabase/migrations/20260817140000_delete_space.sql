-- A SUPER ADMIN CAN DELETE THEIR SPACE (founder 2026-08-17, after a member
-- asked the help room "how do I delete a group if I'm a super admin" and the
-- honest answer was: you can't — no policy, no button, no RPC existed).
--
-- Why an RPC and not a DELETE policy: 22 tables reference spaces. Most
-- cascade cleanly, but two SET-NULLs collide with CHECK constraints (a being
-- whose steward is this space would be left with no steward at all; a booking
-- type whose only audience is this space would have an audience with no id),
-- polymorphic rows have no FK to clean them (mycelium/recommendation/saved
-- edges pointing AT the space, the member's per-space AI consent rows), and
-- the ledger is append-only — Current in the treasury can't be deleted, only
-- moved. A bare delete would fail on the first of those and silently orphan
-- the rest. So it's one SECURITY DEFINER function that either refuses with a
-- reason a human can act on, or removes the whole thing in one transaction.
--
-- Refusals are honest and specific — each is something the super admin can
-- go do first:
--   · the treasury still holds Current   → send it somewhere first
--   · the space stewards a member         → hand them to another steward
--   · a trade is still open               → finish or cancel it
-- Nested groups are NOT a refusal: they simply become standalone (the FK
-- already says so) — a group outlives the community that held it.

create or replace function public.delete_space(p_space uuid)
returns void language plpgsql security definer set search_path to 'public' as $func$
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
  -- Booking types whose only audience was this space's members: an audience
  -- with nobody in it. Narrow to the provider's own web rather than widen to
  -- everyone — the closest "people I already know" tier, never a silent
  -- public exposure.
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

revoke all on function public.delete_space(uuid) from public;
grant execute on function public.delete_space(uuid) to authenticated;
