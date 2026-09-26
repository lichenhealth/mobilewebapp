-- THE SMART CARE ADD (founder 2026-09-26: "have inviting care team members
-- be a smart, type ahead (no copy and paste), so no errors. If the person's
-- name doesn't prompt a member because they haven't joined, prompting an
-- invite for that person, using an email or phone number.")
--
-- Found live: a member pasted a contact line — "galyn burke
-- <galynburke@gmail.com>" — into the care invite box in July. The loose
-- email test passed it, the whole string was stored verbatim, and
-- claim_care_invitations (exact match on the signed-in email) could never
-- claim it. Two people believed they were connected for months.
--
-- 1) Phone invites become real: care_invitations grows invitee_phone, and
--    the claim matches it against the member's own profiles.phone (set at
--    onboarding) — so a texted invite links the care team on signup the
--    same way an emailed one does.
alter table public.care_invitations alter column invitee_email drop not null;
alter table public.care_invitations add column if not exists invitee_phone text;
alter table public.care_invitations drop constraint if exists care_invitations_has_contact;
alter table public.care_invitations add constraint care_invitations_has_contact
  check (invitee_email is not null or invitee_phone is not null);

-- 2) Repair the malformed legacy rows: pull the FIRST email-shaped token out
--    of whatever was pasted ("Name <email>", "Name, email" — both happened
--    live), trim, lowercase — so the standing invitations actually claim
--    when their people join.
update public.care_invitations
  set invitee_email = lower(btrim(coalesce(
        (regexp_match(invitee_email, '[A-Za-z0-9._%+''-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'))[1],
        invitee_email)))
  where invitee_email is not null
    and invitee_email <> lower(btrim(coalesce(
        (regexp_match(invitee_email, '[A-Za-z0-9._%+''-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'))[1],
        invitee_email)));

-- 3) The claim hardens: normalize the stored email defensively (a belt for
--    any row that predates the client-side classifier), and match phones by
--    digits — last 10 when both sides have them, so "+1 (303) 555-1234"
--    meets "3035551234".
create or replace function public.claim_care_invitations()
returns integer
language plpgsql security definer set search_path to 'public' as $func$
declare
  v_uid   uuid := auth.uid();
  v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_phone text;
  inv     record;
  v_count int := 0;
begin
  if v_uid is null then return 0; end if;
  select nullif(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '')
    into v_phone from public.profiles where id = v_uid;
  for inv in
    select * from public.care_invitations
    where status = 'pending' and (
      (v_email <> '' and invitee_email is not null and
       lower(btrim(coalesce(
         (regexp_match(invitee_email, '[A-Za-z0-9._%+''-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'))[1],
         invitee_email))) = v_email)
      or
      (v_phone is not null and invitee_phone is not null and (
        case
          when length(v_phone) >= 10 and length(regexp_replace(invitee_phone, '\D', '', 'g')) >= 10
            then right(v_phone, 10) = right(regexp_replace(invitee_phone, '\D', '', 'g'), 10)
          else v_phone = regexp_replace(invitee_phone, '\D', '', 'g')
        end
      ))
    )
  loop
    if inv.inviter_id <> v_uid then
      if inv.role = 'caregiver' then
        insert into public.care_team_members (patient_id, caregiver_id, initiated_by, status)
        values (inv.inviter_id, v_uid, inv.inviter_id, 'pending')
        on conflict (patient_id, caregiver_id) do nothing;
      else
        insert into public.care_team_members (patient_id, caregiver_id, initiated_by, status)
        values (v_uid, inv.inviter_id, inv.inviter_id, 'pending')
        on conflict (patient_id, caregiver_id) do nothing;
      end if;
    end if;
    update public.care_invitations
      set status = 'accepted', accepted_profile_id = v_uid, accepted_at = now()
      where id = inv.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$func$;
