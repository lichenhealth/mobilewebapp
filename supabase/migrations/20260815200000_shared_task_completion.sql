-- ONE JOB, SHARED (founder 2026-08-14): "if I mark the task complete, or
-- Gabe does, I assume it disappears for both of us?" — it didn't. Every
-- recipient ticked their own copy, which is right for "everyone submit your
-- hours" and wrong for "bring the horses in", where the job only needs doing
-- once. Shared completion becomes the DEFAULT, with a per-task override for
-- the each-of-us shape.
--
-- The done rows stay per-person (they record WHO finished it — "done by
-- Gabe" falls out for free); what changes is who may SEE and UNDO them.

alter table public.reminders
  add column done_mode text not null default 'shared'
    check (done_mode in ('shared', 'each'));

comment on column public.reminders.done_mode is
  'shared = whoever ticks it completes it for everyone (default); each = every recipient ticks their own copy.';

-- Anyone ON the task — owner, named recipient, or member of a named space.
-- SECURITY DEFINER so reminder_done's policies never walk back into
-- reminder_recipients' policies (the 42P17 rule).
create or replace function public.is_on_reminder(p_reminder uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $func$
  select exists (select 1 from public.reminders r where r.id = p_reminder and r.profile_id = p_uid)
      or exists (
        select 1 from public.reminder_recipients rr
        where rr.reminder_id = p_reminder
          and ((rr.recipient_type = 'profile' and rr.recipient_id = p_uid)
            or (rr.recipient_type = 'space' and public.is_space_member(rr.recipient_id, p_uid))));
$func$;

-- READ: your own ticks, plus everyone's ticks on a task you're on — that is
-- what lets a shared task read as done for all of you, and name who did it.
drop policy if exists "reminder_done own" on public.reminder_done;
drop policy if exists "reminder_done_self" on public.reminder_done;
create policy "reminder_done read" on public.reminder_done
  for select using (profile_id = auth.uid() or public.is_on_reminder(reminder_id, auth.uid()));

-- WRITE: you tick as yourself.
create policy "reminder_done tick" on public.reminder_done
  for insert with check (profile_id = auth.uid());
create policy "reminder_done update own" on public.reminder_done
  for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- UNDO: your own tick always; someone else's only on a SHARED task you're on
-- (reopening a shared job is a normal thing to need — "actually, it's not
-- done"). Never on an each-of-us task, where their tick is their own record.
drop policy if exists "reminder_done untick" on public.reminder_done;
create policy "reminder_done untick" on public.reminder_done
  for delete using (
    profile_id = auth.uid()
    or (public.is_on_reminder(reminder_id, auth.uid())
        and exists (select 1 from public.reminders r
                    where r.id = reminder_id and r.done_mode = 'shared')));
