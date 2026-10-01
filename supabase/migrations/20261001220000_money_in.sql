-- Money in (founder 2026-10-01): an admin-set operating rate on donations
-- (5–15%, drives the public /donate copy live), bucket-tagged donations
-- (operations / community / concierge / general), and Current-cy LOADS —
-- "your Current-cy is like a checking account: you can earn it or you can
-- load money into it." Loads mint 1:1 only after Stripe confirms payment
-- (the stripe-webhook calls record_currentcy_load), so every minted Current
-- stays backed by a real dollar actually held — the float rule generalized
-- to every door dollars come in through.

-- ── 1. Platform settings — one admin-writable, world-readable row store ────
create table if not exists public.platform_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
alter table public.platform_settings enable row level security;
-- The operating rate drives member- and DONOR-facing copy (donors may be
-- signed out), so reads are open; writes go only through the RPC below.
drop policy if exists "settings: anyone reads" on public.platform_settings;
create policy "settings: anyone reads" on public.platform_settings
  for select using (true);
grant select on public.platform_settings to anon, authenticated;

insert into public.platform_settings (key, value)
values ('operating_rate_pct', to_jsonb(15))
on conflict (key) do nothing;

-- Current effective rate (policy floor/ceiling 5–15; clamp defensively so a
-- hand-edited row can never make the public copy state an out-of-policy rate).
create or replace function public.operating_rate_pct()
returns integer
language sql stable
set search_path to 'public'
as $func$
  select greatest(5, least(15, coalesce(
    (select (value #>> '{}')::int from platform_settings where key = 'operating_rate_pct'),
    15)));
$func$;
grant execute on function public.operating_rate_pct() to anon, authenticated;

create or replace function public.set_operating_rate(p_pct integer)
returns void
language plpgsql security definer
set search_path to 'public'
as $func$
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only admins can set the operating rate.';
  end if;
  if p_pct is null or p_pct < 5 or p_pct > 15 then
    raise exception 'The operating rate must be between 5 and 15 percent.';
  end if;
  insert into platform_settings (key, value, updated_at, updated_by)
  values ('operating_rate_pct', to_jsonb(p_pct), now(), auth.uid())
  on conflict (key) do update
    set value = excluded.value, updated_at = now(), updated_by = auth.uid();
end $func$;

-- ── 2. Donations carry their bucket and their FROZEN rate ──────────────────
-- The rate a donor read under the Donate button is the rate their gift keeps,
-- whatever the admin sets later; the bucket is where the gift pools
-- (operations / community / concierge / general — founder's three wells).
alter table public.donations
  add column if not exists fund text
    check (fund in ('operations', 'community', 'concierge', 'general')),
  add column if not exists operating_rate_pct integer
    check (operating_rate_pct between 5 and 15);

-- ── 3. Current-cy loads — dollars onto the platform, minted 1:1 ────────────
alter table public.ledger_entries drop constraint if exists ledger_entries_context_check;
alter table public.ledger_entries add constraint ledger_entries_context_check
  check (context in ('mint','grant','gift','exchange','contribution','adjustment','burn','load'));

create table if not exists public.currentcy_loads (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references public.profiles(id),
  amount_cents      integer not null check (amount_cents > 0),
  stripe_session_id text not null unique,
  ledger_entry_id   uuid references public.ledger_entries(id),
  created_at        timestamptz not null default now()
);
alter table public.currentcy_loads enable row level security;
drop policy if exists "loads: own" on public.currentcy_loads;
create policy "loads: own" on public.currentcy_loads
  for select using (profile_id = auth.uid());
grant select on public.currentcy_loads to authenticated;

-- Called ONLY by the stripe-webhook (service role) after a paid checkout.
-- Idempotent per Stripe session, so webhook retries never double-mint.
create or replace function public.record_currentcy_load(
  p_profile uuid, p_amount_cents integer, p_session text
) returns uuid
language plpgsql security definer
set search_path to 'public'
as $func$
declare v_load uuid; v_ledger uuid; v_amt numeric;
begin
  if p_profile is null or p_session is null or coalesce(p_amount_cents, 0) <= 0 then
    raise exception 'Bad load.';
  end if;
  if not exists (select 1 from profiles where id = p_profile) then
    raise exception 'No such member.';
  end if;

  insert into currentcy_loads (profile_id, amount_cents, stripe_session_id)
  values (p_profile, p_amount_cents, p_session)
  on conflict (stripe_session_id) do nothing
  returning id into v_load;
  if v_load is null then
    -- Retry of an already-recorded session: answer with the existing mint.
    select ledger_entry_id into v_ledger from currentcy_loads where stripe_session_id = p_session;
    return v_ledger;
  end if;

  v_amt := round(p_amount_cents / 100.0, 2);
  insert into ledger_entries (from_type, from_id, to_type, to_id, amount, context, memo, ref_type, ref_id)
  values (null, null, 'profile', p_profile, v_amt, 'load', 'Loaded from your card', 'load', v_load)
  returning id into v_ledger;

  update currentcy_loads set ledger_entry_id = v_ledger where id = v_load;

  perform public.notify(p_profile, 'home', null, 'currentcy',
    trim(to_char(v_amt, 'FM999999990.##')) || ' Current loaded into your wallet',
    null, '/currentcy', null);
  return v_ledger;
end $func$;
revoke execute on function public.record_currentcy_load(uuid, integer, text) from public, anon, authenticated;

-- ── 4. translate_donation honors the frozen rate (95/5 hardcode retired) ───
create or replace function public.translate_donation(p_donation uuid, p_to_type text, p_to_id uuid)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $func$
declare
  d record; v_rate integer; v_grant numeric; v_central integer; v_ledger uuid; v_memo text;
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only admins can translate donations.';
  end if;

  select * into d from donations where id = p_donation for update;
  if not found then raise exception 'No such donation.'; end if;
  if d.status <> 'received' then raise exception 'Already translated.'; end if;

  if p_to_type = 'profile' then
    if not exists (select 1 from profiles where id = p_to_id) then raise exception 'No such member.'; end if;
  elsif p_to_type = 'space' then
    if not exists (select 1 from spaces where id = p_to_id) then raise exception 'No such group.'; end if;
  else
    raise exception 'Unknown recipient kind.';
  end if;

  -- The rate the donor was shown at gift time wins; older rows (pre-column)
  -- fall back to the current setting.
  v_rate := coalesce(d.operating_rate_pct, public.operating_rate_pct());
  v_central := round(d.amount_cents * v_rate / 100.0)::integer;
  v_grant := round((d.amount_cents - v_central) / 100.0, 2);
  if v_grant <= 0 then raise exception 'Donation too small to translate.'; end if;

  v_memo := 'Donor-directed gift · ' || (100 - v_rate)::text || '% of $'
    || trim(to_char(d.amount_cents / 100.0, 'FM999999990.00'));
  if coalesce(d.designation, '') <> '' then
    v_memo := v_memo || ' · "' || d.designation || '"';
  end if;

  insert into ledger_entries (from_type, from_id, to_type, to_id, amount, context, memo, ref_type, ref_id, created_by)
  values (null, null, p_to_type, p_to_id, v_grant, 'grant', v_memo, 'donation', d.id, auth.uid())
  returning id into v_ledger;

  update donations
     set status = 'translated', translated_at = now(),
         ledger_entry_id = v_ledger, central_cents = v_central
   where id = p_donation;

  if p_to_type = 'profile' then
    perform public.notify(p_to_id, 'home', null, 'currentcy',
      'A donor directed ' || trim(to_char(v_grant, 'FM999999990.##')) || ' Current to you',
      nullif(d.designation, ''), '/profile', auth.uid());
  end if;
  return v_ledger;
end $func$;
