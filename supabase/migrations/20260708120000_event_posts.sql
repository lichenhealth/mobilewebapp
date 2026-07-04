-- =============================================================================
-- Events — event posts linked to real calendar events, with open RSVP.
--
-- NOT auto-applied. Run in the Supabase SQL editor, then refresh the init.sql
-- baseline with pg_dump. Idempotent. Purely additive → transition-safe.
--
-- An event post (service_areas includes 'events') carries a category, a
-- Free/Trade/Paid mode, and a REAL calendar event (posts.linked_event_id →
-- events). The calendar event is the RSVP container: Booking a Free/Trade
-- event inserts you into event_attendees (status 'going'), which puts it on
-- your calendar, blocks your availability, and notifies the host via the
-- existing calendar notification producers. Paid events link out to the
-- organizer's own booking page (in-app payments are a later project).
--
-- Visibility: the linked calendar event becomes readable to exactly whoever
-- can read the post — the policy subquery on posts runs under the caller's
-- own RLS, so post-visibility (public / mycelium / spaces) carries over.
-- =============================================================================

-- ── posts: link + event fields ────────────────────────────────────────────────
alter table public.posts add column if not exists linked_event_id uuid references public.events(id) on delete set null;
alter table public.posts add column if not exists event_category text;
alter table public.posts add column if not exists event_mode text;

alter table public.posts drop constraint if exists posts_event_category_check;
alter table public.posts add constraint posts_event_category_check check (
  event_category is null or event_category in ('social', 'work_charity', 'learning', 'experiences')
);
alter table public.posts drop constraint if exists posts_event_mode_check;
alter table public.posts add constraint posts_event_mode_check check (
  event_mode is null or event_mode in ('free', 'trade', 'paid')
);

create index if not exists posts_linked_event_idx on public.posts (linked_event_id) where linked_event_id is not null;
create index if not exists posts_event_category_idx on public.posts (event_category) where event_category is not null;

-- ── events: readable via a readable linking post ─────────────────────────────
-- (posts RLS applies inside the subquery → exactly post-visibility; no
-- recursion: posts policies never reference events.)
drop policy if exists "events read" on public.events;
create policy "events read" on public.events for select to authenticated
  using (
    creator_id = auth.uid()
    or owner_profile_id = auth.uid()
    or (owner_space_id is not null and public.is_space_member(owner_space_id, auth.uid()))
    or exists (select 1 from public.event_attendees a
               where a.event_id = id and a.profile_id = auth.uid())
    or exists (select 1 from public.posts p where p.linked_event_id = id)
  );

-- ── event_attendees: the guest list is visible to whoever can see the post ───
-- (Policy expression, NOT the SECURITY DEFINER helper — so posts RLS applies
-- and private events never leak their attendee lists.)
drop policy if exists "event_attendees read via post" on public.event_attendees;
create policy "event_attendees read via post" on public.event_attendees for select to authenticated
  using (exists (select 1 from public.posts p where p.linked_event_id = event_attendees.event_id));

-- ── event_attendees: self-RSVP to any event whose post you can see ───────────
drop policy if exists "event_attendees self rsvp" on public.event_attendees;
create policy "event_attendees self rsvp" on public.event_attendees for insert to authenticated
  with check (
    profile_id = auth.uid()
    and invited_by = auth.uid()
    and exists (select 1 from public.posts p where p.linked_event_id = event_attendees.event_id)
  );
-- (un-RSVP already works: "event_attendees delete" allows removing yourself.)

-- ── Notify the host on self-RSVP ──────────────────────────────────────────────
-- The original invite producer notifies the INVITEE; on a self-RSVP that is
-- the actor themself (suppressed by notify()'s guard) and the host heard
-- nothing. Route self-RSVPs to the event's creator instead.
create or replace function public.on_event_invite_notify()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_name text; v_title text; v_creator uuid;
begin
  select coalesce(nullif(full_name, ''), email, 'A member')
    into v_name from public.profiles where id = new.invited_by;
  select title, creator_id into v_title, v_creator from public.events where id = new.event_id;
  if new.invited_by = new.profile_id then
    -- self-RSVP (Book on an event post) → tell the host
    perform public.notify(v_creator, 'calendar', null, 'event_rsvp',
      v_name, 'is going: ' || coalesce(v_title, 'your event'), '/calendar', new.profile_id);
  else
    -- classic invite → tell the invitee
    perform public.notify(new.profile_id, 'calendar', null, 'event_invite',
      v_name, 'invited you: ' || coalesce(v_title, 'an event'), '/calendar', new.invited_by);
  end if;
  return new;
end; $$;
alter function public.on_event_invite_notify() owner to postgres;
