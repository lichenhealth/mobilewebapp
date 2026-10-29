-- PAYMENTS ON BOOKINGS + CASH-OUT (founder 2026-10-29: "Let's do both — you
-- can choose to have it be cash out, current-cy or either as the
-- practitioner"). The blessed money shape (the subsidy build order): the
-- booker pays DOLLARS through Lichen's Stripe, the dollars stay in Lichen's
-- account, and the PRACTITIONER accrues Current-cy 1:1 — the float rule
-- holds because every minted Current is backed by a dollar actually held.
-- Cash-out is the burn + payout half: a practitioner turns Current back
-- into dollars; v1 the payout itself is PAID BY HAND from the admin desk
-- (Stripe Connect automation stays the later phase, as the ledger doctrine
-- always said) — the ledger burn and the request/paid record are real now.
--
-- v1 payment POSTURE (deliberate, the smallest honest shape): payment never
-- gates booking STATUS — an instant booking confirms as always and then asks
-- for payment ("pay to secure"); a request booking is accepted first and the
-- acceptance email carries the pay link, so nothing is ever charged before
-- the provider's yes and no auto-refund machinery is needed (Calendly's own
-- refunds are manual too). An unpaid booking holds its slot until the
-- provider cancels it — their call, visible as "awaiting payment".

-- ── Columns ──────────────────────────────────────────────────────────────────
alter table public.booking_types
  add column if not exists price_cents integer
  check (price_cents is null or (price_cents between 100 and 500000));
comment on column public.booking_types.price_cents is
  'Collect this online at booking (USD cents, $1–$5,000); null = no online payment (price stays words).';

alter table public.bookings
  add column if not exists price_cents integer,
  add column if not exists paid_at timestamptz,
  add column if not exists stripe_session_id text;
comment on column public.bookings.price_cents is
  'FROZEN from the type at insert (the exchange-freeze doctrine) — a later price change never rewrites an open booking.';

alter table public.profiles
  add column if not exists payout_pref text not null default 'keep'
  check (payout_pref in ('keep','auto_cashout'));
comment on column public.profiles.payout_pref is
  'How session earnings arrive: keep = Current-cy in the wallet (cash out any time); auto_cashout = every payment immediately becomes a payout request.';

-- The frozen price can't be forgotten by any create path (the page_versions
-- lesson: enforce where it can't be skipped, a trigger).
create or replace function public.stamp_booking_price()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  new.price_cents := (select bt.price_cents from public.booking_types bt where bt.id = new.type_id);
  return new;
end $fn$;
drop trigger if exists booking_price_stamp on public.bookings;
create trigger booking_price_stamp before insert on public.bookings
  for each row execute function public.stamp_booking_price();

-- Two new ledger contexts: 'booking' (a session payment minting to the
-- provider) and 'cashout' (the burn that turns Current back toward dollars).
alter table public.ledger_entries drop constraint ledger_entries_context_check;
alter table public.ledger_entries add constraint ledger_entries_context_check
  check (context = any (array['mint','grant','gift','exchange','contribution','adjustment','burn','load','booking','cashout']));

-- ── Payment bookkeeping (idempotency per Stripe session — the
--    currentcy_loads pattern; a webhook retry answers with the same mint) ────
create table if not exists public.booking_payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  stripe_session_id text not null unique,
  ledger_entry_id uuid,
  created_at timestamptz not null default now()
);
alter table public.booking_payments enable row level security;
drop policy if exists "booking_payments: admins read" on public.booking_payments;
create policy "booking_payments: admins read" on public.booking_payments
  for select using (exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin));
-- No client writes: only record_booking_payment (service role) touches it.

-- ── Cash-out requests ────────────────────────────────────────────────────────
create table if not exists public.payout_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'requested' check (status in ('requested','paid','returned')),
  source text not null default 'manual' check (source in ('manual','auto')),
  burn_ledger_id uuid,
  return_ledger_id uuid,
  note text not null default '',
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);
alter table public.payout_requests enable row level security;
drop policy if exists "payouts: own" on public.payout_requests;
create policy "payouts: own" on public.payout_requests
  for select using (profile_id = auth.uid());
drop policy if exists "payouts: admins read" on public.payout_requests;
create policy "payouts: admins read" on public.payout_requests
  for select using (exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin));
-- Writes only via the RPCs below — the burn and the row always move together.

-- ── record_booking_payment — the webhook's one door (service role only) ─────
create or replace function public.record_booking_payment(p_booking uuid, p_session text, p_amount_cents integer)
returns uuid language plpgsql security definer set search_path to 'public' as $fn$
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
    -- Retry of an already-recorded session: answer with the existing mint.
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
         stripe_session_id = coalesce(stripe_session_id, p_session)
   where id = p_booking;

  v_amt_txt := trim(trailing '.' from trim(trailing '0' from to_char(v_amt, 'FM999999990.00')));
  select coalesce((select full_name from public.profiles where id = b.booker_id), b.guest_name, 'Someone')
    into v_payer;

  if b.status in ('cancelled', 'declined') then
    -- Money landed for a dead booking (a checkout finished after a cancel):
    -- the dollars are held and recorded; the refund is the provider's manual
    -- act in Stripe, said plainly.
    perform public.notify(b.provider_id, 'currentcy', null, 'currentcy',
      v_payer || ' paid $' || v_amt_txt || ' for a cancelled booking',
      'Arrange their refund — the payment is recorded on ' || coalesce(t.title, 'the session') || '.',
      '/bookings', null);
    return v_ledger;
  end if;

  select payout_pref into v_pref from public.profiles where id = b.provider_id;
  if v_pref = 'auto_cashout' then
    -- Their choice: every payment goes straight toward dollars — burn the
    -- fresh Current and open the payout request in the same breath.
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
        '/admin/supporters', null);
    end loop;
  else
    perform public.notify(b.provider_id, 'currentcy', null, 'currentcy',
      v_payer || ' paid $' || v_amt_txt || ' for ' || coalesce(t.title, 'your session'),
      v_amt_txt || ' Current is in your wallet — cash it out any time.', '/currentcy', null);
  end if;
  return v_ledger;
end $fn$;
revoke all on function public.record_booking_payment(uuid, text, integer) from public, anon, authenticated;

-- ── request_cashout — burn now, dollars by hand from the desk ────────────────
create or replace function public.request_cashout(p_amount numeric)
returns uuid language plpgsql security definer set search_path to 'public' as $fn$
declare v_amt numeric; v_bal numeric; v_burn uuid; v_id uuid; v_name text; v_admin record; v_amt_txt text;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  v_amt := round(coalesce(p_amount, 0), 2);
  if v_amt <= 0 then raise exception 'Amount must be positive.'; end if;

  perform pg_advisory_xact_lock(hashtextextended('profile:' || auth.uid()::text, 42));

  select coalesce(sum(case when to_type = 'profile' and to_id = auth.uid() then amount else 0 end), 0)
       - coalesce(sum(case when from_type = 'profile' and from_id = auth.uid() then amount else 0 end), 0)
    into v_bal
    from public.ledger_entries
   where (to_type = 'profile' and to_id = auth.uid())
      or (from_type = 'profile' and from_id = auth.uid());
  if v_bal < v_amt then
    raise exception 'Not enough Current — you hold %.', trim(to_char(v_bal, 'FM999999990.##'));
  end if;

  insert into public.ledger_entries (from_type, from_id, to_type, to_id, amount, context, memo, created_by)
  values ('profile', auth.uid(), null, null, v_amt, 'cashout',
          'Cash-out requested — dollars on the way', auth.uid())
  returning id into v_burn;

  insert into public.payout_requests (profile_id, amount, source, burn_ledger_id)
  values (auth.uid(), v_amt, 'manual', v_burn)
  returning id into v_id;

  v_amt_txt := trim(trailing '.' from trim(trailing '0' from to_char(v_amt, 'FM999999990.00')));
  select coalesce(full_name, 'A member') into v_name from public.profiles where id = auth.uid();
  for v_admin in select pr.id from public.profiles pr where pr.is_admin and pr.id <> auth.uid() loop
    perform public.notify(v_admin.id, 'currentcy', null, 'currentcy',
      v_name || ' requests a $' || v_amt_txt || ' cash-out',
      'The Payouts desk in Invite & manage members has it.', '/admin/supporters', auth.uid());
  end loop;
  return v_id;
end $fn$;
revoke all on function public.request_cashout(numeric) from public, anon;
grant execute on function public.request_cashout(numeric) to authenticated;

-- ── cancel_cashout — the mirror: re-mint and close the request ───────────────
create or replace function public.cancel_cashout(p_request uuid)
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare r record; v_mint uuid; v_admin boolean;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  select * into r from public.payout_requests where id = p_request;
  if r is null then raise exception 'No such cash-out.'; end if;
  select coalesce(is_admin, false) into v_admin from public.profiles where id = auth.uid();
  if r.profile_id <> auth.uid() and not v_admin then raise exception 'Not yours to cancel.'; end if;
  if r.status <> 'requested' then raise exception 'Already settled.'; end if;

  insert into public.ledger_entries (from_type, from_id, to_type, to_id, amount, context, memo, created_by)
  values (null, null, 'profile', r.profile_id, r.amount, 'adjustment',
          'Cash-out returned to wallet', auth.uid())
  returning id into v_mint;

  update public.payout_requests
     set status = 'returned', return_ledger_id = v_mint, resolved_at = now(), resolved_by = auth.uid()
   where id = p_request;

  if r.profile_id <> auth.uid() then
    perform public.notify(r.profile_id, 'currentcy', null, 'currentcy',
      'Your cash-out was returned to your wallet',
      'The Current is back and spendable — ask Galyn if that''s a surprise.', '/currentcy', auth.uid());
  end if;
end $fn$;
revoke all on function public.cancel_cashout(uuid) from public, anon;
grant execute on function public.cancel_cashout(uuid) to authenticated;

-- ── mark_payout_paid — the desk's act: the dollars moved by hand ─────────────
create or replace function public.mark_payout_paid(p_request uuid, p_note text default '')
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare r record; v_admin boolean; v_amt_txt text;
begin
  select coalesce(is_admin, false) into v_admin from public.profiles where id = auth.uid();
  if not coalesce(v_admin, false) then raise exception 'Only a platform admin settles payouts.'; end if;
  select * into r from public.payout_requests where id = p_request;
  if r is null then raise exception 'No such cash-out.'; end if;
  if r.status <> 'requested' then raise exception 'Already settled.'; end if;

  update public.payout_requests
     set status = 'paid', note = coalesce(nullif(p_note, ''), note),
         resolved_at = now(), resolved_by = auth.uid()
   where id = p_request;

  v_amt_txt := trim(trailing '.' from trim(trailing '0' from to_char(r.amount, 'FM999999990.00')));
  perform public.notify(r.profile_id, 'currentcy', null, 'currentcy',
    'Your cash-out was paid — $' || v_amt_txt || ' is on its way',
    coalesce(nullif(p_note, ''), 'Sent by hand from Lichen.'), '/currentcy', auth.uid());
end $fn$;
revoke all on function public.mark_payout_paid(uuid, text) from public, anon;
grant execute on function public.mark_payout_paid(uuid, text) to authenticated;

-- ── guest_booking carries the payment state (return shape changes → DROP) ───
drop function if exists public.guest_booking(text);
create function public.guest_booking(p_token text)
 returns table(guest_name text, status text, on_date date, start_min integer, end_min integer,
               note text, type_title text, type_location text, duration_min integer,
               provider_name text, type_id uuid, capacity integer, meeting_url text,
               approval text, price_cents integer, paid_at timestamptz)
 language sql stable security definer set search_path to 'public'
as $fn$
  select b.guest_name, b.status, b.on_date, b.start_min, b.end_min, b.note,
         t.title, t.location, t.duration_min,
         coalesce(p.full_name, 'A Lichen member'),
         t.id, t.capacity,
         case when b.status = 'confirmed' then b.meeting_url end,
         t.approval, b.price_cents, b.paid_at
  from public.bookings b
  join public.booking_types t on t.id = b.type_id
  join public.profiles p on p.id = b.provider_id
  where b.guest_token = p_token and b.guest_email is not null;
$fn$;
revoke all on function public.guest_booking(text) from public;
grant execute on function public.guest_booking(text) to anon, authenticated;
