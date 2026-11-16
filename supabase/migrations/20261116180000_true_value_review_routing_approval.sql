-- THE FOUNDER'S THREE ANSWERS (2026-11-16): "true value is set by the person
-- and reviewed by me for now" + "honor system, with a check"; "algo can
-- suggest and it sends me the suggestions to approve for now"; "donations
-- will be in relay - so it would need to be an auto deduction from relay…
-- for now, i have to approve all deductions".
--   1. a true value COUNTS the moment the person sets it (honor); a steward's
--      look is a check after — reviewed ✓ or a question, never a gate.
--   2. the suggestion SCORE lives in SQL (one source), and a daily tick bells
--      the stewards with the newest suggestions to approve.
--   3. an approved funding is paid by hand from Relay (no public payments
--      API) and marked paid here — never moves on its own.

-- ── 1. the check on the honor system ───────────────────────────────────────
alter table public.true_values
  add column if not exists review_status text not null default 'pending',
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists review_note text;
alter table public.true_values drop constraint if exists true_values_review_status_check;
alter table public.true_values add constraint true_values_review_status_check
  check (review_status in ('pending', 'reviewed', 'questioned'));
alter table public.true_values drop constraint if exists true_values_review_note_len;
alter table public.true_values add constraint true_values_review_note_len
  check (review_note is null or char_length(review_note) <= 500);

-- Owners can't review themselves; changing the value asks for a fresh look.
create or replace function public.true_values_guard()
returns trigger language plpgsql security definer set search_path = public as $func$
begin
  if new.being_id is not null and not exists
     (select 1 from profiles where id = new.being_id and coalesce(kind, 'person') <> 'person') then
    raise exception 'Only a stewarded member (a plant, animal, place, element or collective) can be named as the being.';
  end if;
  if coalesce(current_setting('lichen.tv_review', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      new.review_status := 'pending'; new.reviewed_at := null; new.reviewed_by := null; new.review_note := null;
    else
      if new.true_cents is distinct from old.true_cents or new.exchanged_cents is distinct from old.exchanged_cents
         or new.being_id is distinct from old.being_id then
        new.review_status := 'pending'; new.reviewed_at := null; new.reviewed_by := null; new.review_note := null;
      else
        new.review_status := old.review_status; new.reviewed_at := old.reviewed_at;
        new.reviewed_by := old.reviewed_by; new.review_note := old.review_note;
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end; $func$;

create or replace function public.true_value_review_queue()
returns table (id uuid, owner_id uuid, owner_name text, source text, direction text, title text,
               counterparty text, being_name text, exchanged_cents integer, true_cents integer,
               note text, at timestamptz, review_status text, review_note text)
language sql stable security definer set search_path = public as $func$
  select t.id, t.owner_id, p.full_name, t.source, t.direction, t.title, t.counterparty,
         b.full_name, t.exchanged_cents, t.true_cents, t.note, t.at, t.review_status, t.review_note
    from true_values t join profiles p on p.id = t.owner_id
    left join profiles b on b.id = t.being_id
   where t.review_status in ('pending', 'questioned')
     and exists (select 1 from profiles me where me.id = auth.uid() and me.is_admin)
   order by (t.review_status = 'pending') desc, t.updated_at desc
   limit 100;
$func$;
revoke all on function public.true_value_review_queue() from public, anon;
grant execute on function public.true_value_review_queue() to authenticated;

create or replace function public.review_true_value(p_id uuid, p_ok boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $func$
declare v_owner uuid; v_title text;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
    raise exception 'Only a Lichen steward can review a true value.';
  end if;
  select owner_id, coalesce(title, 'a value you recorded') into v_owner, v_title from true_values where id = p_id;
  if v_owner is null then raise exception 'That record is gone.'; end if;
  perform set_config('lichen.tv_review', 'on', true);
  update true_values set review_status = case when p_ok then 'reviewed' else 'questioned' end,
         reviewed_at = now(), reviewed_by = auth.uid(),
         review_note = nullif(left(trim(coalesce(p_note, '')), 500), '')
   where id = p_id;
  perform set_config('lichen.tv_review', '', true);
  if not p_ok then
    perform notify(v_owner, 'currentcy', null, 'true_value_question',
      'A question about a value you recorded',
      'A Lichen steward would like to talk about “' || v_title || '”' ||
        coalesce(': ' || nullif(trim(coalesce(p_note, '')), ''), '.') ,
      '/currentcy', auth.uid());
  end if;
end; $func$;
revoke all on function public.review_true_value(uuid, boolean, text) from public, anon;
grant execute on function public.review_true_value(uuid, boolean, text) to authenticated;

-- Beings' totals: the honor system counts everything but what's in question.
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
   where t.being_id is not null and t.review_status <> 'questioned'
     and exists (select 1 from profiles me where me.id = auth.uid() and me.is_admin)
   group by t.being_id, p.full_name, p.kind, p.jurisdiction
   order by coalesce(sum(t.true_cents) filter (where t.direction = 'received'), 0)
          - coalesce(sum(t.true_cents) filter (where t.direction = 'given'), 0) desc
   limit 100;
$func$;

-- ── 3. paid by hand from Relay ─────────────────────────────────────────────
alter table public.budget_items
  add column if not exists paid_at timestamptz,
  add column if not exists paid_note text,
  add column if not exists suggested_at timestamptz;
alter table public.budget_items drop constraint if exists budget_items_paid_note_len;
alter table public.budget_items add constraint budget_items_paid_note_len
  check (paid_note is null or char_length(paid_note) <= 200);

create or replace function public.budget_items_guard_funding()
returns trigger language plpgsql set search_path = public as $func$
begin
  if coalesce(current_setting('lichen.need_funding', true), '') <> 'on'
     and (new.funded_cents is distinct from old.funded_cents
       or new.funded_at is distinct from old.funded_at
       or new.funded_by is distinct from old.funded_by
       or new.paid_at is distinct from old.paid_at
       or new.paid_note is distinct from old.paid_note
       or new.suggested_at is distinct from old.suggested_at) then
    raise exception 'Funding a need is a Lichen steward''s decision.';
  end if;
  return new;
end; $func$;

create or replace function public.mark_need_paid(p_need uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $func$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
    raise exception 'Only a Lichen steward can mark a need paid.';
  end if;
  if not exists (select 1 from budget_items where id = p_need and funded_cents is not null) then
    raise exception 'Approve the funding first.';
  end if;
  perform set_config('lichen.need_funding', 'on', true);
  update budget_items set paid_at = now(),
         paid_note = coalesce(nullif(left(trim(coalesce(p_note, '')), 200), ''), 'Paid from Relay')
   where id = p_need;
  perform set_config('lichen.need_funding', '', true);
end; $func$;
revoke all on function public.mark_need_paid(uuid, text) from public, anon;
grant execute on function public.mark_need_paid(uuid, text) to authenticated;

-- ── 2. the score, in one place ─────────────────────────────────────────────
-- By NEED, never by past giving: can't pay +3 / trade only +1 / can afford
-- part +1; +1 per 14 days waiting (cap 3); −1 per gift or per $100 funded in
-- the last 180 days (cap −4); −1 if a gift was already offered.
create or replace function public._need_score(b public.budget_items, p_gifts integer, p_funded integer)
returns table (score integer, reasons text[])
language plpgsql stable set search_path = public as $func$
declare s integer := 0; r text[] := '{}'; days numeric; w integer; recent integer;
begin
  if b.offer_kind = 'none' then s := s + 3; r := array_append(r, 'can''t pay right now'::text);
  elsif b.offer_kind = 'trade' then s := s + 1; r := array_append(r, 'can only trade'::text);
  elsif b.offer_kind = 'pay' and b.amount_cents is not null and coalesce(b.offer_cents, 0) < b.amount_cents then
    s := s + 1; r := array_append(r, ('can afford $' || (coalesce(b.offer_cents, 0) / 100) || ' of $' || (b.amount_cents / 100))::text);
  end if;
  days := extract(epoch from now() - b.created_at) / 86400;
  w := least(3, floor(days / 14)::int);
  if w > 0 then s := s + w; r := array_append(r, ('waiting ' || round(days) || ' days')::text); end if;
  recent := coalesce(p_gifts, 0) + floor(coalesce(p_funded, 0) / 10000.0)::int;
  if recent > 0 then s := s - least(4, recent); r := array_append(r, 'already received recently'::text);
  else r := array_append(r, 'nothing received lately'::text); end if;
  if b.gift_offered_post_id is not null then s := s - 1; r := array_append(r, 'a gift was already offered'::text); end if;
  return query select s, r;
end; $func$;

drop function if exists public.routing_needs();
create function public.routing_needs()
returns table (id uuid, profile_id uuid, full_name text, label text, amount_cents integer,
               offer_kind text, offer_cents integer, offer_trade text, created_at timestamptz,
               gift_offered_post_id uuid, gift_offered_at timestamptz,
               provider_name text, provider_profile_id uuid, provider_space_id uuid,
               funded_cents integer, funded_at timestamptz, paid_at timestamptz, paid_note text,
               gifts_received_180d integer, funded_180d_cents integer, score integer, reasons text[])
language sql stable security definer set search_path = public as $func$
  with base as (
    select b, p.full_name as fname,
           coalesce(b.provider_name, pp.full_name, ps.name) as prov,
           (select count(*)::int from exchanges x
             where x.buyer_id = b.profile_id and x.buyer_space_id is null and x.status = 'completed'
               and x.mode in ('gift', 'free', 'lichen') and x.completed_at > now() - interval '180 days') as gifts,
           (select coalesce(sum(o.funded_cents), 0)::int from budget_items o
             where o.profile_id = b.profile_id and o.funded_at > now() - interval '180 days') as funded
      from budget_items b join profiles p on p.id = b.profile_id
      left join profiles pp on pp.id = b.provider_profile_id
      left join spaces ps on ps.id = b.provider_space_id
     where b.bucket = 'need' and b.matchable
       and exists (select 1 from profiles me where me.id = auth.uid() and me.is_admin)
  )
  select (base.b).id, (base.b).profile_id, base.fname, coalesce((base.b).label, ''), (base.b).amount_cents,
         (base.b).offer_kind, (base.b).offer_cents, (base.b).offer_trade, (base.b).created_at,
         (base.b).gift_offered_post_id, (base.b).gift_offered_at,
         base.prov, (base.b).provider_profile_id, (base.b).provider_space_id,
         (base.b).funded_cents, (base.b).funded_at, (base.b).paid_at, (base.b).paid_note,
         base.gifts, base.funded, s.score, s.reasons
    from base cross join lateral public._need_score(base.b, base.gifts, base.funded) s
   order by (base.b).created_at desc
   limit 200;
$func$;
revoke all on function public.routing_needs() from public, anon;
grant execute on function public.routing_needs() to authenticated;

-- The daily nudge: the algorithm SUGGESTS, the steward decides. Each need is
-- suggested once (suggested_at); a bell to every platform admin names the top
-- few and links the desk.
create or replace function public.tick_routing_suggestions()
returns void language plpgsql security definer set search_path = public as $func$
declare v_list text; v_ids uuid[]; v_n integer; a record;
begin
  with c as (
    select b.id, b.label, b.amount_cents, p.full_name,
           coalesce(b.provider_name, pp.full_name, ps.name) as prov,
           (select s.score from public._need_score(b,
              (select count(*)::int from exchanges x where x.buyer_id = b.profile_id and x.buyer_space_id is null
                 and x.status = 'completed' and x.mode in ('gift','free','lichen') and x.completed_at > now() - interval '180 days'),
              (select coalesce(sum(o.funded_cents),0)::int from budget_items o where o.profile_id = b.profile_id
                 and o.funded_at > now() - interval '180 days')) s) as score
      from budget_items b join profiles p on p.id = b.profile_id
      left join profiles pp on pp.id = b.provider_profile_id
      left join spaces ps on ps.id = b.provider_space_id
     where b.bucket = 'need' and b.matchable and b.funded_cents is null and b.suggested_at is null
  ), top as (select * from c where score >= 1 order by score desc limit 3)
  select string_agg(coalesce(full_name, 'A member') || ' — ' || coalesce(nullif(label, ''), 'a need')
           || coalesce(' with ' || prov, ''), '; '),
         array_agg(id), count(*)
    into v_list, v_ids, v_n from top;
  if coalesce(v_n, 0) = 0 then return; end if;
  perform set_config('lichen.need_funding', 'on', true);
  update budget_items set suggested_at = now() where id = any(v_ids);
  perform set_config('lichen.need_funding', '', true);
  for a in select id from profiles where is_admin loop
    perform notify(a.id, 'currentcy', null, 'routing_suggestion',
      case when v_n = 1 then 'A need to approve' else v_n || ' needs to approve' end,
      'Suggested by need: ' || v_list || '. Nothing moves until you approve.',
      '/admin/supporters#routing', null);
  end loop;
end; $func$;
revoke all on function public.tick_routing_suggestions() from public, anon, authenticated;

do $do$ begin
  perform cron.unschedule('tick-routing-suggestions')
    where exists (select 1 from cron.job where jobname = 'tick-routing-suggestions');
  perform cron.schedule('tick-routing-suggestions', '17 16 * * *', 'select public.tick_routing_suggestions()');
end $do$;
