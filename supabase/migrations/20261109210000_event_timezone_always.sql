-- TIMES ALWAYS SAY THEIR ZONE (founder 2026-11-09: "times should always have
-- a time zone on events and cal items and bookings"). An event saved without
-- a zone takes its creator's calendar zone at insert, and every existing
-- zoneless event is backfilled the same way — so every surface that prints
-- an event time can print its zone.
create or replace function public.event_default_timezone()
returns trigger language plpgsql security definer set search_path to 'public' as $f$
begin
  if new.timezone is null or new.timezone = '' then
    select nullif(timezone, '') into new.timezone from public.profiles where id = new.creator_id;
  end if;
  return new;
end $f$;
drop trigger if exists events_default_timezone on public.events;
create trigger events_default_timezone before insert on public.events
  for each row execute function public.event_default_timezone();

update public.events e set timezone = p.timezone
  from public.profiles p
 where p.id = e.creator_id and (e.timezone is null or e.timezone = '') and nullif(p.timezone, '') is not null;
