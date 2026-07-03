-- =============================================================================
-- Calendar fix: events read policy must evaluate on the ROW, not re-query.
--
-- NOT auto-applied. Run in the Supabase SQL editor. Idempotent.
--
-- The original "events read" policy called can_read_event(id, uid), which
-- re-queries events by id. During INSERT ... RETURNING, that subquery's
-- snapshot cannot see the row being inserted, so creating an event failed at
-- the read-back step ("Could not save."). Rewrite the policy as a direct
-- expression over the candidate row's columns (the care_posts pattern).
-- can_read_event stays for the event_attendees policies, where the event row
-- already exists.
-- =============================================================================

drop policy if exists "events read" on public.events;
create policy "events read" on public.events for select to authenticated
  using (
    creator_id = auth.uid()
    or owner_profile_id = auth.uid()
    or (owner_space_id is not null and public.is_space_member(owner_space_id, auth.uid()))
    or exists (select 1 from public.event_attendees a
               where a.event_id = id and a.profile_id = auth.uid())
  );
