-- Web of Wellbeing consent (founder 2026-08-11): the financial picture
-- joins the rest of a member's health info under one name, care-team-only
-- by default — and a member can go fully private instead. Off means the
-- care team reads nothing (this policy), and the member understands the
-- trade: no care-team money help, no coaching, no subsidies pool — the
-- same shape as the AI consents. Never a score, never anyone else,
-- either way.

alter table financial_positions
  add column care_team_visible boolean not null default true;

drop policy "means: care team reads" on financial_positions;
create policy "means: care team reads" on financial_positions
  for select to authenticated
  using (
    care_team_visible
    and exists (
      select 1 from care_team_members c
      where c.patient_id = financial_positions.profile_id
        and c.caregiver_id = auth.uid()
        and c.status = 'active'
    )
  );
