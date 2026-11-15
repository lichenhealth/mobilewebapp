-- CONTACT CARDS — gray until they join, peach once they're on Lichen
-- (founder 2026-11-15: "contacts be personal, professional for individuals
-- (can be both), groups, organizations, communities and places… When they
-- join lichen, they go from a gray contact to peach"; "organizations can run
-- places"; "Private and you can choose to share contact lists using all the
-- layers we have on lichen, e.g. with this group, but not these 3 members").
--
-- A card is a member's OWN private record. Guest lists keep their entries
-- shape (every consumer reads it) but each entry now carries a contact_id —
-- the card is the truth, the list a grouping of cards: the guest_lists
-- trigger files any new entry as a card, and a card's change flows back into
-- every list that holds it.

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'person'
    check (kind in ('person','organization','community','group','place')),
  name text not null default '' check (char_length(name) <= 120),
  roles text[] not null default '{}' check (roles <@ array['personal','professional']::text[]),
  parent_id uuid references public.contacts(id) on delete set null,
  photo_url text,
  emails text[] not null default '{}',
  phones text[] not null default '{}',
  website text,
  socials jsonb not null default '{}'::jsonb,
  address text,
  notes text check (char_length(notes) <= 4000),
  source text,
  linked_profile_id uuid references public.profiles(id) on delete set null,
  linked_space_id uuid references public.spaces(id) on delete set null,
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contacts_owner on public.contacts (owner_id);
alter table public.contacts enable row level security;
drop policy if exists "contacts owner" on public.contacts;
create policy "contacts owner" on public.contacts for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke all on public.contacts from anon;
grant select, insert, update, delete on public.contacts to authenticated;

-- Helpers ---------------------------------------------------------------
create or replace function public._digits(p text) returns text
language sql immutable as $f$ select regexp_replace(coalesce(p,''), '\D', '', 'g') $f$;

-- Two phone strings are the same number (last-10 when both carry ≥10 digits).
create or replace function public._same_phone(a text, b text) returns boolean
language sql immutable as $f$
  select case
    when length(public._digits(a)) >= 10 and length(public._digits(b)) >= 10
      then right(public._digits(a), 10) = right(public._digits(b), 10)
    else public._digits(a) <> '' and public._digits(a) = public._digits(b) end
$f$;

create or replace function public._web_domain(p text) returns text
language sql immutable as $f$
  select nullif(lower(regexp_replace(regexp_replace(regexp_replace(btrim(coalesce(p,'')),
    '^[a-z]+://', '', 'i'), '^www\.', '', 'i'), '[/?#:].*$', '')), '')
$f$;

create or replace function public._mail_domain(p text) returns text
language sql immutable as $f$
  select case when position('@' in coalesce(p,'')) > 0
    and lower(split_part(p, '@', 2)) not in ('gmail.com','googlemail.com','yahoo.com','hotmail.com','outlook.com',
      'live.com','msn.com','icloud.com','me.com','mac.com','aol.com','proton.me','protonmail.com','comcast.net','att.net','gmx.com')
    then lower(btrim(split_part(p, '@', 2))) end
$f$;

-- An organization's places are the same owner's cards.
create or replace function public.contacts_guard() returns trigger
language plpgsql security definer set search_path = public as $f$
begin
  new.updated_at := now();
  new.emails := coalesce((select array_agg(distinct lower(btrim(e))) from unnest(new.emails) e where btrim(e) <> ''), '{}');
  new.phones := coalesce((select array_agg(distinct btrim(p)) from unnest(new.phones) p where public._digits(p) <> ''), '{}');
  if new.kind <> 'person' then new.roles := '{}'; end if;
  if new.parent_id is not null then
    if new.parent_id = new.id or not exists (select 1 from public.contacts c where c.id = new.parent_id and c.owner_id = new.owner_id) then
      new.parent_id := null;
    end if;
  end if;
  -- Find them on Lichen right away (findable, onboarded members only — the
  -- member_by_contact boundary), when the card isn't linked yet.
  if new.linked_profile_id is null and new.kind = 'person' then
    select p.id into new.linked_profile_id
      from public.profiles p join auth.users u on u.id = p.id
     where p.onboarded and p.findable and p.id <> new.owner_id
       and (lower(u.email) = any(new.emails)
            or exists (select 1 from unnest(new.phones) ph where p.phone is not null and public._same_phone(ph, p.phone)))
     limit 1;
    if new.linked_profile_id is not null then new.linked_at := now(); end if;
  elsif new.linked_space_id is null and new.kind <> 'person' then
    select s.id into new.linked_space_id from public.spaces s
     where s.kind::text = new.kind and coalesce(s.status, 'live') <> 'offline' and coalesce(s.findable, true)
       and ( (public._web_domain(new.website) is not null and public._web_domain(s.contact->>'website') = public._web_domain(new.website))
          or (s.contact->>'email' is not null and lower(s.contact->>'email') = any(new.emails))
          or exists (select 1 from unnest(new.emails) e where public._mail_domain(e) is not null
                      and public._mail_domain(e) = coalesce(public._mail_domain(s.contact->>'email'), public._web_domain(s.contact->>'website'))) )
     limit 1;
    if new.linked_space_id is not null then new.linked_at := now(); end if;
  end if;
  return new;
end $f$;
drop trigger if exists contacts_guard on public.contacts;
create trigger contacts_guard before insert or update on public.contacts
  for each row execute function public.contacts_guard();

-- List entries ⇄ cards -----------------------------------------------------
-- Any entry without a card is filed as one (found by member / email / phone
-- in the LIST OWNER's cards, else created), and stamped with its contact_id.
create or replace function public.guest_list_file_entries() returns trigger
language plpgsql security definer set search_path = public as $f$
declare e jsonb; out jsonb := '[]'::jsonb; cid uuid; k text; v text;
begin
  for e in select * from jsonb_array_elements(coalesce(new.entries, '[]'::jsonb)) loop
    cid := nullif(e->>'contact_id', '')::uuid;
    if cid is null or not exists (select 1 from public.contacts c where c.id = cid and c.owner_id = new.owner_id) then
      cid := null; k := e->>'kind'; v := e->>'value';
      if k = 'member' then
        select id into cid from public.contacts where owner_id = new.owner_id and linked_profile_id = (e->>'id')::uuid limit 1;
        if cid is null then
          insert into public.contacts (owner_id, kind, name, linked_profile_id, linked_at, source)
          values (new.owner_id, 'person', coalesce(e->>'name',''), (e->>'id')::uuid, now(), 'guest list') returning id into cid;
        end if;
      elsif k = 'email' and coalesce(v,'') <> '' then
        select id into cid from public.contacts where owner_id = new.owner_id and lower(v) = any(emails) limit 1;
        if cid is null and btrim(coalesce(e->>'name','')) <> '' then
          -- Same name on a person card already = the same person's other line.
          select id into cid from public.contacts where owner_id = new.owner_id and kind = 'person'
            and lower(btrim(name)) = lower(btrim(e->>'name')) order by created_at limit 1;
          if cid is not null then update public.contacts set emails = emails || array[v] where id = cid; end if;
        end if;
        if cid is null then
          insert into public.contacts (owner_id, kind, name, emails, source)
          values (new.owner_id, 'person', coalesce(e->>'name',''), array[v], 'guest list') returning id into cid;
        end if;
      elsif k = 'phone' and coalesce(v,'') <> '' then
        select id into cid from public.contacts c where c.owner_id = new.owner_id
          and exists (select 1 from unnest(c.phones) p where public._same_phone(p, v)) limit 1;
        if cid is null and btrim(coalesce(e->>'name','')) <> '' then
          select id into cid from public.contacts where owner_id = new.owner_id and kind = 'person'
            and lower(btrim(name)) = lower(btrim(e->>'name')) order by created_at limit 1;
          if cid is not null then update public.contacts set phones = phones || array[coalesce(nullif(e->>'sms',''), v)] where id = cid; end if;
        end if;
        if cid is null then
          insert into public.contacts (owner_id, kind, name, phones, source)
          values (new.owner_id, 'person', coalesce(e->>'name',''), array[coalesce(nullif(e->>'sms',''), v)], 'guest list') returning id into cid;
        end if;
      end if;
      if cid is not null then e := e || jsonb_build_object('contact_id', cid); end if;
    end if;
    out := out || jsonb_build_array(e);
  end loop;
  new.entries := out;
  return new;
end $f$;
drop trigger if exists guest_list_file_entries on public.guest_lists;
create trigger guest_list_file_entries before insert or update of entries on public.guest_lists
  for each row execute function public.guest_list_file_entries();

-- A card's change flows into every list holding it; a card that joined
-- Lichen becomes a member entry (peach — invited on Lichen from then on).
create or replace function public.contacts_flow_to_lists() returns trigger
language plpgsql security definer set search_path = public as $f$
declare g record; e jsonb; out jsonb; changed boolean;
begin
  for g in select id, entries from public.guest_lists
            where owner_id = new.owner_id and entries @> jsonb_build_array(jsonb_build_object('contact_id', new.id)) loop
    out := '[]'::jsonb; changed := false;
    for e in select * from jsonb_array_elements(g.entries) loop
      if e->>'contact_id' = new.id::text then
        if new.linked_profile_id is not null and e->>'kind' <> 'member' then
          e := jsonb_build_object('kind','member','id',new.linked_profile_id,'name',new.name,'contact_id',new.id);
        elsif e->>'kind' = 'email' and cardinality(new.emails) > 0 and not (lower(e->>'value') = any(new.emails)) then
          e := e || jsonb_build_object('value', new.emails[1]);
        elsif e->>'kind' = 'phone' and cardinality(new.phones) > 0
              and not exists (select 1 from unnest(new.phones) p where public._same_phone(p, e->>'value')) then
          e := e || jsonb_build_object('value', public._digits(new.phones[1]), 'sms', new.phones[1]);
        end if;
        if new.name <> '' and coalesce(e->>'name','') <> new.name then e := e || jsonb_build_object('name', new.name); end if;
        changed := true;
      end if;
      out := out || jsonb_build_array(e);
    end loop;
    if changed and out <> g.entries then update public.guest_lists set entries = out where id = g.id; end if;
  end loop;
  return new;
end $f$;
drop trigger if exists contacts_flow_to_lists on public.contacts;
create trigger contacts_flow_to_lists after update of name, emails, phones, linked_profile_id on public.contacts
  for each row execute function public.contacts_flow_to_lists();

-- Deleting a card takes it off its owner's lists (or the list trigger would
-- simply file it again).
create or replace function public.contacts_leave_lists() returns trigger
language plpgsql security definer set search_path = public as $f$
begin
  update public.guest_lists g
     set entries = coalesce((select jsonb_agg(e) from jsonb_array_elements(g.entries) e where e->>'contact_id' is distinct from old.id::text), '[]'::jsonb)
   where g.owner_id = old.owner_id and g.entries @> jsonb_build_array(jsonb_build_object('contact_id', old.id));
  return old;
end $f$;
drop trigger if exists contacts_leave_lists on public.contacts;
create trigger contacts_leave_lists after delete on public.contacts
  for each row execute function public.contacts_leave_lists();

-- Gray → peach when they join ------------------------------------------------
create or replace function public.link_contacts_to_profile(p_profile uuid) returns void
language plpgsql security definer set search_path = public as $f$
declare v_email text; v_phone text; c record;
begin
  select lower(u.email), p.phone into v_email, v_phone
    from public.profiles p join auth.users u on u.id = p.id
   where p.id = p_profile and p.onboarded and p.findable;
  if not found then return; end if;
  for c in update public.contacts set linked_profile_id = p_profile, linked_at = now()
            where linked_profile_id is null and kind = 'person' and owner_id <> p_profile
              and ((v_email is not null and v_email = any(emails))
                   or (v_phone is not null and exists (select 1 from unnest(phones) ph where public._same_phone(ph, v_phone))))
            returning owner_id, name loop
    perform public.notify(c.owner_id, 'home', null, 'contact_joined',
      coalesce(nullif(c.name,''), 'One of your contacts') || ' is on Lichen now',
      'Their card in your contacts turned peach.', '/drive?contacts=1', p_profile);
  end loop;
end $f$;
revoke execute on function public.link_contacts_to_profile(uuid) from public, anon, authenticated;

create or replace function public.profiles_link_contacts() returns trigger
language plpgsql security definer set search_path = public as $f$
begin
  if new.onboarded and new.findable then perform public.link_contacts_to_profile(new.id); end if;
  return new;
end $f$;
drop trigger if exists profiles_link_contacts on public.profiles;
create trigger profiles_link_contacts after insert or update of onboarded, phone, email, findable on public.profiles
  for each row execute function public.profiles_link_contacts();

create or replace function public.link_contacts_to_space(p_space uuid) returns void
language plpgsql security definer set search_path = public as $f$
declare s record; c record; v_dom text; v_mail text; v_mdom text;
begin
  select * into s from public.spaces where id = p_space;
  if not found or coalesce(s.status,'live') = 'offline' or not coalesce(s.findable, true) then return; end if;
  v_dom := public._web_domain(s.contact->>'website');
  v_mail := lower(nullif(btrim(s.contact->>'email'),''));
  v_mdom := coalesce(public._mail_domain(v_mail), v_dom);
  if v_dom is null and v_mail is null then return; end if;
  for c in update public.contacts set linked_space_id = p_space, linked_at = now()
            where linked_space_id is null and kind = s.kind::text
              and ((v_dom is not null and public._web_domain(website) = v_dom)
                   or (v_mail is not null and v_mail = any(emails))
                   or (v_mdom is not null and exists (select 1 from unnest(emails) e where public._mail_domain(e) = v_mdom)))
            returning owner_id, name loop
    perform public.notify(c.owner_id, 'home', null, 'contact_joined',
      coalesce(nullif(c.name,''), s.name) || ' is on Lichen now',
      'Their card in your contacts turned peach.', '/drive?contacts=1', null);
  end loop;
end $f$;
revoke execute on function public.link_contacts_to_space(uuid) from public, anon, authenticated;

create or replace function public.spaces_link_contacts() returns trigger
language plpgsql security definer set search_path = public as $f$
begin perform public.link_contacts_to_space(new.id); return new; end $f$;
drop trigger if exists spaces_link_contacts on public.spaces;
create trigger spaces_link_contacts after insert or update of contact, status, findable on public.spaces
  for each row execute function public.spaces_link_contacts();

-- Sharing a list, on Lichen's own ladder --------------------------------------
create table if not exists public.contact_list_shares (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.guest_lists(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  audience_type text not null check (audience_type in ('everyone','mycelium','space','profile')),
  audience_space_id uuid references public.spaces(id) on delete cascade,
  audience_profile_id uuid references public.profiles(id) on delete cascade,
  level text not null default 'see' check (level in ('hidden','see','edit')),
  created_at timestamptz not null default now(),
  check ((audience_type = 'space') = (audience_space_id is not null)),
  check ((audience_type = 'profile') = (audience_profile_id is not null))
);
create unique index if not exists contact_list_shares_one on public.contact_list_shares
  (list_id, audience_type, coalesce(audience_space_id, audience_profile_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.contact_list_shares enable row level security;
drop policy if exists "list shares owner" on public.contact_list_shares;
create policy "list shares owner" on public.contact_list_shares for all to authenticated
  using (owner_id = auth.uid() and exists (select 1 from public.guest_lists g where g.id = list_id and g.owner_id = auth.uid()))
  with check (owner_id = auth.uid() and exists (select 1 from public.guest_lists g where g.id = list_id and g.owner_id = auth.uid()));
revoke all on public.contact_list_shares from anon;
grant select, insert, update, delete on public.contact_list_shares to authenticated;

-- The most specific rule wins (person > circle > web > everyone); at the
-- same level the most restrictive wins. Default: hidden.
create or replace function public.contact_list_level(p_list uuid, p_viewer uuid) returns text
language plpgsql stable security definer set search_path = public as $f$
declare v_owner uuid; v text;
begin
  if p_viewer is null then return 'hidden'; end if;
  select owner_id into v_owner from public.guest_lists where id = p_list;
  if v_owner is null then return 'hidden'; end if;
  if v_owner = p_viewer then return 'edit'; end if;
  select s.level into v from public.contact_list_shares s
   where s.list_id = p_list and s.audience_type = 'profile' and s.audience_profile_id = p_viewer;
  if v is not null then return v; end if;
  select s.level into v from public.contact_list_shares s
   where s.list_id = p_list and s.audience_type = 'space'
     and public.is_space_member(s.audience_space_id, v_owner) and public.is_space_member(s.audience_space_id, p_viewer)
   order by case s.level when 'hidden' then 0 when 'see' then 1 else 2 end limit 1;
  if v is not null then return v; end if;
  select s.level into v from public.contact_list_shares s
   where s.list_id = p_list and s.audience_type = 'mycelium'
     and exists (select 1 from public.mycelium m where m.truster_id = v_owner and m.truster_space_id is null
                  and m.target_type = 'profile' and m.target_id = p_viewer);
  if v is not null then return v; end if;
  select s.level into v from public.contact_list_shares s where s.list_id = p_list and s.audience_type = 'everyone';
  return coalesce(v, 'hidden');
end $f$;
grant execute on function public.contact_list_level(uuid, uuid) to authenticated;

drop policy if exists "guest_lists shared read" on public.guest_lists;
create policy "guest_lists shared read" on public.guest_lists for select to authenticated
  using (public.contact_list_level(id, auth.uid()) in ('see','edit'));
drop policy if exists "guest_lists shared edit" on public.guest_lists;
create policy "guest_lists shared edit" on public.guest_lists for update to authenticated
  using (public.contact_list_level(id, auth.uid()) = 'edit')
  with check (public.contact_list_level(id, auth.uid()) = 'edit');

-- Owner can't be changed by a shared editor.
create or replace function public.guest_lists_pin_owner() returns trigger
language plpgsql as $f$ begin new.owner_id := old.owner_id; return new; end $f$;
drop trigger if exists guest_lists_pin_owner on public.guest_lists;
create trigger guest_lists_pin_owner before update on public.guest_lists
  for each row execute function public.guest_lists_pin_owner();

-- File today's list entries as cards (touching entries runs the trigger).
update public.guest_lists set entries = entries;
