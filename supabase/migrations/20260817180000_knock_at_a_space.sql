-- A PUBLIC PAGE IS A GATEWAY INTO LICHEN (founder 2026-08-17): "since Groups,
-- Communities, etc can have public profiles on the open web, those should be
-- gateways into Lichen. Request to Join Group would tell you about Lichen and
-- then you decide if you want to become a member."
--
-- The knock already existed (join_requests, from /signup) — it just didn't
-- know WHICH door someone knocked on, and only platform admins could answer.
-- Now a knock can carry the space whose public page brought them, and that
-- space's STEWARDS see it in their own backstage and can send the invitation
-- themselves. Founder's reasoning: the person will be paying for the whole
-- platform, not just group software, so they have to want the ethos and put
-- real money behind it — self-vetting. What stewards add is the vouch: trust
-- is person-to-person, and the steward whose page drew someone in can judge
-- them in a way the platform desk never could. Generic knocks (no space) stay
-- the desk's alone — nobody else has any relationship to that person.
--
-- Membership gate untouched: they still pay, or are gifted, after signing up.

alter table public.join_requests
  add column if not exists space_id uuid references public.spaces(id) on delete set null;
create index if not exists join_requests_space_idx on public.join_requests (space_id) where space_id is not null;

-- Stewards see and answer the knocks at THEIR door. Platform admins keep
-- seeing everything (existing policies, unchanged).
create policy "knocks: space stewards" on public.join_requests
  for select to authenticated
  using (space_id is not null and public.is_space_admin(space_id, auth.uid()));
create policy "knocks: space stewards decide" on public.join_requests
  for update to authenticated
  using (space_id is not null and public.is_space_admin(space_id, auth.uid()))
  with check (space_id is not null and public.is_space_admin(space_id, auth.uid()));

-- When the person who knocked at a space finally signs up, they arrive at
-- THAT space's door instead of a blank Home: a membership request is filed
-- for them (initiated_by = themselves — they asked), and the steward who let them
-- in approves it the ordinary way. A separate trigger on profiles rather
-- than a rewrite of handle_new_user — additive, and it fires for every
-- signup path (emailed link, gift, different-address claim).
create or replace function public.knock_becomes_membership_request()
returns trigger language plpgsql security definer set search_path to 'public' as $func$
begin
  if new.email is null then return new; end if;
  insert into public.space_membership_requests (space_id, profile_id, initiated_by)
  select distinct k.space_id, new.id, new.id
    from public.join_requests k
    join public.spaces s on s.id = k.space_id
   where k.space_id is not null
     and lower(k.email) = lower(new.email)
     and s.status = 'live'
  on conflict do nothing;
  return new;
end;
$func$;
drop trigger if exists knock_becomes_membership_request on public.profiles;
create trigger knock_becomes_membership_request
  after insert on public.profiles
  for each row execute function public.knock_becomes_membership_request();
