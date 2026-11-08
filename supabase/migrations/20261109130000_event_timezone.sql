-- EVENT TIME ZONES (founder 2026-11-08: "we need a time zone picker for
-- events, that defaults to the time zone that the person specifies for their
-- calendar, but they can edit it"). An event's minutes stay wall-clock (the
-- standing doctrine); events.timezone names WHOSE wall clock. Null = the
-- creator's own zone (profiles.timezone), so every older event reads as before.

alter table public.events add column if not exists timezone text;
alter table public.events drop constraint if exists events_timezone_len;
alter table public.events add constraint events_timezone_len check (timezone is null or char_length(timezone) between 1 and 64);

-- The member's own calendar zone (profiles' SELECT is column-scoped).
create or replace function public.my_timezone()
returns text language sql stable security definer set search_path = public
as $f$ select nullif(timezone, '') from public.profiles where id = auth.uid(); $f$;
revoke all on function public.my_timezone() from public;
grant execute on function public.my_timezone() to authenticated;

drop function if exists public.guest_event(text);
create function public.guest_event(p_token text)
returns table(guest_name text, guest_status text, title text, description text, location text,
  start_date date, end_date date, all_day boolean, start_min smallint, end_min smallint,
  recurrence jsonb, host_name text, post_id uuid, photo_url text, invite jsonb,
  guest_plus_ones smallint, guest_meal text, guest_answers jsonb, event_tz text)
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
         x.plus_ones, x.meal, x.answers,
         coalesce(e.timezone, (select timezone from public.profiles where id = e.creator_id))
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
  post_id uuid, photo_url text, invite jsonb, event_tz text)
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
         case when jsonb_typeof(p.details->'invite') = 'object' then p.details->'invite' end,
         coalesce(e.timezone, (select timezone from public.profiles where id = e.creator_id))
  from public.events e
  left join lateral (
    select po.id, po.details, po.image_url
    from public.posts po where po.linked_event_id = e.id limit 1
  ) p on true
  where e.guest_link_token = p_link;
$f$;
revoke all on function public.open_event(text) from public;
grant execute on function public.open_event(text) to anon, authenticated;

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
           coalesce(nullif(e.timezone, ''), nullif(pr.timezone, ''), 'UTC') as tz
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
