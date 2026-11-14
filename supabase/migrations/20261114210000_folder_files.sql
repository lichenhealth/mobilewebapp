-- FILES IN FOLDERS (founder 2026-11-14: "make it so docs and presos etc can go
-- inside folders, not just posts"). collection_items holds a member's own
-- Drive docs/sheets/presentations ('doc' → chat_docs) and uploaded files
-- ('file' → drive_files) beside posts. Still by reference: putting a private
-- doc in a published folder shows its title row to readers, never its
-- contents — chat_docs/drive_files RLS stays the only door to those.
alter table public.collection_items drop constraint if exists collection_items_target_type_check;
alter table public.collection_items add constraint collection_items_target_type_check
  check (target_type in ('post', 'doc', 'file'));

create or replace function public.enforce_folder_file()
returns trigger language plpgsql security definer set search_path = public as $func$
declare v_ok boolean;
begin
  if new.target_type = 'post' then return new; end if;
  -- The service role (the assistant's own tools) has already checked
  -- ownership against the member it acts for.
  if auth.uid() is null then return new; end if;
  if new.target_type = 'doc' then
    select exists(select 1 from chat_docs d where d.id = new.target_id and d.created_by = auth.uid() and d.chat_id is null) into v_ok;
  else
    select exists(select 1 from drive_files f where f.id = new.target_id and f.profile_id = auth.uid()) into v_ok;
  end if;
  if not v_ok then
    raise exception 'Only your own Drive files can go in a folder.';
  end if;
  return new;
end $func$;

drop trigger if exists collection_items_folder_file on public.collection_items;
create trigger collection_items_folder_file before insert on public.collection_items
  for each row execute function public.enforce_folder_file();
