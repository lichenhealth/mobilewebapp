-- BOOK WITH A PHONE NUMBER (founder 2026-11-09: "let's let people book with
-- their phone number, too - esp if I give people a link and they use their
-- phones not email for coordination"). A guest gives an email OR a phone.
-- No SMS provider (standing doctrine): a phone booker manages the booking
-- from the /b/ page they land on, and the provider sees the number on
-- /bookings to text them from their own phone. Email guests keep every mail.
alter table public.bookings add column if not exists guest_phone text;
alter table public.bookings drop constraint if exists bookings_some_booker_check;
alter table public.bookings add constraint bookings_some_booker_check
  check (booker_id is not null or (guest_name is not null and (guest_email is not null or guest_phone is not null)));

-- The guest's own doors key on a guest row, not on its having an email.
do $mig$
declare r record; v text;
begin
  for r in select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('guest_cancel_booking', 'guest_reschedule_booking', 'set_booking_pay_choice', 'guest_booking') loop
    v := pg_get_functiondef(r.oid);
    v := replace(v, 'guest_email is not null', 'guest_name is not null');
    execute v;
  end loop;
end $mig$;
