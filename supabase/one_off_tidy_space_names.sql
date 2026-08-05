-- One-off: trim the redundant kind word out of an EXISTING space name.
-- Founder-approved 2026-08-05 for Melanie's group ("Melanie Bright Mentorship
-- Group" under a heading that already reads "Group"). New and renamed spaces
-- are handled in code now — src/lib/spaceName.ts.
--
-- Run it:  ./worker/migrate.sh supabase/one_off_tidy_space_names.sql
-- (One transaction. Anything unexpected rolls the whole thing back.)

-- The same rule the app uses, in SQL: a kind word bookending the name, with a
-- separator in front of it, so "Regroup" and "Bailey Community Garden" are safe.
create or replace function pg_temp.tidy_space_name(p_name text, p_kind text)
returns text language sql immutable as $func$
  select case
    when trimmed = '' or trimmed ~* '^(the|a|an|our|my|your|this)$' then p_name
    else trimmed
  end
  from (
    select btrim(regexp_replace(p_name, case p_kind
      when 'group'        then '[[:space:]:,([–—-]+\(?groups?\)?[[:space:].!,;]*$'
      when 'community'    then '[[:space:]:,([–—-]+\(?communit(y|ies)\)?[[:space:].!,;]*$'
      when 'organization' then '[[:space:]:,([–—-]+\(?(organi[sz]ations?|orgs?)\)?[[:space:].!,;]*$'
      else '$^'   -- "place" is an ordinary word ("The Gathering Place") — never trimmed
    end, '', 'i'), ' :,([–—-') as trimmed
  ) t;
$func$;

-- ── Before / after, for the record (psql prints it) ──────────────────────────
select id, kind, name as before,
       pg_temp.tidy_space_name(name, kind::text) as after
from public.spaces
where pg_temp.tidy_space_name(name, kind::text) <> name
order by kind, name;

-- ── Apply: Melanie's group only ──────────────────────────────────────────────
update public.spaces
set name = pg_temp.tidy_space_name(name, kind::text)
where kind = 'group'
  and name ilike 'Melanie Bright Mentorship%Group';

-- The space's chat carries a TITLE SNAPSHOT taken when the space was created
-- (handle_new_space), so it has to be renamed alongside or the inbox keeps
-- showing the old name.
update public.chats c
set title = s.name
from public.spaces s
where c.space_id = s.id
  and s.kind = 'group'
  and s.name ilike 'Melanie Bright Mentorship%'
  and c.title is distinct from s.name;

select id, kind, name as now_reads from public.spaces
where kind = 'group' and name ilike 'Melanie Bright Mentorship%';

-- ── Platform-wide (NOT run above — uncomment only after reading the preview) ──
-- update public.spaces
-- set name = pg_temp.tidy_space_name(name, kind::text)
-- where pg_temp.tidy_space_name(name, kind::text) <> name;
--
-- update public.chats c set title = s.name
-- from public.spaces s
-- where c.space_id = s.id and c.title is distinct from s.name;
