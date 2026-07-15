-- Gift-carrying invitations (2026-07-15): an admin's "Invite to Lichen" can
-- attach a gifted membership, claimed automatically when that email signs up
-- (claim_care_invitations pattern). The membership gate calls
-- claim_membership_gift() before sending anyone to the paywall.

create table if not exists public.membership_gifts (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  invitee_email text not null,
  tier text not null default 'community' check (tier in ('community','concierge')),
  status text not null default 'pending' check (status in ('pending','claimed')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_profile_id uuid references public.profiles(id)
);

create unique index membership_gifts_one_pending
  on public.membership_gifts (lower(invitee_email)) where (status = 'pending');

alter table public.membership_gifts enable row level security;

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
    insert into public.subscriptions (profile_id, tier, source, status, granted_by, granted_at, updated_at)
    values (v_uid, g.tier, 'gift', 'active', g.inviter_id, now(), now())
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
