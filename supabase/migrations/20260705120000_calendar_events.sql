-- =============================================================================
-- Calendar, part 1 of 3 — events + attendees (+ invite/RSVP notifications).
--
-- NOT auto-applied. Run in the Supabase SQL editor, then refresh the init.sql
-- baseline with pg_dump. Idempotent.
--
-- Everything on Lichen gets a calendar. v1 owners: a PERSON (owner_profile_id)
-- or a SPACE (owner_space_id); part 3 adds resources (rooms/tools) by widening
-- the exactly-one-owner CHECK. Events are TIMED (start_min/end_min = minutes
-- since local midnight) or all-day, may span days (start_date..end_date), and
-- may recur using the same RRULE-lite `recurrence` jsonb as care_posts —
-- evaluated client-side by occursOn() (src/lib/recurrence.ts). A recurring
-- event is single-day (its span is the occurrence).
--
-- Attendees: the creator invites members; invitees RSVP going/declined. RLS:
-- you can read an event if you created it, own it, attend it, or are a member
-- of the owning space. v1 manage = creator only.
-- =============================================================================

-- ── Helper: space membership (mirrors is_chat_member) ────────────────────────
create or replace function public.is_space_member(p_space uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.space_members m
                 where m.space_id = p_space and m.profile_id = p_uid);
$$;
alter function public.is_space_member(uuid, uuid) owner to postgres;

-- ── events ────────────────────────────────────────────────────────────────────
create table if not exists public.events (
  id               uuid primary key default gen_random_uuid(),
  creator_id       uuid not null references public.profiles(id) on delete cascade,
  owner_profile_id uuid references public.profiles(id) on delete cascade,
  owner_space_id   uuid references public.spaces(id) on delete cascade,
  title            text not null check (length(btrim(title)) > 0),
  description      text not null default '',
  location         text not null default '',
  start_date       date not null,
  end_date         date not null,
  all_day          boolean not null default false,
  start_min        smallint check (start_min between 0 and 1439),
  end_min          smallint check (end_min between 1 and 1440),
  recurrence       jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- exactly one owner (part 3 widens this to include owner_resource_id)
  constraint events_one_owner check (
    (owner_profile_id is not null)::int + (owner_space_id is not null)::int = 1
  ),
  constraint events_span check (end_date >= start_date),
  -- timed events carry both minutes (end after start when same-day);
  -- all-day events carry neither.
  constraint events_times check (
    (all_day and start_min is null and end_min is null)
    or
    (not all_day and start_min is not null and end_min is not null
       and (start_date <> end_date or end_min > start_min))
  ),
  -- a recurring event is single-day; its end lives in the recurrence spec
  constraint events_recur_single_day check (
    recurrence is null or start_date = end_date
  )
);
alter table public.events enable row level security;

create index if not exists events_owner_profile_idx
  on public.events (owner_profile_id, start_date) where owner_profile_id is not null;
create index if not exists events_owner_space_idx
  on public.events (owner_space_id, start_date) where owner_space_id is not null;
create index if not exists events_creator_idx on public.events (creator_id, start_date);

drop trigger if exists events_touch on public.events;
create trigger events_touch before update on public.events
  for each row execute function public.touch_updated_at();

-- ── event_attendees ───────────────────────────────────────────────────────────
create table if not exists public.event_attendees (
  event_id   uuid not null references public.events(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  status     text not null default 'invited' check (status in ('invited', 'going', 'declined')),
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (event_id, profile_id)
);
alter table public.event_attendees enable row level security;

create index if not exists event_attendees_profile_idx
  on public.event_attendees (profile_id);

-- ── Helper: can this uid read this event? (used by both tables' policies) ────
create or replace function public.can_read_event(p_event uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event
      and (e.creator_id = p_uid
        or e.owner_profile_id = p_uid
        or (e.owner_space_id is not null and public.is_space_member(e.owner_space_id, p_uid))
        or exists (select 1 from public.event_attendees a
                   where a.event_id = e.id and a.profile_id = p_uid))
  );
$$;
alter function public.can_read_event(uuid, uuid) owner to postgres;

-- ── RLS ───────────────────────────────────────────────────────────────────────
drop policy if exists "events read"   on public.events;
drop policy if exists "events insert" on public.events;
drop policy if exists "events update" on public.events;
drop policy if exists "events delete" on public.events;
create policy "events read" on public.events for select to authenticated
  using (public.can_read_event(id, auth.uid()));
-- insert: onto your own calendar, or onto a space calendar you belong to
create policy "events insert" on public.events for insert to authenticated
  with check (
    creator_id = auth.uid()
    and (owner_profile_id = auth.uid()
      or (owner_space_id is not null and public.is_space_member(owner_space_id, auth.uid())))
  );
create policy "events update" on public.events for update to authenticated
  using (creator_id = auth.uid()) with check (creator_id = auth.uid());
create policy "events delete" on public.events for delete to authenticated
  using (creator_id = auth.uid());

drop policy if exists "event_attendees read"   on public.event_attendees;
drop policy if exists "event_attendees insert" on public.event_attendees;
drop policy if exists "event_attendees update" on public.event_attendees;
drop policy if exists "event_attendees delete" on public.event_attendees;
create policy "event_attendees read" on public.event_attendees for select to authenticated
  using (public.can_read_event(event_id, auth.uid()));
-- only the event's creator invites
create policy "event_attendees insert" on public.event_attendees for insert to authenticated
  with check (
    invited_by = auth.uid()
    and exists (select 1 from public.events e where e.id = event_id and e.creator_id = auth.uid())
  );
-- an attendee updates their own RSVP status
create policy "event_attendees update" on public.event_attendees for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
-- creator may uninvite; attendee may remove themself
create policy "event_attendees delete" on public.event_attendees for delete to authenticated
  using (
    profile_id = auth.uid()
    or exists (select 1 from public.events e where e.id = event_id and e.creator_id = auth.uid())
  );

-- ── Notifications (section 'calendar'; name falls back to email) ──────────────
create or replace function public.on_event_invite_notify()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_name text; v_title text;
begin
  select coalesce(nullif(full_name, ''), email, 'A member')
    into v_name from public.profiles where id = new.invited_by;
  select title into v_title from public.events where id = new.event_id;
  perform public.notify(new.profile_id, 'calendar', null, 'event_invite',
    v_name, 'invited you: ' || coalesce(v_title, 'an event'), '/calendar', new.invited_by);
  return new;
end; $$;
alter function public.on_event_invite_notify() owner to postgres;
drop trigger if exists on_event_invite_notify_trg on public.event_attendees;
create trigger on_event_invite_notify_trg after insert on public.event_attendees
  for each row execute function public.on_event_invite_notify();

create or replace function public.on_event_rsvp_notify()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_name text; v_title text; v_creator uuid;
begin
  if new.status = old.status or new.status = 'invited' then return new; end if;
  select coalesce(nullif(full_name, ''), email, 'A member')
    into v_name from public.profiles where id = new.profile_id;
  select title, creator_id into v_title, v_creator from public.events where id = new.event_id;
  perform public.notify(v_creator, 'calendar', null, 'event_rsvp',
    v_name,
    (case when new.status = 'going' then 'is going: ' else 'can''t make it: ' end) || coalesce(v_title, 'your event'),
    '/calendar', new.profile_id);
  return new;
end; $$;
alter function public.on_event_rsvp_notify() owner to postgres;
drop trigger if exists on_event_rsvp_notify_trg on public.event_attendees;
create trigger on_event_rsvp_notify_trg after update on public.event_attendees
  for each row execute function public.on_event_rsvp_notify();
