-- PRESENCE IS THE CANDLE, AND ONLY THE CANDLE (founder 2026-08-13: "your light
-- on indicates you're open to live engagement, versus just there to get things
-- done. So we shouldn't show who's online, just whose candle is lit").
--
-- Presence has been two signals wearing one label. presence_visible (default
-- TRUE) meant "I'm online". The candle meant "I'm open to being interrupted".
-- Both fed the same counts, so "One in your web is awake" was mostly reporting
-- that somebody had the app open — a thing nobody chose — while the candle,
-- the one deliberate act, was reduced to a nicer dot beside it.
--
-- Now a person is present only when their candle is lit:
--
--   * presence_always_present — "candle whenever I'm online" — still needs the
--     online half to be true, so it keeps the 12-hour freshness guard.
--   * presence_lit_until      — lit by hand, and it carries its own expiry.
--     No freshness guard: someone who lit it deliberately already said the
--     thing a last_seen_at check would only be guessing at.
--
-- presence_visible is left in the schema, simply unread. Nothing to undo if
-- this wants revisiting, and no data to migrate.
--
-- Expect the counts to fall to near zero until people light candles. That is
-- the point, not a regression: presence is a gift, and a gift nobody offered
-- was never ours to spend.
--
-- The `lit` column stays in the two list functions (always true now) so the
-- RETURNS TABLE signature — and every caller — is untouched. The names keep
-- saying "awake"; renaming four functions and their call sites buys nothing
-- this comment can't say.

-- ── Your web ────────────────────────────────────────────────────────────────

create or replace function public.network_awake_count()
returns integer language sql stable security definer set search_path = 'public' as $func$
  select count(distinct p.id)::int
  from public.profiles p
  where p.id <> auth.uid()
    and ((p.presence_always_present and p.last_seen_at > now() - interval '12 hours')
         or p.presence_lit_until > now())
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
    and ((p.presence_always_present and p.last_seen_at > now() - interval '12 hours')
         or p.presence_lit_until > now())
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
      where (p.presence_always_present and p.last_seen_at > now() - interval '12 hours')
         or p.presence_lit_until > now()
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
  where ((p.presence_always_present and p.last_seen_at > now() - interval '12 hours')
         or p.presence_lit_until > now())
    and exists (
      select 1 from public.space_members me2
      where me2.space_id = p_space and me2.profile_id = auth.uid()
    )
  order by p.full_name;
$func$;
