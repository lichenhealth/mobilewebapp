-- TASKS: ASSIGNMENT LANDS + CONSENTED VISIBILITY (founder 2026-08-14).
--
-- Assignment was half-built: reminder_recipients + per-person reminder_done
-- + notify/cron fan-out all work, and RLS already lets a recipient READ the
-- shared reminder — the client just never loaded it. The schema half here is
-- one policy: a recipient may LEAVE (delete their own row). Assignment stays
-- consensual without pending-state machinery — the bell announces, leaving
-- is one tap.
--
-- Visibility: "make my tasks visible to X" — location_shares' audience-rule
-- pattern (exclusion = a specific rule set to hidden; most-restrictive wins
-- at equal specificity; DEFAULT HIDDEN — a task list is undone work, more
-- intimate than a calendar). One new standing tier joins the vocabulary:
-- 'mycelium' (the owner's web), between space and everyone in specificity.

-- ── A named recipient can step out of an assignment ─────────────────────────
create policy "reminder_recipients leave" on public.reminder_recipients
  for delete using (recipient_type = 'profile' and recipient_id = auth.uid());

-- ── Who may see my tasks ────────────────────────────────────────────────────
create table public.task_shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  audience_type text not null check (audience_type in ('everyone', 'mycelium', 'space', 'profile')),
  audience_space_id uuid references public.spaces(id) on delete cascade,
  audience_profile_id uuid references public.profiles(id) on delete cascade,
  level text not null check (level in ('hidden', 'see')),
  created_at timestamptz not null default now(),
  constraint task_shares_audience_shape check (
    (audience_type in ('everyone', 'mycelium') and audience_space_id is null and audience_profile_id is null)
    or (audience_type = 'space' and audience_space_id is not null and audience_profile_id is null)
    or (audience_type = 'profile' and audience_profile_id is not null and audience_space_id is null))
);

create unique index task_shares_one_rule_per_audience on public.task_shares (
  owner_id, audience_type,
  coalesce(audience_space_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(audience_profile_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

alter table public.task_shares enable row level security;
create policy "task_shares owner" on public.task_shares
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update, delete on public.task_shares to authenticated;

-- Resolver: specificity profile > space > mycelium > everyone; at equal
-- specificity the MOST RESTRICTIVE wins (location_level's inversion —
-- exclude beats include); no rule at all means hidden.
create or replace function public.task_level(p_owner uuid, p_viewer uuid)
returns text language plpgsql stable security definer set search_path to 'public' as $func$
declare v text;
begin
  if p_viewer is null then return 'hidden'; end if;
  if p_owner = p_viewer then return 'see'; end if;

  -- 1. An explicit person rule wins outright.
  select s.level into v from public.task_shares s
   where s.owner_id = p_owner and s.audience_type = 'profile'
     and s.audience_profile_id = p_viewer;
  if v is not null then return v; end if;

  -- 2. Space rules over spaces BOTH belong to — most restrictive wins.
  select s.level into v from public.task_shares s
   where s.owner_id = p_owner and s.audience_type = 'space'
     and public.is_space_member(s.audience_space_id, p_owner)
     and public.is_space_member(s.audience_space_id, p_viewer)
   order by case s.level when 'hidden' then 0 else 1 end asc
   limit 1;
  if v is not null then return v; end if;

  -- 3. The web: a mycelium rule speaks to anyone the owner holds in theirs.
  select s.level into v from public.task_shares s
   where s.owner_id = p_owner and s.audience_type = 'mycelium'
     and exists (select 1 from public.mycelium m
                 where m.truster_id = p_owner
                   and m.target_type = 'profile' and m.target_id = p_viewer);
  if v is not null then return v; end if;

  -- 4. Everyone, else the privacy-first default.
  select s.level into v from public.task_shares s
   where s.owner_id = p_owner and s.audience_type = 'everyone';
  return coalesce(v, 'hidden');
end $func$;

-- The one read door: a viewer the ladder admits sees the owner's OPEN
-- to-dos and their reminders (raw rows — the client's recurrence engine
-- expands them). Nothing else escapes.
create or replace function public.visible_tasks_of(p_owner uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $func$
  select case when public.task_level(p_owner, auth.uid()) = 'hidden'
    then null
    else jsonb_build_object(
      'owner_name', (select coalesce(full_name, 'A member') from public.profiles where id = p_owner),
      'todos', coalesce((
        select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title) order by t.created_at desc)
        from public.todos t where t.profile_id = p_owner and not t.done), '[]'::jsonb),
      'reminders', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id, 'title', r.title, 'start_date', r.start_date,
          'end_date', r.end_date, 'at_min', r.at_min, 'recurrence', r.recurrence))
        from public.reminders r
        where r.profile_id = p_owner
          and (r.end_date >= current_date - 1 or r.recurrence is not null)), '[]'::jsonb))
  end;
$func$;
revoke all on function public.visible_tasks_of(uuid) from public, anon;
grant execute on function public.visible_tasks_of(uuid) to authenticated;
