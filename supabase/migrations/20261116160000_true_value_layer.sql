-- THE TRUE VALUE LAYER + SUGGESTED ROUTING (founder 2026-11-16: "We track
-- value delivered and received… what is valued and how value is exchanged
-- today, versus the true value that should be exchanged in a fully
-- reciprocal and inclusive economy (that includes land, animals, plants and
-- elements)" → "can we create the basic true value layer?" → "and the algo
-- to suggest routing, although its manual now?" → "what we need can be a
-- good or service - on or off lichen… as specific as an organization's good
-- … or service (body work with cherlynn)… the totality of her fee… is funded
-- thru the donation, or a portion based on how much you can afford").
--   1. true_values — each person's PRIVATE note of what an exchange was truly
--      worth (or a manual entry: a being's medicine), beside what changed hands.
--   2. a need names WHO provides it (a member, a space, or anyone off Lichen)
--      and a steward can approve funding the gap from the donation wells.
--   3. the routing desk reads beings owed restoration (aggregates only).

-- ── 1. true values ─────────────────────────────────────────────────────────
create table if not exists public.true_values (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  source text not null check (source in ('exchange', 'session', 'order', 'manual')),
  source_id uuid,
  direction text not null check (direction in ('given', 'received')),
  title text check (title is null or char_length(title) <= 200),
  counterparty text check (counterparty is null or char_length(counterparty) <= 120),
  being_id uuid references public.profiles(id) on delete set null,
  exchanged_cents integer check (exchanged_cents is null or exchanged_cents >= 0),
  true_cents integer not null check (true_cents >= 0 and true_cents <= 100000000),
  note text check (note is null or char_length(note) <= 500),
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists true_values_source_uidx
  on public.true_values (owner_id, source, source_id) where source_id is not null;
alter table public.true_values enable row level security;
drop policy if exists "true_values owner" on public.true_values;
create policy "true_values owner" on public.true_values
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke all on public.true_values from anon;

-- A being named on a record must be a stewarded member (plant, animal, place,
-- element, collective) — never a person.
create or replace function public.true_values_guard()
returns trigger language plpgsql security definer set search_path = public as $func$
begin
  if new.being_id is not null and not exists
     (select 1 from profiles where id = new.being_id and coalesce(kind, 'person') <> 'person') then
    raise exception 'Only a stewarded member (a plant, animal, place, element or collective) can be named as the being.';
  end if;
  new.updated_at := now();
  return new;
end; $func$;
drop trigger if exists true_values_guard on public.true_values;
create trigger true_values_guard before insert or update on public.true_values
  for each row execute function public.true_values_guard();

-- my_value_flow returns each row's source id now, so a true value can sit beside it.
drop function if exists public.my_value_flow();
create function public.my_value_flow()
returns table (at timestamptz, direction text, manner text, title text,
               other_name text, value_cents integer, source text, source_id uuid)
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
         'exchange', x.id
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
         b.price_cents, 'session', b.id
    from bookings b cross join me
    left join booking_types t on t.id = b.type_id
    left join profiles bp on bp.id = b.booker_id
    left join profiles pp on pp.id = b.provider_id
   where b.paid_at is not null and (b.provider_id = me.id or b.booker_id = me.id)
  union all
  select o.paid_at, 'given', 'sale',
         coalesce(nullif(trim(po.title), ''), left(trim(po.body), 60), 'A listing'),
         o.buyer_name, o.price_cents, 'order', o.id
    from post_orders o cross join me
    left join posts po on po.id = o.post_id
   where o.paid_at is not null and o.seller_type = 'profile' and o.seller_id = me.id
  order by 1 desc
  limit 300;
$func$;
revoke all on function public.my_value_flow() from public, anon;
grant execute on function public.my_value_flow() to authenticated;

-- ── 2. a need names its provider; a steward can fund the gap ───────────────
alter table public.budget_items
  add column if not exists provider_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists provider_space_id uuid references public.spaces(id) on delete set null,
  add column if not exists provider_name text,
  add column if not exists funded_cents integer,
  add column if not exists funded_at timestamptz,
  add column if not exists funded_by uuid references public.profiles(id) on delete set null;
alter table public.budget_items drop constraint if exists budget_items_provider_name_len;
alter table public.budget_items add constraint budget_items_provider_name_len
  check (provider_name is null or char_length(provider_name) <= 120);
alter table public.budget_items drop constraint if exists budget_items_funded_check;
alter table public.budget_items add constraint budget_items_funded_check
  check (funded_cents is null or funded_cents > 0);

-- Funding is a steward's decision, never the owner's: guard the columns.
create or replace function public.budget_items_guard_funding()
returns trigger language plpgsql set search_path = public as $func$
begin
  if coalesce(current_setting('lichen.need_funding', true), '') <> 'on'
     and (new.funded_cents is distinct from old.funded_cents
       or new.funded_at is distinct from old.funded_at
       or new.funded_by is distinct from old.funded_by) then
    raise exception 'Funding a need is a Lichen steward''s decision.';
  end if;
  return new;
end; $func$;
drop trigger if exists budget_items_guard_funding on public.budget_items;
create trigger budget_items_guard_funding before update on public.budget_items
  for each row execute function public.budget_items_guard_funding();

drop function if exists public.routing_needs();
create function public.routing_needs()
returns table (id uuid, profile_id uuid, full_name text, label text, amount_cents integer,
               offer_kind text, offer_cents integer, offer_trade text, created_at timestamptz,
               gift_offered_post_id uuid, gift_offered_at timestamptz,
               provider_name text, provider_profile_id uuid, provider_space_id uuid,
               funded_cents integer, funded_at timestamptz,
               gifts_received_180d integer, funded_180d_cents integer)
language sql stable security definer set search_path = public as $func$
  select b.id, b.profile_id, p.full_name, coalesce(b.label, ''), b.amount_cents,
         b.offer_kind, b.offer_cents, b.offer_trade, b.created_at,
         b.gift_offered_post_id, b.gift_offered_at,
         coalesce(b.provider_name, pp.full_name, ps.name), b.provider_profile_id, b.provider_space_id,
         b.funded_cents, b.funded_at,
         (select count(*)::int from exchanges x
           where x.buyer_id = b.profile_id and x.buyer_space_id is null and x.status = 'completed'
             and x.mode in ('gift', 'free', 'lichen') and x.completed_at > now() - interval '180 days'),
         (select coalesce(sum(o.funded_cents), 0)::int from budget_items o
           where o.profile_id = b.profile_id and o.funded_at > now() - interval '180 days')
    from budget_items b join profiles p on p.id = b.profile_id
    left join profiles pp on pp.id = b.provider_profile_id
    left join spaces ps on ps.id = b.provider_space_id
   where b.bucket = 'need' and b.matchable
     and exists (select 1 from profiles me where me.id = auth.uid() and me.is_admin)
   order by b.created_at desc
   limit 200;
$func$;
revoke all on function public.routing_needs() from public, anon;
grant execute on function public.routing_needs() to authenticated;

-- A steward approves funding (all of the fee, or the part the holder can't
-- afford). Nothing moves on its own: v1 a steward arranges the payment by
-- hand, the payouts posture — the bell says so plainly.
create or replace function public.approve_need_funding(p_need uuid, p_cents integer)
returns void language plpgsql security definer set search_path = public as $func$
declare v_owner uuid; v_label text; v_amount integer; v_prov text;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
    raise exception 'Only a Lichen steward can fund a need.';
  end if;
  select b.profile_id, b.label, b.amount_cents, coalesce(b.provider_name, pp.full_name, ps.name)
    into v_owner, v_label, v_amount, v_prov
    from budget_items b
    left join profiles pp on pp.id = b.provider_profile_id
    left join spaces ps on ps.id = b.provider_space_id
   where b.id = p_need and b.bucket = 'need' and b.matchable;
  if v_owner is null then raise exception 'That need isn''t shared with Lichen''s matcher.'; end if;
  if p_cents is null or p_cents <= 0 then raise exception 'Name an amount to fund.'; end if;
  if v_amount is not null and p_cents > v_amount then
    raise exception 'That''s more than the need costs.';
  end if;
  perform set_config('lichen.need_funding', 'on', true);
  update budget_items set funded_cents = p_cents, funded_at = now(), funded_by = auth.uid() where id = p_need;
  perform set_config('lichen.need_funding', '', true);
  perform notify(v_owner, 'currentcy', null, 'need_funded',
    'Lichen will fund ' || coalesce(nullif(v_label, ''), 'your need'),
    '$' || regexp_replace(to_char(p_cents / 100.0, 'FM999999990.00'), '\.00$', '') || ' toward ' ||
      coalesce(nullif(v_label, ''), 'what you listed') ||
      coalesce(' with ' || v_prov, '') ||
      ', from donations. A steward will be in touch to arrange it.',
    '/currentcy', auth.uid());
end; $func$;
revoke all on function public.approve_need_funding(uuid, integer) from public, anon;
grant execute on function public.approve_need_funding(uuid, integer) to authenticated;

-- ── 3. beings owed restoration (aggregates only — no one's private note) ───
create or replace function public.routing_beings()
returns table (being_id uuid, name text, kind text, jurisdiction text,
               received_cents bigint, exchanged_cents bigint, returned_cents bigint, records integer)
language sql stable security definer set search_path = public as $func$
  select t.being_id, p.full_name, p.kind, p.jurisdiction,
         coalesce(sum(t.true_cents) filter (where t.direction = 'received'), 0),
         coalesce(sum(t.exchanged_cents) filter (where t.direction = 'received'), 0),
         coalesce(sum(t.true_cents) filter (where t.direction = 'given'), 0),
         count(*)::int
    from true_values t join profiles p on p.id = t.being_id
   where t.being_id is not null
     and exists (select 1 from profiles me where me.id = auth.uid() and me.is_admin)
   group by t.being_id, p.full_name, p.kind, p.jurisdiction
   order by coalesce(sum(t.true_cents) filter (where t.direction = 'received'), 0)
          - coalesce(sum(t.true_cents) filter (where t.direction = 'given'), 0) desc
   limit 100;
$func$;
revoke all on function public.routing_beings() from public, anon;
grant execute on function public.routing_beings() to authenticated;
