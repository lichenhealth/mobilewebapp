-- POST TO A CONTACT LIST (founder 2026-11-16: "I could see you posting
-- something to Lichen to a contact list, and those on lichen see it on lichen,
-- but everyone else also has it sent to their cell or email"). A post may name
-- PEOPLE as its audience: those members read it through the posts RLS arm
-- below and are belled once; people off Lichen ride post_guests (their /p/
-- link by email or the author's own Messages) — no change needed there.

alter table public.posts
  add column if not exists audience_profile_ids uuid[] not null default '{}'::uuid[];

-- Recreated VERBATIM + one arm (never narrowed).
drop policy if exists "posts: read" on public.posts;
create policy "posts: read" on public.posts for select to authenticated using (
  ((author_space_id is null) or space_alive(author_space_id)) and (
    is_public
    or (author_id = auth.uid())
    or (to_mycelium and exists (
      select 1 from mycelium my
      where my.truster_id = auth.uid()
        and ((my.target_type = 'profile' and my.target_id = posts.author_id)
          or (my.target_type = 'space' and my.target_id = posts.author_space_id))))
    or exists (
      select 1 from space_members m
      where m.profile_id = auth.uid() and m.space_id = any (posts.audience_space_ids))
    or ((linked_event_id is not null) and is_event_attendee(linked_event_id, auth.uid()))
    or (auth.uid() = any (posts.audience_profile_ids))
  )
);

-- Bell each newly-named person once, with the author's name.
create or replace function public.post_people_notify()
returns trigger language plpgsql security definer set search_path = public as $func$
declare
  v_new uuid[];
  v_who text;
  v_title text;
  r uuid;
begin
  v_new := array(
    select unnest(coalesce(new.audience_profile_ids, '{}'))
    except
    select unnest(case when tg_op = 'UPDATE' then coalesce(old.audience_profile_ids, '{}') else '{}'::uuid[] end)
  );
  if cardinality(v_new) = 0 then return new; end if;
  select coalesce(s.name, p.full_name, 'Someone') into v_who
    from profiles p left join spaces s on s.id = new.author_space_id
   where p.id = new.author_id;
  v_title := coalesce(nullif(trim(new.title), ''), left(trim(coalesce(new.body, '')), 60), 'a post');
  foreach r in array v_new loop
    if r is distinct from new.author_id then
      perform notify(r, 'home', null, 'post_shared',
        v_who || ' shared a post with you',
        '“' || v_title || '”', '/posts/' || new.id, new.author_id);
    end if;
  end loop;
  return new;
end; $func$;

drop trigger if exists posts_people_notify on public.posts;
create trigger posts_people_notify
  after insert or update of audience_profile_ids on public.posts
  for each row execute function public.post_people_notify();

-- The insert check requires SOME audience — named people count (verbatim + one arm).
drop policy if exists "posts: insert own" on public.posts;
create policy "posts: insert own" on public.posts for insert to authenticated with check (
  ((author_id = auth.uid()) or is_entity_steward(author_id, auth.uid()))
  and (is_public or to_mycelium or (cardinality(audience_space_ids) > 0)
       or ((linked_event_id is not null) and is_event_creator(linked_event_id, auth.uid()))
       or (cardinality(audience_profile_ids) > 0))
  and (not exists (
    select 1 from unnest(posts.audience_space_ids) a(sid)
    where not exists (select 1 from space_members m where m.space_id = a.sid and m.profile_id = auth.uid())))
  and ((author_space_id is null) or is_space_admin(author_space_id, auth.uid()))
);
