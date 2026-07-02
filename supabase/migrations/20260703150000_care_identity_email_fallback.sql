-- =============================================================================
-- Care-team identity: fall back to EMAIL when a member has no display name.
--
-- NOT auto-applied. Run in the Supabase SQL editor, then refresh the init.sql
-- baseline with pg_dump. Idempotent.
--
-- Problem: a member you invite before they've set a full_name shows up as the
-- generic "A member" / "Member" — you can't tell who it is. Names still win when
-- present; this only adds an email fallback so there's always a recognizable
-- identity.
--
-- Privacy: members still can't read the profiles.email column directly (the
-- column-scoped grant from 20260629120100 stands). Email is surfaced ONLY:
--   * inside the SECURITY DEFINER notify triggers (owned by postgres), and
--   * via care_member_display(), which reveals an email ONLY for the caller's
--     own care-team counterparties (a relationship they're already party to).
-- Everyone else still resolves to name-or-"Member", no email.
-- =============================================================================

-- ── Notify producers: coalesce(name, email, fallback) ────────────────────────
-- nullif(...,'') so a blank-string name doesn't shadow the email.

create or replace function public.on_care_request_notify()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_recipient uuid; v_name text;
begin
  if new.status <> 'pending' then return new; end if;
  v_recipient := case when new.initiated_by = new.patient_id
                      then new.caregiver_id else new.patient_id end;
  select coalesce(nullif(full_name, ''), email, 'A member')
    into v_name from public.profiles where id = new.initiated_by;
  perform public.notify(v_recipient, 'profile', null, 'care_request',
    v_name, 'wants to connect on your care team', '/profile', new.initiated_by);
  return new;
end; $$;
alter function public.on_care_request_notify() owner to postgres;

create or replace function public.on_message_notify()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_kind text; v_name text;
begin
  select kind into v_kind from public.chats where id = new.chat_id;
  if v_kind not in ('direct', 'care_team') then return new; end if;
  select coalesce(nullif(full_name, ''), email, 'A member')
    into v_name from public.profiles where id = new.sender_id;
  insert into public.notifications (recipient_id, section, type, title, body, link, actor_id)
  select m.profile_id, 'chat', 'dm_message',
         v_name, left(coalesce(new.body, 'Sent an attachment'), 140),
         '/chat/' || new.chat_id, new.sender_id
  from public.chat_members m
  where m.chat_id = new.chat_id and m.profile_id <> new.sender_id;
  return new;
end; $$;
alter function public.on_message_notify() owner to postgres;

create or replace function public.on_snapshot_notify()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_name text;
begin
  select coalesce(nullif(full_name, ''), email, 'Your care team')
    into v_name from public.profiles where id = new.author_id;
  perform public.notify(new.patient_id, 'concierge', null, 'snapshot_shared',
    v_name, 'shared a new wellness snapshot', '/concierge', new.author_id);
  return new;
end; $$;
alter function public.on_snapshot_notify() owner to postgres;

create or replace function public.on_care_plan_notify()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_name text;
begin
  select coalesce(nullif(full_name, ''), email, 'Your care team')
    into v_name from public.profiles where id = new.author_id;
  perform public.notify(new.patient_id, 'concierge', null, 'plan_shared',
    v_name, 'shared a new care plan', '/concierge', new.author_id);
  return new;
end; $$;
alter function public.on_care_plan_notify() owner to postgres;

-- ── Display-name resolver for the Profile care-team lists ─────────────────────
-- Returns a display string per id: name if set, else email IFF the caller shares
-- a care-team relationship (any status) with that id, else "Member". This is the
-- only path that lets a member see a counterparty's email, and only their own.
create or replace function public.care_member_display(p_ids uuid[])
returns table(id uuid, display text)
language sql security definer set search_path to 'public' stable as $$
  select p.id,
    case
      when p.id <> auth.uid() and exists (
        select 1 from public.care_team_members ct
        where (ct.patient_id = auth.uid() and ct.caregiver_id = p.id)
           or (ct.caregiver_id = auth.uid() and ct.patient_id = p.id)
      )
      then coalesce(nullif(p.full_name, ''), p.email, 'Member')
      else coalesce(nullif(p.full_name, ''), 'Member')
    end
  from public.profiles p
  where p.id = any(p_ids);
$$;
alter function public.care_member_display(uuid[]) owner to postgres;
revoke all on function public.care_member_display(uuid[]) from public, anon;
grant execute on function public.care_member_display(uuid[]) to authenticated;
