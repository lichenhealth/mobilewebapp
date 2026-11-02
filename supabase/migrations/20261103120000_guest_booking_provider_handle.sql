-- The cancelled/declined guest page needs a way FORWARD (founder 2026-11-02:
-- "let's have this say 'this booking has been cancelled' with a CTA to book
-- a different time/meeting type with Galyn, and take users to
-- lichen.health/book/galyn so they see the highest level link"):
-- guest_booking returns the provider's HANDLE now, so /b/<token> can offer
-- the top-level booking menu. Return-type change = DROP + recreate (the
-- one-PostgREST-candidate rule), grants restored exactly as before.

drop function if exists public.guest_booking(text);

create function public.guest_booking(p_token text)
 returns table(guest_name text, status text, on_date date, start_min integer, end_min integer, note text, type_title text, type_location text, duration_min integer, provider_name text, type_id uuid, capacity integer, meeting_url text, approval text, price_cents integer, paid_at timestamp with time zone, pay_choice text, payment_pending_at timestamp with time zone, pay_methods jsonb, provider_handle text)
 language sql
 stable security definer
 set search_path to 'public'
as $func$
  select b.guest_name, b.status, b.on_date, b.start_min, b.end_min, b.note,
         t.title, t.location, t.duration_min,
         coalesce(p.full_name, 'A Lichen member'),
         t.id, t.capacity,
         case when b.status = 'confirmed' then b.meeting_url end,
         t.approval, b.price_cents, b.paid_at,
         b.pay_choice, b.payment_pending_at,
         t.pay_methods,
         p.handle
  from public.bookings b
  join public.booking_types t on t.id = b.type_id
  join public.profiles p on p.id = b.provider_id
  where b.guest_token = p_token and b.guest_email is not null;
$func$;

revoke all on function public.guest_booking(text) from public;
grant execute on function public.guest_booking(text) to anon, authenticated;
