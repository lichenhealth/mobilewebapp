-- INVITE-ONLY EVENTS (founder 2026-11-04: Who's-invited and Audience merge
-- for events, and "visibility can be its own section" — Open vs Invite-only,
-- her pick on the explicit fork). An invite-only event post carries
-- is_public=false with no network audience, so the standing policy hides it
-- from everyone but the author — this adds the one missing arm: a member
-- SEATED ON THE LINKED EVENT (event_attendees, any status — invited people
-- must read the post to RSVP) can read the post. Off-platform guests never
-- touch posts RLS (the /e/ token page reads via SECURITY DEFINER RPCs).
--
-- The policy body below is the LIVE policy verbatim (read from pg_policies
-- 2026-11-04) plus the is_event_attendee arm — recreated whole, never
-- narrowed.

drop policy if exists "posts: read" on public.posts;
create policy "posts: read" on public.posts for select to authenticated using (
  ((author_space_id is null) or space_alive(author_space_id))
  and (
    is_public
    or (author_id = auth.uid())
    or (to_mycelium and (exists (
      select 1 from mycelium my
      where my.truster_id = auth.uid()
        and (((my.target_type = 'profile') and (my.target_id = posts.author_id))
          or ((my.target_type = 'space') and (my.target_id = posts.author_space_id)))
    )))
    or (exists (
      select 1 from space_members m
      where m.profile_id = auth.uid() and m.space_id = any (posts.audience_space_ids)
    ))
    -- Invite-only events: a seat on the linked event is a key to the post.
    or (linked_event_id is not null and public.is_event_attendee(linked_event_id, auth.uid()))
  )
);
