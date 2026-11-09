-- TIME POLLS ON EVENTS (founder 2026-11-09: "invites that have a poll that
-- gives you multiple times and you select all the ones that work for you?
-- Then, the Ai on the platform chooses the time that works for the most
-- people… additional instructions… works for the most people + this
-- mandatory person, etc. Then it notifies guests of the final time chosen
-- once everyone has responded. Like Google doodles, but elegantly integrated
-- into the event flow" + "have a deadline feature that's optional and then
-- the choice to 'wait for all guests to reply' - and it should remind guests
-- who haven't replied automatically. final pick should either need your
-- confirm or auto book - you get to choose").
--
-- The event row carries its PROVISIONAL time (the first option) while the
-- poll is open, so every existing reader keeps working; free_busy and the
-- day-before reminder skip an open poll — nothing is booked until decided.

alter table public.events add column if not exists poll_status text;           -- null | 'open' | 'decided'
alter table public.events add column if not exists poll_deadline timestamptz;  -- optional
alter table public.events add column if not exists poll_wait_all boolean not null default false;
alter table public.events add column if not exists poll_auto boolean not null default false;  -- true = book the pick automatically
alter table public.events add column if not exists poll_rules text;            -- the host's own words
alter table public.events add column if not exists poll_suggested uuid;
alter table public.events add column if not exists poll_reason text;
alter table public.events add column if not exists poll_reminded_at timestamptz;
alter table public.events add column if not exists poll_asked_at timestamptz;  -- when the brain was last asked to pick
do $c$ begin
  alter table public.events add constraint events_poll_status_chk check (poll_status is null or poll_status in ('open','decided'));
exception when duplicate_object then null; end $c$;

create table if not exists public.event_time_options (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  start_date date not null,
  all_day boolean not null default false,
  start_min smallint, end_min smallint,
  position smallint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists event_time_options_event on public.event_time_options(event_id, position);
alter table public.event_time_options enable row level security;
drop policy if exists "time options: readers" on public.event_time_options;
create policy "time options: readers" on public.event_time_options for select to authenticated
  using (public.can_read_event(event_id, auth.uid()) or public.is_event_host(event_id, auth.uid()));
drop policy if exists "time options: hosts write" on public.event_time_options;
create policy "time options: hosts write" on public.event_time_options for all to authenticated
  using (public.is_event_host(event_id, auth.uid())) with check (public.is_event_host(event_id, auth.uid()));

create table if not exists public.event_time_votes (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references public.event_time_options(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  guest_id uuid references public.event_guests(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint event_time_votes_one_voter check ((profile_id is null) <> (guest_id is null))
);
create unique index if not exists event_time_votes_member on public.event_time_votes(option_id, profile_id) where profile_id is not null;
create unique index if not exists event_time_votes_guest on public.event_time_votes(option_id, guest_id) where guest_id is not null;
create index if not exists event_time_votes_event on public.event_time_votes(event_id);
alter table public.event_time_votes enable row level security;
-- Hosts see every vote (names included); a member sees their own. Writes ride the RPCs.
drop policy if exists "time votes: host or own" on public.event_time_votes;
create policy "time votes: host or own" on public.event_time_votes for select to authenticated
  using (profile_id = auth.uid() or public.is_event_host(event_id, auth.uid()));

-- Has this person answered the poll? (an empty selection still counts as an
-- answer — "none of these work" — recorded as a voted marker on the row.)
alter table public.event_attendees add column if not exists poll_voted_at timestamptz;
alter table public.event_guests add column if not exists poll_voted_at timestamptz;

-- A member's vote: replace their selection wholesale.
create or replace function public.member_poll_vote(p_event uuid, p_options uuid[])
returns void language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sign in to vote.'; end if;
  if not exists (select 1 from public.events where id = p_event and poll_status = 'open') then
    raise exception 'This time poll is closed.'; end if;
  if not (public.is_event_attendee(p_event, v_uid) or public.is_event_host(p_event, v_uid)) then
    raise exception 'Only invited guests can vote on the time.'; end if;
  delete from public.event_time_votes where event_id = p_event and profile_id = v_uid;
  insert into public.event_time_votes(option_id, event_id, profile_id)
    select o.id, p_event, v_uid from public.event_time_options o
     where o.event_id = p_event and o.id = any(coalesce(p_options, '{}'));
  update public.event_attendees set poll_voted_at = now() where event_id = p_event and profile_id = v_uid;
end $f$;
revoke all on function public.member_poll_vote(uuid, uuid[]) from public, anon;
grant execute on function public.member_poll_vote(uuid, uuid[]) to authenticated;

-- A guest's poll (from their invitation token): the options + their picks.
create or replace function public.guest_poll(p_token text)
returns table(option_id uuid, start_date date, all_day boolean, start_min smallint, end_min smallint, picked boolean, poll_status text, poll_deadline timestamptz, voted boolean)
language sql stable security definer set search_path to 'public' as $f$
  select o.id, o.start_date, o.all_day, o.start_min, o.end_min,
         exists (select 1 from public.event_time_votes v where v.option_id = o.id and v.guest_id = g.id),
         e.poll_status, e.poll_deadline, g.poll_voted_at is not null
    from public.event_guests g
    join public.events e on e.id = g.event_id
    join public.event_time_options o on o.event_id = e.id
   where g.token = p_token and g.status <> 'requested' and e.poll_status is not null
   order by o.position, o.start_date, o.start_min;
$f$;
revoke all on function public.guest_poll(text) from public;
grant execute on function public.guest_poll(text) to anon, authenticated;

create or replace function public.guest_poll_vote(p_token text, p_options uuid[])
returns void language plpgsql security definer set search_path to 'public' as $f$
declare g record;
begin
  select gg.id, gg.event_id into g from public.event_guests gg
    join public.events e on e.id = gg.event_id
   where gg.token = p_token and gg.status <> 'requested' and e.poll_status = 'open';
  if g.id is null then raise exception 'This time poll is closed.'; end if;
  delete from public.event_time_votes where guest_id = g.id;
  insert into public.event_time_votes(option_id, event_id, guest_id)
    select o.id, g.event_id, g.id from public.event_time_options o
     where o.event_id = g.event_id and o.id = any(coalesce(p_options, '{}'));
  update public.event_guests set poll_voted_at = now() where id = g.id;
end $f$;
revoke all on function public.guest_poll_vote(text, uuid[]) from public;
grant execute on function public.guest_poll_vote(text, uuid[]) to anon, authenticated;

-- THE DECISION: moves the event to the chosen option, closes the poll and
-- tells everyone (members by bell; emailed guests by mail). Host-only for
-- clients; the auto-book path calls _poll_decide as the service role.
create or replace function public._poll_decide(p_event uuid, p_option uuid)
returns void language plpgsql security definer set search_path to 'public' as $f$
declare o record; e record; v_post uuid; v_secret text; r record; v_when text;
begin
  select * into o from public.event_time_options where id = p_option and event_id = p_event;
  if o.id is null then raise exception 'That time isn''t one of this event''s options.'; end if;
  select * into e from public.events where id = p_event;
  if e.poll_status is distinct from 'open' then raise exception 'This time poll is already decided.'; end if;
  update public.events set start_date = o.start_date, end_date = o.start_date, all_day = o.all_day,
         start_min = case when o.all_day then null else o.start_min end,
         end_min = case when o.all_day then null else o.end_min end,
         poll_status = 'decided', poll_suggested = p_option
   where id = p_event;
  select id into v_post from public.posts where linked_event_id = p_event limit 1;
  v_when := to_char(o.start_date, 'FMDay, FMMon FMDD') ||
    case when o.all_day or o.start_min is null then '' else ' at ' || to_char(o.start_date::timestamp + make_interval(mins => o.start_min), 'FMHH12:MIam') end;
  for r in select a.profile_id from public.event_attendees a where a.event_id = p_event and a.status <> 'declined' and a.profile_id <> e.creator_id loop
    perform public.notify(r.profile_id, 'calendar', null, 'event_time_decided',
      e.title || ' — the time is set', v_when || '.',
      case when v_post is not null then '/events/' || v_post else '/calendar' end, null);
  end loop;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_hook_secret';
  for r in select g.id from public.event_guests g where g.event_id = p_event and g.email is not null and g.status in ('invited','going','tentative') loop
    begin
      perform net.http_post(
        url := 'https://mjqnaevertyzgjlpwynr.supabase.co/functions/v1/event-mail',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', coalesce(v_secret, '')),
        body := jsonb_build_object('kind', 'decided', 'guest_id', r.id));
    exception when others then null; end;
  end loop;
end $f$;
revoke all on function public._poll_decide(uuid, uuid) from public, anon, authenticated;

create or replace function public.poll_decide(p_event uuid, p_option uuid)
returns void language plpgsql security definer set search_path to 'public' as $f$
begin
  if not public.is_event_host(p_event, auth.uid()) then raise exception 'Only the host can set the time.'; end if;
  perform public._poll_decide(p_event, p_option);
end $f$;
revoke all on function public.poll_decide(uuid, uuid) from public, anon;
grant execute on function public.poll_decide(uuid, uuid) to authenticated;

-- Who still owes an answer, for the tick and the host's view.
create or replace function public._poll_pending(p_event uuid)
returns integer language sql stable security definer set search_path to 'public' as $f$
  select (select count(*) from public.event_attendees a join public.events e on e.id = a.event_id
           where a.event_id = p_event and a.status <> 'declined' and a.poll_voted_at is null and a.profile_id <> e.creator_id)::int
       + (select count(*) from public.event_guests g
           where g.event_id = p_event and g.status in ('invited','going','tentative') and g.poll_voted_at is null)::int;
$f$;

-- THE TICK (every 15 min): reminds non-voters once (a day before the
-- deadline, or two days in when there's none), and when the poll is ready —
-- deadline passed, or everyone answered with wait-for-all on (or anyone has
-- answered by the deadline) — asks the event-poll function to choose.
create or replace function public.tick_event_polls()
returns void language plpgsql security definer set search_path to 'public' as $f$
declare r record; v_secret text; v_post uuid; v_pending int; v_ready boolean; r2 record;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_hook_secret';
  for r in select * from public.events where poll_status = 'open' limit 100 loop
    begin
      v_pending := public._poll_pending(r.id);
      -- Reminders.
      if r.poll_reminded_at is null and v_pending > 0 and (
           (r.poll_deadline is not null and now() >= r.poll_deadline - interval '24 hours' and now() < r.poll_deadline)
        or (r.poll_deadline is null and now() >= r.created_at + interval '48 hours')) then
        update public.events set poll_reminded_at = now() where id = r.id;
        select id into v_post from public.posts where linked_event_id = r.id limit 1;
        for r2 in select a.profile_id from public.event_attendees a
                   where a.event_id = r.id and a.status <> 'declined' and a.poll_voted_at is null and a.profile_id <> r.creator_id loop
          perform public.notify(r2.profile_id, 'calendar', null, 'event_poll_reminder',
            'Which times work for ' || r.title || '?', 'Pick every time you can make it.',
            case when v_post is not null then '/events/' || v_post else '/calendar' end, null);
        end loop;
        for r2 in select g.id from public.event_guests g
                   where g.event_id = r.id and g.status in ('invited','going','tentative') and g.email is not null and g.poll_voted_at is null loop
          perform net.http_post(
            url := 'https://mjqnaevertyzgjlpwynr.supabase.co/functions/v1/event-mail',
            headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', coalesce(v_secret, '')),
            body := jsonb_build_object('kind', 'poll_reminder', 'guest_id', r2.id));
        end loop;
      end if;
      -- Ready to choose?
      v_ready := (r.poll_deadline is not null and now() >= r.poll_deadline)
              or (r.poll_wait_all and v_pending = 0 and exists (select 1 from public.event_time_votes v where v.event_id = r.id));
      if v_ready and (r.poll_asked_at is null or r.poll_asked_at < now() - interval '6 hours') then
        update public.events set poll_asked_at = now() where id = r.id;
        perform net.http_post(
          url := 'https://mjqnaevertyzgjlpwynr.supabase.co/functions/v1/event-poll',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', coalesce(v_secret, '')),
          body := jsonb_build_object('event_id', r.id));
      end if;
    exception when others then null;
    end;
  end loop;
end $f$;
revoke all on function public.tick_event_polls() from public, anon, authenticated;
do $c$ begin perform cron.unschedule('tick-event-polls'); exception when others then null; end $c$;
select cron.schedule('tick-event-polls', '*/15 * * * *', 'select public.tick_event_polls()');
grant execute on function public._poll_decide(uuid, uuid) to service_role;
