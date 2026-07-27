-- CURATED SECTIONS ARE STEWARDED (founder, 2026-07-26): a space's main feed
-- stays a communal wall, but its Courses/Library sections show only what the
-- space authored — or what its duty-holders APPROVED. Sharing a course into
-- a space you don't steward files a request; approving it can also promote
-- the sharer into a courses-duty admin (the "course provider" on-ramp).

-- ── 1. The requests ──────────────────────────────────────────────────────────
create table if not exists public.space_section_shares (
  space_id uuid not null references public.spaces(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  area text not null check (area in ('courses', 'library')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  requested_by uuid not null references public.profiles(id) on delete cascade,
  decided_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (space_id, post_id, area)
);
create index if not exists sss_space_status_idx on public.space_section_shares (space_id, area, status);
alter table public.space_section_shares enable row level security;

-- Approved rows are how sections render (any member reads); pending/declined
-- stay between the requester and the space's admins.
create policy "sss: read" on public.space_section_shares
  for select to authenticated using (
    status = 'approved'
    or requested_by = auth.uid()
    or public.is_space_admin(space_id, auth.uid())
  );
-- No client INSERT/UPDATE — the trigger files requests; the RPC decides them.

-- ── 2. Filing: sharing a curated-area post into a space you don't steward ───
create or replace function public.handle_section_shares()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
declare
  v_sid uuid; v_area text; v_duty text; v_name text; v_who text; v_admin uuid;
  v_areas text[];
begin
  if new.audience_space_ids is null or array_length(new.audience_space_ids, 1) is null then
    return new;
  end if;
  v_areas := array(select unnest(new.service_areas) intersect select unnest(array['courses','library']));
  if array_length(v_areas, 1) is null then
    return new;
  end if;
  foreach v_sid in array new.audience_space_ids loop
    foreach v_area in array v_areas loop
      v_duty := case when v_area = 'courses' then 'courses' else 'library' end;
      -- The space's own voice, or a duty-holder: straight in (approved).
      if new.author_space_id = v_sid or public.has_space_duty(v_sid, new.author_id, v_duty) then
        insert into public.space_section_shares (space_id, post_id, area, status, requested_by, decided_by)
        values (v_sid, new.id, v_area, 'approved', new.author_id, new.author_id)
        on conflict do nothing;
      else
        insert into public.space_section_shares (space_id, post_id, area, status, requested_by)
        values (v_sid, new.id, v_area, 'pending', new.author_id)
        on conflict do nothing;
        -- Bell the stewards.
        select name into v_name from public.spaces where id = v_sid;
        select full_name into v_who from public.profiles where id = new.author_id;
        for v_admin in
          select m.profile_id from public.space_members m
          where m.space_id = v_sid and m.role in ('admin', 'super_admin')
            and public.has_space_duty(v_sid, m.profile_id, v_duty)
        loop
          perform public.notify(
            v_admin, 'home', v_sid, 'section_share_request',
            coalesce(v_who, 'A member') || ' shared a ' ||
              (case when v_area = 'courses' then 'course' else 'library piece' end) ||
              ' with ' || coalesce(v_name, 'your space'),
            'Approve it into the ' || v_area || ' section on the profile page.',
            '/spaces/' || v_sid, new.author_id
          );
        end loop;
      end if;
    end loop;
  end loop;
  return new;
end; $fn$;

drop trigger if exists on_post_section_shares on public.posts;
create trigger on_post_section_shares
  after insert on public.posts
  for each row execute function public.handle_section_shares();

-- ── 3. Deciding ──────────────────────────────────────────────────────────────
create or replace function public.decide_section_share(
  p_space uuid, p_post uuid, p_area text, p_approve boolean
) returns void
language plpgsql security definer set search_path = public
as $fn$
declare v_req uuid; v_name text; v_title text;
begin
  if not public.has_space_duty(p_space, auth.uid(),
        case when p_area = 'courses' then 'courses' else 'library' end) then
    raise exception 'Only this section''s stewards can decide shares';
  end if;
  select requested_by into v_req from public.space_section_shares
  where space_id = p_space and post_id = p_post and area = p_area and status = 'pending';
  if v_req is null then
    raise exception 'No pending share';
  end if;
  update public.space_section_shares
  set status = case when p_approve then 'approved' else 'declined' end,
      decided_by = auth.uid()
  where space_id = p_space and post_id = p_post and area = p_area;
  -- Approvals ring; declines stay quiet.
  if p_approve then
    select name into v_name from public.spaces where id = p_space;
    select coalesce(nullif(title, ''), left(body, 60)) into v_title from public.posts where id = p_post;
    perform public.notify(
      v_req, 'home', p_space, 'section_share_approved',
      'Your ' || (case when p_area = 'courses' then 'course' else 'piece' end) ||
        ' now lives in ' || coalesce(v_name, 'the space') || '''s ' || p_area,
      coalesce(v_title, ''), '/spaces/' || p_space, auth.uid());
  end if;
end; $fn$;
revoke all on function public.decide_section_share(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.decide_section_share(uuid, uuid, text, boolean) to authenticated;

-- ── 4. Grandfather existing shares as PENDING (Soul-bits et al. leave the
--       curated sections until a steward approves them) ──────────────────────
insert into public.space_section_shares (space_id, post_id, area, status, requested_by)
select sid, p.id, a,
  case when p.author_space_id = sid or public.has_space_duty(sid, p.author_id,
    case when a = 'courses' then 'courses' else 'library' end)
    then 'approved' else 'pending' end,
  p.author_id
from public.posts p,
  unnest(p.audience_space_ids) as sid,
  unnest(p.service_areas) as a
where a in ('courses', 'library')
on conflict do nothing;
