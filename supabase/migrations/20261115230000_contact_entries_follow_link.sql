-- An entry filed onto a card that is already linked to a member reads as a
-- member entry right away (founder 2026-11-15: gray until on Lichen, peach once).
create or replace function public.guest_list_file_entries() returns trigger
language plpgsql security definer set search_path = public as $f$
declare e jsonb; out jsonb := '[]'::jsonb; cid uuid; k text; v text; lp uuid; nm text;
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
    -- A card already on Lichen makes its entry a member entry (peach on lists too).
    cid := nullif(e->>'contact_id', '')::uuid;
    if cid is not null and e->>'kind' <> 'member' then
      select linked_profile_id, name into lp, nm from public.contacts where id = cid and owner_id = new.owner_id;
      if lp is not null then
        e := jsonb_build_object('kind','member','id',lp,'name',coalesce(nullif(btrim(nm),''), e->>'name'),'contact_id',cid);
      end if;
    end if;
    out := out || jsonb_build_array(e);
  end loop;
  new.entries := out;
  return new;
end $f$;

update public.guest_lists set entries = entries;
