-- FINDABLE BY OTHER MEMBERS (founder 2026-08-07: "there are people who don't
-- wanna be super visible on social media, so let's be the network that makes
-- privacy personal and possible at the individual level").
--
-- WHY THIS IS AN RLS CHANGE AND NOT A FILTER. The profiles read policy was
-- USING (true) — every signed-in member could already list all 23 rows. A
-- client-side "findable" filter would have hidden someone from the directory
-- while leaving them fully enumerable by anyone who opened a console. That's
-- theatre, and privacy theatre is worse than none: it makes a promise the
-- database doesn't keep.
--
-- WHAT IT MEANS. Turning it off removes you from browsing — the member
-- directory, people search, name type-aheads. It does NOT erase you from the
-- places you actually show up, because that would break the app and misdescribe
-- the choice. You stay readable to:
--   * yourself
--   * anyone you share a space with
--   * anyone woven into your web, either direction
--   * your care team, either direction
--   * anyone in a chat with you
--   * anyone reading a PUBLIC post you wrote — your name is on it by your own
--     hand, and a feed that can't name its authors is broken
--
-- So the honest sentence, and the one the UI uses, is "you won't appear in the
-- directory or in search" — never "nobody can find you".
--
-- DEFAULT TRUE, so this is a no-op for all 23 existing members and nothing
-- changes until someone opts out. The relationship arms only start doing work
-- for a person who has actually turned it off.

alter table public.profiles
  add column if not exists findable boolean not null default true;

-- Clients need to read it to render the switch.
grant select (findable) on public.profiles to authenticated;

/** Can the caller see this profile row at all?
 *  SECURITY DEFINER so the relationship lookups can't recurse into the
 *  policies of the tables they read (the is_event_attendee lesson, PR #43). */
create or replace function public.can_see_profile(p_target uuid)
returns boolean language sql stable security definer set search_path = 'public' as $func$
  select
    p_target = auth.uid()
    or coalesce((select p.findable from public.profiles p where p.id = p_target), true)
    -- Somewhere you both stand
    or exists (
      select 1 from public.space_members a
      join public.space_members b on b.space_id = a.space_id
      where a.profile_id = p_target and b.profile_id = auth.uid()
    )
    -- Woven, either direction (membership, not trust — trust is private)
    or exists (
      select 1 from public.mycelium m
      where m.target_type = 'profile'
        and ((m.truster_id = auth.uid() and m.target_id = p_target)
          or (m.truster_id = p_target and m.target_id = auth.uid()))
    )
    -- Care, either direction, at any stage
    or exists (
      select 1 from public.care_team_members c
      where (c.patient_id = p_target and c.caregiver_id = auth.uid())
         or (c.caregiver_id = p_target and c.patient_id = auth.uid())
    )
    -- In a room together
    or exists (
      select 1 from public.chat_members a
      join public.chat_members b on b.chat_id = a.chat_id
      where a.profile_id = p_target and b.profile_id = auth.uid()
    )
    -- They put their name on something public
    or exists (
      select 1 from public.posts po
      where po.author_id = p_target and po.visibility = 'public'
    );
$func$;
revoke all on function public.can_see_profile(uuid) from public, anon;
grant execute on function public.can_see_profile(uuid) to authenticated;

-- Swap the blanket policy for the real one. Same column-scoped grants as
-- before — this narrows which ROWS come back, never which columns.
drop policy if exists "Profiles readable by authenticated" on public.profiles;
create policy "Profiles readable by authenticated" on public.profiles
  for select to authenticated
  using (public.can_see_profile(id));
