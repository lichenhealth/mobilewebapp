-- A TASK CAN CARRY A CHECKLIST (founder 2026-11-26: "taking a photo and
-- translating it into a shopping list that's attached to a date in cal,
-- where tasks can be checked off as items are bought").
-- items = [{id, text, group?, done?, done_by?, done_at?}] — the owner edits
-- the list through the existing owner policy; ticking an item goes through
-- set_task_item_done so anyone ON the task (owner or a recipient) can tick.
alter table public.reminders
  add column if not exists items jsonb not null default '[]'::jsonb;

do $chk$ begin
  alter table public.reminders add constraint reminders_items_shape
    check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 300);
exception when duplicate_object then null; end $chk$;

create or replace function public.set_task_item_done(p_reminder uuid, p_item text, p_done boolean)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid();
  v_items jsonb;
  v_new jsonb;
begin
  if v_uid is null then raise exception 'Sign in first.'; end if;
  select items into v_items from reminders where id = p_reminder for update;
  if v_items is null then raise exception 'That task is gone.'; end if;
  if not exists (select 1 from reminders where id = p_reminder and profile_id = v_uid)
     and not public.is_on_reminder(p_reminder, v_uid) then
    raise exception 'That task isn''t yours to tick.';
  end if;
  select coalesce(jsonb_agg(
           case when e->>'id' = p_item then
             case when p_done then e || jsonb_build_object('done', true, 'done_by', v_uid, 'done_at', now())
                  else (e - 'done_by' - 'done_at') || jsonb_build_object('done', false) end
           else e end order by ord), '[]'::jsonb)
    into v_new
    from jsonb_array_elements(v_items) with ordinality as t(e, ord);
  update reminders set items = v_new where id = p_reminder;
  return v_new;
end $fn$;

revoke all on function public.set_task_item_done(uuid, text, boolean) from public, anon;
grant execute on function public.set_task_item_done(uuid, text, boolean) to authenticated;
