-- Gift-carrying invitations (2026-07-15): an admin's "Invite to Lichen" can
-- attach a gifted membership — optionally time-boxed ("a year of Lichen") —
-- claimed automatically when that email signs up (claim_care_invitations
-- pattern). The membership gate calls claim_membership_gift() before sending
-- anyone to the paywall. Gift end dates reuse subscriptions.current_period_end
-- (the same slot Stripe uses); expiry is enforced by date-compare in the app.

create table if not exists public.membership_gifts (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  invitee_email text not null,
  tier text not null default 'community' check (tier in ('community','concierge')),
  months integer check (months is null or months > 0),   -- null = no end date
  status text not null default 'pending' check (status in ('pending','claimed')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_profile_id uuid references public.profiles(id)
);

-- (no-op on a fresh run; upgrades a table created before months existed)
alter table public.membership_gifts add column if not exists months integer
  check (months is null or months > 0);

create unique index if not exists membership_gifts_one_pending
  on public.membership_gifts (lower(invitee_email)) where (status = 'pending');

alter table public.membership_gifts enable row level security;

drop policy if exists "membership_gifts: admins all" on public.membership_gifts;
create policy "membership_gifts: admins all" on public.membership_gifts
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

create or replace function public.claim_membership_gift() returns integer
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid   uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  g       record;
  v_count int := 0;
begin
  if v_uid is null or v_email = '' then return 0; end if;
  for g in
    select * from public.membership_gifts
    where lower(invitee_email) = v_email and status = 'pending'
    order by (tier = 'concierge') desc, created_at desc
  loop
    insert into public.subscriptions (profile_id, tier, source, status, granted_by, granted_at, current_period_end, updated_at)
    values (
      v_uid, g.tier, 'gift', 'active', g.inviter_id, now(),
      case when g.months is null then null else now() + make_interval(months => g.months) end,
      now()
    )
    on conflict (profile_id) do nothing;   -- never clobber a paid Stripe sub
    update public.membership_gifts
      set status = 'claimed', claimed_profile_id = v_uid, claimed_at = now()
      where id = g.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

grant execute on function public.claim_membership_gift() to authenticated;

-- gift_subscription grows an optional duration. Postgres treats a changed
-- arg list as a NEW function, so drop the old 2-arg version first; existing
-- 2-arg calls resolve to the new default.
drop function if exists public.gift_subscription(text, text);
create or replace function public.gift_subscription(p_email text, p_tier text, p_months integer default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_target uuid;
  v_end timestamptz := case when p_months is null then null else now() + make_interval(months => p_months) end;
begin
  select is_admin into v_is_admin from public.profiles where id = v_caller;
  if not coalesce(v_is_admin, false) then raise exception 'Not authorized'; end if;
  if p_tier not in ('community','concierge') then raise exception 'Invalid tier'; end if;
  if p_months is not null and p_months <= 0 then raise exception 'Invalid duration'; end if;
  select id into v_target from public.profiles where lower(email) = lower(p_email);
  if v_target is null then raise exception 'No member with that email'; end if;
  insert into public.subscriptions (profile_id, tier, source, status, granted_by, granted_at, current_period_end, updated_at)
  values (v_target, p_tier, 'gift', 'active', v_caller, now(), v_end, now())
  on conflict (profile_id) do update set
    tier = excluded.tier, source = 'gift', status = 'active',
    granted_by = v_caller, granted_at = now(), current_period_end = excluded.current_period_end,
    stripe_customer_id = null, stripe_subscription_id = null, updated_at = now();
end;
$$;

grant execute on function public.gift_subscription(text, text, integer) to authenticated;

-- admin_list_supporters returns the end date too (return type changed → drop first).
drop function if exists public.admin_list_supporters();
create function public.admin_list_supporters()
returns table(profile_id uuid, tier text, source text, status text, full_name text, email text, current_period_end timestamptz)
language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;
  return query
    select s.profile_id, s.tier, s.source, s.status, p.full_name, p.email, s.current_period_end
    from public.subscriptions s
    left join public.profiles p on p.id = s.profile_id
    order by s.granted_at desc nulls last;
end;
$$;

grant execute on function public.admin_list_supporters() to authenticated;
