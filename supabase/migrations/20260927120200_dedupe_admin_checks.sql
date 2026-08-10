-- CLEANUP (founder architecture audit, 2026-08-09): six policies hand-rolled
-- the exact admin-role check public.is_space_admin() already encapsulates,
-- instead of calling it. Not an active bug today (space_members' own SELECT
-- policy is `USING (true)`, so the reference chain terminates) — but it's
-- the "two tables reference each other" shape the SECURITY DEFINER helper
-- doctrine exists to guard, sitting on unforced duplication. Routing all six
-- through the helper, same semantics, one fewer place to keep in sync.

DROP POLICY "Admins update their space" ON public.spaces;
CREATE POLICY "Admins update their space" ON public.spaces FOR UPDATE
  USING (public.is_space_admin(id, auth.uid()))
  WITH CHECK (public.is_space_admin(id, auth.uid()));

DROP POLICY "smr: read own or admin" ON public.space_membership_requests;
CREATE POLICY "smr: read own or admin" ON public.space_membership_requests FOR SELECT
  USING ((profile_id = auth.uid()) OR public.is_space_admin(space_id, auth.uid()));

DROP POLICY "smr: withdraw or decline" ON public.space_membership_requests;
CREATE POLICY "smr: withdraw or decline" ON public.space_membership_requests FOR DELETE
  USING ((profile_id = auth.uid()) OR public.is_space_admin(space_id, auth.uid()));

DROP POLICY "snr: group admins propose" ON public.space_nesting_requests;
CREATE POLICY "snr: group admins propose" ON public.space_nesting_requests FOR INSERT
  WITH CHECK ((initiated_by = auth.uid()) AND public.is_space_admin(group_id, auth.uid()));

DROP POLICY "snr: read either side" ON public.space_nesting_requests;
CREATE POLICY "snr: read either side" ON public.space_nesting_requests FOR SELECT
  USING (public.is_space_admin(group_id, auth.uid()) OR public.is_space_admin(parent_id, auth.uid()));

DROP POLICY "snr: withdraw or decline" ON public.space_nesting_requests;
CREATE POLICY "snr: withdraw or decline" ON public.space_nesting_requests FOR DELETE
  USING (public.is_space_admin(group_id, auth.uid()) OR public.is_space_admin(parent_id, auth.uid()));
