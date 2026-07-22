-- SHARED NUDGES (founder, 2026-07-22): a reminder can name recipients —
-- people, orgs, groups — who then get the nudge too. Still a reminder: no
-- RSVP, never busy, no free_busy weight. This relaxes reminders from
-- always-private to private-unless-you-share.

create table public.reminder_recipients (
  reminder_id uuid not null references public.reminders(id) on delete cascade,
  recipient_type text not null check (recipient_type in ('profile', 'space')),
  recipient_id uuid not null,
  primary key (reminder_id, recipient_type, recipient_id)
);
alter table public.reminder_recipients enable row level security;

-- SECURITY DEFINER ownership check — breaks the RLS cycle (reminder_recipients'
-- owner policy would otherwise read `reminders`, whose recipient-read policy
-- reads `reminder_recipients` back → 42P17 infinite recursion; the events
-- is_event_attendee() pattern).
create or replace function public.owns_reminder(p_reminder uuid)
returns boolean language sql security definer stable set search_path = public as $fn$
  select exists (select 1 from public.reminders where id = p_reminder and profile_id = auth.uid());
$fn$;

-- The reminder's owner manages its recipients.
create policy reminder_recipients_owner on public.reminder_recipients for all
  using (public.owns_reminder(reminder_id))
  with check (public.owns_reminder(reminder_id));
-- A recipient may read rows that name them (to show "shared with you").
create policy reminder_recipients_read on public.reminder_recipients for select
  using (
    (recipient_type = 'profile' and recipient_id = auth.uid())
    or (recipient_type = 'space' and exists (
      select 1 from public.space_members m where m.space_id = recipient_id and m.profile_id = auth.uid()))
  );

-- Recipients can SEE the reminder itself (the owner policy already covers owners).
create policy reminders_recipient_read on public.reminders for select using (
  exists (select 1 from public.reminder_recipients rr where rr.reminder_id = id and (
    (rr.recipient_type = 'profile' and rr.recipient_id = auth.uid())
    or (rr.recipient_type = 'space' and exists (
      select 1 from public.space_members m where m.space_id = rr.recipient_id and m.profile_id = auth.uid()))
  ))
);

-- Per-person check-off: each recipient ticks their OWN occurrence.
alter table public.reminder_done add column if not exists profile_id uuid references public.profiles(id) on delete cascade;
update public.reminder_done d set profile_id = r.profile_id
  from public.reminders r where d.reminder_id = r.id and d.profile_id is null;
alter table public.reminder_done alter column profile_id set not null;
alter table public.reminder_done drop constraint reminder_done_pkey;
alter table public.reminder_done add primary key (reminder_id, profile_id, on_date);
drop policy reminder_done_own on public.reminder_done;
create policy reminder_done_self on public.reminder_done for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Notify a reminder's recipients (called by the app after create/update).
-- SECURITY DEFINER to resolve space members; only the owner may call it.
create or replace function public.notify_reminder(p_reminder uuid)
returns void language plpgsql security definer set search_path = public as $func$
declare r record;
begin
  select * into r from reminders where id = p_reminder;
  if not found or r.profile_id <> auth.uid() then return; end if;
  perform public.notify(t.pid, 'calendar', null, 'reminder_shared',
    'Reminder: ' || r.title, null, '/calendar', auth.uid())
  from (
    select rr.recipient_id as pid from reminder_recipients rr
      where rr.reminder_id = p_reminder and rr.recipient_type = 'profile'
    union
    select m.profile_id from reminder_recipients rr
      join space_members m on m.space_id = rr.recipient_id
      where rr.reminder_id = p_reminder and rr.recipient_type = 'space'
  ) t
  where t.pid <> auth.uid();
end $func$;
