-- THE MARKETPLACE ACTUALLY TRANSACTS (founder 2026-08-05: "lets build out
-- marketplace for real").
--
-- Until now a listing could be browsed, filtered by trust, saved and
-- recommended — and the only door forward was a DM with a URL pasted into the
-- draft. No record, no state, no link to the ledger. This adds the exchange
-- itself, modelled on resource_bookings (20260830120000): parties-read RLS,
-- no client writes, request → decide → complete through SECURITY DEFINER RPCs,
-- and the same privacy stance — others see that something is spoken for
-- without seeing who spoke.
--
-- Two things ride along: the guardian gate promised in 20260916120000 ("the
-- guardian approval queue is the next build"), and the matcher learning to
-- stop ringing bells for goods that are gone.

create table if not exists public.exchanges (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  -- Who is giving. A space can sell through its own listing, so the seller
  -- side is polymorphic exactly like posts.author_id / author_space_id.
  seller_id uuid not null references public.profiles(id) on delete cascade,
  seller_space_id uuid references public.spaces(id) on delete set null,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  -- SNAPSHOTS. posts.details stays editable by the author after someone
  -- agrees, so the terms of THIS exchange are frozen here — the same
  -- precedent the booking tables set by copying title/location into events.
  mode text not null,
  amount numeric(12,2) not null default 0 check (amount >= 0),
  fulfillment text,
  note text,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'completed', 'canceled')),
  -- A young member's exchange waits on a grown-up. Ruby's card, made real.
  needs_guardian boolean not null default false,
  guardian_ok_at timestamptz,
  -- Both hands on the handoff: the second confirmation completes it.
  buyer_done_at timestamptz,
  seller_done_at timestamptz,
  ledger_entry_id uuid references public.ledger_entries(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  completed_at timestamptz,
  constraint exchanges_not_self check (buyer_id <> seller_id)
);
alter table public.exchanges enable row level security;

-- Parties read; a space's admins read its side; a guardian reads their young
-- member's. Nobody else — and there are NO write policies, by design.
create policy "exchanges: parties read" on public.exchanges
  for select to authenticated
  using (
    buyer_id = auth.uid()
    or seller_id = auth.uid()
    or (seller_space_id is not null and public.is_space_admin(seller_space_id, auth.uid()))
    or public.is_guardian_of(buyer_id, auth.uid())
    or public.is_guardian_of(seller_id, auth.uid())
  );

create index if not exists exchanges_post_idx on public.exchanges (post_id);
create index if not exists exchanges_buyer_idx on public.exchanges (buyer_id, status);
create index if not exists exchanges_seller_idx on public.exchanges (seller_id, status);

/** Is this listing spoken for? Deliberately says only YES or NO — who claimed
 *  it stays private, the resource_busy() stance. Anyone signed in may ask,
 *  because the answer is what stops people wasting their time. */
create or replace function public.post_claimed(p_post uuid)
returns boolean language sql stable security definer set search_path to 'public' as $func$
  select exists (
    select 1 from public.exchanges x
    where x.post_id = p_post and x.status in ('accepted', 'completed')
  );
$func$;
revoke all on function public.post_claimed(uuid) from public, anon;
grant execute on function public.post_claimed(uuid) to authenticated;

-- ── Ask for it ────────────────────────────────────────────────────────────
create or replace function public.request_exchange(
  p_post uuid, p_mode text default null,
  p_fulfillment text default null, p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_post public.posts%rowtype;
  v_mode text; v_amount numeric(12,2); v_id uuid;
  v_minor boolean; v_who text;
begin
  select * into v_post from public.posts where id = p_post;
  if v_post.id is null then raise exception 'That listing is gone.'; end if;
  if not (v_post.service_areas @> array['marketplace']) then
    raise exception 'That isn''t a marketplace listing.';
  end if;
  if v_post.author_id = auth.uid() then
    raise exception 'That''s your own listing.';
  end if;
  if public.post_claimed(p_post) then
    raise exception 'Someone already claimed this one.';
  end if;
  if exists (select 1 from public.exchanges x
              where x.post_id = p_post and x.buyer_id = auth.uid()
                and x.status = 'pending') then
    raise exception 'You''ve already asked for this — it''s waiting on them.';
  end if;

  -- Freeze the terms as they stand right now.
  v_mode := coalesce(nullif(p_mode, ''), v_post.details->>'mode', 'gift');
  v_amount := coalesce(
    nullif(regexp_replace(coalesce(v_post.details->>'price', ''), '[^0-9.]', '', 'g'), '')::numeric,
    0);
  -- Only priced modes carry money; a gift is a gift.
  if v_mode not in ('sale', 'sliding', 'rent') then v_amount := 0; end if;

  -- Either party under 18 → a grown-up says yes before anything changes hands.
  v_minor := public.is_minor(auth.uid()) or public.is_minor(v_post.author_id);

  insert into public.exchanges (post_id, seller_id, seller_space_id, buyer_id,
                                mode, amount, fulfillment, note, needs_guardian)
  values (p_post, v_post.author_id, v_post.author_space_id, auth.uid(),
          v_mode, v_amount, nullif(p_fulfillment, ''), nullif(p_note, ''), v_minor)
  returning id into v_id;

  select coalesce(full_name, 'Someone') into v_who from public.profiles where id = auth.uid();
  perform public.notify(
    v_post.author_id, 'market', null, 'exchange_request',
    v_who || ' would like your ' || coalesce(v_post.title, 'listing'),
    coalesce(p_note, 'Open it to say yes or not now.'),
    '/posts/' || p_post, auth.uid());

  -- And the grown-ups who hold either party.
  perform public.notify(g.guardian_id, 'market', null, 'exchange_guardian',
    v_who || ' started an exchange that needs your yes',
    coalesce(v_post.title, 'A marketplace listing'),
    '/profile#holding', auth.uid())
  from public.guardians g
  where v_minor and g.minor_id in (auth.uid(), v_post.author_id);

  return v_id;
end $fn$;
revoke all on function public.request_exchange(uuid, text, text, text) from public, anon;
grant execute on function public.request_exchange(uuid, text, text, text) to authenticated;

-- ── Yes or not now ────────────────────────────────────────────────────────
create or replace function public.decide_exchange(p_exchange uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_x public.exchanges%rowtype; v_who text;
begin
  select * into v_x from public.exchanges where id = p_exchange;
  if v_x.id is null then raise exception 'No such exchange.'; end if;
  if not (v_x.seller_id = auth.uid()
          or (v_x.seller_space_id is not null
              and public.is_space_admin(v_x.seller_space_id, auth.uid()))) then
    raise exception 'Only the person offering it can answer.';
  end if;
  if v_x.status <> 'pending' then raise exception 'That''s already settled.'; end if;

  update public.exchanges
     set status = case when p_accept then 'accepted' else 'declined' end,
         decided_at = now()
   where id = p_exchange;

  select coalesce(full_name, 'They') into v_who from public.profiles where id = v_x.seller_id;
  perform public.notify(
    v_x.buyer_id, 'market', null,
    case when p_accept then 'exchange_accepted' else 'exchange_declined' end,
    case when p_accept then v_who || ' said yes' else v_who || ' passed this time' end,
    case when p_accept then 'Arrange the handoff — mark it done when it''s done.'
         else 'The listing stays open for others.' end,
    '/posts/' || v_x.post_id, auth.uid());
end $fn$;
revoke all on function public.decide_exchange(uuid, boolean) from public, anon;
grant execute on function public.decide_exchange(uuid, boolean) to authenticated;

-- ── The grown-up's yes ────────────────────────────────────────────────────
create or replace function public.approve_exchange_guardian(p_exchange uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_x public.exchanges%rowtype;
begin
  select * into v_x from public.exchanges where id = p_exchange;
  if v_x.id is null then raise exception 'No such exchange.'; end if;
  if not (public.is_guardian_of(v_x.buyer_id, auth.uid())
          or public.is_guardian_of(v_x.seller_id, auth.uid())) then
    raise exception 'Only a guardian can approve this.';
  end if;
  update public.exchanges set guardian_ok_at = now() where id = p_exchange;
  perform public.notify(v_x.buyer_id, 'market', null, 'exchange_guardian_ok',
    'A grown-up said yes', 'Your exchange can go ahead.',
    '/posts/' || v_x.post_id, auth.uid());
end $fn$;
revoke all on function public.approve_exchange_guardian(uuid) from public, anon;
grant execute on function public.approve_exchange_guardian(uuid) to authenticated;

-- ── Both hands on the handoff ─────────────────────────────────────────────
-- Settlement writes ledger_entries DIRECTLY rather than calling
-- send_currentcy: that function takes no ref_type/ref_id (so a payment could
-- never point at the exchange), and its steward + minor guards were added by
-- textual rewrites of its own body — changing its signature would silently
-- drop them. The guards that matter here are restated explicitly.
create or replace function public.complete_exchange(p_exchange uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_x public.exchanges%rowtype;
  v_is_buyer boolean; v_is_seller boolean;
  v_bal numeric; v_entry uuid; v_who text;
begin
  select * into v_x from public.exchanges where id = p_exchange;
  if v_x.id is null then raise exception 'No such exchange.'; end if;
  if v_x.status <> 'accepted' then
    raise exception 'This one isn''t agreed yet.';
  end if;
  if v_x.needs_guardian and v_x.guardian_ok_at is null then
    raise exception 'A grown-up needs to say yes first.';
  end if;

  v_is_buyer := v_x.buyer_id = auth.uid();
  v_is_seller := v_x.seller_id = auth.uid()
    or (v_x.seller_space_id is not null
        and public.is_space_admin(v_x.seller_space_id, auth.uid()));
  if not (v_is_buyer or v_is_seller) then
    raise exception 'Only the two of you can close this.';
  end if;

  update public.exchanges
     set buyer_done_at = case when v_is_buyer then now() else buyer_done_at end,
         seller_done_at = case when v_is_seller then now() else seller_done_at end
   where id = p_exchange
  returning * into v_x;

  -- One hand isn't a handoff — wait for the other.
  if v_x.buyer_done_at is null or v_x.seller_done_at is null then return; end if;

  if v_x.amount > 0 then
    select coalesce(sum(case when to_type = 'profile' and to_id = v_x.buyer_id then amount else 0 end), 0)
         - coalesce(sum(case when from_type = 'profile' and from_id = v_x.buyer_id then amount else 0 end), 0)
      into v_bal from public.ledger_entries
     where (to_type = 'profile' and to_id = v_x.buyer_id)
        or (from_type = 'profile' and from_id = v_x.buyer_id);
    if v_bal < v_x.amount then
      raise exception 'Not enough Current-cy — this account holds %.', v_bal;
    end if;
    insert into public.ledger_entries
      (from_type, from_id, to_type, to_id, amount, context, memo,
       ref_type, ref_id, created_by)
    values ('profile', v_x.buyer_id, 'profile', v_x.seller_id, v_x.amount,
            'exchange', 'Marketplace exchange', 'exchange', v_x.id, auth.uid())
    returning id into v_entry;
  end if;

  update public.exchanges
     set status = 'completed', completed_at = now(), ledger_entry_id = v_entry
   where id = p_exchange;

  select coalesce(full_name, 'They') into v_who from public.profiles where id = auth.uid();
  perform public.notify(
    case when v_is_buyer then v_x.seller_id else v_x.buyer_id end,
    'market', null, 'exchange_completed',
    'That exchange is complete',
    v_who || ' marked it done. It''s in your statement.',
    '/posts/' || v_x.post_id, auth.uid());
end $fn$;
revoke all on function public.complete_exchange(uuid) from public, anon;
grant execute on function public.complete_exchange(uuid) to authenticated;

-- ── Either party can walk away, before it's done ──────────────────────────
create or replace function public.cancel_exchange(p_exchange uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_x public.exchanges%rowtype;
begin
  select * into v_x from public.exchanges where id = p_exchange;
  if v_x.id is null then raise exception 'No such exchange.'; end if;
  if v_x.status = 'completed' then raise exception 'That one already happened.'; end if;
  if not (v_x.buyer_id = auth.uid() or v_x.seller_id = auth.uid()
          or (v_x.seller_space_id is not null
              and public.is_space_admin(v_x.seller_space_id, auth.uid()))) then
    raise exception 'Not yours to cancel.';
  end if;
  update public.exchanges set status = 'canceled' where id = p_exchange;
  perform public.notify(
    case when v_x.buyer_id = auth.uid() then v_x.seller_id else v_x.buyer_id end,
    'market', null, 'exchange_canceled',
    'An exchange was called off', 'The listing is open again.',
    '/posts/' || v_x.post_id, auth.uid());
end $fn$;
revoke all on function public.cancel_exchange(uuid) from public, anon;
grant execute on function public.cancel_exchange(uuid) to authenticated;

-- ── The matcher stops ringing for goods that are gone ─────────────────────
-- match_marketplace_post() (20260814120000) had no notion of "claimed", so it
-- would keep matching members to things already spoken for.
do $$
declare v_src text;
begin
  select pg_get_functiondef(oid) into v_src from pg_proc
   where proname = 'match_marketplace_post' and pronamespace = 'public'::regnamespace limit 1;
  if v_src is null then
    raise notice 'matcher not found — skipping';
  elsif position('exchanges' in v_src) > 0 then
    raise notice 'matcher already skips claimed listings';
  else
    v_src := replace(v_src, 'p.created_at > now() - interval ''90 days''',
      'p.created_at > now() - interval ''90 days''' || chr(10) ||
      '      and not exists (select 1 from public.exchanges x' || chr(10) ||
      '                       where x.post_id = p.id and x.status in (''accepted'', ''completed''))');
    execute v_src;
    raise notice 'matcher now skips claimed listings';
  end if;
end $$;
