-- THE CALENDAR BRAIN IS AN ADMIN (founder 2026-11-02: "I want the calendar
-- brain to be like an admin, so can we build in that I approve a therapy
-- session via a chat with Ai, or I can do so manually via the bookings
-- button in cal? both work?"): the assistant answers a pending booking
-- request through the SAME transitions respond_booking makes — one row, one
-- truth, so the Bookings screen shows the chat-made answer instantly (the
-- shared-state rule).
--
-- WHY A WRAPPER: respond_booking rightly checks auth.uid(), and the
-- assistant edge function runs service-role (auth.uid() is null), so it can
-- never call it. This twin takes the provider EXPLICITLY — the edge
-- function passes the trigger row's sender, a server-side fact, never model
-- input — and execute is revoked from every client role: only the service
-- role can reach it.

create or replace function public.assistant_respond_booking(
  p_provider uuid, p_booking uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $func$
declare b record; t record;
begin
  select * into b from public.bookings where id = p_booking;
  if b is null or b.provider_id <> p_provider then
    raise exception 'Not yours to answer';
  end if;
  if b.status <> 'pending' then raise exception 'Already answered'; end if;
  select * into t from public.booking_types where id = b.type_id;
  if p_accept then
    update public.bookings set status = 'confirmed' where id = p_booking;
    perform public._booking_attach_event(p_booking);
    if b.booker_id is not null then
      perform public.notify(b.booker_id, 'calendar', null, 'booking',
        t.title || ' is confirmed',
        to_char(b.on_date, 'FMMon FMDD') || ' — it''s on your calendar.', '/bookings', p_provider);
    end if;
  else
    update public.bookings set status = 'declined' where id = p_booking;
    if b.booker_id is not null then
      perform public.notify(b.booker_id, 'calendar', null, 'booking',
        t.title || ' — this time didn''t work',
        'Pick another slot whenever you like.', '/bookings', p_provider);
    end if;
  end if;
end;
$func$;

revoke execute on function public.assistant_respond_booking(uuid, uuid, boolean) from public;
revoke execute on function public.assistant_respond_booking(uuid, uuid, boolean) from anon;
revoke execute on function public.assistant_respond_booking(uuid, uuid, boolean) from authenticated;
