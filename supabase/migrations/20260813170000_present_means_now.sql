-- PRESENT MEANS HERE NOW, NOT HERE TODAY (founder 2026-08-13: "can we have
-- present now as candle lit and actually online now? Not in the last 12
-- hours?").
--
-- The window was 12 hours, so a lit candle plus one visit this morning still
-- read as "present" at midnight — to someone who might message expecting an
-- answer. It is now 5 minutes.
--
-- ⚠ THE WINDOW AND THE HEARTBEAT ARE A PAIR. AuthProvider.tsx beats
-- last_seen_at every 2 minutes, and only while the tab is visible. Five
-- minutes is 2.5x that, so one missed beat or a slow network doesn't blink
-- anyone out. Shortening this below ~2x the beat would make presence STROBE
-- for someone sitting right there with the app open; lengthening the beat
-- without lengthening this does the same. Change them together.
--
-- BOTH ARMS NOW REQUIRE IT, including the hand-lit candle. presence_lit_until
-- used to stand on its own, so a candle lit for four hours kept burning on a
-- closed laptop — which is exactly the "here today" being removed. Lighting it
-- by hand still says "I'm open right now" when presence_always_present is off;
-- it just no longer outlives the session that lit it.
--
-- Expect the counts to fall again and to move about, tracking people actually
-- looking at Lichen this minute. On an alpha of two dozen that will often be
-- nobody. That is the honest reading, not a fault.

-- ── Your web ────────────────────────────────────────────────────────────────

create or replace function public.network_awake_count()
returns integer language sql stable security definer set search_path = 'public' as $func$
  select count(distinct p.id)::int
  from public.profiles p
  where p.id <> auth.uid()
    and (p.presence_always_present or p.presence_lit_until > now())
    and p.last_seen_at > now() - interval '5 minutes'
    and (
      p.id in (select m.target_id from public.mycelium m
               where m.truster_id = auth.uid() and m.target_type = 'profile')
      or p.id in (select m2.profile_id
                  from public.space_members m1
                  join public.space_members m2 on m2.space_id = m1.space_id
                  where m1.profile_id = auth.uid())
    );
$func$;

create or replace function public.network_awake_list()
returns table(id uuid, full_name text, avatar_url text, headline text, lit boolean)
language sql stable security definer set search_path = 'public' as $func$
  select distinct p.id, p.full_name, p.avatar_url, p.headline, true as lit
  from public.profiles p
  where p.id <> auth.uid()
    and (p.presence_always_present or p.presence_lit_until > now())
    and p.last_seen_at > now() - interval '5 minutes'
    and (
      p.id in (select m.target_id from public.mycelium m
               where m.truster_id = auth.uid() and m.target_type = 'profile')
      or p.id in (select m2.profile_id
                  from public.space_members m1
                  join public.space_members m2 on m2.space_id = m1.space_id
                  where m1.profile_id = auth.uid())
    )
  order by p.full_name;
$func$;

-- ── One space's own layer (counts you — you're in the room too) ─────────────

create or replace function public.space_awake_count(p_space uuid)
returns integer language sql stable security definer set search_path = 'public' as $func$
  select case
    when not exists (
      select 1 from public.space_members me
      where me.space_id = p_space and me.profile_id = auth.uid()
    ) then 0
    else (
      select count(distinct p.id)::int
      from public.profiles p
      join public.space_members m on m.profile_id = p.id and m.space_id = p_space
      where (p.presence_always_present or p.presence_lit_until > now())
        and p.last_seen_at > now() - interval '5 minutes'
    )
  end;
$func$;

create or replace function public.space_awake_list(p_space uuid)
returns table(id uuid, full_name text, avatar_url text, headline text, lit boolean, me boolean)
language sql stable security definer set search_path = 'public' as $func$
  select distinct p.id, p.full_name, p.avatar_url, p.headline,
         true as lit,
         (p.id = auth.uid()) as me
  from public.profiles p
  join public.space_members m on m.profile_id = p.id and m.space_id = p_space
  where (p.presence_always_present or p.presence_lit_until > now())
    and p.last_seen_at > now() - interval '5 minutes'
    and exists (
      select 1 from public.space_members me2
      where me2.space_id = p_space and me2.profile_id = auth.uid()
    )
  order by p.full_name;
$func$;
