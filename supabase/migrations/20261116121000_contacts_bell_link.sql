-- Contacts got its own door (2026-11-16): the contact-joined bell lands there.
CREATE OR REPLACE FUNCTION public.link_contacts_to_profile(p_profile uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      'Their card in your contacts turned peach.', '/contacts', p_profile);
  end loop;
end $function$
;
CREATE OR REPLACE FUNCTION public.link_contacts_to_space(p_space uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      'Their card in your contacts turned peach.', '/contacts', null);
  end loop;
end $function$
;