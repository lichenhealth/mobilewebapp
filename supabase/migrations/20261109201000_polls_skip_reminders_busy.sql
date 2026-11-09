-- Open time polls aren't booked yet: no day-before reminder, no busy block
-- on anyone's calendar until the time is decided (2026-11-09).

CREATE OR REPLACE FUNCTION public.tick_event_mail()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       and e.poll_status is distinct from 'open'
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
end $function$;

CREATE OR REPLACE FUNCTION public.free_busy(p_profiles uuid[], p_from date, p_to date)
 RETURNS TABLE(profile_id uuid, level text, start_date date, end_date date, all_day boolean, start_min smallint, end_min smallint, recurrence jsonb, title text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with lv as (
    select p as owner, public.calendar_level(p, auth.uid()) as level
    from unnest(p_profiles) as p
  ),
  owned as (
    select l.owner,
      case
        when l.owner = auth.uid() then l.level
        when e.share_level = 'hidden' then 'hidden'
        when (e.is_draft or e.share_level = 'busy') and l.level = 'details' then 'busy'
        else l.level
      end as level,
      e.start_date, e.end_date, e.all_day, e.start_min, e.end_min, e.recurrence, e.title, e.id
    from lv l join public.events e on e.owner_profile_id = l.owner
    where l.level <> 'hidden' and e.poll_status is distinct from 'open'
  ),
  attending as (
    select l.owner, l.level,
      e.start_date, e.end_date, e.all_day, e.start_min, e.end_min, e.recurrence, e.title, e.id
    from lv l
    join public.event_attendees a on a.profile_id = l.owner and a.status <> 'declined'
    join public.events e on e.id = a.event_id
    where l.level <> 'hidden' and e.poll_status is distinct from 'open'
  ),
  all_evts as (
    select distinct on (owner, id) * from (
      select * from owned union all select * from attending
    ) u
  )
  select owner, level, start_date, end_date, all_day, start_min, end_min, recurrence,
         case when level = 'details' then title else null end
  from all_evts
  where level <> 'hidden'
    and start_date <= p_to and (end_date >= p_from or recurrence is not null)
  union all
  select l.owner, lvx.level, b.on_date, b.on_date, b.all_day,
         b.start_min::smallint, b.end_min::smallint, null::jsonb,
         case when lvx.level = 'details' then b.title else null end
  from lv l
  join public.external_busy b on b.profile_id = l.owner
  join public.external_calendars c on c.id = b.calendar_id
  cross join lateral (
    select coalesce(
      public.external_calendar_level(c.id, l.owner, auth.uid()),
      case when l.level = 'hidden' then 'hidden' else 'busy' end
    ) as level
  ) lvx
  where lvx.level <> 'hidden'
    and b.on_date between p_from and p_to;
$function$;
