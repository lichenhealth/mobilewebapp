-- Invite-flow truth repair (founder 2026-08-11, after the audit found the
-- /invite ledger stale): claiming was client-side only — link-dependent,
-- skipped for admins, skipped until onboarding finished — so invitees who
-- signed up could stay "open" forever, and a gift keyed to an email the
-- person didn't sign up with was orphaned for good.
--
-- Fixes, in order:
--   1. invite_tokens.opened_at — stamped (via mark_invite_opened, callable
--      by anon) when the invite link lands on the signup page. Drives the
--      new "Opened" status: invited → opened → joined.
--   2. claim_gifts_for_email() helper — the gift-claiming loop, callable
--      with an EXPLICIT email so a token can deliver a gift even when the
--      person signed up under a different address (the Kristine case).
--   3. handle_new_user() now claims email-matching invites server-side at
--      signup — no link, no onboarding, no admin-ness required.
--   4. claim_invite() now also delivers gifts keyed to the token's
--      invitee_email.
--   5. Reconciliation of the rows the old flow already left stale.

-- 1 ── opened_at + mark_invite_opened -----------------------------------------

alter table invite_tokens add column opened_at timestamptz;
comment on column invite_tokens.opened_at is 'First time the invite link landed on the signup page — the "Opened" status. Stronger signal than an email-open pixel.';

create or replace function public.mark_invite_opened(p_token uuid)
returns void
language sql
security definer
set search_path = public
as $func$
  update public.invite_tokens
  set opened_at = coalesce(opened_at, now())
  where token = p_token;
$func$;

revoke all on function public.mark_invite_opened(uuid) from public;
grant execute on function public.mark_invite_opened(uuid) to anon, authenticated;

-- 2 ── the gift-claiming loop, reusable with an explicit email ----------------

create or replace function public.claim_gifts_for_email(p_user uuid, p_email text)
returns integer
language plpgsql
security definer
set search_path = public
as $func$
declare g record; v_count int := 0;
begin
  if p_user is null or coalesce(p_email, '') = '' then return 0; end if;
  for g in
    select * from public.membership_gifts
    where lower(invitee_email) = lower(p_email) and status = 'pending'
    order by (tier = 'concierge') desc, created_at desc
  loop
    insert into public.subscriptions (profile_id, tier, source, status, granted_by, granted_at, current_period_end, updated_at)
    values (
      p_user, g.tier, 'gift', 'active', g.inviter_id, now(),
      case when g.months is null then null else now() + make_interval(months => g.months) end,
      now()
    )
    on conflict (profile_id) do nothing;
    update public.membership_gifts
      set status = 'claimed', claimed_profile_id = p_user, claimed_at = now()
      where id = g.id;
    perform public.notify(
      p_user, 'membership', null, 'membership_gifted',
      'Your gift is active: ' || coalesce(public.gift_span_text(g.months) || ' of ', '') || 'Lichen (' || initcap(g.tier) || ')',
      'Welcome in.',
      '/membership', g.inviter_id
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$func$;

revoke all on function public.claim_gifts_for_email(uuid, text) from public, anon, authenticated;

-- claim_membership_gift becomes a thin wrapper over the helper.
create or replace function public.claim_membership_gift()
returns integer
language sql
security definer
set search_path = public
as $func$
  select public.claim_gifts_for_email(auth.uid(), auth.jwt() ->> 'email');
$func$;

-- 3 ── server-side email-match claiming at signup -----------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));

  -- Claim any invite addressed to this email the moment the account exists —
  -- the old client-side path only fired for people who arrived through the
  -- exact emailed link AND finished onboarding AND weren't admins, which
  -- left real joiners shown as "open" forever. The weave is the invite's
  -- promise, so it happens here too; claim_invite() (token path, for people
  -- who signed up under a different address) no-ops on rows claimed here.
  update public.invite_tokens t
  set claimed_by = new.id, claimed_at = now()
  where t.claimed_by is null
    and lower(t.invitee_email) = lower(new.email)
    and t.created_by <> new.id;

  insert into public.mycelium (truster_id, target_type, target_id)
  select x.created_by, 'profile', new.id
  from public.invite_tokens x
  where x.claimed_by = new.id
  on conflict do nothing;
  insert into public.mycelium (truster_id, target_type, target_id)
  select new.id, 'profile', x.created_by
  from public.invite_tokens x
  where x.claimed_by = new.id
  on conflict do nothing;

  return new;
end;
$func$;

-- 4 ── claim_invite also delivers gifts keyed to the token's email ------------

create or replace function public.claim_invite(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare v_inviter uuid; v_name text; v_minor boolean; v_invitee text;
begin
  update public.invite_tokens
  set claimed_by = auth.uid(), claimed_at = now()
  where token = p_token and claimed_by is null and created_by <> auth.uid()
  returning created_by, for_minor, invitee_email into v_inviter, v_minor, v_invitee;
  if v_inviter is null then return; end if;

  if coalesce(v_minor, false) then
    insert into public.guardians (minor_id, guardian_id)
    values (auth.uid(), v_inviter)
    on conflict do nothing;
  end if;

  insert into public.mycelium (truster_id, target_type, target_id)
  values (v_inviter, 'profile', auth.uid()), (auth.uid(), 'profile', v_inviter)
  on conflict do nothing;

  -- The token proves this is the invited person even when they signed up
  -- under a different address — deliver any gift riding the invitation
  -- (the audit found one orphaned exactly this way).
  perform public.claim_gifts_for_email(auth.uid(), v_invitee);

  select full_name into v_name from public.profiles where id = auth.uid();
  perform public.notify(
    v_inviter, 'home', null, 'invite_accepted',
    coalesce(v_name, 'Someone') || ' just joined Lichen',
    case when coalesce(v_minor, false)
      then 'They''re on Lichen, and you''re holding the account.'
      else 'Your invitation was accepted — they''re woven into your web.' end,
    '/members/' || auth.uid(), auth.uid());
end; $func$;

-- 5 ── reconcile what the old flow left stale ---------------------------------

-- 5a. Invites whose email now has an account, still unclaimed: claim + weave
--     (quietly — no bell for something that happened days ago).
update public.invite_tokens t
set claimed_by = p.id, claimed_at = coalesce(p.created_at, now())
from public.profiles p
where t.claimed_by is null
  and lower(t.invitee_email) = lower(p.email)
  and t.created_by <> p.id;

insert into public.mycelium (truster_id, target_type, target_id)
select t.created_by, 'profile', t.claimed_by from public.invite_tokens t where t.claimed_by is not null
union
select t.claimed_by, 'profile', t.created_by from public.invite_tokens t where t.claimed_by is not null
on conflict do nothing;

-- 5b. Gifts still pending though their invitation's token WAS claimed (the
--     different-email case): deliver them to the claimer now — this one
--     does bell them, because the gift is landing for real today.
select public.claim_gifts_for_email(t.claimed_by, t.invitee_email)
from public.invite_tokens t
join public.membership_gifts g
  on lower(g.invitee_email) = lower(t.invitee_email) and g.status = 'pending'
where t.claimed_by is not null;
