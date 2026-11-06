-- PRIVATE LISTING LINKS + GUEST CHECKOUT (founder 2026-11-06: "if someone off
-- lichen is on the list, it allows them to see the marketplace listing, the
-- event, etc - they shouldn't have to join lichen to engage in the specific
-- piece of content… To actually buy the item… they'd have to check out as a
-- guest if they didn't wanna join lichen" → "build the payments piece as you
-- articulated it").
--
-- Shape (the booking-payment machinery, reused):
--   post_guests  — one tokened row per off-Lichen person a seller shares a
--                  post with (the event_guests pattern). The token IS the
--                  guest's whole authorization.
--   post_orders  — a guest asks to buy → the seller accepts → the guest pays
--                  by card through Lichen's Stripe. The price is FROZEN onto
--                  the order when asked. Nothing is ever charged before the
--                  seller's yes, so a decline never needs a refund.
--   post_payments — idempotency per Stripe session (booking_payments' twin).
--   record_post_payment — service-role-only: mints the dollars 1:1 as
--                  Current-cy to the SELLER (a person, or a space's treasury),
--                  the float rule holding: every minted Current is backed by a
--                  dollar held.

-- ── ledger context ───────────────────────────────────────────────────────
alter table public.ledger_entries drop constraint if exists ledger_entries_context_check;
alter table public.ledger_entries add constraint ledger_entries_context_check
  check (context = any (array['mint','grant','gift','exchange','contribution','adjustment','burn','load','booking','cashout','sale']));

-- ── who may manage a post's guests/orders ────────────────────────────────
create or replace function public.post_host(p_post uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $func$
  select exists (
    select 1 from public.posts p
    where p.id = p_post
      and (
        (p.author_space_id is null and p.author_id = p_uid)
        or (p.author_space_id is not null and public.is_space_admin(p.author_space_id, p_uid))
      )
  );
$func$;
revoke all on function public.post_host(uuid, uuid) from public, anon;
grant execute on function public.post_host(uuid, uuid) to authenticated;

-- ── guests ───────────────────────────────────────────────────────────────
create table if not exists public.post_guests (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  invited_by uuid not null references public.profiles(id) on delete cascade,
  name text,
  email text,
  phone text,
  token text not null unique default replace((gen_random_uuid())::text || (gen_random_uuid())::text, '-', ''),
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint post_guests_contact check (email is not null or phone is not null)
);
create index if not exists post_guests_post on public.post_guests (post_id);
alter table public.post_guests enable row level security;
drop policy if exists "post_guests host" on public.post_guests;
create policy "post_guests host" on public.post_guests
  for all to authenticated
  using (public.post_host(post_id, auth.uid()))
  with check (public.post_host(post_id, auth.uid()) and invited_by = auth.uid());
grant select, insert, update, delete on public.post_guests to authenticated;

-- ── orders ───────────────────────────────────────────────────────────────
create table if not exists public.post_orders (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  guest_id uuid references public.post_guests(id) on delete set null,
  seller_type text not null check (seller_type in ('profile','space')),
  seller_id uuid not null,
  buyer_name text,
  buyer_email text,
  buyer_phone text,
  note text check (note is null or char_length(note) <= 1000),
  price_cents integer not null check (price_cents between 100 and 500000),
  status text not null default 'requested'
    check (status in ('requested','accepted','declined','cancelled','paid')),
  decided_at timestamptz,
  payment_pending_at timestamptz,
  paid_at timestamptz,
  stripe_session_id text,
  created_at timestamptz not null default now()
);
create index if not exists post_orders_post on public.post_orders (post_id);
-- One open order per guest: ask once, wait for the answer.
create unique index if not exists post_orders_open_per_guest on public.post_orders (guest_id)
  where status in ('requested','accepted');
alter table public.post_orders enable row level security;
drop policy if exists "post_orders host read" on public.post_orders;
create policy "post_orders host read" on public.post_orders
  for select to authenticated using (public.post_host(post_id, auth.uid()));
grant select on public.post_orders to authenticated;

create table if not exists public.post_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.post_orders(id) on delete cascade,
  amount_cents integer not null,
  stripe_session_id text not null unique,
  ledger_entry_id uuid,
  created_at timestamptz not null default now()
);
alter table public.post_payments enable row level security;   -- no client policies: service role only

-- The frozen dollar price of a post: the FIRST number in details.price (the
-- exchange freeze's rule), commas dropped, in cents. Null when unpriced.
create or replace function public._post_price_cents(p_details jsonb)
returns integer language sql immutable as $func$
  select case
    when n is null then null
    else round(n * 100)::integer
  end
  from (select nullif(substring(replace(coalesce(p_details->>'price', ''), ',', '')
                       from '[0-9]+(?:\.[0-9]{1,2})?'), '')::numeric as n) s;
$func$;

-- ── the guest's page ─────────────────────────────────────────────────────
create or replace function public.guest_post(p_token text)
returns table (
  guest_name text, post_id uuid, title text, body text, photos text[],
  price text, price_cents integer, modes jsonb, seller_name text, seller_kind text,
  order_id uuid, order_status text, order_price_cents integer,
  order_paid_at timestamptz, order_pending_at timestamptz
)
language sql stable security definer set search_path = public as $func$
  select g.name, p.id, p.title, p.body,
         coalesce(
           array(select m->>'url'
                 from jsonb_array_elements(
                   case when jsonb_typeof(p.details->'media') = 'array'
                        then p.details->'media' else '[]'::jsonb end) m
                 where m->>'type' = 'photo'),
           '{}'::text[])
           || case when p.image_url is not null then array[p.image_url] else '{}'::text[] end,
         p.details->>'price',
         public._post_price_cents(p.details),
         coalesce(p.details->'modes', '[]'::jsonb),
         coalesce(sp.name, pr.full_name, 'A Lichen member'),
         case when p.author_space_id is not null then sp.kind::text else 'person' end,
         o.id, o.status, o.price_cents, o.paid_at, o.payment_pending_at
  from public.post_guests g
  join public.posts p on p.id = g.post_id
  left join public.profiles pr on pr.id = p.author_id
  left join public.spaces sp on sp.id = p.author_space_id
  left join lateral (
    select * from public.post_orders po
    where po.guest_id = g.id
    order by (po.status in ('requested','accepted','paid')) desc, po.created_at desc
    limit 1
  ) o on true
  where g.token = p_token;
$func$;
revoke all on function public.guest_post(text) from public;
grant execute on function public.guest_post(text) to anon, authenticated;

-- ── a guest asks to buy ──────────────────────────────────────────────────
create or replace function public.guest_request_purchase(p_token text, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $func$
declare g record; p record; v_cents integer; v_order uuid; v_title text; v_admin record;
begin
  select * into g from public.post_guests where token = p_token;
  if g is null then raise exception 'This link isn''t valid anymore.'; end if;
  select * into p from public.posts where id = g.post_id;
  if p is null then raise exception 'This listing isn''t available anymore.'; end if;
  v_cents := public._post_price_cents(p.details);
  if v_cents is null or v_cents < 100 then
    raise exception 'This listing has no dollar price to pay online — message the seller to arrange it.';
  end if;
  if v_cents > 500000 then
    raise exception 'Online checkout covers up to $5,000 — message the seller to arrange this one.';
  end if;
  if exists (select 1 from public.post_orders where guest_id = g.id and status in ('requested','accepted')) then
    raise exception 'You''ve already asked — the seller will answer soon.';
  end if;

  insert into public.post_orders (post_id, guest_id, seller_type, seller_id,
                                  buyer_name, buyer_email, buyer_phone, note, price_cents)
  values (p.id, g.id,
          case when p.author_space_id is not null then 'space' else 'profile' end,
          coalesce(p.author_space_id, p.author_id),
          g.name, g.email, g.phone, nullif(trim(coalesce(p_note, '')), ''), v_cents)
  returning id into v_order;

  v_title := coalesce(nullif(p.title, ''), left(coalesce(p.body, 'your listing'), 60));
  if p.author_space_id is null then
    perform public.notify(p.author_id, 'home', null, 'listing_order',
      coalesce(g.name, 'Someone off Lichen') || ' wants to buy ' || v_title,
      'They''re not on Lichen — accept and they''ll pay $' || (v_cents / 100.0)::numeric(12,2) || ' by card.',
      '/posts/' || p.id || '#orders', null);
  else
    for v_admin in select m.profile_id from public.space_members m
                   where m.space_id = p.author_space_id and m.role in ('admin','super_admin') loop
      perform public.notify(v_admin.profile_id, 'home', p.author_space_id, 'listing_order',
        coalesce(g.name, 'Someone off Lichen') || ' wants to buy ' || v_title,
        'Accept and they''ll pay $' || (v_cents / 100.0)::numeric(12,2) || ' by card, into the treasury.',
        '/posts/' || p.id || '#orders', null);
    end loop;
  end if;
  return v_order;
end $func$;
revoke all on function public.guest_request_purchase(text, text) from public;
grant execute on function public.guest_request_purchase(text, text) to anon, authenticated;

-- A guest withdraws an unpaid ask.
create or replace function public.guest_cancel_purchase(p_token text)
returns void language plpgsql security definer set search_path = public as $func$
declare g record;
begin
  select * into g from public.post_guests where token = p_token;
  if g is null then raise exception 'This link isn''t valid anymore.'; end if;
  update public.post_orders set status = 'cancelled', decided_at = now()
   where guest_id = g.id and status in ('requested','accepted') and paid_at is null
     and payment_pending_at is null;
end $func$;
revoke all on function public.guest_cancel_purchase(text) from public;
grant execute on function public.guest_cancel_purchase(text) to anon, authenticated;

-- ── the seller answers ───────────────────────────────────────────────────
create or replace function public.respond_post_order(p_order uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $func$
declare o record;
begin
  select * into o from public.post_orders where id = p_order;
  if o is null then raise exception 'No such order.'; end if;
  if not public.post_host(o.post_id, auth.uid()) then
    raise exception 'Only the seller can answer this.';
  end if;
  if p_accept then
    if o.status <> 'requested' then raise exception 'This order isn''t waiting on an answer.'; end if;
    update public.post_orders set status = 'accepted', decided_at = now() where id = p_order;
    return 'accepted';
  else
    if o.status not in ('requested','accepted') or o.paid_at is not null or o.payment_pending_at is not null then
      raise exception 'This order can''t be declined now.';
    end if;
    update public.post_orders set status = 'declined', decided_at = now() where id = p_order;
    return 'declined';
  end if;
end $func$;
revoke all on function public.respond_post_order(uuid, boolean) from public, anon;
grant execute on function public.respond_post_order(uuid, boolean) to authenticated;

-- ── the money lands (service role only, called by stripe-webhook) ────────
create or replace function public.record_post_payment(p_order uuid, p_session text, p_amount_cents integer)
returns uuid language plpgsql security definer set search_path = public as $func$
declare o record; p record; v_pay uuid; v_ledger uuid; v_amt numeric; v_amt_txt text;
        v_title text; v_pref text; v_burn uuid; v_admin record; v_payer text;
begin
  if p_order is null or p_session is null or coalesce(p_amount_cents, 0) <= 0 then
    raise exception 'Bad payment.';
  end if;
  select * into o from public.post_orders where id = p_order;
  if o is null then raise exception 'No such order.'; end if;
  select * into p from public.posts where id = o.post_id;

  insert into public.post_payments (order_id, amount_cents, stripe_session_id)
  values (p_order, p_amount_cents, p_session)
  on conflict (stripe_session_id) do nothing
  returning id into v_pay;
  if v_pay is null then
    select ledger_entry_id into v_ledger from public.post_payments where stripe_session_id = p_session;
    return v_ledger;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(o.seller_type || ':' || o.seller_id::text, 42));

  v_amt := round(p_amount_cents / 100.0, 2);
  v_title := coalesce(nullif(p.title, ''), left(coalesce(p.body, 'a listing'), 60), 'a listing');
  insert into public.ledger_entries (from_type, from_id, to_type, to_id, amount, context, memo, ref_type, ref_id)
  values (null, null, o.seller_type, o.seller_id, v_amt, 'sale',
          'Guest purchase — ' || v_title, 'post_order', p_order)
  returning id into v_ledger;
  update public.post_payments set ledger_entry_id = v_ledger where id = v_pay;

  update public.post_orders
     set paid_at = coalesce(paid_at, now()),
         stripe_session_id = coalesce(stripe_session_id, p_session),
         payment_pending_at = null,
         status = case when status in ('requested','accepted') then 'paid' else status end
   where id = p_order;

  v_amt_txt := trim(trailing '.' from trim(trailing '0' from to_char(v_amt, 'FM999999990.00')));
  v_payer := coalesce(o.buyer_name, 'A guest');

  if o.status in ('cancelled','declined') then
    -- Paid for an order no longer standing: record it, tell the seller plainly.
    if o.seller_type = 'profile' then
      perform public.notify(o.seller_id, 'currentcy', null, 'currentcy',
        v_payer || ' paid $' || v_amt_txt || ' on a closed order',
        'Arrange their refund — the payment is recorded on ' || v_title || '.', '/posts/' || o.post_id || '#orders', null);
    else
      for v_admin in select m.profile_id from public.space_members m
                     where m.space_id = o.seller_id and m.role in ('admin','super_admin') loop
        perform public.notify(v_admin.profile_id, 'currentcy', o.seller_id, 'currentcy',
          v_payer || ' paid $' || v_amt_txt || ' on a closed order',
          'Arrange their refund — the payment is recorded on ' || v_title || '.', '/posts/' || o.post_id || '#orders', null);
      end loop;
    end if;
    return v_ledger;
  end if;

  if o.seller_type = 'profile' then
    select payout_pref into v_pref from public.profiles where id = o.seller_id;
    if v_pref = 'auto_cashout' then
      insert into public.ledger_entries (from_type, from_id, to_type, to_id, amount, context, memo, ref_type, ref_id)
      values ('profile', o.seller_id, null, null, v_amt, 'cashout',
              'Auto cash-out — guest purchase', 'post_order', p_order)
      returning id into v_burn;
      insert into public.payout_requests (profile_id, amount, source, burn_ledger_id)
      values (o.seller_id, v_amt, 'auto', v_burn);
      perform public.notify(o.seller_id, 'currentcy', null, 'currentcy',
        v_payer || ' paid $' || v_amt_txt || ' for ' || v_title,
        'Queued for cash-out, as you chose — arrange the hand-off with them.', '/posts/' || o.post_id || '#orders', null);
      for v_admin in select pr.id from public.profiles pr where pr.is_admin and pr.id <> o.seller_id loop
        perform public.notify(v_admin.id, 'currentcy', null, 'currentcy',
          'Cash-out to pay: $' || v_amt_txt,
          'A guest purchase queued for auto cash-out — the Payouts desk has it.',
          '/admin/supporters#payouts', null);
      end loop;
    else
      perform public.notify(o.seller_id, 'currentcy', null, 'currentcy',
        v_payer || ' paid $' || v_amt_txt || ' for ' || v_title,
        v_amt_txt || ' Current is in your wallet — now arrange the hand-off with them.', '/posts/' || o.post_id || '#orders', null);
    end if;
  else
    for v_admin in select m.profile_id from public.space_members m
                   where m.space_id = o.seller_id and m.role in ('admin','super_admin') loop
      perform public.notify(v_admin.profile_id, 'currentcy', o.seller_id, 'currentcy',
        v_payer || ' paid $' || v_amt_txt || ' for ' || v_title,
        v_amt_txt || ' Current landed in the treasury — arrange the hand-off with them.', '/posts/' || o.post_id || '#orders', null);
    end loop;
  end if;
  return v_ledger;
end $func$;
revoke all on function public.record_post_payment(uuid, text, integer) from public, anon, authenticated;
