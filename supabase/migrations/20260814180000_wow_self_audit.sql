-- THE AUDIT IN YOUR OWN WORDS (founder 2026-08-14): the Web of Wellbeing
-- kicks off with a SELF-evaluation — six dimensions (Mental, Physical,
-- Social, Spiritual, Economic, Environmental), each in the member's own
-- words with an optional self-score feeding the existing radar. The board's
-- RLS only let ACTIVE CAREGIVERS write, so a member's wellbeing story could
-- only begin as other people's observations of them. This widens each write
-- policy with one self-arm: you may author (and later edit or remove) posts
-- on YOUR OWN board. Nothing changes for caregivers, and reading was always
-- patient-inclusive (is_on_care_team's first arm).

drop policy if exists "care_posts insert" on public.care_posts;
create policy "care_posts insert" on public.care_posts
  for insert with check (
    author_id = auth.uid()
    and (patient_id = auth.uid() or public.is_active_caregiver(patient_id, auth.uid()))
  );

drop policy if exists "care_posts update" on public.care_posts;
create policy "care_posts update" on public.care_posts
  for update using (
    public.is_active_caregiver(patient_id, auth.uid())
    or (author_id = auth.uid() and patient_id = auth.uid())
  )
  with check (
    author_id = auth.uid()
    and (patient_id = auth.uid() or public.is_active_caregiver(patient_id, auth.uid()))
  );

drop policy if exists "care_posts delete" on public.care_posts;
create policy "care_posts delete" on public.care_posts
  for delete using (
    public.is_active_caregiver(patient_id, auth.uid())
    or (author_id = auth.uid() and patient_id = auth.uid())
  );
