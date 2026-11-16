-- THE GIFT ECONOMY, SLICE 1 (founder 2026-11-16): "Gifts flow to need.
-- Giving earns no claim on receiving." Three pieces, none of which moves money:
--   1. a private record of value given and received (my_value_flow)
--   2. a need can say what its holder can offer for it, and whether Lichen's
--      matcher may see it (budget_items.offer_* / matchable)
--   3. the routing desk matches entrusted gifts to shared needs, a steward
--      approving each (routing_needs / offer_gift_for_need)

-- ── 2. needs carry an offer + an explicit share ──────────────────────────
alter table public.budget_items
  add column if not exists offer_kind text,
  add column if not exists offer_cents integer,
  add column if not exists offer_trade text,
  add column if not exists matchable boolean not null default false,
  add column if not exists gift_offered_post_id uuid references public.posts(id) on delete set null,
  add column if not exists gift_offered_at timestamptz;
alter table public.budget_items drop constraint if exists budget_items_offer_kind_check;
alter table public.budget_items add constraint budget_items_offer_kind_check
  check (offer_kind is null or offer_kind in ('pay', 'trade', 'none'));
alter table public.budget_items drop constraint if exists budget_items_offer_cents_check;
alter table public.budget_items add constraint budget_items_offer_cents_check
  check (offer_cents is null or offer_cents >= 0);
alter table public.budget_items drop constraint if exists budget_items_offer_trade_len;
alter table public.budget_items add constraint budget_items_offer_trade_len
  check (offer_trade is null or char_length(offer_trade) <= 200);

-- ── 3. the steward's read of SHARED needs (never the private ones) ─────────
create or replace function public.routing_needs()
returns table (id uuid, profile_id uuid, full_name text, label text, amount_cents integer,
               offer_kind text, offer_cents integer, offer_trade text, created_at timestamptz,
               gift_offered_post_id uuid, gift_offered_at timestamptz)
language sql stable security definer set search_path = public as $func$
  select b.id, b.profile_id, p.full_name, coalesce(b.label, ''), b.amount_cents,
         b.offer_kind, b.offer_cents, b.offer_trade, b.created_at,
         b.gift_offered_post_id, b.gift_offered_at
    from budget_items b join profiles p on p.id = b.profile_id
   where b.bucket = 'need' and b.matchable
     and exists (select 1 from profiles me where me.id = auth.uid() and me.is_admin)
   order by b.created_at desc
   limit 200;
$func$;
revoke all on function public.routing_needs() from public, anon;
grant execute on function public.routing_needs() to authenticated;

-- A steward offers an entrusted gift to a shared need: the holder is belled
-- with a door to the gift; nothing is given until they take it up.
create or replace function public.offer_gift_for_need(p_need uuid, p_post uuid)
returns void language plpgsql security definer set search_path = public as $func$
declare v_owner uuid; v_label text; v_title text;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
    raise exception 'Only a Lichen steward can route gifts.';
  end if;
  select profile_id, label into v_owner, v_label
    from budget_items where id = p_need and bucket = 'need' and matchable;
  if v_owner is null then raise exception 'That need isn''t shared with Lichen''s matcher.'; end if;
  select coalesce(nullif(trim(title), ''), left(trim(body), 60)) into v_title
    from posts where id = p_post and details->>'allocation' = 'lichen';
  if v_title is null then raise exception 'That isn''t an offering entrusted to Lichen.'; end if;
  update budget_items set gift_offered_post_id = p_post, gift_offered_at = now() where id = p_need;
  perform notify(v_owner, 'currentcy', null, 'gift_for_need',
    'A gift for your need: ' || coalesce(nullif(v_label, ''), 'what you listed'),
    '“' || v_title || '” was given freely to Lichen, and it may meet your need. Take a look.',
    '/posts/' || p_post, auth.uid());
end; $func$;
revoke all on function public.offer_gift_for_need(uuid, uuid) from public, anon;
grant execute on function public.offer_gift_for_need(uuid, uuid) to authenticated;

-- ── 1. the private record of value given and received ─────────────────────
-- Read straight from what already happened (completed exchanges, paid
-- sessions, paid guest orders) — the caller's own rows only. A record, never
-- a balance: nothing here entitles anyone to anything.
create or replace function public.my_value_flow()
returns table (at timestamptz, direction text, manner text, title text,
               other_name text, value_cents integer, source text)
language sql stable security definer set search_path = public as $func$
  with me as (select auth.uid() as id)
  select x.completed_at,
         case when x.seller_id = me.id then 'given' else 'received' end,
         case when x.mode in ('gift', 'free', 'lichen') then 'gift'
              when x.mode = 'trade' then 'trade'
              when x.mode in ('lend', 'borrow') then 'lend'
              else 'sale' end,
         coalesce(nullif(trim(po.title), ''), left(trim(po.body), 60), 'An exchange'),
         case when x.seller_id = me.id then bp.full_name else coalesce(ss.name, sp.full_name) end,
         case when x.amount is null then null else round(x.amount * 100)::int end,
         'exchange'
    from exchanges x cross join me
    left join posts po on po.id = x.post_id
    left join profiles bp on bp.id = x.buyer_id
    left join profiles sp on sp.id = x.seller_id
    left join spaces ss on ss.id = x.seller_space_id
   where x.status = 'completed' and x.completed_at is not null
     and ((x.seller_id = me.id and x.seller_space_id is null)
       or (x.buyer_id = me.id and x.buyer_space_id is null))
  union all
  select b.paid_at,
         case when b.provider_id = me.id then 'given' else 'received' end,
         'sale', coalesce(t.title, 'A session'),
         case when b.provider_id = me.id then coalesce(bp.full_name, b.guest_name) else pp.full_name end,
         b.price_cents, 'session'
    from bookings b cross join me
    left join booking_types t on t.id = b.type_id
    left join profiles bp on bp.id = b.booker_id
    left join profiles pp on pp.id = b.provider_id
   where b.paid_at is not null and (b.provider_id = me.id or b.booker_id = me.id)
  union all
  select o.paid_at, 'given', 'sale',
         coalesce(nullif(trim(po.title), ''), left(trim(po.body), 60), 'A listing'),
         o.buyer_name, o.price_cents, 'order'
    from post_orders o cross join me
    left join posts po on po.id = o.post_id
   where o.paid_at is not null and o.seller_type = 'profile' and o.seller_id = me.id
  order by 1 desc
  limit 300;
$func$;
revoke all on function public.my_value_flow() from public, anon;
grant execute on function public.my_value_flow() to authenticated;
