-- FIX (founder architecture audit, 2026-08-09): the "events read" policy's
-- posts sub-clause compared a post to itself (`p.linked_event_id = p.id`)
-- instead of correlating against the event row actually being checked —
-- the OR arm never did what it was written to do. Correlate it correctly.

DROP POLICY "events read" ON public.events;

CREATE POLICY "events read" ON public.events FOR SELECT TO authenticated USING (
  (creator_id = auth.uid())
  OR (owner_profile_id = auth.uid())
  OR ((owner_space_id IS NOT NULL) AND public.is_space_member(owner_space_id, auth.uid()))
  OR public.is_event_attendee(id, auth.uid())
  OR (EXISTS (SELECT 1 FROM public.posts p WHERE p.linked_event_id = events.id))
);
