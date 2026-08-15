-- COURSE NOTES + A SELF-ORGANIZING DRIVE (founder 2026-08-15)
--
--   "a note taking feature that ties the notes to the course itself, so you
--    can access them there, but also, each course automatically creates a
--    folder in drive for you, which you can delete if you want to — but
--    wouldn't it be cool for drive to be as self organizing as possible?"
--
-- Two pieces, one idea. Notes are PRIVATE by construction — owner-only RLS,
-- no visibility branching at all, the same shape `assistant_feed_posts` uses
-- for anything that is nobody else's business. And walking into a course
-- gives you a folder in your Drive without asking, because the moment you
-- have somewhere obvious to put things is the moment before you have
-- anything to put there.
--
-- The folder is an ordinary private `collections` row tagged
-- `details.forCourse = <course id>`, so it behaves like every other folder —
-- rename it, add to it, delete it. Deleting it is a real answer: the trigger
-- only ever fires on ENROLL, so a folder you threw away stays thrown away.

create table if not exists public.course_notes (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  collection_id uuid not null references public.collections(id) on delete cascade,
  -- Null = a note on the course as a whole; set = a note on one lesson.
  post_id       uuid references public.posts(id) on delete set null,
  body          text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists course_notes_owner_course_idx
  on public.course_notes (profile_id, collection_id, created_at desc);

alter table public.course_notes enable row level security;

drop policy if exists "course_notes are your own" on public.course_notes;
create policy "course_notes are your own" on public.course_notes
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

grant select, insert, update, delete on public.course_notes to authenticated;

-- Keep updated_at honest.
create or replace function public.touch_course_note()
returns trigger language plpgsql as $func$
begin
  new.updated_at := now();
  return new;
end;
$func$;

drop trigger if exists touch_course_note on public.course_notes;
create trigger touch_course_note before update on public.course_notes
  for each row execute function public.touch_course_note();

-- ── The folder, made for you on the way in ──────────────────────────────────
-- SECURITY DEFINER because the enrolling member owns the folder but the
-- INSERT happens inside someone else's course's trigger context.
create or replace function public.ensure_course_folder()
returns trigger language plpgsql security definer set search_path = public as $func$
declare
  v_name text;
begin
  -- Already has one (or had one and deleted it on purpose)? Leave it alone.
  if exists (
    select 1 from collections
     where owner_id = new.profile_id
       and details ->> 'forCourse' = new.collection_id::text
  ) then
    return new;
  end if;

  select name into v_name from collections where id = new.collection_id;
  if v_name is null then return new; end if;

  insert into collections (owner_id, name, kind, is_public, details)
  values (new.profile_id, v_name, 'collection', false,
          jsonb_build_object('forCourse', new.collection_id::text));

  return new;
end;
$func$;

drop trigger if exists ensure_course_folder on public.collection_enrollments;
create trigger ensure_course_folder after insert on public.collection_enrollments
  for each row execute function public.ensure_course_folder();
