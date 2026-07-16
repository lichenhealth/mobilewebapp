-- New category suggestions ring the admins' bell (founder, 2026-07-15).
-- Admin review doors moved from the side menu to the Profile Admin section;
-- this trigger makes sure admins hear about suggestions without a nav link
-- staring at them. Reuses the notify() helper (skips self, respects
-- notification_pref) with the global-admin fanout (profiles.is_admin) —
-- same shape as handle_new_space_request's admin loop.

create or replace function public.handle_new_category_suggestion()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_who text;
  v_admin uuid;
begin
  select full_name into v_who from public.profiles where id = new.proposer_id;
  for v_admin in select id from public.profiles where is_admin loop
    perform public.notify(
      v_admin, 'home', null, 'category_suggested',
      coalesce(v_who, 'A member') || ' suggests a new category: “' || new.name || '”',
      'Review it under Admin on your Profile.',
      '/admin/categories', new.proposer_id
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists on_category_suggestion on public.category_suggestions;
create trigger on_category_suggestion
  after insert on public.category_suggestions
  for each row execute function public.handle_new_category_suggestion();
