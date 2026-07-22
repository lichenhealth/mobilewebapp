-- PRESENCE DEFAULTS (founder, 2026-07-22): the "around" dot is now DEFAULT-ON
-- (opt-out) — most people expect "online" to show. The candle ("present —
-- open to connecting") stays intentional: off by default, lit by hand (~4h)
-- OR a new "always while I'm online" mode.

-- Around: default on. Realize it for existing rows (the feature was days old,
-- opt-in, so ~everyone is still false = never-touched).
alter table public.profiles alter column presence_visible set default true;
update public.profiles set presence_visible = true where presence_visible = false;

-- Present-always: the candle's persistent mode.
alter table public.profiles
  add column if not exists presence_always_present boolean not null default false;
grant select (presence_always_present) on public.profiles to authenticated;

-- The list's `lit` (candle) now also honors the always-present flag; the WHERE
-- admits always-present members too. Return signature is unchanged from
-- PR #115, so no DROP is needed.
create or replace function public.network_awake_list()
returns table(id uuid, full_name text, avatar_url text, headline text, lit boolean)
language sql stable security definer set search_path = 'public' as $$
  select distinct p.id, p.full_name, p.avatar_url, p.headline,
         (p.presence_always_present or p.presence_lit_until > now()) as lit
  from public.profiles p
  where p.id <> auth.uid()
    and (p.presence_visible or p.presence_always_present or p.presence_lit_until > now())
    and p.last_seen_at > now() - interval '12 hours'
    and (
      p.id in (select m.target_id from public.mycelium m
               where m.truster_id = auth.uid() and m.target_type = 'profile')
      or p.id in (select m2.profile_id
                  from public.space_members m1
                  join public.space_members m2 on m2.space_id = m1.space_id
                  where m1.profile_id = auth.uid())
    )
  order by p.full_name;
$$;
