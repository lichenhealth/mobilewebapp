-- A COMMUNITY CAN BUY, AND A COMMUNITY GETS PAID (founder 2026-08-13:
-- "communities may have their own current-cy, so an admin can buy on behalf
-- of that community" / "I'm always a participant, even if i'm an org").
--
-- The exchange flow (request → accept → both-say-done → Current moves) was
-- built with a polymorphic SELLER — a space could list — but the buyer was
-- hard-wired to a person, and worse, completion paid the HUMAN who posted the
-- space's listing, not the space: the treasury was bypassed on its own sales.
-- This closes both sides:
--
--   * exchanges.buyer_space_id — a space as buyer, requested and completed by
--     its admins. buyer_id still records WHICH human acted (the truster_id
--     pattern: the space speaks, a named person stays accountable).
--   * completion debits the buying party and credits the SELLING party —
--     space or person on either side.
--   * the not_self rule relaxes just enough for "the barn buys its admin's
--     saddle": buyer and seller humans may match when a space is the real
--     buyer. Treasury-pays-its-own-admin is already possible via
--     send_currentcy, so this opens no new door.
--
-- A treasury purchase skips the guardian gate on the BUYER side — the admin
-- role is the guard there, and the guardian flow governs a young person's own
-- money — but a minor SELLER still gets one.

alter table public.exchanges
  add column if not exists buyer_space_id uuid references public.spaces(id) on delete set null;

comment on column public.exchanges.buyer_space_id is
  'Set when a SPACE is the buyer, acting through the admin in buyer_id. Completion debits the space''s treasury, not the human.';

alter table public.exchanges drop constraint if exists exchanges_not_self;
alter table public.exchanges
  add constraint exchanges_not_self
    check (buyer_id <> seller_id or buyer_space_id is not null);

alter table public.exchanges drop constraint if exists exchanges_no_space_self_deal;
alter table public.exchanges
  add constraint exchanges_no_space_self_deal
    check (buyer_space_id is null or seller_space_id is null
           or buyer_space_id <> seller_space_id);

create index if not exists exchanges_buyer_space_idx
  on public.exchanges (buyer_space_id, status) where buyer_space_id is not null;

-- Reads: the buying space's admins see its side, same as the selling space's.
drop policy if exists "exchanges: parties read" on public.exchanges;
create policy "exchanges: parties read" on public.exchanges
  for select to authenticated
  using (
    buyer_id = auth.uid()
    or seller_id = auth.uid()
    or (seller_space_id is not null and public.is_space_admin(seller_space_id, auth.uid()))
    or (buyer_space_id is not null and public.is_space_admin(buyer_space_id, auth.uid()))
    or public.is_guardian_of(buyer_id, auth.uid())
    or public.is_guardian_of(seller_id, auth.uid())
  );

-- ── Ask for it, wearing the space's hat if you hold it ────────────────────
-- New optional parameter = new argument list; the old 4-arg function is
-- dropped so PostgREST never has two candidates to resolve between.
drop function if exists public.request_exchange(uuid, text, text, text);

create or replace function public.request_exchange(
  p_post uuid, p_mode text default null,
  p_fulfillment text default null, p_note text default null,
  p_as_space uuid default null
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

  if p_as_space is not null then
    if not public.is_space_admin(p_as_space, auth.uid()) then
      raise exception 'Only that group''s admins can buy on its behalf.';
    end if;
    if v_post.author_space_id = p_as_space then
      raise exception 'That''s this group''s own listing.';
    end if;
  elsif v_post.author_id = auth.uid() then
    raise exception 'That''s your own listing.';
  end if;

  if public.post_claimed(p_post) then
    raise exception 'Someone already claimed this one.';
  end if;
  -- One live ask per PARTY: yours as yourself, and one per space you steward.
  if exists (select 1 from public.exchanges x
              where x.post_id = p_post and x.status = 'pending'
                and ((p_as_space is null and x.buyer_id = auth.uid() and x.buyer_space_id is null)
                  or (p_as_space is not null and x.buyer_space_id = p_as_space))) then
    raise exception 'You''ve already asked for this — it''s waiting on them.';
  end if;

  -- Freeze the terms as they stand right now. The FIRST number in the price
  -- text, not every digit mashed together — the old strip-non-numerics turned
  -- "sliding $10–$25" into 1025 Current. A range freezes at its low end; the
  -- seller can always decline and name a figure in chat.
  v_mode := coalesce(nullif(p_mode, ''), v_post.details->>'mode', 'gift');
  v_amount := coalesce(
    nullif(substring(coalesce(v_post.details->>'price', '') from '[0-9]+\.?[0-9]*'), '')::numeric,
    0);
  -- Only priced modes carry money; a gift is a gift.
  if v_mode not in ('sale', 'sliding', 'rent') then v_amount := 0; end if;

  -- A treasury purchase is admin-gated, not guardian-gated — but a minor
  -- SELLER still gets a grown-up's yes before anything changes hands.
  v_minor := (p_as_space is null and public.is_minor(auth.uid()))
             or public.is_minor(v_post.author_id);

  insert into public.exchanges (post_id, seller_id, seller_space_id,
                                buyer_id, buyer_space_id,
                                mode, amount, fulfillment, note, needs_guardian)
  values (p_post, v_post.author_id, v_post.author_space_id,
          auth.uid(), p_as_space,
          v_mode, v_amount, nullif(p_fulfillment, ''), nullif(p_note, ''), v_minor)
  returning id into v_id;

  if p_as_space is not null then
    select name into v_who from public.spaces where id = p_as_space;
    v_who := coalesce(v_who, 'A group');
  else
    select coalesce(full_name, 'Someone') into v_who from public.profiles where id = auth.uid();
  end if;
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
revoke all on function public.request_exchange(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.request_exchange(uuid, text, text, text, uuid) to authenticated;

-- ── Both hands, then the money — to the right party ───────────────────────
create or replace function public.complete_exchange(p_exchange uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_x public.exchanges%rowtype;
  v_is_buyer boolean; v_is_seller boolean;
  v_bal numeric; v_entry uuid; v_who text; v_space text; v_admin record;
  v_from_type text; v_from_id uuid; v_to_type text; v_to_id uuid;
begin
  select * into v_x from public.exchanges where id = p_exchange;
  if v_x.id is null then raise exception 'No such exchange.'; end if;
  if v_x.status <> 'accepted' then
    raise exception 'This one isn''t agreed yet.';
  end if;
  if v_x.needs_guardian and v_x.guardian_ok_at is null then
    raise exception 'A grown-up needs to say yes first.';
  end if;

  v_is_buyer := v_x.buyer_id = auth.uid()
    or (v_x.buyer_space_id is not null
        and public.is_space_admin(v_x.buyer_space_id, auth.uid()));
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
    -- The PARTIES, not the people: a space buyer pays from its treasury, a
    -- space seller is paid INTO its treasury (this used to credit the human
    -- who posted the space's listing — the treasury never saw its own sales).
    v_from_type := case when v_x.buyer_space_id is not null then 'space' else 'profile' end;
    v_from_id   := coalesce(v_x.buyer_space_id, v_x.buyer_id);
    v_to_type   := case when v_x.seller_space_id is not null then 'space' else 'profile' end;
    v_to_id     := coalesce(v_x.seller_space_id, v_x.seller_id);

    -- Same lock keyspace as send_currentcy, so concurrent spends from the
    -- same party serialize against each other no matter which door they use.
    perform pg_advisory_xact_lock(hashtextextended(v_from_type || ':' || v_from_id::text, 42));

    select coalesce(sum(case when to_type = v_from_type and to_id = v_from_id then amount else 0 end), 0)
         - coalesce(sum(case when from_type = v_from_type and from_id = v_from_id then amount else 0 end), 0)
      into v_bal from public.ledger_entries
     where (to_type = v_from_type and to_id = v_from_id)
        or (from_type = v_from_type and from_id = v_from_id);
    if v_bal < v_x.amount then
      raise exception 'Not enough Current-cy — this account holds %.', v_bal;
    end if;
    insert into public.ledger_entries
      (from_type, from_id, to_type, to_id, amount, context, memo,
       ref_type, ref_id, created_by)
    values (v_from_type, v_from_id, v_to_type, v_to_id, v_x.amount,
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

  -- Money landed in a treasury: its stewards hear, same as send_currentcy.
  if v_entry is not null and v_x.seller_space_id is not null then
    select name into v_space from public.spaces where id = v_x.seller_space_id;
    for v_admin in
      select m.profile_id from public.space_members m
       where m.space_id = v_x.seller_space_id
         and m.role in ('admin', 'super_admin')
         and m.profile_id <> auth.uid()
    loop
      perform public.notify(v_admin.profile_id, 'home', v_x.seller_space_id, 'currentcy',
        coalesce(v_space, 'Your group') || ' received '
          || trim(to_char(v_x.amount, 'FM999999990.##')) || ' Current',
        'A marketplace exchange completed.',
        '/spaces/' || v_x.seller_space_id::text || '?manage=1', auth.uid());
    end loop;
  end if;
end $fn$;

-- ── Walking away: the buying space's other admins can too ─────────────────
create or replace function public.cancel_exchange(p_exchange uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_x public.exchanges%rowtype;
begin
  select * into v_x from public.exchanges where id = p_exchange;
  if v_x.id is null then raise exception 'No such exchange.'; end if;
  if v_x.status = 'completed' then raise exception 'That one already happened.'; end if;
  if not (v_x.buyer_id = auth.uid() or v_x.seller_id = auth.uid()
          or (v_x.seller_space_id is not null
              and public.is_space_admin(v_x.seller_space_id, auth.uid()))
          or (v_x.buyer_space_id is not null
              and public.is_space_admin(v_x.buyer_space_id, auth.uid()))) then
    raise exception 'Not yours to cancel.';
  end if;
  update public.exchanges set status = 'canceled' where id = p_exchange;
  perform public.notify(
    case when v_x.buyer_id = auth.uid() then v_x.seller_id else v_x.buyer_id end,
    'market', null, 'exchange_canceled',
    'An exchange was called off', 'The listing is open again.',
    '/posts/' || v_x.post_id, auth.uid());
end $fn$;
