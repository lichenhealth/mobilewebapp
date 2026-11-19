-- ADD TO MAPS AND CONTACTS + THE PROPRIETOR CLAIMS HER PLACE
-- (founder 2026-11-19: "So you can say: Add to maps and contacts. Maybe that
-- also means that the proprietor can claim that place, if/when she joins the
-- platform").
--
-- (1) A card with an address carries its pin (lat/lng), so the member's own
--     places ride a private "My contacts" layer on Maps. Changing the address
--     clears a stale pin unless the same write carries a new one.
-- (2) THE CLAIM: when the business owner joins and makes her page (an
--     organization or place), every member's card for that business links
--     to it and turns peach. Linking already matched website / email /
--     email-domain; it now also matches a PHONE, and the SAME NAME at the
--     SAME SPOT (within ~250 m) — which is how a card saved from a web search
--     (often name + address only) finds the page its proprietor made. An
--     organization card and a place page (or the other way) count as the same
--     business. The proprietor never learns who saved her, or how many.

alter table public.contacts add column if not exists lat double precision;
alter table public.contacts add column if not exists lng double precision;

-- Names compare by their letters and digits only ("A Hand Above, LLC" ~ "a hand above").
create or replace function public._name_key(p text) returns text
language sql immutable as $f$
  select nullif(regexp_replace(regexp_replace(lower(coalesce(p,'')), '\m(llc|inc|co|the|ltd)\M', '', 'g'), '[^a-z0-9]', '', 'g'), '')
$f$;

create or replace function public._same_business_name(a text, b text) returns boolean
language sql immutable as $f$
  select public._name_key(a) is not null and public._name_key(b) is not null
     and char_length(least(public._name_key(a), public._name_key(b))) >= 4
     and (public._name_key(a) = public._name_key(b)
          or position(public._name_key(a) in public._name_key(b)) > 0
          or position(public._name_key(b) in public._name_key(a)) > 0)
$f$;

-- Rough metres between two points (plenty for "same spot").
create or replace function public._near_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision) returns double precision
language sql immutable as $f$
  select case when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
    else 6371000 * sqrt(power(radians(lat2 - lat1), 2) + power(radians(lng2 - lng1) * cos(radians((lat1 + lat2) / 2)), 2)) end
$f$;

create or replace function public._kinds_match(card_kind text, space_kind text) returns boolean
language sql immutable as $f$
  select card_kind = space_kind
      or (card_kind in ('organization','place') and space_kind in ('organization','place'))
$f$;

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
  -- A new address with no new pin: the old pin no longer tells the truth.
  if tg_op = 'UPDATE' and new.address is distinct from old.address
     and new.lat is not distinct from old.lat and new.lng is not distinct from old.lng then
    new.lat := null; new.lng := null;
  end if;
  if new.lat is not null and (new.lat < -90 or new.lat > 90 or new.lng is null or new.lng < -180 or new.lng > 180) then
    new.lat := null; new.lng := null;
  end if;
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
     where public._kinds_match(new.kind, s.kind::text) and coalesce(s.status, 'live') <> 'offline' and coalesce(s.findable, true)
       and ( (public._web_domain(new.website) is not null and public._web_domain(s.contact->>'website') = public._web_domain(new.website))
          or (s.contact->>'email' is not null and lower(s.contact->>'email') = any(new.emails))
          or exists (select 1 from unnest(new.emails) e where public._mail_domain(e) is not null
                      and public._mail_domain(e) = coalesce(public._mail_domain(s.contact->>'email'), public._web_domain(s.contact->>'website')))
          or (nullif(s.contact->>'phone','') is not null and exists (select 1 from unnest(new.phones) ph where public._same_phone(ph, s.contact->>'phone')))
          or (public._same_business_name(new.name, s.name) and public._near_m(new.lat, new.lng, s.lat, s.lng) <= 250) )
     order by (s.kind::text = new.kind) desc
     limit 1;
    if new.linked_space_id is not null then new.linked_at := now(); end if;
  end if;
  return new;
end $f$;

create or replace function public.link_contacts_to_space(p_space uuid) returns void
language plpgsql security definer set search_path = public as $f$
declare s record; c record; v_dom text; v_mail text; v_mdom text; v_phone text;
begin
  select * into s from public.spaces where id = p_space;
  if not found or coalesce(s.status,'live') = 'offline' or not coalesce(s.findable, true) then return; end if;
  v_dom := public._web_domain(s.contact->>'website');
  v_mail := lower(nullif(btrim(s.contact->>'email'),''));
  v_mdom := coalesce(public._mail_domain(v_mail), v_dom);
  v_phone := nullif(btrim(s.contact->>'phone'),'');
  if v_dom is null and v_mail is null and v_phone is null and (s.lat is null or s.lng is null) then return; end if;
  for c in update public.contacts set linked_space_id = p_space, linked_at = now()
            where linked_space_id is null and kind <> 'person' and public._kinds_match(kind, s.kind::text)
              and owner_id <> coalesce(s.created_by, '00000000-0000-0000-0000-000000000000'::uuid)
              and ((v_dom is not null and public._web_domain(website) = v_dom)
                   or (v_mail is not null and v_mail = any(emails))
                   or (v_mdom is not null and exists (select 1 from unnest(emails) e where public._mail_domain(e) = v_mdom))
                   or (v_phone is not null and exists (select 1 from unnest(phones) ph where public._same_phone(ph, v_phone)))
                   or (public._same_business_name(name, s.name) and public._near_m(lat, lng, s.lat, s.lng) <= 250))
            returning owner_id, name loop
    perform public.notify(c.owner_id, 'home', null, 'contact_joined',
      coalesce(nullif(c.name,''), s.name) || ' is on Lichen now',
      'They made their own page, so their card in your contacts turned peach.', '/contacts', null);
  end loop;
end $f$;
revoke execute on function public.link_contacts_to_space(uuid) from public, anon, authenticated;

drop trigger if exists spaces_link_contacts on public.spaces;
create trigger spaces_link_contacts after insert or update of contact, status, findable, lat, lng, name on public.spaces
  for each row execute function public.spaces_link_contacts();
