-- WHO'S INVITED — ON LICHEN / OFF LICHEN (founder 2026-11-04: "both have
-- smart search, so if you enter the phone number of a lichen member, it
-- adds them … under members on lichen"): the composer's smart box resolves
-- a typed EMAIL or PHONE to a member, so the invitation lands as a SEATED
-- member invite (belled, RSVP under their own account) instead of a blind
-- event_guests row. profiles.email/phone sit outside the column grants by
-- design, so the lookup rides SECURITY DEFINER — BOUNDED like the
-- email_is_member oracle (2026-11-02, accepted trade-off): EXACT match only
-- (no prefix fishing), FINDABLE + onboarded members only, authenticated
-- callers only, id + name and nothing else. Phones compare digits-only,
-- exact or last-10 when both sides carry 10+ (claim_care_invitations' rule).
create or replace function public.member_by_contact(p_contact text)
returns table (id uuid, full_name text)
language sql
security definer
set search_path = public
stable
as $f$
  with q as (
    select lower(trim(p_contact)) as em,
           regexp_replace(coalesce(p_contact, ''), '\D', '', 'g') as dg
  )
  select p.id, p.full_name
  from profiles p
  cross join q
  cross join lateral (select regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') as pd) ph
  where p.findable and p.onboarded
    and (
      (q.em like '%@%' and lower(coalesce(p.email, '')) = q.em)
      or (length(q.dg) >= 7 and (
        ph.pd = q.dg
        or (length(q.dg) >= 10 and length(ph.pd) >= 10 and right(ph.pd, 10) = right(q.dg, 10))
      ))
    )
  limit 3;
$f$;
revoke all on function public.member_by_contact(text) from public;
revoke all on function public.member_by_contact(text) from anon;
grant execute on function public.member_by_contact(text) to authenticated;
