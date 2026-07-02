-- =============================================================================
-- Notification preference: three levels — off / in_app / both.
--
-- Replaces the boolean email_notifications with a single preference:
--   'off'    → no notifications at all (producers skip this recipient)
--   'in_app' → in-app only (default)
--   'both'   → in-app + email
--
-- Also fixes a bug: `profiles` has column-scoped SELECT for `authenticated`
-- (privacy migration), so a newly-added column must be granted explicitly or the
-- client can't read it back — which is why the old toggle "didn't save".
--
-- NOT auto-applied. Run in the Supabase SQL editor, then refresh the init.sql
-- baseline. Idempotent.
-- =============================================================================

alter table public.profiles add column if not exists notification_pref text not null default 'in_app'
  check (notification_pref in ('off', 'in_app', 'both'));

-- Carry over anyone who had email turned on.
update public.profiles set notification_pref = 'both'
  where email_notifications is true and notification_pref <> 'both';

-- Column-scoped SELECT grant so the client can read the preference back.
grant select (notification_pref) on public.profiles to authenticated;
-- (UPDATE is not column-scoped — the "Users update own profile" policy already
--  lets a member write their own row, including this column.)

-- Suppress notifications for members who chose 'off'. `notify()` handles the
-- single-insert producers; the dm producer inserts a set, so it filters too.
create or replace function public.notify(
  p_recipient uuid, p_section text, p_space uuid, p_type text,
  p_title text, p_body text, p_link text, p_actor uuid
) returns void language plpgsql security definer set search_path to 'public' as $$
declare v_pref text;
begin
  if p_recipient is null or p_recipient = p_actor then return; end if;
  select notification_pref into v_pref from public.profiles where id = p_recipient;
  if coalesce(v_pref, 'in_app') = 'off' then return; end if;
  insert into public.notifications (recipient_id, section, space_id, type, title, body, link, actor_id)
  values (p_recipient, p_section, p_space, p_type, p_title, p_body, p_link, p_actor);
end; $$;
alter function public.notify(uuid,text,uuid,text,text,text,text,uuid) owner to postgres;

create or replace function public.on_message_notify()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_kind text; v_name text;
begin
  select kind into v_kind from public.chats where id = new.chat_id;
  if v_kind not in ('direct', 'care_team') then return new; end if;
  select coalesce(full_name, 'A member') into v_name from public.profiles where id = new.sender_id;
  insert into public.notifications (recipient_id, section, type, title, body, link, actor_id)
  select m.profile_id, 'chat', 'dm_message',
         v_name, left(coalesce(new.body, 'Sent an attachment'), 140),
         '/chat/' || new.chat_id, new.sender_id
  from public.chat_members m
  join public.profiles p on p.id = m.profile_id
  where m.chat_id = new.chat_id
    and m.profile_id <> new.sender_id
    and coalesce(p.notification_pref, 'in_app') <> 'off';
  return new;
end; $$;
alter function public.on_message_notify() owner to postgres;
