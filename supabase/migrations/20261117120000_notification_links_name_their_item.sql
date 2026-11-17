-- WHERE A BELL LANDS (founder 2026-11-17: "it should scroll to the unread message that the notification is indicating - audit the entire platform").
-- Bells now name their item: a chat message (?m=), a booking (?b=), an event (/events/<post> or /calendar?d=&e=).
-- Bodies are the live definitions with only the link expression changed.

-- assistant_respond_booking: 2 link(s)
CREATE OR REPLACE FUNCTION public.assistant_respond_booking(p_provider uuid, p_booking uuid, p_accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        to_char(b.on_date, 'FMMon FMDD') || ' — it''s on your calendar.', '/bookings?b=' || b.id, p_provider);
    end if;
  else
    update public.bookings set status = 'declined' where id = p_booking;
    if b.booker_id is not null then
      perform public.notify(b.booker_id, 'calendar', null, 'booking',
        t.title || ' — this time didn''t work',
        'Pick another slot whenever you like.', '/bookings?b=' || b.id, p_provider);
    end if;
  end if;
end;
$function$;

-- cancel_booking: 1 link(s)
CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b record; t record; v_other uuid; v_name text;
begin
  select * into b from public.bookings where id = p_booking;
  if b is null or (auth.uid() is distinct from b.provider_id
                   and auth.uid() is distinct from b.booker_id) then
    raise exception 'Not yours to cancel';
  end if;
  if b.status in ('cancelled', 'declined') then return; end if;
  select * into t from public.booking_types where id = b.type_id;
  perform public._booking_detach_event(p_booking);
  update public.bookings set status = 'cancelled' where id = p_booking;
  v_other := case when auth.uid() = b.provider_id then b.booker_id else b.provider_id end;
  if v_other is not null then
    select full_name into v_name from public.profiles where id = auth.uid();
    perform public.notify(v_other, 'calendar', null, 'booking',
      t.title || ' on ' || to_char(b.on_date, 'FMMon FMDD') || ' was cancelled',
      'Cancelled by ' || coalesce(v_name, 'the other member') || '.', '/bookings?b=' || b.id, auth.uid());
  end if;
end;
$function$;

-- create_booking: 2 link(s)
CREATE OR REPLACE FUNCTION public.create_booking(p_type uuid, p_date date, p_start integer, p_note text DEFAULT ''::text, p_answers jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t record; v_end integer; v_id uuid;
        v_booker_name text; v_seats int;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.booking_type_visible(p_type, auth.uid()) then
    raise exception 'This session isn''t open to you';
  end if;
  select * into t from public.booking_types where id = p_type;
  if t.profile_id = auth.uid() then raise exception 'That''s your own session type'; end if;
  v_end := p_start + t.duration_min;
  if v_end > 1440 then raise exception 'Slot runs past midnight'; end if;
  if p_date < current_date then raise exception 'That day has passed'; end if;
  if p_answers is not null and jsonb_typeof(p_answers) <> 'array' then p_answers := null; end if;
  if p_answers is not null and pg_column_size(p_answers) > 16384 then
    raise exception 'Answers are too long';
  end if;

  -- Inside a declared availability window? (weekday 0=Mon … 6=Sun)
  if not public._booking_in_hours(p_type, p_date, p_start, v_end) then
    raise exception 'That time isn''t offered';
  end if;
  if not public._booking_conditions_ok(p_type, p_date, p_start, v_end) then
    raise exception 'That time isn''t open for this session — pick another';
  end if;

  -- Group seats: the same type at the same slot isn't a conflict until full.
  if t.capacity > 1 then
    select count(*) into v_seats from public.bookings b
     where b.type_id = p_type and b.on_date = p_date and b.start_min = p_start
       and b.status in ('pending', 'confirmed');
    if v_seats >= t.capacity then
      raise exception 'This session is full — pick another time';
    end if;
    if exists (select 1 from public.bookings b
       where b.type_id = p_type and b.on_date = p_date and b.start_min = p_start
         and b.status in ('pending', 'confirmed') and b.booker_id = auth.uid()) then
      raise exception 'You''re already in this session';
    end if;
  end if;

  -- Conflicts: held bookings + non-recurring events + imported busy.
  -- (Recurring-event conflicts are filtered by the slot picker; request-mode
  -- approval is the human backstop.) Group seatmates and the group's own
  -- shared event are excluded — they ARE this slot.
  if exists (
    select 1 from public.bookings b
    where b.provider_id = t.profile_id and b.on_date = p_date
      and b.status in ('pending', 'confirmed')
      and b.start_min < v_end + t.buffer_min and b.end_min + t.buffer_min > p_start
      and not (t.capacity > 1 and b.type_id = p_type and b.start_min = p_start)
  ) or exists (
    select 1 from public.events e
    where (not e.is_draft or e.draft_blocks) and e.owner_profile_id = t.profile_id and e.recurrence is null
      and p_date between e.start_date and e.end_date
      and (e.all_day or (coalesce(e.start_min, 0) < v_end + t.buffer_min
                         and coalesce(e.end_min, 1440) + t.buffer_min > p_start))
      and not (t.capacity > 1 and exists (
        select 1 from public.bookings lb
        where lb.event_id = e.id and lb.type_id = p_type))
  ) or exists (
    select 1 from public.external_busy x
    where x.profile_id = t.profile_id and x.on_date = p_date
      and (x.all_day or (coalesce(x.start_min, 0) < v_end + t.buffer_min
                         and coalesce(x.end_min, 1440) + t.buffer_min > p_start))
  ) then
    raise exception 'That slot was just taken — pick another';
  end if;

  insert into public.bookings (type_id, provider_id, booker_id, on_date, start_min, end_min, status, note, answers)
  values (p_type, t.profile_id, auth.uid(), p_date, p_start, v_end,
          case when t.approval = 'instant' then 'confirmed' else 'pending' end,
          coalesce(p_note, ''), p_answers)
  returning id into v_id;

  select full_name into v_booker_name from public.profiles where id = auth.uid();

  if t.approval = 'instant' then
    perform public._booking_attach_event(v_id);
    perform public.notify(t.profile_id, 'calendar', null, 'booking',
      coalesce(v_booker_name, 'A member') || ' booked ' || t.title,
      to_char(p_date, 'FMMon FMDD') || ' — it''s on your calendar.', '/bookings?b=' || v_id, auth.uid());
  else
    perform public.notify(t.profile_id, 'calendar', null, 'booking',
      coalesce(v_booker_name, 'A member') || ' requested ' || t.title,
      to_char(p_date, 'FMMon FMDD') || ' — accept or decline in Bookings.', '/bookings?b=' || v_id, auth.uid());
  end if;
  return v_id;
end;
$function$;

-- guest_cancel_booking: 1 link(s)
CREATE OR REPLACE FUNCTION public.guest_cancel_booking(p_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b record; t record;
begin
  select * into b from public.bookings where guest_token = p_token and guest_name is not null;
  if b is null then return; end if;
  if b.status in ('cancelled', 'declined') then return; end if;
  select * into t from public.booking_types where id = b.type_id;
  perform public._booking_detach_event(b.id);
  update public.bookings set status = 'cancelled' where id = b.id;
  perform public.notify(b.provider_id, 'calendar', null, 'booking',
    t.title || ' on ' || to_char(b.on_date, 'FMMon FMDD') || ' was cancelled',
    'Cancelled by ' || coalesce(b.guest_name, 'the guest') || ' (outside Lichen).', '/bookings?b=' || b.id, null);
end;
$function$;

-- guest_create_booking: 2 link(s)
CREATE OR REPLACE FUNCTION public.guest_create_booking(p_type uuid, p_date date, p_start integer, p_name text, p_email text, p_note text DEFAULT ''::text, p_answers jsonb DEFAULT NULL::jsonb, p_phone text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_email text := nullif(lower(btrim(coalesce(p_email, ''))), ''); v_phone text := nullif(btrim(coalesce(p_phone, '')), ''); t record; v_end integer; v_id uuid; v_token text;
        v_seats int;
begin
  select * into t from public.booking_types where id = p_type and active and audience = 'public';
  if t is null then raise exception 'This session isn''t open to the public'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'Your name, please'; end if;
  if v_email is not null and v_email !~ '^\S+@\S+\.\S+$' then
    raise exception 'That email doesn''t look complete';
  end if;
  if v_phone is not null and (length(regexp_replace(v_phone, '\D', '', 'g')) < 7 or v_phone ~ '[A-Za-z]') then
    raise exception 'That phone number doesn''t look complete';
  end if;
  if v_email is null and v_phone is null then
    raise exception 'An email or a phone number, so the host can reach you';
  end if;
  v_end := p_start + t.duration_min;
  if v_end > 1440 then raise exception 'Slot runs past midnight'; end if;
  if p_date < current_date then raise exception 'That day has passed'; end if;
  if p_answers is not null and jsonb_typeof(p_answers) <> 'array' then p_answers := null; end if;
  if p_answers is not null and pg_column_size(p_answers) > 16384 then
    raise exception 'Answers are too long';
  end if;

  if not public._booking_in_hours(p_type, p_date, p_start, v_end) then
    raise exception 'That time isn''t offered';
  end if;
  if not public._booking_conditions_ok(p_type, p_date, p_start, v_end) then
    raise exception 'That time isn''t open for this session — pick another';
  end if;

  if t.capacity > 1 then
    select count(*) into v_seats from public.bookings b
     where b.type_id = p_type and b.on_date = p_date and b.start_min = p_start
       and b.status in ('pending', 'confirmed');
    if v_seats >= t.capacity then
      raise exception 'This session is full — pick another time';
    end if;
    if exists (select 1 from public.bookings b
       where b.type_id = p_type and b.on_date = p_date and b.start_min = p_start
         and b.status in ('pending', 'confirmed')
         and ((v_email is not null and b.guest_email = v_email) or (v_phone is not null and regexp_replace(b.guest_phone, '\D', '', 'g') = regexp_replace(v_phone, '\D', '', 'g')))) then
      raise exception 'You''re already in this session';
    end if;
  end if;

  if exists (
    select 1 from public.bookings b
    where b.provider_id = t.profile_id and b.on_date = p_date
      and b.status in ('pending', 'confirmed')
      and b.start_min < v_end + t.buffer_min and b.end_min + t.buffer_min > p_start
      and not (t.capacity > 1 and b.type_id = p_type and b.start_min = p_start)
  ) or exists (
    select 1 from public.events e
    where (not e.is_draft or e.draft_blocks) and e.owner_profile_id = t.profile_id and e.recurrence is null
      and p_date between e.start_date and e.end_date
      and (e.all_day or (coalesce(e.start_min, 0) < v_end + t.buffer_min
                         and coalesce(e.end_min, 1440) + t.buffer_min > p_start))
      and not (t.capacity > 1 and exists (
        select 1 from public.bookings lb
        where lb.event_id = e.id and lb.type_id = p_type))
  ) or exists (
    select 1 from public.external_busy x
    where x.profile_id = t.profile_id and x.on_date = p_date
      and (x.all_day or (coalesce(x.start_min, 0) < v_end + t.buffer_min
                         and coalesce(x.end_min, 1440) + t.buffer_min > p_start))
  ) then
    raise exception 'That slot was just taken — pick another';
  end if;

  insert into public.bookings (type_id, provider_id, booker_id, on_date, start_min, end_min,
                               status, note, answers, guest_name, guest_email, guest_phone)
  values (p_type, t.profile_id, null, p_date, p_start, v_end,
          case when t.approval = 'instant' then 'confirmed' else 'pending' end,
          coalesce(p_note, ''), p_answers, btrim(p_name), v_email, v_phone)
  returning id, guest_token into v_id, v_token;

  if t.approval = 'instant' then
    perform public._booking_attach_event(v_id);
    perform public.notify(t.profile_id, 'calendar', null, 'booking',
      btrim(p_name) || ' booked ' || t.title || ' (from outside Lichen)',
      to_char(p_date, 'FMMon FMDD') || ' — it''s on your calendar.', '/bookings?b=' || v_id, null);
  else
    perform public.notify(t.profile_id, 'calendar', null, 'booking',
      btrim(p_name) || ' requested ' || t.title || ' (from outside Lichen)',
      to_char(p_date, 'FMMon FMDD') || ' — accept or decline in Bookings.', '/bookings?b=' || v_id, null);
  end if;
  return v_token;
end;
$function$;

-- guest_reschedule_booking: 1 link(s)
CREATE OR REPLACE FUNCTION public.guest_reschedule_booking(p_token text, p_date date, p_start integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b record; t record; v_end integer;
        v_when text; v_seats int;
begin
  select * into b from public.bookings where guest_token = p_token and guest_name is not null;
  if b is null then raise exception 'This booking link isn''t valid'; end if;
  if b.status not in ('pending', 'confirmed') then
    raise exception 'This booking isn''t live any more';
  end if;
  select * into t from public.booking_types where id = b.type_id;
  v_end := p_start + t.duration_min;
  if v_end > 1440 then raise exception 'Slot runs past midnight'; end if;
  if p_date < current_date then raise exception 'That day has passed'; end if;

  if not public._booking_in_hours(b.type_id, p_date, p_start, v_end) then
    raise exception 'That time isn''t offered';
  end if;
  if not public._booking_conditions_ok(b.type_id, p_date, p_start, v_end) then
    raise exception 'That time isn''t open for this session — pick another';
  end if;

  if t.capacity > 1 then
    select count(*) into v_seats from public.bookings x
     where x.type_id = b.type_id and x.on_date = p_date and x.start_min = p_start
       and x.status in ('pending', 'confirmed') and x.id <> b.id;
    if v_seats >= t.capacity then
      raise exception 'This session is full at that time';
    end if;
  end if;

  if exists (
    select 1 from public.bookings x
    where x.provider_id = b.provider_id and x.on_date = p_date
      and x.status in ('pending', 'confirmed') and x.id <> b.id
      and x.start_min < v_end + t.buffer_min and x.end_min + t.buffer_min > p_start
      and not (t.capacity > 1 and x.type_id = b.type_id and x.start_min = p_start)
  ) or exists (
    select 1 from public.events e
    where (not e.is_draft or e.draft_blocks) and e.owner_profile_id = b.provider_id and e.recurrence is null
      and e.id is distinct from b.event_id
      and p_date between e.start_date and e.end_date
      and (e.all_day or (coalesce(e.start_min, 0) < v_end + t.buffer_min
                         and coalesce(e.end_min, 1440) + t.buffer_min > p_start))
      and not (t.capacity > 1 and exists (
        select 1 from public.bookings lb
        where lb.event_id = e.id and lb.type_id = b.type_id))
  ) or exists (
    select 1 from public.external_busy x
    where x.profile_id = b.provider_id and x.on_date = p_date
      and (x.all_day or (coalesce(x.start_min, 0) < v_end + t.buffer_min
                         and coalesce(x.end_min, 1440) + t.buffer_min > p_start))
  ) then
    raise exception 'That slot was just taken — pick another';
  end if;

  perform public._booking_detach_event(b.id);
  update public.bookings
     set on_date = p_date, start_min = p_start, end_min = v_end,
         reminded_at = null
   where id = b.id;
  if b.status = 'confirmed' then
    perform public._booking_attach_event(b.id);
  end if;

  v_when := to_char(p_date, 'FMMon FMDD') || ' · '
         || to_char(p_date::timestamp + make_interval(mins => p_start), 'FMHH12:MIam');
  perform public.notify(b.provider_id, 'calendar', null, 'booking',
    t.title || ' moved to ' || v_when,
    'Rescheduled by ' || coalesce(b.guest_name, 'the guest') || ' (outside Lichen).', '/bookings?b=' || b.id, null);
end;
$function$;

-- record_booking_payment: 1 link(s)
CREATE OR REPLACE FUNCTION public.record_booking_payment(p_booking uuid, p_session text, p_amount_cents integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b record; t record; v_pay uuid; v_ledger uuid; v_amt numeric; v_amt_txt text;
        v_payer text; v_pref text; v_burn uuid; v_admin record;
begin
  if p_booking is null or p_session is null or coalesce(p_amount_cents, 0) <= 0 then
    raise exception 'Bad payment.';
  end if;
  select * into b from public.bookings where id = p_booking;
  if b is null then raise exception 'No such booking.'; end if;
  select * into t from public.booking_types where id = b.type_id;

  insert into public.booking_payments (booking_id, amount_cents, stripe_session_id)
  values (p_booking, p_amount_cents, p_session)
  on conflict (stripe_session_id) do nothing
  returning id into v_pay;
  if v_pay is null then
    select ledger_entry_id into v_ledger from public.booking_payments where stripe_session_id = p_session;
    return v_ledger;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('profile:' || b.provider_id::text, 42));

  v_amt := round(p_amount_cents / 100.0, 2);
  insert into public.ledger_entries (from_type, from_id, to_type, to_id, amount, context, memo, ref_type, ref_id)
  values (null, null, 'profile', b.provider_id, v_amt, 'booking',
          'Session payment — ' || coalesce(t.title, 'a session'), 'booking', p_booking)
  returning id into v_ledger;
  update public.booking_payments set ledger_entry_id = v_ledger where id = v_pay;

  update public.bookings
     set paid_at = coalesce(paid_at, now()),
         stripe_session_id = coalesce(stripe_session_id, p_session),
         payment_pending_at = null
   where id = p_booking;

  v_amt_txt := trim(trailing '.' from trim(trailing '0' from to_char(v_amt, 'FM999999990.00')));
  select coalesce((select full_name from public.profiles where id = b.booker_id), b.guest_name, 'Someone')
    into v_payer;

  if b.status in ('cancelled', 'declined') then
    perform public.notify(b.provider_id, 'currentcy', null, 'currentcy',
      v_payer || ' paid $' || v_amt_txt || ' for a cancelled booking',
      'Arrange their refund — the payment is recorded on ' || coalesce(t.title, 'the session') || '.',
      '/bookings?b=' || b.id, null);
    return v_ledger;
  end if;

  select payout_pref into v_pref from public.profiles where id = b.provider_id;
  if v_pref = 'auto_cashout' then
    insert into public.ledger_entries (from_type, from_id, to_type, to_id, amount, context, memo, ref_type, ref_id)
    values ('profile', b.provider_id, null, null, v_amt, 'cashout',
            'Auto cash-out — session payment', 'booking', p_booking)
    returning id into v_burn;
    insert into public.payout_requests (profile_id, amount, source, burn_ledger_id)
    values (b.provider_id, v_amt, 'auto', v_burn);
    perform public.notify(b.provider_id, 'currentcy', null, 'currentcy',
      v_payer || ' paid $' || v_amt_txt || ' for ' || coalesce(t.title, 'your session'),
      'Queued for cash-out, as you chose — the dollars are on their way.', '/currentcy', null);
    for v_admin in select pr.id from public.profiles pr where pr.is_admin and pr.id <> b.provider_id loop
      perform public.notify(v_admin.id, 'currentcy', null, 'currentcy',
        'Cash-out to pay: $' || v_amt_txt,
        'A session payment queued for auto cash-out — the Payouts desk has it.',
        '/admin/supporters#payouts', null);
    end loop;
  else
    perform public.notify(b.provider_id, 'currentcy', null, 'currentcy',
      v_payer || ' paid $' || v_amt_txt || ' for ' || coalesce(t.title, 'your session'),
      v_amt_txt || ' Current is in your wallet — cash it out any time.', '/currentcy', null);
  end if;
  return v_ledger;
end $function$;

-- reschedule_booking: 1 link(s)
CREATE OR REPLACE FUNCTION public.reschedule_booking(p_booking uuid, p_date date, p_start integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b record; t record; v_end integer;
        v_name text; v_other uuid; v_when text; v_seats int;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into b from public.bookings where id = p_booking;
  if b is null or (auth.uid() is distinct from b.provider_id
                   and auth.uid() is distinct from b.booker_id) then
    raise exception 'Not yours to move';
  end if;
  if b.status not in ('pending', 'confirmed') then
    raise exception 'This booking isn''t live any more';
  end if;
  select * into t from public.booking_types where id = b.type_id;
  v_end := p_start + t.duration_min;
  if v_end > 1440 then raise exception 'Slot runs past midnight'; end if;
  if p_date < current_date then raise exception 'That day has passed'; end if;

  if not public._booking_in_hours(b.type_id, p_date, p_start, v_end) then
    raise exception 'That time isn''t offered';
  end if;
  if not public._booking_conditions_ok(b.type_id, p_date, p_start, v_end) then
    raise exception 'That time isn''t open for this session — pick another';
  end if;

  if t.capacity > 1 then
    select count(*) into v_seats from public.bookings x
     where x.type_id = b.type_id and x.on_date = p_date and x.start_min = p_start
       and x.status in ('pending', 'confirmed') and x.id <> b.id;
    if v_seats >= t.capacity then
      raise exception 'This session is full at that time';
    end if;
  end if;

  if exists (
    select 1 from public.bookings x
    where x.provider_id = b.provider_id and x.on_date = p_date
      and x.status in ('pending', 'confirmed') and x.id <> b.id
      and x.start_min < v_end + t.buffer_min and x.end_min + t.buffer_min > p_start
      and not (t.capacity > 1 and x.type_id = b.type_id and x.start_min = p_start)
  ) or exists (
    select 1 from public.events e
    where (not e.is_draft or e.draft_blocks) and e.owner_profile_id = b.provider_id and e.recurrence is null
      and e.id is distinct from b.event_id
      and p_date between e.start_date and e.end_date
      and (e.all_day or (coalesce(e.start_min, 0) < v_end + t.buffer_min
                         and coalesce(e.end_min, 1440) + t.buffer_min > p_start))
      and not (t.capacity > 1 and exists (
        select 1 from public.bookings lb
        where lb.event_id = e.id and lb.type_id = b.type_id))
  ) or exists (
    select 1 from public.external_busy x
    where x.profile_id = b.provider_id and x.on_date = p_date
      and (x.all_day or (coalesce(x.start_min, 0) < v_end + t.buffer_min
                         and coalesce(x.end_min, 1440) + t.buffer_min > p_start))
  ) then
    raise exception 'That slot was just taken — pick another';
  end if;

  perform public._booking_detach_event(p_booking);
  update public.bookings
     set on_date = p_date, start_min = p_start, end_min = v_end,
         reminded_at = null   -- a moved session earns a fresh reminder
   where id = p_booking;      -- notice/window/cap trigger re-checks here
  if b.status = 'confirmed' then
    perform public._booking_attach_event(p_booking);
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  v_when := to_char(p_date, 'FMMon FMDD') || ' · '
         || to_char(p_date::timestamp + make_interval(mins => p_start), 'FMHH12:MIam');
  v_other := case when auth.uid() = b.provider_id then b.booker_id else b.provider_id end;
  if v_other is not null then
    perform public.notify(v_other, 'calendar', null, 'booking',
      t.title || ' moved to ' || v_when,
      'Rescheduled by ' || coalesce(v_name, 'the other member') || '.', '/bookings?b=' || b.id, auth.uid());
  end if;

  return case when auth.uid() = b.provider_id and b.booker_id is null
              then b.guest_token else null end;
end;
$function$;

-- respond_booking: 2 link(s)
CREATE OR REPLACE FUNCTION public.respond_booking(p_booking uuid, p_accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b record; t record;
begin
  select * into b from public.bookings where id = p_booking;
  if b is null or b.provider_id <> auth.uid() then raise exception 'Not yours to answer'; end if;
  if b.status <> 'pending' then raise exception 'Already answered'; end if;
  select * into t from public.booking_types where id = b.type_id;
  if p_accept then
    update public.bookings set status = 'confirmed' where id = p_booking;
    perform public._booking_attach_event(p_booking);
    if b.booker_id is not null then
      perform public.notify(b.booker_id, 'calendar', null, 'booking',
        t.title || ' is confirmed',
        to_char(b.on_date, 'FMMon FMDD') || ' — it''s on your calendar.', '/bookings?b=' || b.id, auth.uid());
    end if;
  else
    update public.bookings set status = 'declined' where id = p_booking;
    if b.booker_id is not null then
      perform public.notify(b.booker_id, 'calendar', null, 'booking',
        t.title || ' — this time didn''t work',
        'Pick another slot whenever you like.', '/bookings?b=' || b.id, auth.uid());
    end if;
  end if;
end;
$function$;

-- tick_booking_reminders: 2 link(s)
CREATE OR REPLACE FUNCTION public.tick_booking_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; v_now timestamp; v_slot timestamp; v_secret text; v_when text;
begin
  for r in
    select b.id, b.on_date, b.start_min, b.provider_id, b.booker_id,
           b.guest_token, b.created_at, t.title,
           coalesce(nullif(p.timezone, ''), 'UTC') as tz
    from public.bookings b
    join public.booking_types t on t.id = b.type_id
    join public.profiles p on p.id = b.provider_id
    where b.status = 'confirmed' and b.reminded_at is null
      and b.on_date between current_date - 1 and current_date + 2
  loop
    begin
      begin
        v_now := now() at time zone r.tz;
      exception when others then
        v_now := now() at time zone 'UTC';
      end;
      v_slot := r.on_date::timestamp + make_interval(mins => r.start_min);
      if v_slot > v_now and v_slot <= v_now + interval '24 hours'
         and r.created_at < now() - interval '1 hour' then
        update public.bookings set reminded_at = now() where id = r.id;
        v_when := to_char(v_slot, 'FMDay') || ' at ' || to_char(v_slot, 'FMHH12:MIam');
        perform public.notify(r.provider_id, 'calendar', null, 'booking',
          'Coming up: ' || r.title, v_when || '.', '/bookings?b=' || r.id, null);
        if r.booker_id is not null then
          perform public.notify(r.booker_id, 'calendar', null, 'booking',
            'Coming up: ' || r.title, v_when || '.', '/bookings?b=' || r.id, null);
        elsif r.guest_token is not null then
          begin
            select decrypted_secret into v_secret
              from vault.decrypted_secrets where name = 'push_hook_secret';
            perform net.http_post(
              url := 'https://mjqnaevertyzgjlpwynr.supabase.co/functions/v1/send-booking-mail',
              headers := jsonb_build_object('Content-Type', 'application/json',
                                            'x-webhook-secret', coalesce(v_secret, '')),
              body := jsonb_build_object('token', r.guest_token, 'kind', 'reminder'));
          exception when others then
            null;  -- a mail hiccup must never block the sweep
          end;
        end if;
      end if;
    exception when others then
      null;  -- one bad row never stalls the rest
    end;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.on_message_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_kind text; v_name text; v_space text; v_party uuid; v_patient uuid;
begin
  select c.kind, s.name, c.party_space_id, c.patient_id
    into v_kind, v_space, v_party, v_patient
    from public.chats c left join public.spaces s on s.id = c.party_space_id
   where c.id = new.chat_id;
  if v_kind not in ('direct', 'care_team', 'help', 'space_dm', 'suggestion') then return new; end if;
  select coalesce(nullif(full_name, ''), email, 'A member')
    into v_name from public.profiles where id = new.sender_id;
  insert into public.notifications (recipient_id, section, space_id, type, title, body, link, actor_id)
  select m.profile_id, 'chat', v_party, 'dm_message',
         case when v_kind in ('space_dm', 'suggestion') and v_space is not null
              then v_name || ' · ' || v_space
              else v_name end,
         left(coalesce(new.body, 'Sent an attachment'), 140),
         '/chat/' || new.chat_id || '?m=' || new.id, new.sender_id
  from public.chat_members m
  where m.chat_id = new.chat_id and m.profile_id <> new.sender_id
    and (v_kind <> 'care_team'
         or m.profile_id = v_patient
         or m.profile_id = any(coalesce(new.mentions, '{}')));
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.on_event_invite_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_name text; v_title text; v_creator uuid; v_post uuid; v_date date; v_link text;
begin
  select coalesce(nullif(full_name, ''), email, 'A member')
    into v_name from public.profiles where id = new.invited_by;
  select title, creator_id, start_date into v_title, v_creator, v_date from public.events where id = new.event_id;
  select id into v_post from public.posts where linked_event_id = new.event_id limit 1;
  v_link := case when v_post is not null then '/events/' || v_post else '/calendar?d=' || coalesce(v_date::text, '') || '&e=' || new.event_id end;
  if new.invited_by = new.profile_id then
    -- self-RSVP (Book on an event post) → tell the host
    perform public.notify(v_creator, 'calendar', null, 'event_rsvp',
      v_name, 'is going: ' || coalesce(v_title, 'your event'), v_link, new.profile_id);
  else
    -- classic invite → tell the invitee
    perform public.notify(new.profile_id, 'calendar', null, 'event_invite',
      v_name, 'invited you: ' || coalesce(v_title, 'an event'), v_link, new.invited_by);
  end if;
  return new;
end; $function$;

CREATE OR REPLACE FUNCTION public.on_event_rsvp_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_name text; v_title text; v_creator uuid; v_post uuid; v_date date; v_link text;
begin
  if new.status = old.status or new.status = 'invited' then return new; end if;
  select coalesce(nullif(full_name, ''), email, 'A member')
    into v_name from public.profiles where id = new.profile_id;
  select title, creator_id, start_date into v_title, v_creator, v_date from public.events where id = new.event_id;
  select id into v_post from public.posts where linked_event_id = new.event_id limit 1;
  v_link := case when v_post is not null then '/events/' || v_post else '/calendar?d=' || coalesce(v_date::text, '') || '&e=' || new.event_id end;
  perform public.notify(v_creator, 'calendar', null, 'event_rsvp',
    v_name,
    (case new.status
       when 'going' then 'is going: '
       when 'tentative' then 'might come: '
       else 'can''t make it: '
     end) || coalesce(v_title, 'your event'),
    v_link, new.profile_id);
  return new;
end; $function$;
