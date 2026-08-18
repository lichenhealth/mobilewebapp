-- DECLINE AN INVITATION (founder 2026-08-17: "in case they change their
-- mind"). Someone who doesn't want in could only ghost — their row said
-- "invited" forever, and any future reminder would keep bothering them. A
-- decline is a real answer: the invitation closes, the inviter is told
-- quietly, and the address is left alone.
--
-- Anon-callable on purpose: the person has no account, that's the point. The
-- token is unguessable, so holding it IS the authorization — same trust model
-- as mark_invite_opened and check_invite.

alter table public.invite_tokens
  add column if not exists declined_at timestamptz;

create or replace function public.decline_invite(p_token uuid)
returns void language plpgsql security definer set search_path to 'public' as $func$
declare v record;
begin
  update public.invite_tokens
     set declined_at = now()
   where token = p_token and claimed_by is null and declined_at is null
   returning created_by, invitee_email into v;
  if v.created_by is null then return; end if;

  -- The inviter hears — quietly, once — so the ledger row isn't a mystery.
  perform public.notify(
    v.created_by, 'home', null, 'invite_declined',
    'An invitation was declined',
    split_part(v.invitee_email, '@', 1) || '@… decided Lichen isn''t for them right now. No reminder will go their way.',
    '/invite', null);
end;
$func$;
revoke all on function public.decline_invite(uuid) from public;
grant execute on function public.decline_invite(uuid) to anon, authenticated;
