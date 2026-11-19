-- BILL RIGHT AFTER THE SESSION (founder 2026-11-19: she keeps Ivy Pay for
-- billing — cheaper, HIPAA-covered — and wants to be "more disciplined about
-- doing it right after session"). A session type can carry a reminder: when
-- a confirmed booking of it ENDS, the provider gets one bell (push rides the
-- bell) naming who to bill and for how long. Lichen never charges anyone and
-- holds no billing detail — it only taps her on the shoulder.

alter table public.booking_types add column if not exists bill_reminder boolean not null default false;
alter table public.bookings add column if not exists bill_nudged_at timestamptz;

create or replace function public.tick_bill_reminders() returns void
language plpgsql security definer set search_path = public as $f$
declare r record; v_now timestamp; v_end timestamp; v_who text; v_len int;
begin
  for r in
    select b.id, b.on_date, b.start_min, b.end_min, b.provider_id, b.booker_id, b.guest_name,
           t.title, coalesce(nullif(p.timezone, ''), 'UTC') as tz
      from public.bookings b
      join public.booking_types t on t.id = b.type_id
      join public.profiles p on p.id = b.provider_id
     where t.bill_reminder and b.status = 'confirmed' and b.bill_nudged_at is null
       and b.on_date between current_date - 1 and current_date + 1
  loop
    begin
      begin v_now := now() at time zone r.tz; exception when others then v_now := now() at time zone 'UTC'; end;
      v_end := r.on_date::timestamp + make_interval(mins => r.end_min);
      -- Fire once the session has ended; a session that ended hours ago
      -- (the cron was down) is too late to be a nudge — mark it and stay quiet.
      if v_end <= v_now then
        update public.bookings set bill_nudged_at = now() where id = r.id;
        if v_end > v_now - interval '3 hours' then
          select coalesce(nullif(full_name, ''), 'your client') into v_who from public.profiles where id = r.booker_id;
          v_who := coalesce(v_who, nullif(btrim(r.guest_name), ''), 'your client');
          v_len := r.end_min - r.start_min;
          perform public.notify(r.provider_id, 'calendar', null, 'booking',
            'Bill ' || v_who || ' now',
            r.title || ' ended at ' || lower(to_char(v_end, 'FMHH12:MIam')) || ' · ' || v_len || ' min booked.',
            '/bookings?b=' || r.id, null);
        end if;
      end if;
    exception when others then null;  -- one bad row never stalls the rest
    end;
  end loop;
end $f$;
revoke execute on function public.tick_bill_reminders() from public, anon, authenticated;

select cron.schedule('tick-bill-reminders', '*/5 * * * *', 'select public.tick_bill_reminders()');

-- Her therapy sessions are billed by hand through Ivy Pay — switch the reminder on for them.
update public.booking_types t set bill_reminder = true
  from public.profiles p where p.id = t.profile_id and p.handle = 'galyn' and t.title = 'Therapy session';
