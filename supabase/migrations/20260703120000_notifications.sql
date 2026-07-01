-- =============================================================================
-- Notifications — per-scope in-app notifications (+ email opt-in flag).
--
-- NOT auto-applied. Run in the Supabase SQL editor, then refresh the init.sql
-- baseline with pg_dump. Idempotent.
--
-- Every notification carries a scope: a top-level `section` (chat/concierge/
-- profile…) OR a specific `space_id`. Home shows the global total; a section or
-- space shows only its own. Producers are SECURITY DEFINER triggers (no client
-- INSERT). Email delivery (opt-in) is wired separately via an edge function +
-- Database Webhook; this migration only adds the `email_notifications` flag.
-- =============================================================================

-- Opt-in email flag (in-app notifications are always on; email defaults OFF).
alter table public.profiles
  add column if not exists email_notifications boolean not null default false;

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  section      text not null,                       -- 'profile' | 'chat' | 'concierge' | …
  space_id     uuid references public.spaces(id) on delete cascade,  -- null = not space-scoped
  type         text not null,                       -- 'care_request' | 'dm_message' | …
  title        text not null,
  body         text,
  link         text,                                -- in-app route to open
  actor_id     uuid references public.profiles(id) on delete set null,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
alter table public.notifications enable row level security;

-- Unread-count indexes (partial), + panel list.
create index if not exists notifications_recipient_section_unread_idx
  on public.notifications (recipient_id, section) where read_at is null;
create index if not exists notifications_recipient_space_unread_idx
  on public.notifications (recipient_id, space_id) where read_at is null;
create index if not exists notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc);

-- Recipient may read / mark-read / delete their own. NO client INSERT — producers
-- are SECURITY DEFINER triggers owned by postgres (which bypass RLS).
drop policy if exists "notif read"   on public.notifications;
drop policy if exists "notif update" on public.notifications;
drop policy if exists "notif delete" on public.notifications;
create policy "notif read"   on public.notifications for select to authenticated
  using (recipient_id = auth.uid());
create policy "notif update" on public.notifications for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
create policy "notif delete" on public.notifications for delete to authenticated
  using (recipient_id = auth.uid());

-- Realtime (default replica identity — we only consume INSERT/UPDATE).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ── Internal helper: insert one notification, with a self-notify guard ────────
create or replace function public.notify(
  p_recipient uuid, p_section text, p_space uuid, p_type text,
  p_title text, p_body text, p_link text, p_actor uuid
) returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if p_recipient is null or p_recipient = p_actor then return; end if;
  insert into public.notifications (recipient_id, section, space_id, type, title, body, link, actor_id)
  values (p_recipient, p_section, p_space, p_type, p_title, p_body, p_link, p_actor);
end; $$;
alter function public.notify(uuid,text,uuid,text,text,text,text,uuid) owner to postgres;

-- ── Producer 1: care request → notify the approver (party ≠ initiated_by) ─────
create or replace function public.on_care_request_notify()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_recipient uuid; v_name text;
begin
  if new.status <> 'pending' then return new; end if;
  v_recipient := case when new.initiated_by = new.patient_id
                      then new.caregiver_id else new.patient_id end;
  select coalesce(full_name, 'A member') into v_name from public.profiles where id = new.initiated_by;
  perform public.notify(v_recipient, 'profile', null, 'care_request',
    v_name, 'wants to connect on your care team', '/profile', new.initiated_by);
  return new;
end; $$;
alter function public.on_care_request_notify() owner to postgres;
drop trigger if exists on_care_request_notify_trg on public.care_team_members;
create trigger on_care_request_notify_trg after insert on public.care_team_members
  for each row execute function public.on_care_request_notify();

-- ── Producer 2: chat message → notify other members (direct + care_team only) ─
-- Group/community/org chats are excluded for v1 to avoid high-volume fan-out.
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
  where m.chat_id = new.chat_id and m.profile_id <> new.sender_id;
  return new;
end; $$;
alter function public.on_message_notify() owner to postgres;
drop trigger if exists on_message_notify_trg on public.chat_messages;
create trigger on_message_notify_trg after insert on public.chat_messages
  for each row execute function public.on_message_notify();

-- ── Producers 3 & 4: Concierge WOW/KOC → notify the patient ───────────────────
-- Guarded: these tables come from the separate WOW/KOC migration. The functions
-- are inert until their triggers attach, so we create the functions always and
-- attach the triggers only if the tables already exist. (Re-run this migration
-- after applying WOW/KOC to activate them.)
create or replace function public.on_snapshot_notify()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_name text;
begin
  select coalesce(full_name, 'Your care team') into v_name from public.profiles where id = new.author_id;
  perform public.notify(new.patient_id, 'concierge', null, 'snapshot_shared',
    v_name, 'shared a new wellness snapshot', '/concierge', new.author_id);
  return new;
end; $$;
alter function public.on_snapshot_notify() owner to postgres;

create or replace function public.on_care_plan_notify()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_name text;
begin
  select coalesce(full_name, 'Your care team') into v_name from public.profiles where id = new.author_id;
  perform public.notify(new.patient_id, 'concierge', null, 'plan_shared',
    v_name, 'shared a new care plan', '/concierge', new.author_id);
  return new;
end; $$;
alter function public.on_care_plan_notify() owner to postgres;

do $$
begin
  if to_regclass('public.health_snapshots') is not null then
    drop trigger if exists on_snapshot_notify_trg on public.health_snapshots;
    create trigger on_snapshot_notify_trg after insert on public.health_snapshots
      for each row execute function public.on_snapshot_notify();
  end if;
  if to_regclass('public.care_plans') is not null then
    drop trigger if exists on_care_plan_notify_trg on public.care_plans;
    create trigger on_care_plan_notify_trg after insert on public.care_plans
      for each row execute function public.on_care_plan_notify();
  end if;
end $$;
