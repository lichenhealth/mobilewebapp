-- THE EVENT HOST SUITE (founder 2026-11-08, "build all of them in that
-- order!" — the Paperless Post audit's remaining gaps): RSVP extras
-- (plus-ones, a meal choice, custom questions), host messages to every
-- guest, scheduled send + automatic reminders, opened tracking per guest,
-- and co-hosts. The RSVP FORM itself is design data on the door-post
-- (posts.details.invite.form — {plusOnes, meals[], questions[], remind}),
-- read here only to validate answers.

-- ── CO-HOSTS ────────────────────────────────────────────────────────────
create table if not exists public.event_cohosts (
  event_id uuid not null references public.events(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (event_id, profile_id)
);
alter table public.event_cohosts enable row level security;

-- The ONE host test: the creator or a co-host. SECURITY DEFINER so policies
-- on event_cohosts and event_guests can both lean on it without a cycle.
create or replace function public.is_event_host(p_event uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public
as $f$
  select p_uid is not null and (
    exists (select 1 from public.events where id = p_event and creator_id = p_uid)
    or exists (select 1 from public.event_cohosts where event_id = p_event and profile_id = p_uid));
$f$;
revoke all on function public.is_event_host(uuid, uuid) from public;
grant execute on function public.is_event_host(uuid, uuid) to authenticated;

drop policy if exists "cohosts read" on public.event_cohosts;
create policy "cohosts read" on public.event_cohosts for select to authenticated
  using (profile_id = auth.uid() or public.is_event_host(event_id, auth.uid()));
drop policy if exists "cohosts add" on public.event_cohosts;
create policy "cohosts add" on public.event_cohosts for insert to authenticated
  with check (added_by = auth.uid() and profile_id <> auth.uid()
    and exists (select 1 from public.events e where e.id = event_id and e.creator_id = auth.uid()));
drop policy if exists "cohosts remove" on public.event_cohosts;
create policy "cohosts remove" on public.event_cohosts for delete to authenticated
  using (profile_id = auth.uid()
    or exists (select 1 from public.events e where e.id = event_id and e.creator_id = auth.uid()));

create or replace function public.on_event_cohost_added()
returns trigger language plpgsql security definer set search_path = public
as $f$
declare v_title text; v_post uuid;
begin
  select e.title into v_title from public.events e where e.id = new.event_id;
  select id into v_post from public.posts where linked_event_id = new.event_id limit 1;
  perform public.notify(new.profile_id, 'calendar', null, 'event_cohost',
    'You’re co-hosting ' || coalesce(v_title, 'an event'),
    'You can invite guests, answer requests, message everyone and see their replies.',
    case when v_post is not null then '/events/' || v_post else '/calendar' end, new.added_by);
  return new;
end $f$;
drop trigger if exists event_cohost_added on public.event_cohosts;
create trigger event_cohost_added after insert on public.event_cohosts
  for each row execute function public.on_event_cohost_added();

-- Guests: co-hosts manage the list too. Recreated with the one host test
-- (the creator's rows are unchanged — the creator IS a host).
drop policy if exists event_guests_host on public.event_guests;
create policy event_guests_host on public.event_guests for all to authenticated
  using (invited_by = auth.uid() or public.is_event_host(event_id, auth.uid()))
  with check (public.is_event_host(event_id, auth.uid()));

-- ── GUEST ROW STATE: scheduled send, mail stamps, open tracking ─────────
alter table public.event_guests
  add column if not exists send_at timestamptz,
  add column if not exists emailed_at timestamptz,
  add column if not exists reminded_at timestamptz,
  add column if not exists opened_at timestamptz,
  add column if not exists last_opened_at timestamptz,
  add column if not exists responded_at timestamptz;
alter table public.event_attendees add column if not exists reminded_at timestamptz;

-- ── RSVP EXTRAS ─────────────────────────────────────────────────────────
-- Their own table (not event_attendees columns): attendee rows are readable
-- by anyone who can read the event, and a guest's answers are for the hosts.
create table if not exists public.event_rsvp_extras (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  guest_id uuid references public.event_guests(id) on delete cascade,
  plus_ones smallint not null default 0,
  meal text,
  answers jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint rsvp_extras_one_party check ((profile_id is null) <> (guest_id is null)),
  constraint rsvp_extras_plus check (plus_ones between 0 and 20),
  constraint rsvp_extras_meal check (meal is null or char_length(meal) <= 80),
  constraint rsvp_extras_answers check (jsonb_typeof(answers) = 'array')
);
create unique index if not exists rsvp_extras_member on public.event_rsvp_extras(event_id, profile_id) where profile_id is not null;
create unique index if not exists rsvp_extras_guest on public.event_rsvp_extras(guest_id) where guest_id is not null;
alter table public.event_rsvp_extras enable row level security;
drop policy if exists "rsvp extras read" on public.event_rsvp_extras;
create policy "rsvp extras read" on public.event_rsvp_extras for select to authenticated
  using (profile_id = auth.uid() or public.is_event_host(event_id, auth.uid()));
drop policy if exists "rsvp extras own" on public.event_rsvp_extras;
create policy "rsvp extras own" on public.event_rsvp_extras for insert to authenticated
  with check (profile_id = auth.uid() and guest_id is null);
drop policy if exists "rsvp extras own update" on public.event_rsvp_extras;
create policy "rsvp extras own update" on public.event_rsvp_extras for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid() and guest_id is null);
drop policy if exists "rsvp extras own delete" on public.event_rsvp_extras;
create policy "rsvp extras own delete" on public.event_rsvp_extras for delete to authenticated
  using (profile_id = auth.uid());

create or replace function public._rsvp_form(p_event uuid)
returns jsonb language sql stable security definer set search_path = public
as $f$
  select coalesce(
    (select case when jsonb_typeof(p.details->'invite'->'form') = 'object'
                 then p.details->'invite'->'form' end
     from public.posts p where p.linked_event_id = p_event limit 1), '{}'::jsonb);
$f$;
revoke all on function public._rsvp_form(uuid) from public, anon, authenticated;

-- Answers are held to the host's own form, whichever door wrote them.
create or replace function public.enforce_rsvp_extras()
returns trigger language plpgsql security definer set search_path = public
as $f$
declare v_form jsonb; v_max int; v_q jsonb; v_out jsonb := '[]'::jsonb; v_a jsonb; i int := 0;
begin
  v_form := public._rsvp_form(new.event_id);
  v_max := least(20, greatest(0, coalesce(nullif(v_form->>'plusOnes', '')::int, 0)));
  if new.plus_ones > v_max then
    raise exception 'This invitation allows up to % extra guest%.', v_max, case when v_max = 1 then '' else 's' end;
  end if;
  if new.meal is not null then
    new.meal := nullif(btrim(new.meal), '');
    if new.meal is not null and not (coalesce(v_form->'meals', '[]'::jsonb) ? new.meal) then
      raise exception 'Pick one of the meal choices the host offered.';
    end if;
  end if;
  -- Keep only answers to questions the host actually asked, trimmed.
  v_q := coalesce(v_form->'questions', '[]'::jsonb);
  for v_a in select * from jsonb_array_elements(coalesce(new.answers, '[]'::jsonb)) loop
    exit when i >= 5;
    if jsonb_typeof(v_a) = 'object' and v_q ? (v_a->>'q') then
      v_out := v_out || jsonb_build_array(jsonb_build_object('q', v_a->>'q', 'a', left(btrim(coalesce(v_a->>'a', '')), 500)));
      i := i + 1;
    end if;
  end loop;
  new.answers := v_out;
  new.updated_at := now();
  return new;
end $f$;
drop trigger if exists rsvp_extras_enforce on public.event_rsvp_extras;
create trigger rsvp_extras_enforce before insert or update on public.event_rsvp_extras
  for each row execute function public.enforce_rsvp_extras();

-- guest_rsvp grows the extras (optional — a bare RSVP stays a bare RSVP).
drop function if exists public.guest_rsvp(text, text);
create function public.guest_rsvp(p_token text, p_status text,
  p_plus_ones int default null, p_meal text default null, p_answers jsonb default null)
returns void language plpgsql security definer set search_path = public
as $f$
declare g record;
begin
  if p_status not in ('going', 'tentative', 'declined') then return; end if;
  select id, event_id, status into g from public.event_guests where token = p_token;
  if g.id is null then raise exception 'This invitation link isn’t valid.'; end if;
  if g.status = 'requested' then
    raise exception 'This request is still with the host — you''ll be able to RSVP once they say yes.';
  end if;
  update public.event_guests set status = p_status, responded_at = now() where id = g.id;
  if p_status = 'declined' then
    delete from public.event_rsvp_extras where guest_id = g.id;
  elsif p_plus_ones is not null or p_meal is not null or p_answers is not null then
    insert into public.event_rsvp_extras (event_id, guest_id, plus_ones, meal, answers)
    values (g.event_id, g.id, coalesce(p_plus_ones, 0), p_meal, coalesce(p_answers, '[]'::jsonb))
    on conflict (guest_id) where guest_id is not null do update
      set plus_ones = excluded.plus_ones, meal = excluded.meal, answers = excluded.answers;
  end if;
end $f$;
revoke all on function public.guest_rsvp(text, text, int, text, jsonb) from public;
grant execute on function public.guest_rsvp(text, text, int, text, jsonb) to anon, authenticated;

-- OPENED TRACKING: the guest page says it was opened (the honest signal —
-- no email pixels). First open + latest open.
create or replace function public.mark_guest_opened(p_token text)
returns void language sql security definer set search_path = public
as $f$
  update public.event_guests
     set opened_at = coalesce(opened_at, now()), last_opened_at = now()
   where token = p_token and (last_opened_at is null or last_opened_at < now() - interval '1 minute');
$f$;
revoke all on function public.mark_guest_opened(text) from public;
grant execute on function public.mark_guest_opened(text) to anon, authenticated;

-- ── HOST MESSAGES ───────────────────────────────────────────────────────
create table if not exists public.event_messages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  emailed int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists event_messages_event on public.event_messages(event_id, created_at desc);
alter table public.event_messages enable row level security;
drop policy if exists "event messages read" on public.event_messages;
create policy "event messages read" on public.event_messages for select to authenticated
  using (public.is_event_host(event_id, auth.uid()) or public.is_event_attendee(event_id, auth.uid()));
drop policy if exists "event messages write" on public.event_messages;
create policy "event messages write" on public.event_messages for insert to authenticated
  with check (author_id = auth.uid() and public.is_event_host(event_id, auth.uid()));
drop policy if exists "event messages delete" on public.event_messages;
create policy "event messages delete" on public.event_messages for delete to authenticated
  using (author_id = auth.uid());

-- Member attendees (going / maybe / invited) hear it as a bell; emailed
-- guests get it by mail from the edge fn; phone guests read it on their page.
create or replace function public.on_event_message()
returns trigger language plpgsql security definer set search_path = public
as $f$
declare v_title text; v_post uuid; r record;
begin
  select e.title into v_title from public.events e where e.id = new.event_id;
  select id into v_post from public.posts where linked_event_id = new.event_id limit 1;
  for r in
    select profile_id from public.event_attendees
     where event_id = new.event_id and status in ('going', 'tentative', 'invited')
       and profile_id <> new.author_id
    union
    select e.creator_id from public.events e where e.id = new.event_id and e.creator_id <> new.author_id
    union
    select profile_id from public.event_cohosts where event_id = new.event_id and profile_id <> new.author_id
  loop
    perform public.notify(r.profile_id, 'calendar', null, 'event_message',
      'From the host · ' || coalesce(v_title, 'your event'), left(new.body, 160),
      case when v_post is not null then '/events/' || v_post else '/calendar' end, new.author_id);
  end loop;
  return new;
end $f$;
drop trigger if exists event_message_bells on public.event_messages;
create trigger event_message_bells after insert on public.event_messages
  for each row execute function public.on_event_message();

-- A guest reads the host's messages by their own token.
create or replace function public.guest_event_messages(p_token text)
returns table(body text, author_name text, created_at timestamptz)
language sql stable security definer set search_path = public
as $f$
  select m.body, coalesce(pr.full_name, 'The host'), m.created_at
  from public.event_guests g
  join public.event_messages m on m.event_id = g.event_id
  left join public.profiles pr on pr.id = m.author_id
  where g.token = p_token and g.status <> 'requested'
  order by m.created_at desc limit 20;
$f$;
revoke all on function public.guest_event_messages(text) from public;
grant execute on function public.guest_event_messages(text) to anon, authenticated;

-- ── THE GUEST PAGE READS: co-hosts in the host line, the guest's answers ─
create or replace function public._event_host_line(p_event uuid)
returns text language sql stable security definer set search_path = public
as $f$
  select coalesce(sp.name, pr.full_name, 'A member')
         || coalesce((select ' & ' || string_agg(c.full_name, ' & ' order by ch.created_at)
                      from public.event_cohosts ch join public.profiles c on c.id = ch.profile_id
                      where ch.event_id = e.id), '')
  from public.events e
  left join public.profiles pr on pr.id = e.owner_profile_id
  left join public.spaces sp on sp.id = e.owner_space_id
  where e.id = p_event;
$f$;
revoke all on function public._event_host_line(uuid) from public, anon, authenticated;

drop function if exists public.guest_event(text);
create function public.guest_event(p_token text)
returns table(guest_name text, guest_status text, title text, description text, location text,
  start_date date, end_date date, all_day boolean, start_min smallint, end_min smallint,
  recurrence jsonb, host_name text, post_id uuid, photo_url text, invite jsonb,
  guest_plus_ones smallint, guest_meal text, guest_answers jsonb)
language sql stable security definer set search_path = public
as $f$
  select g.name, g.status, e.title, e.description, e.location,
         e.start_date, e.end_date, e.all_day, e.start_min, e.end_min, e.recurrence,
         public._event_host_line(e.id),
         p.id,
         coalesce(
           (select m->>'url'
            from jsonb_array_elements(
              case when jsonb_typeof(p.details->'media') = 'array'
                   then p.details->'media' else '[]'::jsonb end) m
            where m->>'type' = 'photo' limit 1),
           p.image_url),
         case when jsonb_typeof(p.details->'invite') = 'object' then p.details->'invite' end,
         x.plus_ones, x.meal, x.answers
  from public.event_guests g
  join public.events e on e.id = g.event_id
  left join lateral (
    select po.id, po.details, po.image_url
    from public.posts po where po.linked_event_id = e.id limit 1
  ) p on true
  left join public.event_rsvp_extras x on x.guest_id = g.id
  where g.token = p_token;
$f$;
revoke all on function public.guest_event(text) from public;
grant execute on function public.guest_event(text) to anon, authenticated;

drop function if exists public.open_event(text);
create function public.open_event(p_link text)
returns table(title text, description text, location text, start_date date, end_date date,
  all_day boolean, start_min smallint, end_min smallint, recurrence jsonb, host_name text,
  post_id uuid, photo_url text, invite jsonb)
language sql stable security definer set search_path = public
as $f$
  select e.title, e.description, e.location,
         e.start_date, e.end_date, e.all_day, e.start_min, e.end_min, e.recurrence,
         public._event_host_line(e.id),
         p.id,
         coalesce(
           (select m->>'url'
            from jsonb_array_elements(
              case when jsonb_typeof(p.details->'media') = 'array'
                   then p.details->'media' else '[]'::jsonb end) m
            where m->>'type' = 'photo' limit 1),
           p.image_url),
         case when jsonb_typeof(p.details->'invite') = 'object' then p.details->'invite' end
  from public.events e
  left join lateral (
    select po.id, po.details, po.image_url
    from public.posts po where po.linked_event_id = e.id limit 1
  ) p on true
  where e.guest_link_token = p_link;
$f$;
revoke all on function public.open_event(text) from public;
grant execute on function public.open_event(text) to anon, authenticated;

-- mint_event_link: co-hosts may mint/rotate too.
create or replace function public.mint_event_link(p_event uuid, p_rotate boolean default false)
returns text language plpgsql security definer set search_path = public
as $f$
declare v_tok text;
begin
  if not public.is_event_host(p_event, auth.uid()) then
    raise exception 'Only the event''s hosts can make its shareable link.';
  end if;
  select guest_link_token into v_tok from public.events where id = p_event;
  if v_tok is null or p_rotate then
    v_tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    update public.events set guest_link_token = v_tok where id = p_event;
  end if;
  return v_tok;
end $f$;

-- ── SCHEDULED SEND + AUTOMATIC REMINDERS ────────────────────────────────
-- Every 5 minutes: invitations whose time has come go out, and guests who
-- said going/maybe get one reminder inside the last 24 hours (the host's
-- form can switch reminders off: form.remind = false). Members hear the
-- reminder as a bell. Recurring events are skipped (one reminder can't
-- honestly speak for a series).
create or replace function public.tick_event_mail()
returns void language plpgsql security definer set search_path = public
as $f$
declare r record; r2 record; v_secret text; v_now timestamp; v_start timestamp; v_post uuid;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_hook_secret';

  for r in
    select id from public.event_guests
     where send_at is not null and send_at <= now() and emailed_at is null
       and email is not null and status in ('invited', 'going', 'tentative')
     limit 50
  loop
    begin
      update public.event_guests set emailed_at = now() where id = r.id;   -- claim first: never twice
      perform net.http_post(
        url := 'https://mjqnaevertyzgjlpwynr.supabase.co/functions/v1/event-mail',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', coalesce(v_secret, '')),
        body := jsonb_build_object('kind', 'invite', 'guest_id', r.id));
    exception when others then null;
    end;
  end loop;

  for r in
    select e.id, e.title, e.start_date, e.start_min, e.all_day,
           coalesce(nullif(pr.timezone, ''), 'UTC') as tz
      from public.events e
      join public.profiles pr on pr.id = e.creator_id
     where e.recurrence is null
       and e.start_date between current_date - 1 and current_date + 2
       and coalesce(public._rsvp_form(e.id)->>'remind', 'true') <> 'false'
  loop
    begin
      begin v_now := now() at time zone r.tz; exception when others then v_now := now() at time zone 'UTC'; end;
      v_start := r.start_date::timestamp + make_interval(mins => coalesce(r.start_min, 9 * 60));
      if v_start > v_now and v_start <= v_now + interval '24 hours' then
        select id into v_post from public.posts where linked_event_id = r.id limit 1;
        for r2 in select a.profile_id from public.event_attendees a
                   where a.event_id = r.id and a.status in ('going', 'tentative') and a.reminded_at is null
        loop
          update public.event_attendees set reminded_at = now() where event_id = r.id and profile_id = r2.profile_id;
          perform public.notify(r2.profile_id, 'calendar', null, 'event_reminder',
            'Coming up: ' || r.title,
            case when r.all_day or r.start_min is null then to_char(v_start, 'FMDay') || '.'
                 else to_char(v_start, 'FMDay') || ' at ' || to_char(v_start, 'FMHH12:MIam') || '.' end,
            case when v_post is not null then '/events/' || v_post else '/calendar' end, null);
        end loop;
        for r2 in select g.id from public.event_guests g
                   where g.event_id = r.id and g.status in ('going', 'tentative')
                     and g.email is not null and g.reminded_at is null
                     and g.created_at < now() - interval '1 hour'
        loop
          update public.event_guests set reminded_at = now() where id = r2.id;
          perform net.http_post(
            url := 'https://mjqnaevertyzgjlpwynr.supabase.co/functions/v1/event-mail',
            headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', coalesce(v_secret, '')),
            body := jsonb_build_object('kind', 'reminder', 'guest_id', r2.id));
        end loop;
      end if;
    exception when others then null;
    end;
  end loop;
end $f$;
revoke all on function public.tick_event_mail() from public, anon, authenticated;

select cron.unschedule('tick-event-mail') where exists (select 1 from cron.job where jobname = 'tick-event-mail');
select cron.schedule('tick-event-mail', '*/5 * * * *', $c$select public.tick_event_mail()$c$);
