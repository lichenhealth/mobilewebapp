-- INVITE-ONLY EVENTS, part 3 (found in the production verify of part 2:
-- "new row violates row-level security policy for table posts"). The INSERT
-- policy's must-have-an-audience invariant (is_public OR to_mycelium OR
-- circles) rightly refused a no-audience row — the invite-only arm it needs:
-- a post linked to YOUR OWN event may carry no network audience, because the
-- event's seats are the audience. The creator check rides a SECURITY DEFINER
-- helper (the standing 42P17 posture for any cross-table policy reference —
-- is_event_attendee's sibling), and it is CREATOR-scoped so nobody can hang
-- a no-audience post off someone else's event and speak to its attendees.
-- UPDATE policy needs nothing — it has no audience invariant.

create or replace function public.is_event_creator(p_event uuid, p_uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $f$
  select exists (select 1 from events e where e.id = p_event and e.creator_id = p_uid);
$f$;
revoke all on function public.is_event_creator(uuid, uuid) from public;
grant execute on function public.is_event_creator(uuid, uuid) to authenticated;

-- The live policy verbatim (read from pg_policies 2026-11-04) plus the one
-- arm — recreated whole, never narrowed.
drop policy if exists "posts: insert own" on public.posts;
create policy "posts: insert own" on public.posts for insert to authenticated with check (
  ((author_id = auth.uid()) or is_entity_steward(author_id, auth.uid()))
  and (
    is_public or to_mycelium or (cardinality(audience_space_ids) > 0)
    -- Invite-only event: your own event's seats are the audience.
    or (linked_event_id is not null and public.is_event_creator(linked_event_id, auth.uid()))
  )
  and (not (exists (
    select 1 from unnest(posts.audience_space_ids) a(sid)
    where not (exists (
      select 1 from space_members m
      where m.space_id = a.sid and m.profile_id = auth.uid()
    ))
  )))
  and ((author_space_id is null) or is_space_admin(author_space_id, auth.uid()))
);
