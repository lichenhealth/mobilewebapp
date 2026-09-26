-- THE CARE-REQUEST BELL LANDS AT THE APPROVE BUTTON (founder 2026-09-26:
-- "When I click on the care team notification from melanie, it just takes
-- me to my profile"). The link now names where the approval actually
-- lives: asked to be someone's CAREGIVER → Profile → Concierge → "People
-- you care for" (/profile#care-for auto-opens the section); someone
-- offered to care for YOU → the Concierge Care Team tab.
create or replace function public.on_care_request_notify()
returns trigger language plpgsql security definer set search_path to 'public' as $func$
declare v_recipient uuid; v_name text; v_link text;
begin
  if new.status <> 'pending' then return new; end if;
  v_recipient := case when new.initiated_by = new.patient_id
                      then new.caregiver_id else new.patient_id end;
  v_link := case when v_recipient = new.caregiver_id
                 then '/profile#care-for' else '/concierge/team' end;
  select coalesce(nullif(full_name, ''), email, 'A member')
    into v_name from public.profiles where id = new.initiated_by;
  perform public.notify(v_recipient, 'profile', null, 'care_request',
    v_name, 'wants to connect on your care team', v_link, new.initiated_by);
  return new;
end;
$func$;
