-- A SPACE GETS A WEB OF ITS OWN (founder 2026-08-13: "let's have the network
-- tagline go... to Countryman Stable's mycelium").
--
-- Until now mycelium.truster_id was a hard FK to profiles, so there was no way
-- to record that a SPACE wove someone. Every road to My-celium while acting as
-- a space therefore bounced to the space's profile page — which is what made
-- Home's presence line open a profile with no members in sight.
--
-- recommendations already solved exactly this with recommender_space_id: the
-- space speaks, and a named human stays accountable for what it said. This is
-- that shape, copied.
--
-- THREE RULES:
--   * A space cannot TRUST. Trust is person-to-person and private — the
--     doctrine myceliumApi already notes as "trust deliberately has no
--     equivalent" for spaces. Mirrors the existing mycelium_no_space_trust,
--     which blocks space TARGETS; this blocks space TRUSTERS.
--   * A space cannot weave itself (check_recommend_voice's rule, cheap enough
--     to be a plain CHECK here).
--   * One voice comes free: truster_id is already NOT NULL, so every space
--     edge carries the person who made it.

alter table public.mycelium
  add column if not exists truster_space_id uuid
    references public.spaces(id) on delete cascade;

comment on column public.mycelium.truster_space_id is
  'Set when this edge is a SPACE''s, woven by an admin acting as it. truster_id still records which human did it. Null = an ordinary personal edge. A space edge can never be vouched — trust stays person-to-person.';

alter table public.mycelium
  drop constraint if exists mycelium_space_cannot_vouch,
  add constraint mycelium_space_cannot_vouch
    check (not (vouched = true and truster_space_id is not null));

alter table public.mycelium
  drop constraint if exists mycelium_no_self_weave,
  add constraint mycelium_no_self_weave
    check (not (target_type = 'space' and target_id = truster_space_id));

-- THE IDENTITY OF THE EDGE. The old PK (truster_id, target_type, target_id)
-- would let two admins of the same space weave the same target twice, and the
-- space's web would show it twice with no sane way to remove it. For a space
-- the edge belongs to the SPACE, so it's keyed that way and any admin can undo
-- it; personal edges keep exactly their old key. Nothing references the PK
-- (checked), so dropping it costs nothing.
alter table public.mycelium drop constraint if exists mycelium_pkey;

create unique index if not exists mycelium_space_edge_idx
  on public.mycelium (truster_space_id, target_type, target_id)
  where truster_space_id is not null;

create unique index if not exists mycelium_personal_edge_idx
  on public.mycelium (truster_id, target_type, target_id)
  where truster_space_id is null;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Every added arm is guarded on `truster_space_id is not null`, so personal
-- rows behave exactly as they did. Reads go through is_space_member and writes
-- through is_space_admin — both SECURITY DEFINER, so no policy on space_members
-- is consulted from inside a mycelium policy and there is no cycle to fall into
-- (the 42P17 lesson).
--
-- STARTING CLOSED: a space's web is readable by its MEMBERS, writable by its
-- ADMINS. Not public. Opening it to anyone who can see the space — the way
-- recommendations already work — is a one-line change to the read policy;
-- narrowing after something has been exposed is not.

drop policy if exists "mycelium: read own" on public.mycelium;
create policy "mycelium: read own" on public.mycelium
  for select
  using (
    truster_id = auth.uid()
    or (truster_space_id is not null
        and public.is_space_member(truster_space_id, auth.uid()))
  );

drop policy if exists "mycelium: add own" on public.mycelium;
create policy "mycelium: add own" on public.mycelium
  for insert to authenticated
  with check (
    truster_id = auth.uid()
    and (truster_space_id is null
         or public.is_space_admin(truster_space_id, auth.uid()))
  );

drop policy if exists "mycelium: update own" on public.mycelium;
create policy "mycelium: update own" on public.mycelium
  for update to authenticated
  using (
    truster_id = auth.uid()
    or (truster_space_id is not null
        and public.is_space_admin(truster_space_id, auth.uid()))
  )
  with check (
    truster_id = auth.uid()
    or (truster_space_id is not null
        and public.is_space_admin(truster_space_id, auth.uid()))
  );

drop policy if exists "mycelium: drop own" on public.mycelium;
create policy "mycelium: drop own" on public.mycelium
  for delete to authenticated
  using (
    truster_id = auth.uid()
    or (truster_space_id is not null
        and public.is_space_admin(truster_space_id, auth.uid()))
  );
