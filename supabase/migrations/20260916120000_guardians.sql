-- GUARDIANS — a young member is held by a grown-up (founder 2026-08-05:
-- "marketplace for minors, but with parental controls" + "a guardian should
-- have to create it for now").
--
-- HOW A CHILD GETS AN ACCOUNT: not by signing themselves up. A guardian mints
-- a CHILD INVITE from their own account; the child completes signup through
-- that token, and the guardian link exists from the first moment. This reuses
-- the invite machinery that already gates every signup, so no service-role
-- account creation and no admin API are involved.
--
-- Under 13 cannot complete signup any other way. That is a legal floor as much
-- as a design one: knowingly collecting a child's information in the US brings
-- verifiable-parental-consent obligations, and a guardian-minted invite is the
-- consent record.

create table if not exists public.guardians (
  minor_id uuid not null references public.profiles(id) on delete cascade,
  guardian_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (minor_id, guardian_id),
  constraint guardians_not_self check (minor_id <> guardian_id)
);
alter table public.guardians enable row level security;

-- Both sides can see the link; nobody else, and no client writes it — it is
-- created by claim_invite alone.
create policy "guardians: parties read" on public.guardians
  for select to authenticated
  using (minor_id = auth.uid() or guardian_id = auth.uid());

create index if not exists guardians_guardian_idx on public.guardians (guardian_id);

/** Does this adult hold this young member? Same delegation shape as
 *  is_active_caregiver and is_entity_steward. */
create or replace function public.is_guardian_of(p_minor uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $func$
  select exists (
    select 1 from public.guardians g
    where g.minor_id = p_minor and g.guardian_id = p_uid
  );
$func$;
revoke all on function public.is_guardian_of(uuid, uuid) from public, anon;
grant execute on function public.is_guardian_of(uuid, uuid) to authenticated;

-- ── The child invite ──────────────────────────────────────────────────────
alter table public.invite_tokens
  add column if not exists for_minor boolean not null default false;

-- check_invite tells the signup screen this token carries guardianship, so the
-- page can say who will be holding the account before anyone types anything.
create or replace function public.check_invite(p_token uuid)
returns json language sql stable security definer set search_path = public as $func$
  select case when t.token is null then json_build_object('valid', false)
    else json_build_object(
      'valid', t.claimed_by is null,
      'inviter', coalesce(p.full_name, 'A member'),
      'for_minor', t.for_minor)
  end
  from (select 1) x
  left join public.invite_tokens t on t.token = p_token
  left join public.profiles p on p.id = t.created_by;
$func$;
revoke all on function public.check_invite(uuid) from public;
grant execute on function public.check_invite(uuid) to anon, authenticated;

-- claim_invite now also records guardianship when the token was minted for a
-- child. Everything else about claiming is unchanged.
create or replace function public.claim_invite(p_token uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_inviter uuid; v_name text; v_minor boolean;
begin
  update public.invite_tokens
  set claimed_by = auth.uid(), claimed_at = now()
  where token = p_token and claimed_by is null and created_by <> auth.uid()
  returning created_by, for_minor into v_inviter, v_minor;
  if v_inviter is null then return; end if;

  if coalesce(v_minor, false) then
    insert into public.guardians (minor_id, guardian_id)
    values (auth.uid(), v_inviter)
    on conflict do nothing;
  end if;

  insert into public.mycelium (truster_id, target_type, target_id)
  values (v_inviter, 'profile', auth.uid()), (auth.uid(), 'profile', v_inviter)
  on conflict do nothing;
  select full_name into v_name from public.profiles where id = auth.uid();
  perform public.notify(
    v_inviter, 'home', null, 'invite_accepted',
    coalesce(v_name, 'Someone') || ' just joined Lichen',
    case when coalesce(v_minor, false)
      then 'They''re on Lichen, and you''re holding the account.'
      else 'Your invitation was accepted — they''re woven into your web.' end,
    '/members/' || auth.uid(), auth.uid());
end; $fn$;
revoke all on function public.claim_invite(uuid) from public, anon;
grant execute on function public.claim_invite(uuid) to authenticated;

-- ── What a guardian holds ─────────────────────────────────────────────────
/** The young members I hold, and the grown-ups holding me. Names only. */
create or replace function public.my_minors()
returns table (id uuid, full_name text, avatar_url text, is_adult boolean)
language sql stable security definer set search_path to 'public' as $func$
  select p.id, p.full_name, p.avatar_url, p.is_adult
  from public.guardians g join public.profiles p on p.id = g.minor_id
  where g.guardian_id = auth.uid()
  order by p.full_name;
$func$;
revoke all on function public.my_minors() from public, anon;
grant execute on function public.my_minors() to authenticated;

create or replace function public.my_guardians()
returns table (id uuid, full_name text, avatar_url text)
language sql stable security definer set search_path to 'public' as $func$
  select p.id, p.full_name, p.avatar_url
  from public.guardians g join public.profiles p on p.id = g.guardian_id
  where g.minor_id = auth.uid()
  order by p.full_name;
$func$;
revoke all on function public.my_guardians() from public, anon;
grant execute on function public.my_guardians() to authenticated;

-- ── Money doesn't move without a grown-up ─────────────────────────────────
-- A young member can be paid and can hold what they earn; SENDING is the act
-- that needs a guardian. Refused honestly rather than queued into a flow that
-- doesn't exist yet — the guardian approval queue is the next build.
do $$
declare v_src text;
begin
  select pg_get_functiondef(oid) into v_src
    from pg_proc where proname = 'send_currentcy'
     and pronamespace = 'public'::regnamespace limit 1;
  if v_src is null then
    raise notice 'send_currentcy not found — skipping';
  elsif position('is_minor' in v_src) > 0 then
    raise notice 'send_currentcy already checks age';
  else
    -- anchor on the existing sender guard (widened for stewards in
    -- 20260914130000) so the age check lands exactly once, ahead of it.
    v_src := replace(v_src,
      'if p_from_id <> auth.uid() and not public.is_entity_steward(p_from_id, auth.uid()) then',
      'if public.is_minor(auth.uid()) then raise exception ''A guardian sends on your behalf — ask a grown-up who holds your account.''; end if;'
      || chr(10) ||
      '  if p_from_id <> auth.uid() and not public.is_entity_steward(p_from_id, auth.uid()) then');
    execute v_src;
    raise notice 'send_currentcy now asks a grown-up first';
  end if;
end $$;
