-- CARE-TEAM REMINDERS (founder 2026-10-12: "should we make it easy to
-- remind a care team member you've invited them to be on your care team?").
-- Two shapes of waiting, two reminders:
--   · a PENDING care_team_members row (a member who hasn't approved) gets a
--     fresh bell via remind_care_request() — only the asker, only while
--     pending, at most once a day (the invite_tokens reminder's floor);
--   · a care_invitations EMAIL row re-sends through send-care-invite, which
--     stamps reminded_at/remind_count server-side after Resend accepts
--     (a stamp always means a send — the un-mint rule's sibling).
-- Phone invitation rows already re-mint a tokened text from the inviter's
-- own Messages — their reminder needed no machinery.

alter table public.care_team_members
  add column if not exists reminded_at timestamptz;

alter table public.care_invitations
  add column if not exists reminded_at timestamptz,
  add column if not exists remind_count integer not null default 0;

create or replace function public.remind_care_request(p_link uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $func$
declare
  r record;
  v_name text;
  v_recipient uuid;
  v_link text;
begin
  select * into r from public.care_team_members where id = p_link;
  if r.id is null then
    raise exception 'That care request no longer exists.';
  end if;
  if r.status <> 'pending' then
    raise exception 'That connection is already active — nothing to remind.';
  end if;
  if auth.uid() is null or auth.uid() <> r.initiated_by then
    raise exception 'Only the person who sent the request can send a reminder.';
  end if;
  -- The first bell rang at creation (on_care_request_notify), so the floor
  -- counts from created_at until a reminder has gone out.
  if coalesce(r.reminded_at, r.created_at) > now() - interval '24 hours' then
    raise exception 'Asked within the last day — give it a little room.';
  end if;

  v_recipient := case when r.initiated_by = r.patient_id
                      then r.caregiver_id else r.patient_id end;
  -- The same landing rules as the original bell: the asked caregiver lands
  -- AT the Approve button; an offered-to patient lands on their team tab.
  v_link := case when v_recipient = r.caregiver_id
                 then '/profile#care-for' else '/concierge/team' end;
  select coalesce(nullif(full_name, ''), email, 'A member')
    into v_name from public.profiles where id = r.initiated_by;

  perform public.notify(v_recipient, 'profile', null, 'care_request',
    v_name, 'a gentle reminder — their care-team request is waiting for your yes',
    v_link, r.initiated_by);

  update public.care_team_members set reminded_at = now() where id = p_link;
end;
$func$;

revoke all on function public.remind_care_request(uuid) from public;
grant execute on function public.remind_care_request(uuid) to authenticated;
