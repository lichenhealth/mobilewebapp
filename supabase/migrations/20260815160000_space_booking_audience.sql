-- SPACE-SCOPED BOOKING AUDIENCES (founder 2026-08-14: "there's a use case
-- for organizations, places, spaces, group specific booking options").
-- A session type can now be offered to the members of ONE space the
-- provider belongs to — office hours for your community, tack-room time for
-- the barn's members. One new audience value + one column; every read path
-- already routes through booking_type_visible() and the visible policy, so
-- the gate lives in exactly two places.
--
-- Also repairs an omission from the public-link migration: the SELECT
-- policy never learned 'public', so public types were invisible to
-- signed-in members browsing sessions.

alter table public.booking_types
  drop constraint if exists booking_types_audience_check,
  add constraint booking_types_audience_check
    check (audience = any (array['everyone'::text, 'mycelium'::text, 'public'::text, 'space'::text]));

alter table public.booking_types
  add column audience_space_id uuid references public.spaces(id) on delete set null;

alter table public.booking_types
  add constraint booking_types_space_audience_check
    check (audience <> 'space' or audience_space_id is not null);

comment on column public.booking_types.audience_space_id is
  'When audience=''space'': only members of this space may see and book the session.';

create or replace function public.booking_type_visible(p_type uuid, p_viewer uuid)
returns boolean language sql stable security definer set search_path to 'public' as $func$
  select exists (select 1 from public.booking_types t
    where t.id = p_type and t.active and (
      t.profile_id = p_viewer
      or t.audience in ('everyone', 'public')
      or (t.audience = 'mycelium' and exists (
        select 1 from public.mycelium m
        where m.truster_id = t.profile_id and m.target_type = 'profile' and m.target_id = p_viewer))
      or (t.audience = 'space' and t.audience_space_id is not null
          and public.is_space_member(t.audience_space_id, p_viewer))));
$func$;

drop policy if exists "booking_types visible" on public.booking_types;
create policy "booking_types visible" on public.booking_types
  for select to authenticated
  using (active and (
    audience in ('everyone', 'public')
    or (audience = 'mycelium' and exists (
      select 1 from public.mycelium m
      where m.truster_id = booking_types.profile_id
        and m.target_type = 'profile' and m.target_id = auth.uid()))
    or (audience = 'space' and audience_space_id is not null
        and public.is_space_member(audience_space_id, auth.uid()))));
