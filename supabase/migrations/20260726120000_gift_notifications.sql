-- Gifts ring the recipient's bell (founder, 2026-07-15). The direct-gift
-- path (existing members) was silent — no email, no notification. Now both
-- gift_subscription() and claim_membership_gift() notify the recipient via
-- the notify() helper (skips self, respects notification_pref). The email
-- side is the send-gift-notice edge function, called from the client.

-- Shared span wording, matching the client's spanText: 1 month / N months /
-- a year / N years; null months = open-ended.
create or replace function public.gift_span_text(p_months integer) returns text
language sql immutable as $$
  select case
    when p_months is null then null
    when p_months % 12 = 0 and p_months = 12 then 'a year'
    when p_months % 12 = 0 then (p_months / 12) || ' years'
    when p_months = 1 then 'a month'
    else p_months || ' months'
  end;
$$;

create or replace function public.gift_subscription(p_email text, p_tier text, p_months integer default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_target uuid;
  v_end timestamptz := case when p_months is null then null else now() + make_interval(months => p_months) end;
  v_span text := public.gift_span_text(p_months);
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
  perform public.notify(
    v_target, 'profile', null, 'membership_gifted',
    'You''ve been gifted ' || coalesce(v_span || ' of ', '') || 'Lichen (' || initcap(p_tier) || ')',
    'It''s already active — welcome in.',
    '/membership', v_caller
  );
end;
$$;

grant execute on function public.gift_subscription(text, text, integer) to authenticated;

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
    perform public.notify(
      v_uid, 'profile', null, 'membership_gifted',
      'Your gift is active: ' || coalesce(public.gift_span_text(g.months) || ' of ', '') || 'Lichen (' || initcap(g.tier) || ')',
      'Welcome in.',
      '/membership', g.inviter_id
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

grant execute on function public.claim_membership_gift() to authenticated;
