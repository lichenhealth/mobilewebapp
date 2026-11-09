-- Booking times are the PROVIDER's wall clock; both parties may see which
-- zone that is (2026-11-09: "times should always have a time zone"). Only
-- the caller's own bookings, provider or booker — never anyone else's zone.
create or replace function public.my_booking_zones()
returns table(booking_id uuid, tz text)
language sql stable security definer set search_path to 'public' as $f$
  select b.id, nullif(p.timezone, '')
    from public.bookings b join public.profiles p on p.id = b.provider_id
   where b.provider_id = auth.uid() or b.booker_id = auth.uid();
$f$;
revoke all on function public.my_booking_zones() from public, anon;
grant execute on function public.my_booking_zones() to authenticated;
