-- ON-CALL HOURS ARE THE CARE TEAM'S TO SEE (founder 2026-10-03: "have
-- calendar be smart and only list on call hours for people who are
-- identified as part of someone's care team on the platform").
-- The hours EDITOR already offers On call only to active caregivers
-- (2026-08-19), and find-a-time already ignores on_call — but only in the
-- CLIENT. availability_of() (SECURITY DEFINER, the find-a-time feed) was
-- returning kind='on_call' rows to anyone the owner's calendar_level didn't
-- hide, so the care rota crossed the wire to any fellow group member.
-- Now an on_call window leaves the server only for: its owner, a patient
-- whose active team the owner serves, or a fellow active caregiver on one
-- of those teams. on_call_roster() (the Urgent tabs' read) was already
-- team-gated; the availability_windows table itself is owner-only RLS.

create or replace function public.availability_of(p_profiles uuid[])
returns table(profile_id uuid, weekday smallint, start_min smallint, end_min smallint, kind text, valid_from date, valid_to date)
language sql
stable security definer
set search_path to 'public'
as $func$
  select w.profile_id, w.weekday, w.start_min, w.end_min, w.kind, w.valid_from, w.valid_to
  from public.availability_windows w
  where w.profile_id = any(p_profiles)
    and public.calendar_level(w.profile_id, auth.uid()) <> 'hidden'
    and (
      w.kind <> 'on_call'
      or w.profile_id = auth.uid()
      or exists (
        select 1 from public.care_team_members a
        where a.caregiver_id = w.profile_id
          and a.status = 'active'
          and (a.patient_id = auth.uid()
               or exists (
                 select 1 from public.care_team_members b
                 where b.patient_id = a.patient_id
                   and b.caregiver_id = auth.uid()
                   and b.status = 'active'))));
$func$;
