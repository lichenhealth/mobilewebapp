-- ALWAYS SEND REPLIES FOR ME (founder 2026-11-26: a Twilio support reply
-- should be answered "with whatever it already knows I want to do… so that
-- I'm not involved at all unless there's something I need to do because
-- it's a password or something like that"). A standing allowance the PERSON
-- taps once; with it, the brain's draft_mail(send: true) sends a reply on an
-- existing thread, to people already in it, never carrying a secret.
-- Revocable in Profile → Privacy beside every other allowance.
alter table public.assistant_allowances drop constraint if exists assistant_allowances_kind_check;
alter table public.assistant_allowances add constraint assistant_allowances_kind_check
  check (kind = any (array['send_currentcy','trust','recommend','weave','join_space','leave_space','mail_reply']));

create or replace function public.grant_mail_reply_allowance()
returns void language plpgsql security definer set search_path = public as $func$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  insert into assistant_allowances (profile_id, kind) values (auth.uid(), 'mail_reply')
  on conflict (profile_id, kind) do nothing;
end $func$;
revoke all on function public.grant_mail_reply_allowance() from public, anon;
grant execute on function public.grant_mail_reply_allowance() to authenticated;
