-- INVITE-ONLY LICHEN (founder 2026-07-28): every member arrives through a
-- person. Invites mint TOKENS; signup requires one; the inviter is auto-woven
-- into the new member's mycelium (nobody starts with an empty web). Walk-ins
-- aren't walled out — they knock: a note about who they are and why Lichen,
-- landing in the founder's email + bell for a 1:1 conversation.

-- ── 1. Invite tokens ─────────────────────────────────────────────────────────
create table if not exists public.invite_tokens (
  token uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  invitee_email text,
  claimed_by uuid references public.profiles(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.invite_tokens enable row level security;
create policy "invites: mine" on public.invite_tokens
  for select to authenticated
  using (created_by = auth.uid() or claimed_by = auth.uid());
create policy "invites: mint" on public.invite_tokens
  for insert to authenticated
  with check (created_by = auth.uid());

-- Signed-out signup page asks: is this token real (and whose)?
create or replace function public.check_invite(p_token uuid)
returns json language sql stable security definer set search_path = public as $fn$
  select case
    when t.token is null then json_build_object('valid', false)
    when t.claimed_by is not null then json_build_object('valid', false, 'reason', 'claimed')
    else json_build_object('valid', true, 'inviter',
      coalesce((select full_name from public.profiles where id = t.created_by), 'a member'))
  end
  from (select * from public.invite_tokens where token = p_token) t
  right join (select 1) one on true;
$fn$;
grant execute on function public.check_invite(uuid) to anon, authenticated;

-- After signup: claim the token, weave inviter <-> invitee both ways
-- (membership, not trust — trust stays a hand-made gesture), ring the inviter.
create or replace function public.claim_invite(p_token uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_inviter uuid; v_name text;
begin
  update public.invite_tokens
  set claimed_by = auth.uid(), claimed_at = now()
  where token = p_token and claimed_by is null and created_by <> auth.uid()
  returning created_by into v_inviter;
  if v_inviter is null then return; end if;
  insert into public.mycelium (truster_id, target_type, target_id)
  values (v_inviter, 'profile', auth.uid()), (auth.uid(), 'profile', v_inviter)
  on conflict do nothing;
  select full_name into v_name from public.profiles where id = auth.uid();
  perform public.notify(
    v_inviter, 'home', null, 'invite_accepted',
    coalesce(v_name, 'Someone') || ' just joined Lichen',
    'Your invitation was accepted — they''re woven into your web.',
    '/members/' || auth.uid(), auth.uid());
end; $fn$;
revoke all on function public.claim_invite(uuid) from public, anon;
grant execute on function public.claim_invite(uuid) to authenticated;

-- ── 2. The knock: walk-ins ask to join ──────────────────────────────────────
create table if not exists public.join_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  story text,
  status text not null default 'new' check (status in ('new', 'invited', 'declined')),
  created_at timestamptz not null default now()
);
alter table public.join_requests enable row level security;
create policy "knocks: admins" on public.join_requests
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
create policy "knocks: admins decide" on public.join_requests
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
-- No INSERT policy: only the join-request edge function (service role) writes,
-- so the public form can't be scripted straight into the table.
