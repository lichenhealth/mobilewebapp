-- WISDOM LINEAGES — value attribution to the original wisdom holders
-- (founder 2026-11-20: "The value algorithm should take into account
-- cultural/wisdom appropriation. People have made millions off of
-- appropriating things like essential oils, reiki, etc, and there needs to be
-- reparations or value attribution to the original wisdom holders… just like
-- huachuma gets current-cy, the mexica should get value attribution").
--
-- A lineage (the Mexica, a reiki lineage…) is a stewarded member of kind
-- 'lineage', exactly as huachuma is a stewarded plant — so it can be named on
-- true-value records, hold Current-cy, and show on the routing desk as owed
-- restoration with no new money machinery.
--
-- Two decisions, both the founder's (2026-11-20):
--   • Lichen NEVER decides who speaks for a people. Until the lineage's own
--     recognized holders step in, the value is HELD IN TRUST BY LICHEN: a new
--     lineage is stewarded by the Lichen organization space.
--   • Only platform stewards create a lineage; members NOMINATE — a lineage,
--     or a holder for one. A nominated holder must ACCEPT before stewardship
--     moves (it is never presumed onto anyone).

-- ── 1. The kind ───────────────────────────────────────────────────────────
alter table public.profiles drop constraint if exists profiles_kind_check;
alter table public.profiles add constraint profiles_kind_check
  check (kind in ('person', 'plant', 'animal', 'place', 'element', 'collective', 'lineage'));
-- create_entity_profile still refuses 'lineage': lineages are born only
-- through approve_lineage_nomination below.

-- ── 2. Nominations ─────────────────────────────────────────────────────────
create table if not exists public.lineage_nominations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('lineage', 'holder')),
  lineage_id uuid references public.profiles(id) on delete cascade,
  name text,
  description text,
  nominee_profile_id uuid references public.profiles(id) on delete cascade,
  note text,
  nominated_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'declined', 'accepted', 'withdrawn')),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint lineage_nominations_shape check (
    case kind
      when 'lineage' then length(btrim(coalesce(name, ''))) between 2 and 120
      else lineage_id is not null and nominee_profile_id is not null
    end),
  constraint lineage_nominations_text_len check (
    length(coalesce(description, '')) <= 2000 and length(coalesce(note, '')) <= 1000)
);
create index if not exists lineage_nominations_status_idx on public.lineage_nominations (status, created_at);
alter table public.lineage_nominations enable row level security;

drop policy if exists "lineage_nominations insert own" on public.lineage_nominations;
create policy "lineage_nominations insert own" on public.lineage_nominations
  for insert to authenticated
  with check (nominated_by = auth.uid() and status = 'pending' and decided_at is null);

drop policy if exists "lineage_nominations read" on public.lineage_nominations;
create policy "lineage_nominations read" on public.lineage_nominations
  for select to authenticated
  using (nominated_by = auth.uid() or nominee_profile_id = auth.uid()
         or exists (select 1 from profiles me where me.id = auth.uid() and me.is_admin));

revoke all on public.lineage_nominations from anon;

-- A nomination bells the platform stewards (the category-suggestion grammar).
create or replace function public.on_lineage_nomination()
returns trigger language plpgsql security definer set search_path = public as $func$
declare a record; v_lineage text;
begin
  if new.kind = 'holder' then
    select full_name into v_lineage from profiles where id = new.lineage_id;
  end if;
  for a in select id from profiles where is_admin and id <> new.nominated_by loop
    perform notify(a.id, 'profile', null, 'lineage_nomination',
      case when new.kind = 'lineage'
        then 'A lineage was nominated: ' || btrim(new.name)
        else 'A holder was nominated for ' || coalesce(v_lineage, 'a lineage') end,
      coalesce(nullif(btrim(coalesce(new.note, new.description, '')), ''), 'Waiting for your review.'),
      '/admin/categories#lineages', new.nominated_by);
  end loop;
  return new;
end $func$;
drop trigger if exists lineage_nomination_bell on public.lineage_nominations;
create trigger lineage_nomination_bell after insert on public.lineage_nominations
  for each row execute function public.on_lineage_nomination();

-- ── 3. Decisions (platform stewards) ───────────────────────────────────────
create or replace function public.approve_lineage_nomination(
  p_id uuid, p_name text default null, p_description text default null)
returns uuid language plpgsql security definer set search_path = public as $func$
declare n lineage_nominations; v_lichen uuid; v_id uuid; v_lineage text;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
    raise exception 'Only a Lichen steward can approve a lineage.';
  end if;
  select * into n from lineage_nominations where id = p_id for update;
  if n.id is null then raise exception 'That nomination isn''t there.'; end if;
  if n.status <> 'pending' then raise exception 'That nomination was already decided.'; end if;

  if n.kind = 'lineage' then
    select id into v_lichen from spaces where handle = 'lichen' and status is distinct from 'offline' limit 1;
    if v_lichen is null then raise exception 'The Lichen organization isn''t reachable to hold this in trust.'; end if;
    v_id := gen_random_uuid();
    insert into profiles (id, full_name, kind, aspect, onboarded, bio, steward_space_id)
    values (v_id, btrim(coalesce(nullif(btrim(coalesce(p_name, '')), ''), n.name)), 'lineage', 'collective', true,
            nullif(btrim(coalesce(p_description, n.description, '')), ''), v_lichen);
    update lineage_nominations set status = 'approved', lineage_id = v_id,
      decided_at = now(), decided_by = auth.uid() where id = p_id;
    if n.nominated_by <> auth.uid() then
      perform notify(n.nominated_by, 'profile', null, 'lineage_decided',
        'The lineage you nominated is on Lichen',
        btrim(coalesce(nullif(btrim(coalesce(p_name, '')), ''), n.name)) ||
          ' now has a page. Lichen holds its value in trust until its own holders step in.',
        '/members/' || v_id, auth.uid());
    end if;
    return v_id;
  end if;

  -- A holder: approval asks the NOMINEE; stewardship moves only on their yes.
  select full_name into v_lineage from profiles where id = n.lineage_id and kind = 'lineage';
  if v_lineage is null then raise exception 'That lineage isn''t there anymore.'; end if;
  update lineage_nominations set status = 'approved', decided_at = now(), decided_by = auth.uid() where id = p_id;
  perform notify(n.nominee_profile_id, 'profile', null, 'lineage_holder_invite',
    'You''ve been recognized as a holder of ' || v_lineage,
    'Lichen holds value attributed to ' || v_lineage || ' in trust. Accept to steward it on behalf of the lineage.',
    '/members/' || n.lineage_id, auth.uid());
  if n.nominated_by not in (auth.uid(), n.nominee_profile_id) then
    perform notify(n.nominated_by, 'profile', null, 'lineage_decided',
      'Your holder nomination was approved',
      'We''ve asked them to accept stewardship of ' || v_lineage || '.',
      '/members/' || n.lineage_id, auth.uid());
  end if;
  return n.lineage_id;
end $func$;

create or replace function public.decline_lineage_nomination(p_id uuid)
returns void language plpgsql security definer set search_path = public as $func$
declare n lineage_nominations;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
    raise exception 'Only a Lichen steward can decide a nomination.';
  end if;
  select * into n from lineage_nominations where id = p_id for update;
  if n.id is null or n.status <> 'pending' then raise exception 'That nomination was already decided.'; end if;
  update lineage_nominations set status = 'declined', decided_at = now(), decided_by = auth.uid() where id = p_id;
  if n.nominated_by <> auth.uid() then
    perform notify(n.nominated_by, 'profile', null, 'lineage_decided',
      'Your nomination wasn''t taken up this time',
      coalesce(btrim(n.name), 'The holder nomination') || ' — thank you for raising it.',
      null, auth.uid());
  end if;
end $func$;

-- The nominee's own yes (or no). Moving stewardship out of trust.
create or replace function public.answer_lineage_stewardship(p_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $func$
declare n lineage_nominations; v_lineage text;
begin
  select * into n from lineage_nominations where id = p_id for update;
  if n.id is null or n.kind <> 'holder' or n.nominee_profile_id is distinct from auth.uid() then
    raise exception 'That invitation isn''t yours.';
  end if;
  if n.status <> 'approved' then raise exception 'That invitation isn''t open.'; end if;
  select full_name into v_lineage from profiles where id = n.lineage_id;
  if p_accept then
    update profiles set steward_profile_id = auth.uid(), steward_space_id = null
      where id = n.lineage_id and kind = 'lineage';
    update lineage_nominations set status = 'accepted' where id = p_id;
  else
    update lineage_nominations set status = 'withdrawn' where id = p_id;
  end if;
  perform notify(a.id, 'profile', null, 'lineage_decided',
      case when p_accept then 'A holder now stewards ' || coalesce(v_lineage, 'a lineage')
           else 'A nominated holder declined ' || coalesce(v_lineage, 'a lineage') end,
      case when p_accept then 'Its value is no longer held in trust by Lichen.'
           else 'It stays held in trust by Lichen.' end,
      '/members/' || n.lineage_id, auth.uid())
    from profiles a where a.is_admin and a.id <> auth.uid();
end $func$;

revoke all on function public.approve_lineage_nomination(uuid, text, text) from public, anon;
revoke all on function public.decline_lineage_nomination(uuid) from public, anon;
revoke all on function public.answer_lineage_stewardship(uuid, boolean) from public, anon;
grant execute on function public.approve_lineage_nomination(uuid, text, text) to authenticated;
grant execute on function public.decline_lineage_nomination(uuid) to authenticated;
grant execute on function public.answer_lineage_stewardship(uuid, boolean) to authenticated;
