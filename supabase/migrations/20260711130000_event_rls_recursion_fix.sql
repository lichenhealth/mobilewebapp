-- =============================================================================
-- Fix: "infinite recursion detected in policy for relation event_attendees"
--
-- NOT auto-applied. Run in the Supabase SQL editor. Idempotent.
--
-- The cycle (surfaced the first time a host invited guests at compose time
-- after the event-posts migration):
--   event_attendees INSERT check  → subquery on events ("am I the host?")
--   events "events read" policy   → subquery on event_attendees ("am I a guest?")
--   that subquery re-enters event_attendees policy evaluation → recursion.
--
-- Break the back-edge with a SECURITY DEFINER helper (the is_chat_member /
-- can_read_event pattern): the events policy's guest check no longer runs
-- through event_attendees RLS. Row visibility is unchanged — the helper
-- answers exactly the predicate the inline subquery expressed.
-- =============================================================================

create or replace function public.is_event_attendee(p_event uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path to 'public' as
$$
  select exists (
    select 1 from public.event_attendees a
    where a.event_id = p_event and a.profile_id = p_uid
  );
$$;

alter function public.is_event_attendee(uuid, uuid) owner to postgres;
revoke all on function public.is_event_attendee(uuid, uuid) from public, anon;
grant execute on function public.is_event_attendee(uuid, uuid) to authenticated;

-- Same policy as 20260708120000_event_posts.sql, with the inline
-- event_attendees subquery swapped for the helper.
drop policy if exists "events read" on public.events;
create policy "events read" on public.events for select to authenticated
  using (
    creator_id = auth.uid()
    or owner_profile_id = auth.uid()
    or (owner_space_id is not null and public.is_space_member(owner_space_id, auth.uid()))
    or public.is_event_attendee(id, auth.uid())
    or exists (select 1 from public.posts p where p.linked_event_id = id)
  );
