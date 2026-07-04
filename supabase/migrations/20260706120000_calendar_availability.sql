-- =============================================================================
-- Calendar, part 3 — declared availability + audience visibility rules.
--
-- NOT auto-applied. Run in the Supabase SQL editor, then refresh the init.sql
-- baseline with pg_dump. Idempotent.
--
-- availability_windows: weekly hours a member declares ("available Mon–Thu
-- 9–5", or an on-call shift — kind='on_call' feeds the Concierge on-call
-- feature next). Optional valid_from/valid_to bound a window to a date range.
--
-- calendar_shares: WHO SEES WHAT of your calendar. A default plus per-audience
-- rules; MOST-SPECIFIC WINS: profile rule > space rule (most permissive among
-- shared spaces) > everyone rule > default 'busy'. "Everyone in this org sees
-- details except these two people" = org→details + those people→busy.
-- ('mycelium' audience lands when mycelium ships — text CHECK is easy to widen
-- in its own later migration.)
--
-- Reads go through SECURITY DEFINER RPCs that resolve the CALLER's level per
-- owner and sanitize accordingly (titles only at 'details'; nothing at
-- 'hidden'). Recurring events return their recurrence spec and are expanded
-- client-side by the existing occursOn() engine — the SQL never duplicates
-- recurrence logic.
-- =============================================================================

-- ── availability_windows ─────────────────────────────────────────────────────
create table if not exists public.availability_windows (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  weekday    smallint not null check (weekday between 0 and 6),  -- 0=Mon … 6=Sun
  start_min  smallint not null check (start_min between 0 and 1439),
  end_min    smallint not null check (end_min between 1 and 1440),
  kind       text not null default 'available' check (kind in ('available', 'on_call')),
  valid_from date,
  valid_to   date,
  created_at timestamptz not null default now(),
  constraint availability_windows_span check (end_min > start_min),
  constraint availability_windows_validity check
    (valid_from is null or valid_to is null or valid_to >= valid_from)
);
alter table public.availability_windows enable row level security;
create index if not exists availability_windows_profile_idx
  on public.availability_windows (profile_id);

drop policy if exists "availability owner all" on public.availability_windows;
create policy "availability owner all" on public.availability_windows
  for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ── calendar_shares (visibility rules) ───────────────────────────────────────
create table if not exists public.calendar_shares (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references public.profiles(id) on delete cascade,
  audience_type       text not null check (audience_type in ('everyone', 'space', 'profile')),
  audience_space_id   uuid references public.spaces(id) on delete cascade,
  audience_profile_id uuid references public.profiles(id) on delete cascade,
  level               text not null check (level in ('hidden', 'busy', 'details')),
  created_at          timestamptz not null default now(),
  constraint calendar_shares_audience_shape check (
    (audience_type = 'everyone' and audience_space_id is null and audience_profile_id is null)
    or (audience_type = 'space' and audience_space_id is not null and audience_profile_id is null)
    or (audience_type = 'profile' and audience_profile_id is not null and audience_space_id is null)
  )
);
alter table public.calendar_shares enable row level security;
-- one rule per audience
create unique index if not exists calendar_shares_audience_uniq
  on public.calendar_shares (
    owner_id, audience_type,
    coalesce(audience_space_id,   '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(audience_profile_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

drop policy if exists "calendar_shares owner all" on public.calendar_shares;
create policy "calendar_shares owner all" on public.calendar_shares
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ── Level resolver: what may p_viewer see of p_owner's calendar? ─────────────
create or replace function public.calendar_level(p_owner uuid, p_viewer uuid)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare v text;
begin
  if p_owner = p_viewer then return 'details'; end if;

  -- 1. explicit person rule
  select level into v from public.calendar_shares
   where owner_id = p_owner and audience_type = 'profile' and audience_profile_id = p_viewer;
  if v is not null then return v; end if;

  -- 2. space rules over spaces BOTH belong to — most permissive wins
  select level into v
  from public.calendar_shares s
  where s.owner_id = p_owner and s.audience_type = 'space'
    and public.is_space_member(s.audience_space_id, p_owner)
    and public.is_space_member(s.audience_space_id, p_viewer)
  order by case s.level when 'details' then 2 when 'busy' then 1 else 0 end desc
  limit 1;
  if v is not null then return v; end if;

  -- 3. everyone rule, else default busy
  select level into v from public.calendar_shares
   where owner_id = p_owner and audience_type = 'everyone';
  return coalesce(v, 'busy');
end; $$;
alter function public.calendar_level(uuid, uuid) owner to postgres;

-- ── free_busy: sanitized event fragments for a set of members ────────────────
-- Returns each candidate event once; the client expands recurrence per visible
-- day with occursOn(). title/location only at 'details'. Declined invites are
-- not busy. 'hidden' owners return nothing.
create or replace function public.free_busy(p_profiles uuid[], p_from date, p_to date)
returns table (
  profile_id uuid, level text,
  start_date date, end_date date, all_day boolean,
  start_min smallint, end_min smallint, recurrence jsonb, title text
) language sql stable security definer set search_path to 'public' as $$
  with lv as (
    select p as owner, public.calendar_level(p, auth.uid()) as level
    from unnest(p_profiles) as p
  ),
  owned as (
    select l.owner, l.level, e.*
    from lv l join public.events e on e.owner_profile_id = l.owner
    where l.level <> 'hidden'
  ),
  attending as (
    select l.owner, l.level, e.*
    from lv l
    join public.event_attendees a on a.profile_id = l.owner and a.status <> 'declined'
    join public.events e on e.id = a.event_id
    where l.level <> 'hidden'
  ),
  all_evts as (
    select distinct on (owner, id) * from (
      select * from owned union all select * from attending
    ) u
  )
  select owner, level, start_date, end_date, all_day, start_min, end_min, recurrence,
         case when level = 'details' then title else null end
  from all_evts
  where start_date <= p_to and (end_date >= p_from or recurrence is not null);
$$;
alter function public.free_busy(uuid[], date, date) owner to postgres;
revoke all on function public.free_busy(uuid[], date, date) from public, anon;
grant execute on function public.free_busy(uuid[], date, date) to authenticated;

-- ── availability_of: declared windows, same visibility gate ──────────────────
create or replace function public.availability_of(p_profiles uuid[])
returns table (profile_id uuid, weekday smallint, start_min smallint, end_min smallint,
               kind text, valid_from date, valid_to date)
language sql stable security definer set search_path to 'public' as $$
  select w.profile_id, w.weekday, w.start_min, w.end_min, w.kind, w.valid_from, w.valid_to
  from public.availability_windows w
  where w.profile_id = any(p_profiles)
    and public.calendar_level(w.profile_id, auth.uid()) <> 'hidden';
$$;
alter function public.availability_of(uuid[]) owner to postgres;
revoke all on function public.availability_of(uuid[]) from public, anon;
grant execute on function public.availability_of(uuid[]) to authenticated;
