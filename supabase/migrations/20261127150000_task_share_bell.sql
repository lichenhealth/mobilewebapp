-- A shared checklist rings the person it was shared with (founder 2026-11-27:
-- "share that checklist with Gabe Miltner so that he can also check off items").
-- Sharing already worked through reminder_recipients (RLS + set_task_item_done
-- let anyone on the task tick); this bells the NEWLY added person once, from any
-- path (the task page, the composer, the brain), landing on the list itself.
create or replace function public.on_reminder_recipient_added()
returns trigger language plpgsql security definer set search_path = public as $func$
declare r record; v_owner text; v_link text; v_n int;
begin
  select id, profile_id, title, start_date, items into r from reminders where id = new.reminder_id;
  if not found then return new; end if;
  select coalesce(nullif(trim(full_name), ''), 'Someone') into v_owner from profiles where id = r.profile_id;
  v_n := coalesce(jsonb_array_length(case when jsonb_typeof(r.items) = 'array' then r.items else '[]'::jsonb end), 0);
  v_link := case when v_n > 0 then '/tasks/' || r.id else '/calendar?d=' || r.start_date end;
  if new.recipient_type = 'profile' then
    perform public.notify(new.recipient_id, 'calendar', null, 'task_shared',
      v_owner || ' shared ' || case when v_n > 0 then 'a checklist' else 'a task' end || ' with you',
      r.title || case when v_n > 0 then ' · ' || v_n || ' items — you can check them off too' else '' end,
      v_link, r.profile_id);
  elsif new.recipient_type = 'space' then
    perform public.notify(m.profile_id, 'calendar', null, 'task_shared',
      v_owner || ' shared ' || case when v_n > 0 then 'a checklist' else 'a task' end || ' with you',
      r.title, v_link, r.profile_id)
    from space_members m where m.space_id = new.recipient_id;
  end if;
  return new;
end $func$;

drop trigger if exists reminder_recipient_added on public.reminder_recipients;
create trigger reminder_recipient_added after insert on public.reminder_recipients
  for each row execute function public.on_reminder_recipient_added();
