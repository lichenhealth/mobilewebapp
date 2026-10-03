-- VANITY BOOKING LINKS (founder 2026-10-03: "vanity URL's for calendars for
-- everyone, like calendly. You can decide what the vanity URL will be for
-- each event type and then send that to people").
--   lichen.health/book/<handle>/<link-name> → that one session type.
-- booking_types.slug is the link name: lowercase kebab, unique PER MEMBER
-- (two members can both have /care-coordination under their own handles).
-- Guests resolve through public_booking_page (slug rides the types json;
-- public types only — a vanity link handed to the open web is a public
-- door by nature); a SIGNED-IN member resolves any audience they may see
-- via resolve_booking_vanity, which leans on booking_type_visible.

alter table public.booking_types
  add column if not exists slug text;

alter table public.booking_types
  drop constraint if exists booking_types_slug_shape,
  add constraint booking_types_slug_shape
    check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{0,47}$');

create unique index if not exists booking_types_slug_per_profile
  on public.booking_types (profile_id, slug) where slug is not null;

-- The one resolver: handle + link name → type id, honoring visibility.
-- Anonymous callers resolve only PUBLIC types; a signed-in member resolves
-- whatever booking_type_visible lets them see (everyone/mycelium/space too).
create or replace function public.resolve_booking_vanity(p_handle text, p_slug text)
returns uuid
language sql
stable security definer
set search_path to 'public'
as $func$
  select t.id
  from public.booking_types t
  join public.profiles p on p.id = t.profile_id
  where lower(p.handle) = lower(p_handle)
    and t.slug = lower(p_slug)
    and t.active
    and case when auth.uid() is null
             then t.audience = 'public'
             else public.booking_type_visible(t.id, auth.uid()) end
  limit 1;
$func$;

-- public_booking_page: the types json carries slug now (the guest page
-- locks onto the linked type without a second request).
create or replace function public.public_booking_page(p_handle text)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $func$
  select jsonb_build_object(
    'provider', jsonb_build_object(
      'id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url,
      'headline', p.headline, 'timezone', p.timezone),
    'types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'description', t.description,
        'duration_min', t.duration_min, 'buffer_min', t.buffer_min,
        'price', t.price, 'location', t.location, 'approval', t.approval,
        'slug', t.slug)
        order by t.created_at)
      from public.booking_types t
      where t.profile_id = p.id and t.active and t.audience = 'public'), '[]'::jsonb))
  from public.profiles p
  where lower(p.handle) = lower(p_handle)
    and exists (select 1 from public.booking_types t
                where t.profile_id = p.id and t.active and t.audience = 'public');
$func$;
