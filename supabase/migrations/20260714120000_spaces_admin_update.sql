-- =============================================================================
-- Fix: space creators (super_admins) couldn't edit their own spaces.
--
-- NOT auto-applied. Run in the Supabase SQL editor. Idempotent.
--
-- The original UPDATE policy matched role = 'admin' only, but the
-- handle_new_space trigger makes creators 'super_admin' — so the person who
-- made a space was the one person who couldn't edit it. Latent since spaces
-- shipped (no space-edit UI existed to trip it); surfaced by Maps v1.1's
-- Add-a-Place, which lets admins set a space's location + coordinates.
-- =============================================================================

drop policy if exists "Admins update their space" on public.spaces;
create policy "Admins update their space" on public.spaces
  for update to authenticated
  using (exists (
    select 1 from public.space_members m
    where m.space_id = spaces.id and m.profile_id = auth.uid()
      and m.role in ('admin', 'super_admin')
  ))
  with check (exists (
    select 1 from public.space_members m
    where m.space_id = spaces.id and m.profile_id = auth.uid()
      and m.role in ('admin', 'super_admin')
  ));
