-- YOUR LICHEN CALENDAR, IN GOOGLE (founder 2026-11-02: "I want to see my
-- Lichen cal on my google cal as well as seeing my google cal on my lichen
-- cal (already) - how do I do that?"): the OUTBOUND half of calendar sync —
-- the mirror of the secret-URL ICS import. Each member may mint ONE private
-- feed token; the calendar-feed edge function serves their events as a
-- standing ICS feed Google/Apple/Outlook subscribe to ("From URL").
--
-- The token is the whole authorization (the guest_token pattern): anyone
-- holding the link reads the member's calendar, so the UI says to keep it
-- private and Rotate mints a fresh token, killing the old link.
--
-- The feed carries EVENTS ONLY (owned + going/tentative RSVPs): confirmed
-- bookings already live as provider-owned events with the booker seated as
-- an attendee (_booking_attach_event), so events cover sessions for both
-- sides with no double-count. Reminders/tasks and the care plan stay out of
-- v1 deliberately — raise before widening what leaves the platform.

create table public.calendar_feeds (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  token text not null unique
    default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

alter table public.calendar_feeds enable row level security;
create policy "calendar feed: owner" on public.calendar_feeds
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Mint-or-read the caller's token; p_rotate replaces it (the old link dies).
create function public.my_calendar_feed(p_rotate boolean default false)
returns text
language plpgsql security definer set search_path to 'public'
as $func$
declare v text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if p_rotate then
    update public.calendar_feeds
       set token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
           rotated_at = now()
     where profile_id = auth.uid()
     returning token into v;
  else
    select token into v from public.calendar_feeds where profile_id = auth.uid();
  end if;
  if v is null then
    insert into public.calendar_feeds (profile_id) values (auth.uid())
    on conflict (profile_id) do update set profile_id = excluded.profile_id
    returning token into v;
  end if;
  return v;
end;
$func$;

revoke execute on function public.my_calendar_feed(boolean) from public, anon;
grant execute on function public.my_calendar_feed(boolean) to authenticated;
