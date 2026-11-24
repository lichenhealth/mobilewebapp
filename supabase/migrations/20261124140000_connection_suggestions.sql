-- CONNECTION SUGGESTIONS (founder 2026-11-24: "can we have a plus button? and
-- if lichen hasn't created a connection with that service, should they be
-- able to suggest lichen connect to it and that goes to me?").
-- A member names a service they want their Brain to work with; platform
-- admins are belled; an admin answers planned / built / not now and the
-- member hears the answer. Members never onboard a service for the whole
-- platform themselves — each connection is code + a security review.

create table if not exists public.connection_suggestions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  service text not null check (char_length(btrim(service)) between 2 and 80),
  why text check (why is null or char_length(why) <= 1000),
  status text not null default 'new' check (status in ('new', 'planned', 'built', 'declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null
);
create index if not exists connection_suggestions_status_idx on public.connection_suggestions (status, created_at desc);

alter table public.connection_suggestions enable row level security;
revoke all on public.connection_suggestions from anon;

create policy "conn sugg: own insert" on public.connection_suggestions
  for insert to authenticated
  with check (profile_id = auth.uid() and status = 'new' and decided_at is null and decided_by is null);
create policy "conn sugg: own or admin read" on public.connection_suggestions
  for select to authenticated
  using (profile_id = auth.uid()
         or exists (select 1 from profiles me where me.id = auth.uid() and me.is_admin));

-- Admins bell on a new suggestion.
create or replace function public.on_connection_suggestion()
returns trigger language plpgsql security definer set search_path = public as $func$
declare a record; v_name text;
begin
  select coalesce(full_name, 'A member') into v_name from profiles where id = new.profile_id;
  for a in select id from profiles where is_admin loop
    perform notify(a.id, 'profile', null, 'connection_suggestion',
      left(v_name || ' asked Lichen to connect ' || new.service, 200),
      left(coalesce(new.why, ''), 300), '/profile#connections', new.profile_id);
  end loop;
  return new;
end $func$;
drop trigger if exists connection_suggestion_bell on public.connection_suggestions;
create trigger connection_suggestion_bell after insert on public.connection_suggestions
  for each row execute function public.on_connection_suggestion();

-- The admin's answer; the member hears it.
create or replace function public.decide_connection_suggestion(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $func$
declare s record;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
    raise exception 'Only Lichen''s stewards can answer service suggestions.';
  end if;
  if p_status not in ('planned', 'built', 'declined', 'new') then
    raise exception 'That isn''t an answer this desk knows.';
  end if;
  update connection_suggestions
     set status = p_status,
         decided_at = case when p_status = 'new' then null else now() end,
         decided_by = case when p_status = 'new' then null else auth.uid() end
   where id = p_id returning * into s;
  if not found then raise exception 'That suggestion isn''t here anymore.'; end if;
  if p_status <> 'new' then
    perform notify(s.profile_id, 'profile', null, 'connection_suggestion_decided',
      left(case p_status
        when 'planned' then 'Lichen plans to connect ' || s.service
        when 'built' then s.service || ' can connect to Lichen now'
        else 'Lichen isn''t connecting ' || s.service || ' for now' end, 200),
      case p_status
        when 'planned' then 'Thanks for asking. You''ll hear again when it''s ready.'
        when 'built' then 'Open Connections to hook it up.'
        else 'Thanks for asking — it isn''t on the list right now.' end,
      '/profile#connections', auth.uid());
  end if;
end $func$;
revoke all on function public.decide_connection_suggestion(uuid, text) from public, anon;
grant execute on function public.decide_connection_suggestion(uuid, text) to authenticated;
