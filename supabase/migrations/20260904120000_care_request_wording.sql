-- CARE REQUESTS SAY WHICH WAY THEY'RE FACING (founder 2026-07-28: "Galyn Burke
-- wants to become a member of your care team"). The notification was
-- direction-blind — "wants to connect on your care team" for both a patient
-- asking someone to care for them and a caregiver offering to help. Now each
-- reads as what it is, and both land in the section where they're answered.

create or replace function public.on_care_request_notify()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare v_recipient uuid; v_name text; v_body text; v_link text;
begin
  if new.status <> 'pending' then return new; end if;
  v_recipient := case when new.initiated_by = new.patient_id
                      then new.caregiver_id else new.patient_id end;
  select coalesce(full_name, 'A member') into v_name from public.profiles where id = new.initiated_by;
  if new.initiated_by = new.caregiver_id then
    -- A caregiver offering to help: the patient decides.
    v_body := 'wants to become a member of your care team';
    v_link := '/concierge/team';
  else
    -- A patient asking someone to care for them: the caregiver decides.
    v_body := 'asked you to join their care team';
    v_link := '/profile#care-for';
  end if;
  perform public.notify(v_recipient, 'profile', null, 'care_request',
    v_name, v_body, v_link, new.initiated_by);
  return new;
end; $fn$;
alter function public.on_care_request_notify() owner to postgres;
