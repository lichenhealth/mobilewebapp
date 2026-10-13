-- INTENT-SHAPED ONBOARDING (founder 2026-10-13: "an optimized onboarding
-- flow for practitioners… the same for those coming thru because they're
-- interested in community and those coming through because they're
-- interested in concierge as a client, versus concierge as a practitioner").
-- New practitioners come only by recommendation, so the INVITATION carries
-- the intent — the new person never self-sorts: the email names the path,
-- and Onboarding reads it back and shapes itself.

alter table public.invite_tokens
  add column if not exists intent text
  check (intent in ('practitioner', 'client', 'community'));

comment on column public.invite_tokens.intent is
  'What the invitee is coming for (founder 2026-10-13): practitioner = concierge provider (dashboard-first), client = concierge care (intake-first), community/null = the general flow. Picked by the inviter at mint; Onboarding reads it via my_invite_intent().';

-- The claimed token's intent, for the signed-in claimer. SECURITY DEFINER
-- because invite_tokens RLS shows rows to their CREATOR, not their claimer —
-- this answers one question about the caller's own arrival, nothing more.
create or replace function public.my_invite_intent()
returns text
language sql
stable
security definer
set search_path = public
as $func$
  select intent from public.invite_tokens
  where claimed_by = auth.uid() and intent is not null
  order by claimed_at desc nulls last
  limit 1
$func$;

revoke all on function public.my_invite_intent() from public;
revoke all on function public.my_invite_intent() from anon;
grant execute on function public.my_invite_intent() to authenticated;
