-- THE WHOLE INVITATION PICTURE (founder 2026-07-28): platform admins can see
-- every invitation and who sent it — the network's growth, legible. Members
-- still see only their own (the existing policy is untouched); this is an
-- additional read arm for is_admin, matching how admins already see gifts,
-- donations and category suggestions.

create policy "invites: admins see all" on public.invite_tokens
  for select to authenticated using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );
