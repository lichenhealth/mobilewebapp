-- A GUEST TYPING A MEMBER'S EMAIL IS ASKED TO SIGN IN (founder 2026-11-02,
-- after Gabe booked her Lichen Curious session logged out: "Can it be smart
-- enough to see if someone is booking from an email that is a registered
-- Lichen user and ask them to sign in? But still deliver them to the
-- booking page?"): the public booking page checks the typed email and, on a
-- hit, offers the sign-in door that parks the pick and returns (the
-- lichen.bookResume round trip). Booking as a guest stays one tap away —
-- the nudge never blocks.
--
-- The check is against AUTH emails (the login identity — the only honest
-- "this email can sign in"), boolean only, never a name or id.
-- ⚠ HONESTY NOTE: any anon-callable yes/no on an email is a membership
-- oracle — someone could probe whether an address is on Lichen. Accepted
-- deliberately for the booking UX (flagged to the founder in the ship
-- report); it reveals membership only, nothing else.

create or replace function public.email_is_member(p_email text)
returns boolean
language sql
security definer
set search_path to 'public'
stable
as $func$
  select btrim(coalesce(p_email, '')) ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  and exists (
    select 1 from auth.users
    where lower(email) = lower(btrim(p_email))
      and deleted_at is null
  );
$func$;

grant execute on function public.email_is_member(text) to anon, authenticated;
