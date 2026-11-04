-- EVENTS AS A RECRUITING DOOR, slice 1 (founder 2026-11-04: "Let's have
-- Events be like the Calendar booking feature. So I invite people to an
-- event via email or phone and they're outside of lichen... pretty
-- invites... an RSVP feature that works even if you're not a lichen
-- member, but if you are, it auto fills your info... add the event to
-- their calendars... ways to keep recruiting more folks to the alpha").
--
-- 1) PHONE INVITES: a guest row may carry a phone instead of an email —
--    the Invite-to-Lichen pattern: the host texts the tokened link from
--    their OWN Messages (no SMS provider, by standing doctrine), each
--    phone gets its own token because a token RSVPs one person.
alter table public.event_guests add column if not exists phone text;
alter table public.event_guests alter column email drop not null;
alter table public.event_guests add constraint event_guests_contact
  check (email is not null or phone is not null);

-- 2) TIGHTEN THE HOST POLICY (found in the same pass): the old WITH CHECK
--    only required invited_by = auth.uid(), so ANY member could mint a
--    token against ANY event id and read a private event through
--    guest_event. Inserts now also require the inserter to be the event's
--    creator — which is exactly what makes client-side phone minting safe
--    (the email path's edge fn always checked creator_id itself).
drop policy event_guests_host on public.event_guests;
create policy event_guests_host on public.event_guests for all
  using (invited_by = auth.uid())
  with check (
    invited_by = auth.uid()
    and exists (select 1 from public.events e
                where e.id = event_id and e.creator_id = auth.uid())
  );

-- 3) THE PRETTY INVITE'S RAW MATERIAL: guest_event returns the linked
--    door-post's id (so a signed-in member can open the real event page —
--    "if you are [a member], it auto fills your info") and its cover
--    photo (first photo in details.media, image_url fallback — post media
--    URLs are public by construction). Return type grew → DROP/recreate,
--    PUBLIC revoked, anon + authenticated re-granted.
drop function public.guest_event(text);
create function public.guest_event(p_token text)
returns table (
  guest_name text, guest_status text,
  title text, description text, location text,
  start_date date, end_date date, all_day boolean, start_min smallint, end_min smallint,
  recurrence jsonb, host_name text,
  post_id uuid, photo_url text
) language sql security definer set search_path = public stable as $fn$
  select g.name, g.status, e.title, e.description, e.location,
         e.start_date, e.end_date, e.all_day, e.start_min, e.end_min, e.recurrence,
         coalesce(sp.name, pr.full_name, 'A member'),
         p.id,
         coalesce(
           (select m->>'url'
            from jsonb_array_elements(
              case when jsonb_typeof(p.details->'media') = 'array'
                   then p.details->'media' else '[]'::jsonb end) m
            where m->>'type' = 'photo' limit 1),
           p.image_url)
  from public.event_guests g
  join public.events e on e.id = g.event_id
  left join public.profiles pr on pr.id = e.owner_profile_id
  left join public.spaces sp on sp.id = e.owner_space_id
  left join lateral (
    select po.id, po.details, po.image_url
    from public.posts po where po.linked_event_id = e.id limit 1
  ) p on true
  where g.token = p_token;
$fn$;
revoke all on function public.guest_event(text) from public;
grant execute on function public.guest_event(text) to anon, authenticated;
