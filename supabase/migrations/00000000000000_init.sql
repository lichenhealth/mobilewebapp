--
-- PostgreSQL database dump
--

\restrict xjeOThdlbCrWRHhefNlF5eDgtxGMwM7zsR2AU8f70d6WSwHWanVE7hPHUdH9bNg

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA public;


ALTER SCHEMA public OWNER TO pg_database_owner;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: account_capability; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.account_capability AS ENUM (
    'service_provider',
    'goods_provider'
);


ALTER TYPE public.account_capability OWNER TO postgres;

--
-- Name: space_kind; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.space_kind AS ENUM (
    'organization',
    'community',
    'group',
    'place'
);


ALTER TYPE public.space_kind OWNER TO postgres;

--
-- Name: space_member_role; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.space_member_role AS ENUM (
    'admin',
    'member',
    'super_admin'
);


ALTER TYPE public.space_member_role OWNER TO postgres;

--
-- Name: admin_list_supporters(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.admin_list_supporters() RETURNS TABLE(profile_id uuid, tier text, source text, status text, full_name text, email text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;
  return query
    select s.profile_id, s.tier, s.source, s.status, p.full_name, p.email
    from public.subscriptions s
    left join public.profiles p on p.id = s.profile_id
    order by s.granted_at desc nulls last;
end;
$$;


ALTER FUNCTION public.admin_list_supporters() OWNER TO postgres;

--
-- Name: approve_category_suggestion(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.approve_category_suggestion(p_suggestion_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  s public.category_suggestions;
  v_caller   uuid := auth.uid();
  v_is_admin boolean;
  v_base text;
  v_slug text;
  v_n int := 0;
begin
  select is_admin into v_is_admin from public.profiles where id = v_caller;
  if not coalesce(v_is_admin, false) then
    raise exception 'Not authorized';
  end if;

  select * into s from public.category_suggestions where id = p_suggestion_id;
  if s.id is null then raise exception 'Suggestion not found'; end if;
  if s.status <> 'pending' then raise exception 'Already decided'; end if;

  v_base := left(s.domain, 1) || '_' || regexp_replace(lower(s.name), '[^a-z0-9]+', '_', 'g');
  v_base := trim(both '_' from v_base);
  if v_base = '' or v_base = left(s.domain,1) || '_' then v_base := left(s.domain,1) || '_custom'; end if;
  v_slug := v_base;
  while exists (select 1 from public.categories where id = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '_' || v_n;
  end loop;

  insert into public.categories (id, domain, name, sort)
  values (v_slug, s.domain, s.name, 1000);

  insert into public.profile_categories (profile_id, category_id)
  values (s.proposer_id, v_slug)
  on conflict do nothing;

  update public.category_suggestions
    set status = 'approved', category_id = v_slug, decided_at = now(), decided_by = v_caller
    where id = p_suggestion_id;
end;
$$;


ALTER FUNCTION public.approve_category_suggestion(p_suggestion_id uuid) OWNER TO postgres;

--
-- Name: availability_of(uuid[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.availability_of(p_profiles uuid[]) RETURNS TABLE(profile_id uuid, weekday smallint, start_min smallint, end_min smallint, kind text, valid_from date, valid_to date)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select w.profile_id, w.weekday, w.start_min, w.end_min, w.kind, w.valid_from, w.valid_to
  from public.availability_windows w
  where w.profile_id = any(p_profiles)
    and public.calendar_level(w.profile_id, auth.uid()) <> 'hidden';
$$;


ALTER FUNCTION public.availability_of(p_profiles uuid[]) OWNER TO postgres;

--
-- Name: calendar_level(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.calendar_level(p_owner uuid, p_viewer uuid) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v text;
begin
  if p_owner = p_viewer then return 'details'; end if;

  -- 1. explicit person rule
  select level into v from public.calendar_shares
   where owner_id = p_owner and audience_type = 'profile' and audience_profile_id = p_viewer;
  if v is not null then return v; end if;

  -- 2. space rules over spaces BOTH belong to — most permissive wins
  select level into v
  from public.calendar_shares s
  where s.owner_id = p_owner and s.audience_type = 'space'
    and public.is_space_member(s.audience_space_id, p_owner)
    and public.is_space_member(s.audience_space_id, p_viewer)
  order by case s.level when 'details' then 2 when 'busy' then 1 else 0 end desc
  limit 1;
  if v is not null then return v; end if;

  -- 3. everyone rule, else default busy
  select level into v from public.calendar_shares
   where owner_id = p_owner and audience_type = 'everyone';
  return coalesce(v, 'busy');
end; $$;


ALTER FUNCTION public.calendar_level(p_owner uuid, p_viewer uuid) OWNER TO postgres;

--
-- Name: can_read_event(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.can_read_event(p_event uuid, p_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.events e
    where e.id = p_event
      and (e.creator_id = p_uid
        or e.owner_profile_id = p_uid
        or (e.owner_space_id is not null and public.is_space_member(e.owner_space_id, p_uid))
        or exists (select 1 from public.event_attendees a
                   where a.event_id = e.id and a.profile_id = p_uid))
  );
$$;


ALTER FUNCTION public.can_read_event(p_event uuid, p_uid uuid) OWNER TO postgres;

--
-- Name: care_member_display(uuid[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.care_member_display(p_ids uuid[]) RETURNS TABLE(id uuid, display text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


ALTER FUNCTION public.care_member_display(p_ids uuid[]) OWNER TO postgres;

--
-- Name: claim_care_invitations(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.claim_care_invitations() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid   uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  inv     record;
  v_count int := 0;
begin
  if v_uid is null or v_email = '' then return 0; end if;
  for inv in
    select * from public.care_invitations
    where lower(invitee_email) = v_email and status = 'pending'
  loop
    if inv.inviter_id <> v_uid then
      if inv.role = 'caregiver' then
        insert into public.care_team_members (patient_id, caregiver_id, initiated_by, status)
        values (inv.inviter_id, v_uid, inv.inviter_id, 'pending')
        on conflict (patient_id, caregiver_id) do nothing;
      else
        insert into public.care_team_members (patient_id, caregiver_id, initiated_by, status)
        values (v_uid, inv.inviter_id, inv.inviter_id, 'pending')
        on conflict (patient_id, caregiver_id) do nothing;
      end if;
    end if;
    update public.care_invitations
      set status = 'accepted', accepted_profile_id = v_uid, accepted_at = now()
      where id = inv.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end; $$;


ALTER FUNCTION public.claim_care_invitations() OWNER TO postgres;

--
-- Name: compose_full_name(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.compose_full_name() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  -- Conditional on purpose: signup inserts rows with first/last null and
  -- full_name from auth metadata — those must pass through unchanged.
  if new.first_name is not null or new.last_name is not null then
    new.full_name := btrim(concat_ws(' ', new.first_name, new.last_name));
  end if;
  return new;
end $$;


ALTER FUNCTION public.compose_full_name() OWNER TO postgres;

--
-- Name: create_space_chat(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_space_chat() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into public.chats (kind, space_id, title) values (new.kind, new.id, new.name);
  return new;
end; $$;


ALTER FUNCTION public.create_space_chat() OWNER TO postgres;

--
-- Name: ensure_care_chat(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ensure_care_chat(p_patient uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_chat uuid;
begin
  select id into v_chat from public.chats where patient_id = p_patient;
  if v_chat is null then
    insert into public.chats (kind, patient_id, title) values ('care_team', p_patient, 'Care team')
    returning id into v_chat;
    insert into public.chat_members (chat_id, profile_id) values (v_chat, p_patient) on conflict do nothing;
  end if;
  return v_chat;
end; $$;


ALTER FUNCTION public.ensure_care_chat(p_patient uuid) OWNER TO postgres;

--
-- Name: ensure_direct_chat(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ensure_direct_chat(p_other uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me   uuid := auth.uid();
  v_key  text;
  v_chat uuid;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if p_other is null or p_other = v_me then raise exception 'Invalid recipient'; end if;
  if not exists (select 1 from public.profiles where id = p_other) then
    raise exception 'No such member';
  end if;

  v_key := case when v_me < p_other
                then v_me::text || ':' || p_other::text
                else p_other::text || ':' || v_me::text end;

  select id into v_chat from public.chats where direct_key = v_key;
  if v_chat is null then
    insert into public.chats (kind, direct_key, title)
    values ('direct', v_key, null)
    on conflict (direct_key) where direct_key is not null do nothing
    returning id into v_chat;

    if v_chat is null then
      select id into v_chat from public.chats where direct_key = v_key;
    end if;

    insert into public.chat_members (chat_id, profile_id) values (v_chat, v_me)    on conflict do nothing;
    insert into public.chat_members (chat_id, profile_id) values (v_chat, p_other) on conflict do nothing;
  end if;

  return v_chat;
end;
$$;


ALTER FUNCTION public.ensure_direct_chat(p_other uuid) OWNER TO postgres;

--
-- Name: ensure_event_chat(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ensure_event_chat(p_event uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_chat uuid; v_creator uuid; v_title text; v_uid uuid := auth.uid();
begin
  select creator_id, title into v_creator, v_title from public.events where id = p_event;
  if v_creator is null then raise exception 'event not found'; end if;
  if v_uid <> v_creator and not exists (
    select 1 from public.event_attendees a
    where a.event_id = p_event and a.profile_id = v_uid
      and a.status in ('going', 'tentative')
  ) then
    raise exception 'not a member of this event';
  end if;

  select id into v_chat from public.chats where event_id = p_event and kind = 'event';
  if v_chat is null then
    insert into public.chats (kind, event_id, title)
    values ('event', p_event, coalesce(v_title, 'Event chat'))
    returning id into v_chat;
  end if;
  insert into public.chat_members (chat_id, profile_id) values (v_chat, v_creator) on conflict do nothing;
  insert into public.chat_members (chat_id, profile_id) values (v_chat, v_uid) on conflict do nothing;
  return v_chat;
end; $$;


ALTER FUNCTION public.ensure_event_chat(p_event uuid) OWNER TO postgres;

--
-- Name: ensure_help_chat(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ensure_help_chat() RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me      uuid := auth.uid();
  v_support uuid;
  v_key     text;
  v_chat    uuid;
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  select id into v_support from public.profiles
  where lower(email) = 'connect@lichen.health' limit 1;
  if v_support is null then raise exception 'Help is not available yet'; end if;
  if v_support = v_me then raise exception 'This is the help account'; end if;

  v_key := 'help:' || v_me::text;

  select id into v_chat from public.chats where direct_key = v_key;
  if v_chat is null then
    insert into public.chats (kind, direct_key, title)
    values ('help', v_key, null)
    on conflict (direct_key) where direct_key is not null do nothing
    returning id into v_chat;

    if v_chat is null then
      select id into v_chat from public.chats where direct_key = v_key;
    end if;

    insert into public.chat_members (chat_id, profile_id) values (v_chat, v_me)      on conflict do nothing;
    insert into public.chat_members (chat_id, profile_id) values (v_chat, v_support) on conflict do nothing;
  end if;

  return v_chat;
end; $$;


ALTER FUNCTION public.ensure_help_chat() OWNER TO postgres;

--
-- Name: find_member_by_email(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.find_member_by_email(p_email text) RETURNS TABLE(id uuid, full_name text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select p.id, p.full_name
  from public.profiles p
  where lower(p.email) = lower(trim(p_email))
  limit 1;
$$;


ALTER FUNCTION public.find_member_by_email(p_email text) OWNER TO postgres;

--
-- Name: free_busy(uuid[], date, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.free_busy(p_profiles uuid[], p_from date, p_to date) RETURNS TABLE(profile_id uuid, level text, start_date date, end_date date, all_day boolean, start_min smallint, end_min smallint, recurrence jsonb, title text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with lv as (
    select p as owner, public.calendar_level(p, auth.uid()) as level
    from unnest(p_profiles) as p
  ),
  owned as (
    select l.owner, l.level, e.*
    from lv l join public.events e on e.owner_profile_id = l.owner
    where l.level <> 'hidden'
  ),
  attending as (
    select l.owner, l.level, e.*
    from lv l
    join public.event_attendees a on a.profile_id = l.owner and a.status <> 'declined'
    join public.events e on e.id = a.event_id
    where l.level <> 'hidden'
  ),
  all_evts as (
    select distinct on (owner, id) * from (
      select * from owned union all select * from attending
    ) u
  )
  select owner, level, start_date, end_date, all_day, start_min, end_min, recurrence,
         case when level = 'details' then title else null end
  from all_evts
  where start_date <= p_to and (end_date >= p_from or recurrence is not null);
$$;


ALTER FUNCTION public.free_busy(p_profiles uuid[], p_from date, p_to date) OWNER TO postgres;

--
-- Name: gift_subscription(text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.gift_subscription(p_email text, p_tier text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_caller uuid := auth.uid(); v_is_admin boolean; v_target uuid;
begin
  select is_admin into v_is_admin from public.profiles where id = v_caller;
  if not coalesce(v_is_admin, false) then raise exception 'Not authorized'; end if;
  if p_tier not in ('community','concierge') then raise exception 'Invalid tier'; end if;
  select id into v_target from public.profiles where lower(email) = lower(p_email);
  if v_target is null then raise exception 'No member with that email'; end if;
  insert into public.subscriptions (profile_id, tier, source, status, granted_by, granted_at, updated_at)
  values (v_target, p_tier, 'gift', 'active', v_caller, now(), now())
  on conflict (profile_id) do update set
    tier = excluded.tier, source = 'gift', status = 'active',
    granted_by = v_caller, granted_at = now(),
    stripe_customer_id = null, stripe_subscription_id = null, updated_at = now();
end; $$;


ALTER FUNCTION public.gift_subscription(p_email text, p_tier text) OWNER TO postgres;

--
-- Name: handle_new_space(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.handle_new_space() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.created_by is not null then
    insert into public.space_members (space_id, profile_id, role)
    values (new.id, new.created_by, 'super_admin')
    on conflict do nothing;
  end if;
  return new;
end;
$$;


ALTER FUNCTION public.handle_new_space() OWNER TO postgres;

--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;


ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

--
-- Name: is_active_caregiver(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.is_active_caregiver(p_patient uuid, p_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.care_team_members c
                 where c.patient_id = p_patient and c.caregiver_id = p_uid and c.status = 'active');
$$;


ALTER FUNCTION public.is_active_caregiver(p_patient uuid, p_uid uuid) OWNER TO postgres;

--
-- Name: is_chat_member(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.is_chat_member(p_chat uuid, p_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.chat_members m where m.chat_id = p_chat and m.profile_id = p_uid);
$$;


ALTER FUNCTION public.is_chat_member(p_chat uuid, p_uid uuid) OWNER TO postgres;

--
-- Name: is_event_attendee(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.is_event_attendee(p_event uuid, p_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.event_attendees a
    where a.event_id = p_event and a.profile_id = p_uid
  );
$$;


ALTER FUNCTION public.is_event_attendee(p_event uuid, p_uid uuid) OWNER TO postgres;

--
-- Name: is_on_care_team(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.is_on_care_team(p_patient uuid, p_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select p_uid = p_patient
      or exists (select 1 from public.care_team_members c
                 where c.patient_id = p_patient and c.caregiver_id = p_uid and c.status = 'active');
$$;


ALTER FUNCTION public.is_on_care_team(p_patient uuid, p_uid uuid) OWNER TO postgres;

--
-- Name: is_space_admin(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.is_space_admin(p_space uuid, p_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.space_members m
                 where m.space_id = p_space and m.profile_id = p_uid
                   and m.role in ('admin', 'super_admin'));
$$;


ALTER FUNCTION public.is_space_admin(p_space uuid, p_uid uuid) OWNER TO postgres;

--
-- Name: is_space_member(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.is_space_member(p_space uuid, p_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.space_members m
                 where m.space_id = p_space and m.profile_id = p_uid);
$$;


ALTER FUNCTION public.is_space_member(p_space uuid, p_uid uuid) OWNER TO postgres;

--
-- Name: location_level(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.location_level(p_owner uuid, p_viewer uuid, p_kind text DEFAULT 'home'::text) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v text;
begin
  if p_owner = p_viewer then return 'exact'; end if;
  if p_viewer is null then return 'hidden'; end if;

  select level into v from public.location_shares
   where owner_id = p_owner and kind = p_kind
     and audience_type = 'profile' and audience_profile_id = p_viewer;
  if v is not null then return v; end if;

  select level into v
  from public.location_shares s
  where s.owner_id = p_owner and s.kind = p_kind and s.audience_type = 'space'
    and public.is_space_member(s.audience_space_id, p_owner)
    and public.is_space_member(s.audience_space_id, p_viewer)
  order by case s.level when 'hidden' then 0 when 'area' then 1 else 2 end asc
  limit 1;
  if v is not null then return v; end if;

  select level into v from public.location_shares
   where owner_id = p_owner and kind = p_kind and audience_type = 'everyone';
  return coalesce(v, 'hidden');
end; $$;


ALTER FUNCTION public.location_level(p_owner uuid, p_viewer uuid, p_kind text) OWNER TO postgres;

--
-- Name: mappable_members(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.mappable_members() RETURNS TABLE(id uuid, full_name text, avatar_url text, level text, lat double precision, lng double precision, place text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select p.id, p.full_name, p.avatar_url, lv.level,
         case when lv.level = 'exact' then p.home_lat
              else round((p.home_lat / 0.05)::numeric) * 0.05 end as lat,
         case when lv.level = 'exact' then p.home_lng
              else round((p.home_lng / 0.05)::numeric) * 0.05 end as lng,
         case when lv.level = 'exact' then p.home_location else p.home_area end as place
  from public.profiles p
  cross join lateral (select public.location_level(p.id, auth.uid()) as level) lv
  where p.home_lat is not null and p.home_lng is not null
    and lv.level <> 'hidden';
$$;


ALTER FUNCTION public.mappable_members() OWNER TO postgres;

--
-- Name: my_home(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.my_home() RETURNS TABLE(home_location text, home_lat double precision, home_lng double precision, home_area text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ select home_location, home_lat, home_lng, home_area from public.profiles where id = auth.uid() $$;


ALTER FUNCTION public.my_home() OWNER TO postgres;

--
-- Name: my_phone(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.my_phone() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ select phone from public.profiles where id = auth.uid() $$;


ALTER FUNCTION public.my_phone() OWNER TO postgres;

--
-- Name: notify(uuid, text, uuid, text, text, text, text, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.notify(p_recipient uuid, p_section text, p_space uuid, p_type text, p_title text, p_body text, p_link text, p_actor uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_pref text;
begin
  if p_recipient is null or p_recipient = p_actor then return; end if;
  select notification_pref into v_pref from public.profiles where id = p_recipient;
  if coalesce(v_pref, 'in_app') = 'off' then return; end if;
  insert into public.notifications (recipient_id, section, space_id, type, title, body, link, actor_id)
  values (p_recipient, p_section, p_space, p_type, p_title, p_body, p_link, p_actor);
end; $$;


ALTER FUNCTION public.notify(p_recipient uuid, p_section text, p_space uuid, p_type text, p_title text, p_body text, p_link text, p_actor uuid) OWNER TO postgres;

--
-- Name: on_call_roster(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.on_call_roster(p_patient uuid) RETURNS TABLE(caregiver_id uuid, full_name text, headline text, avatar_url text, phone text, window_id uuid, weekday smallint, start_min smallint, end_min smallint, valid_from date, valid_to date)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select ct.caregiver_id, p.full_name, p.headline, p.avatar_url, p.phone,
         w.id, w.weekday, w.start_min, w.end_min, w.valid_from, w.valid_to
  from public.care_team_members ct
  join public.profiles p on p.id = ct.caregiver_id
  left join public.availability_windows w
    on w.profile_id = ct.caregiver_id and w.kind = 'on_call'
  where ct.patient_id = p_patient
    and ct.status = 'active'
    and (
      auth.uid() = p_patient
      or exists (
        select 1 from public.care_team_members me
        where me.patient_id = p_patient
          and me.caregiver_id = auth.uid()
          and me.status = 'active'
      )
    );
$$;


ALTER FUNCTION public.on_call_roster(p_patient uuid) OWNER TO postgres;

--
-- Name: on_care_active(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.on_care_active() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_chat uuid;
begin
  v_chat := public.ensure_care_chat(new.patient_id);
  insert into public.chat_members (chat_id, profile_id) values (v_chat, new.patient_id)   on conflict do nothing;
  insert into public.chat_members (chat_id, profile_id) values (v_chat, new.caregiver_id) on conflict do nothing;
  if new.decided_at is null then new.decided_at := now(); end if;
  return new;
end; $$;


ALTER FUNCTION public.on_care_active() OWNER TO postgres;

--
-- Name: on_care_plan_notify(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.on_care_plan_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_name text;
begin
  select coalesce(nullif(full_name, ''), email, 'Your care team')
    into v_name from public.profiles where id = new.author_id;
  perform public.notify(new.patient_id, 'concierge', null, 'plan_shared',
    v_name, 'shared a new care plan', '/concierge', new.author_id);
  return new;
end; $$;


ALTER FUNCTION public.on_care_plan_notify() OWNER TO postgres;

--
-- Name: on_care_remove(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.on_care_remove() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_chat uuid;
begin
  select id into v_chat from public.chats where patient_id = old.patient_id;
  if v_chat is not null then
    delete from public.chat_members where chat_id = v_chat and profile_id = old.caregiver_id;
  end if;
  return old;
end; $$;


ALTER FUNCTION public.on_care_remove() OWNER TO postgres;

--
-- Name: on_care_request_notify(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.on_care_request_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


ALTER FUNCTION public.on_care_request_notify() OWNER TO postgres;

--
-- Name: on_event_invite_notify(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.on_event_invite_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_name text; v_title text; v_creator uuid;
begin
  select coalesce(nullif(full_name, ''), email, 'A member')
    into v_name from public.profiles where id = new.invited_by;
  select title, creator_id into v_title, v_creator from public.events where id = new.event_id;
  if new.invited_by = new.profile_id then
    -- self-RSVP (Book on an event post) → tell the host
    perform public.notify(v_creator, 'calendar', null, 'event_rsvp',
      v_name, 'is going: ' || coalesce(v_title, 'your event'), '/calendar', new.profile_id);
  else
    -- classic invite → tell the invitee
    perform public.notify(new.profile_id, 'calendar', null, 'event_invite',
      v_name, 'invited you: ' || coalesce(v_title, 'an event'), '/calendar', new.invited_by);
  end if;
  return new;
end; $$;


ALTER FUNCTION public.on_event_invite_notify() OWNER TO postgres;

--
-- Name: on_event_rsvp_notify(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.on_event_rsvp_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_name text; v_title text; v_creator uuid;
begin
  if new.status = old.status or new.status = 'invited' then return new; end if;
  select coalesce(nullif(full_name, ''), email, 'A member')
    into v_name from public.profiles where id = new.profile_id;
  select title, creator_id into v_title, v_creator from public.events where id = new.event_id;
  perform public.notify(v_creator, 'calendar', null, 'event_rsvp',
    v_name,
    (case new.status
       when 'going' then 'is going: '
       when 'tentative' then 'might come: '
       else 'can''t make it: '
     end) || coalesce(v_title, 'your event'),
    '/calendar', new.profile_id);
  return new;
end; $$;


ALTER FUNCTION public.on_event_rsvp_notify() OWNER TO postgres;

--
-- Name: on_message_notify(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.on_message_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_kind text; v_name text;
begin
  select kind into v_kind from public.chats where id = new.chat_id;
  if v_kind not in ('direct', 'care_team', 'help') then return new; end if;
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


ALTER FUNCTION public.on_message_notify() OWNER TO postgres;

--
-- Name: on_snapshot_notify(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.on_snapshot_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_name text;
begin
  select coalesce(nullif(full_name, ''), email, 'Your care team')
    into v_name from public.profiles where id = new.author_id;
  perform public.notify(new.patient_id, 'concierge', null, 'snapshot_shared',
    v_name, 'shared a new wellness snapshot', '/concierge', new.author_id);
  return new;
end; $$;


ALTER FUNCTION public.on_snapshot_notify() OWNER TO postgres;

--
-- Name: posts_audience_sync(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.posts_audience_sync() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.is_public = false and new.to_mycelium = false and new.audience_space_ids = '{}'::uuid[] then
    -- Old frontend: only `visibility` set → derive the new columns.
    new.is_public := (new.visibility = 'public');
    new.to_mycelium := (new.visibility = 'mycelium');
    if new.visibility = 'space' and new.space_id is not null then
      new.audience_space_ids := array[new.space_id];
    end if;
  else
    -- New frontend → keep legacy columns coherent (and their CHECKs satisfied).
    new.visibility := case when new.is_public then 'public'
                           when new.to_mycelium then 'mycelium'
                           else 'space' end;
    if new.visibility = 'space' and new.space_id is null then
      new.space_id := new.audience_space_ids[1];
    end if;
  end if;
  if new.service_areas = '{}' and new.service_area is not null then
    new.service_areas := array[new.service_area];
  elsif new.service_area is null and cardinality(new.service_areas) > 0 then
    new.service_area := new.service_areas[1];
  end if;
  return new;
end; $$;


ALTER FUNCTION public.posts_audience_sync() OWNER TO postgres;

--
-- Name: reject_category_suggestion(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.reject_category_suggestion(p_suggestion_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_caller uuid := auth.uid(); v_is_admin boolean;
begin
  select is_admin into v_is_admin from public.profiles where id = v_caller;
  if not coalesce(v_is_admin, false) then raise exception 'Not authorized'; end if;
  update public.category_suggestions
    set status = 'rejected', decided_at = now(), decided_by = v_caller
    where id = p_suggestion_id and status = 'pending';
end;
$$;


ALTER FUNCTION public.reject_category_suggestion(p_suggestion_id uuid) OWNER TO postgres;

--
-- Name: revoke_subscription(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.revoke_subscription(p_email text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_caller uuid := auth.uid(); v_is_admin boolean; v_target uuid;
begin
  select is_admin into v_is_admin from public.profiles where id = v_caller;
  if not coalesce(v_is_admin, false) then raise exception 'Not authorized'; end if;
  select id into v_target from public.profiles where lower(email) = lower(p_email);
  if v_target is null then raise exception 'No member with that email'; end if;
  delete from public.subscriptions where profile_id = v_target;
end; $$;


ALTER FUNCTION public.revoke_subscription(p_email text) OWNER TO postgres;

--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION public.rls_auto_enable() OWNER TO postgres;

--
-- Name: sync_attendee_to_event_chat(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sync_attendee_to_event_chat() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_chat uuid; v_creator uuid;
declare v_event uuid; v_profile uuid; v_status text;
begin
  if tg_op = 'DELETE' then
    v_event := old.event_id; v_profile := old.profile_id; v_status := 'declined';
  else
    v_event := new.event_id; v_profile := new.profile_id; v_status := new.status;
  end if;

  select id into v_chat from public.chats where event_id = v_event and kind = 'event';
  select creator_id into v_creator from public.events where id = v_event;

  if v_status in ('going', 'tentative') then
    if v_chat is null then
      insert into public.chats (kind, event_id, title)
      select 'event', e.id, coalesce(e.title, 'Event chat') from public.events e where e.id = v_event
      returning id into v_chat;
      insert into public.chat_members (chat_id, profile_id) values (v_chat, v_creator) on conflict do nothing;
    end if;
    insert into public.chat_members (chat_id, profile_id) values (v_chat, v_profile) on conflict do nothing;
  elsif v_chat is not null and v_profile <> v_creator then
    delete from public.chat_members where chat_id = v_chat and profile_id = v_profile;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;


ALTER FUNCTION public.sync_attendee_to_event_chat() OWNER TO postgres;

--
-- Name: sync_member_to_chat(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sync_member_to_chat() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_chat uuid;
begin
  if (TG_OP = 'INSERT') then
    select id into v_chat from public.chats where space_id = new.space_id;
    if v_chat is not null then
      insert into public.chat_members (chat_id, profile_id) values (v_chat, new.profile_id)
      on conflict do nothing;
    end if;
    return new;
  elsif (TG_OP = 'DELETE') then
    select id into v_chat from public.chats where space_id = old.space_id;
    if v_chat is not null then
      delete from public.chat_members where chat_id = v_chat and profile_id = old.profile_id;
    end if;
    return old;
  end if;
  return null;
end; $$;


ALTER FUNCTION public.sync_member_to_chat() OWNER TO postgres;

--
-- Name: touch_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION public.touch_updated_at() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: availability_windows; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.availability_windows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    weekday smallint NOT NULL,
    start_min smallint NOT NULL,
    end_min smallint NOT NULL,
    kind text DEFAULT 'available'::text NOT NULL,
    valid_from date,
    valid_to date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT availability_windows_end_min_check CHECK (((end_min >= 1) AND (end_min <= 1440))),
    CONSTRAINT availability_windows_kind_check CHECK ((kind = ANY (ARRAY['available'::text, 'on_call'::text]))),
    CONSTRAINT availability_windows_span CHECK ((end_min > start_min)),
    CONSTRAINT availability_windows_start_min_check CHECK (((start_min >= 0) AND (start_min <= 1439))),
    CONSTRAINT availability_windows_validity CHECK (((valid_from IS NULL) OR (valid_to IS NULL) OR (valid_to >= valid_from))),
    CONSTRAINT availability_windows_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)))
);


ALTER TABLE public.availability_windows OWNER TO postgres;

--
-- Name: calendar_shares; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.calendar_shares (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    audience_type text NOT NULL,
    audience_space_id uuid,
    audience_profile_id uuid,
    level text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calendar_shares_audience_shape CHECK ((((audience_type = 'everyone'::text) AND (audience_space_id IS NULL) AND (audience_profile_id IS NULL)) OR ((audience_type = 'space'::text) AND (audience_space_id IS NOT NULL) AND (audience_profile_id IS NULL)) OR ((audience_type = 'profile'::text) AND (audience_profile_id IS NOT NULL) AND (audience_space_id IS NULL)))),
    CONSTRAINT calendar_shares_audience_type_check CHECK ((audience_type = ANY (ARRAY['everyone'::text, 'space'::text, 'profile'::text]))),
    CONSTRAINT calendar_shares_level_check CHECK ((level = ANY (ARRAY['hidden'::text, 'busy'::text, 'details'::text])))
);


ALTER TABLE public.calendar_shares OWNER TO postgres;

--
-- Name: care_invitations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.care_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inviter_id uuid NOT NULL,
    invitee_email text NOT NULL,
    role text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    accepted_profile_id uuid,
    accepted_at timestamp with time zone,
    CONSTRAINT care_invitations_role_check CHECK ((role = ANY (ARRAY['caregiver'::text, 'patient'::text]))),
    CONSTRAINT care_invitations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'cancelled'::text])))
);


ALTER TABLE public.care_invitations OWNER TO postgres;

--
-- Name: care_plan_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.care_plan_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_id uuid NOT NULL,
    is_daily boolean DEFAULT false NOT NULL,
    item_date date,
    provider_id uuid,
    provider_label text,
    body text NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT care_plan_items_day_chk CHECK (((is_daily AND (item_date IS NULL)) OR ((NOT is_daily) AND (item_date IS NOT NULL)))),
    CONSTRAINT care_plan_items_provider_chk CHECK (((provider_id IS NOT NULL) OR ((provider_label IS NOT NULL) AND (length(btrim(provider_label)) > 0))))
);


ALTER TABLE public.care_plan_items OWNER TO postgres;

--
-- Name: care_plans; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.care_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_id uuid NOT NULL,
    author_id uuid NOT NULL,
    week_start date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.care_plans OWNER TO postgres;

--
-- Name: care_posts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.care_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_id uuid NOT NULL,
    author_id uuid NOT NULL,
    kind text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    dimensions text[] DEFAULT '{}'::text[] NOT NULL,
    score smallint,
    start_date date,
    end_date date,
    attachments jsonb DEFAULT '[]'::jsonb NOT NULL,
    links jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    previews jsonb DEFAULT '[]'::jsonb NOT NULL,
    recurrence jsonb,
    CONSTRAINT care_posts_dims_valid CHECK ((dimensions <@ ARRAY['Mental'::text, 'Physical'::text, 'Spiritual'::text, 'Social'::text, 'Environmental'::text, 'Economic'::text])),
    CONSTRAINT care_posts_kind_check CHECK ((kind = ANY (ARRAY['wow'::text, 'koc'::text]))),
    CONSTRAINT care_posts_kind_shape CHECK ((((kind = 'wow'::text) AND (score IS NOT NULL) AND (start_date IS NULL) AND (end_date IS NULL) AND (recurrence IS NULL)) OR ((kind = 'koc'::text) AND (score IS NULL) AND (start_date IS NOT NULL) AND (cardinality(dimensions) = 0) AND (((recurrence IS NULL) AND (end_date IS NOT NULL) AND (end_date >= start_date)) OR ((recurrence IS NOT NULL) AND ((end_date IS NULL) OR (end_date >= start_date))))))),
    CONSTRAINT care_posts_nonempty CHECK (((length(btrim(body)) > 0) OR (jsonb_array_length(attachments) > 0) OR (jsonb_array_length(links) > 0))),
    CONSTRAINT care_posts_score_check CHECK (((score >= 0) AND (score <= 100)))
);


ALTER TABLE public.care_posts OWNER TO postgres;

--
-- Name: care_team_members; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.care_team_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_id uuid NOT NULL,
    caregiver_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    initiated_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    CONSTRAINT care_team_members_check CHECK ((patient_id <> caregiver_id)),
    CONSTRAINT care_team_members_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text])))
);


ALTER TABLE public.care_team_members OWNER TO postgres;

--
-- Name: categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.categories (
    id text NOT NULL,
    domain text NOT NULL,
    name text NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    CONSTRAINT categories_domain_check CHECK ((domain = ANY (ARRAY['good'::text, 'service'::text])))
);


ALTER TABLE public.categories OWNER TO postgres;

--
-- Name: category_suggestions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.category_suggestions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    proposer_id uuid NOT NULL,
    domain text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    category_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    decided_by uuid,
    CONSTRAINT category_suggestions_domain_check CHECK ((domain = ANY (ARRAY['good'::text, 'service'::text]))),
    CONSTRAINT category_suggestions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


ALTER TABLE public.category_suggestions OWNER TO postgres;

--
-- Name: chat_members; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chat_members (
    chat_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.chat_members OWNER TO postgres;

--
-- Name: chat_message_reactions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chat_message_reactions (
    message_id uuid NOT NULL,
    chat_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.chat_message_reactions REPLICA IDENTITY FULL;


ALTER TABLE public.chat_message_reactions OWNER TO postgres;

--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chat_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    body text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    attachments jsonb,
    reply_to uuid,
    CONSTRAINT chat_messages_content_chk CHECK ((((body IS NOT NULL) AND (length(btrim(body)) > 0)) OR ((attachments IS NOT NULL) AND (jsonb_array_length(attachments) > 0))))
);


ALTER TABLE public.chat_messages OWNER TO postgres;

--
-- Name: chats; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    space_id uuid,
    patient_id uuid,
    title text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    direct_key text,
    event_id uuid,
    CONSTRAINT chats_kind_check CHECK ((kind = ANY (ARRAY['organization'::text, 'community'::text, 'group'::text, 'place'::text, 'care_team'::text, 'direct'::text, 'event'::text, 'help'::text])))
);


ALTER TABLE public.chats OWNER TO postgres;

--
-- Name: event_attendees; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.event_attendees (
    event_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    status text DEFAULT 'invited'::text NOT NULL,
    invited_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT event_attendees_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'going'::text, 'declined'::text, 'tentative'::text])))
);


ALTER TABLE public.event_attendees OWNER TO postgres;

--
-- Name: events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    creator_id uuid NOT NULL,
    owner_profile_id uuid,
    owner_space_id uuid,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    location text DEFAULT ''::text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    all_day boolean DEFAULT false NOT NULL,
    start_min smallint,
    end_min smallint,
    recurrence jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    lat double precision,
    lng double precision,
    CONSTRAINT events_end_min_check CHECK (((end_min >= 1) AND (end_min <= 1440))),
    CONSTRAINT events_one_owner CHECK (((((owner_profile_id IS NOT NULL))::integer + ((owner_space_id IS NOT NULL))::integer) = 1)),
    CONSTRAINT events_recur_single_day CHECK (((recurrence IS NULL) OR (start_date = end_date))),
    CONSTRAINT events_span CHECK ((end_date >= start_date)),
    CONSTRAINT events_start_min_check CHECK (((start_min >= 0) AND (start_min <= 1439))),
    CONSTRAINT events_times CHECK (((all_day AND (start_min IS NULL) AND (end_min IS NULL)) OR ((NOT all_day) AND (start_min IS NOT NULL) AND (end_min IS NOT NULL) AND ((start_date <> end_date) OR (end_min > start_min))))),
    CONSTRAINT events_title_check CHECK ((length(btrim(title)) > 0))
);


ALTER TABLE public.events OWNER TO postgres;

--
-- Name: health_snapshots; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.health_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_id uuid NOT NULL,
    author_id uuid NOT NULL,
    snapshot_date date NOT NULL,
    summary text DEFAULT ''::text NOT NULL,
    score_mental smallint NOT NULL,
    score_physical smallint NOT NULL,
    score_emotional smallint NOT NULL,
    score_social smallint NOT NULL,
    score_financial smallint NOT NULL,
    score_spirit smallint NOT NULL,
    sections jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT health_snapshots_score_emotional_check CHECK (((score_emotional >= 0) AND (score_emotional <= 100))),
    CONSTRAINT health_snapshots_score_financial_check CHECK (((score_financial >= 0) AND (score_financial <= 100))),
    CONSTRAINT health_snapshots_score_mental_check CHECK (((score_mental >= 0) AND (score_mental <= 100))),
    CONSTRAINT health_snapshots_score_physical_check CHECK (((score_physical >= 0) AND (score_physical <= 100))),
    CONSTRAINT health_snapshots_score_social_check CHECK (((score_social >= 0) AND (score_social <= 100))),
    CONSTRAINT health_snapshots_score_spirit_check CHECK (((score_spirit >= 0) AND (score_spirit <= 100)))
);


ALTER TABLE public.health_snapshots OWNER TO postgres;

--
-- Name: location_shares; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.location_shares (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    kind text DEFAULT 'home'::text NOT NULL,
    audience_type text NOT NULL,
    audience_space_id uuid,
    audience_profile_id uuid,
    level text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT location_shares_audience_shape CHECK ((((audience_type = 'everyone'::text) AND (audience_space_id IS NULL) AND (audience_profile_id IS NULL)) OR ((audience_type = 'space'::text) AND (audience_space_id IS NOT NULL) AND (audience_profile_id IS NULL)) OR ((audience_type = 'profile'::text) AND (audience_profile_id IS NOT NULL) AND (audience_space_id IS NULL)))),
    CONSTRAINT location_shares_audience_type_check CHECK ((audience_type = ANY (ARRAY['everyone'::text, 'space'::text, 'profile'::text]))),
    CONSTRAINT location_shares_kind_check CHECK ((kind = 'home'::text)),
    CONSTRAINT location_shares_level_check CHECK ((level = ANY (ARRAY['hidden'::text, 'area'::text, 'exact'::text])))
);


ALTER TABLE public.location_shares OWNER TO postgres;

--
-- Name: mycelium; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mycelium (
    truster_id uuid NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mycelium_target_type_check CHECK ((target_type = ANY (ARRAY['profile'::text, 'space'::text, 'post'::text])))
);


ALTER TABLE public.mycelium OWNER TO postgres;

--
-- Name: notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    recipient_id uuid NOT NULL,
    section text NOT NULL,
    space_id uuid,
    type text NOT NULL,
    title text NOT NULL,
    body text,
    link text,
    actor_id uuid,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.notifications OWNER TO postgres;

--
-- Name: posts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    author_id uuid NOT NULL,
    space_id uuid,
    visibility text DEFAULT 'public'::text NOT NULL,
    content_type text NOT NULL,
    service_area text,
    title text,
    body text NOT NULL,
    image_url text,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    service_areas text[] DEFAULT '{}'::text[] NOT NULL,
    is_public boolean DEFAULT false NOT NULL,
    to_mycelium boolean DEFAULT false NOT NULL,
    audience_space_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    author_space_id uuid,
    linked_event_id uuid,
    event_category text,
    event_mode text,
    CONSTRAINT posts_content_type_check CHECK ((content_type = ANY (ARRAY['social'::text, 'creative'::text, 'educational'::text, 'actionable'::text, 'qa'::text]))),
    CONSTRAINT posts_event_category_check CHECK (((event_category IS NULL) OR (event_category = ANY (ARRAY['social'::text, 'work_charity'::text, 'learning'::text, 'experiences'::text])))),
    CONSTRAINT posts_event_mode_check CHECK (((event_mode IS NULL) OR (event_mode = ANY (ARRAY['free'::text, 'trade'::text, 'paid'::text])))),
    CONSTRAINT posts_service_area_check CHECK ((service_area = ANY (ARRAY['marketplace'::text, 'work'::text, 'courses'::text, 'food'::text, 'art'::text, 'events'::text, 'places'::text, 'library'::text, 'people'::text]))),
    CONSTRAINT posts_service_areas_valid CHECK ((service_areas <@ ARRAY['marketplace'::text, 'work'::text, 'courses'::text, 'food'::text, 'art'::text, 'events'::text, 'places'::text, 'library'::text, 'people'::text])),
    CONSTRAINT posts_space_required CHECK (((visibility <> 'space'::text) OR (space_id IS NOT NULL))),
    CONSTRAINT posts_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'mycelium'::text, 'space'::text])))
);


ALTER TABLE public.posts OWNER TO postgres;

--
-- Name: profile_capabilities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.profile_capabilities (
    profile_id uuid NOT NULL,
    capability public.account_capability NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.profile_capabilities OWNER TO postgres;

--
-- Name: profile_categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.profile_categories (
    profile_id uuid NOT NULL,
    category_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.profile_categories OWNER TO postgres;

--
-- Name: profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text,
    full_name text,
    handle text,
    headline text,
    bio text,
    avatar_url text,
    location text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    onboarded boolean DEFAULT false NOT NULL,
    is_admin boolean DEFAULT false NOT NULL,
    email_notifications boolean DEFAULT false NOT NULL,
    notification_pref text DEFAULT 'in_app'::text NOT NULL,
    first_name text,
    last_name text,
    phone text,
    home_location text,
    home_lat double precision,
    home_lng double precision,
    home_area text,
    CONSTRAINT profiles_notification_pref_check CHECK ((notification_pref = ANY (ARRAY['off'::text, 'in_app'::text, 'both'::text])))
);


ALTER TABLE public.profiles OWNER TO postgres;

--
-- Name: recommendations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.recommendations (
    recommender_id uuid NOT NULL,
    target_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    target_type text DEFAULT 'post'::text NOT NULL,
    CONSTRAINT recommendations_target_type_check CHECK ((target_type = ANY (ARRAY['post'::text, 'profile'::text, 'space'::text])))
);


ALTER TABLE public.recommendations OWNER TO postgres;

--
-- Name: space_members; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.space_members (
    space_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    role public.space_member_role DEFAULT 'member'::public.space_member_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.space_members OWNER TO postgres;

--
-- Name: spaces; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.spaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind public.space_kind NOT NULL,
    name text NOT NULL,
    handle text,
    description text,
    avatar_url text,
    location text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    lat double precision,
    lng double precision
);


ALTER TABLE public.spaces OWNER TO postgres;

--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subscriptions (
    profile_id uuid NOT NULL,
    tier text NOT NULL,
    source text DEFAULT 'gift'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    stripe_customer_id text,
    stripe_subscription_id text,
    current_period_end timestamp with time zone,
    granted_by uuid,
    granted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscriptions_source_check CHECK ((source = ANY (ARRAY['gift'::text, 'stripe'::text]))),
    CONSTRAINT subscriptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'past_due'::text, 'canceled'::text]))),
    CONSTRAINT subscriptions_tier_check CHECK ((tier = ANY (ARRAY['community'::text, 'concierge'::text])))
);


ALTER TABLE public.subscriptions OWNER TO postgres;

--
-- Name: availability_windows availability_windows_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.availability_windows
    ADD CONSTRAINT availability_windows_pkey PRIMARY KEY (id);


--
-- Name: calendar_shares calendar_shares_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.calendar_shares
    ADD CONSTRAINT calendar_shares_pkey PRIMARY KEY (id);


--
-- Name: care_invitations care_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_invitations
    ADD CONSTRAINT care_invitations_pkey PRIMARY KEY (id);


--
-- Name: care_plan_items care_plan_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_plan_items
    ADD CONSTRAINT care_plan_items_pkey PRIMARY KEY (id);


--
-- Name: care_plans care_plans_patient_id_week_start_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_plans
    ADD CONSTRAINT care_plans_patient_id_week_start_key UNIQUE (patient_id, week_start);


--
-- Name: care_plans care_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_plans
    ADD CONSTRAINT care_plans_pkey PRIMARY KEY (id);


--
-- Name: care_posts care_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_posts
    ADD CONSTRAINT care_posts_pkey PRIMARY KEY (id);


--
-- Name: care_team_members care_team_members_patient_id_caregiver_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_team_members
    ADD CONSTRAINT care_team_members_patient_id_caregiver_id_key UNIQUE (patient_id, caregiver_id);


--
-- Name: care_team_members care_team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_team_members
    ADD CONSTRAINT care_team_members_pkey PRIMARY KEY (id);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: category_suggestions category_suggestions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.category_suggestions
    ADD CONSTRAINT category_suggestions_pkey PRIMARY KEY (id);


--
-- Name: chat_members chat_members_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_members
    ADD CONSTRAINT chat_members_pkey PRIMARY KEY (chat_id, profile_id);


--
-- Name: chat_message_reactions chat_message_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_message_reactions
    ADD CONSTRAINT chat_message_reactions_pkey PRIMARY KEY (message_id, profile_id, emoji);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: chats chats_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_pkey PRIMARY KEY (id);


--
-- Name: event_attendees event_attendees_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.event_attendees
    ADD CONSTRAINT event_attendees_pkey PRIMARY KEY (event_id, profile_id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: health_snapshots health_snapshots_patient_id_snapshot_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.health_snapshots
    ADD CONSTRAINT health_snapshots_patient_id_snapshot_date_key UNIQUE (patient_id, snapshot_date);


--
-- Name: health_snapshots health_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.health_snapshots
    ADD CONSTRAINT health_snapshots_pkey PRIMARY KEY (id);


--
-- Name: location_shares location_shares_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.location_shares
    ADD CONSTRAINT location_shares_pkey PRIMARY KEY (id);


--
-- Name: mycelium mycelium_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mycelium
    ADD CONSTRAINT mycelium_pkey PRIMARY KEY (truster_id, target_type, target_id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: posts posts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (id);


--
-- Name: profile_capabilities profile_capabilities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profile_capabilities
    ADD CONSTRAINT profile_capabilities_pkey PRIMARY KEY (profile_id, capability);


--
-- Name: profile_categories profile_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profile_categories
    ADD CONSTRAINT profile_categories_pkey PRIMARY KEY (profile_id, category_id);


--
-- Name: profiles profiles_handle_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_handle_key UNIQUE (handle);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: recommendations recommendations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recommendations
    ADD CONSTRAINT recommendations_pkey PRIMARY KEY (recommender_id, target_type, target_id);


--
-- Name: space_members space_members_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.space_members
    ADD CONSTRAINT space_members_pkey PRIMARY KEY (space_id, profile_id);


--
-- Name: spaces spaces_handle_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.spaces
    ADD CONSTRAINT spaces_handle_key UNIQUE (handle);


--
-- Name: spaces spaces_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.spaces
    ADD CONSTRAINT spaces_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (profile_id);


--
-- Name: availability_windows_profile_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX availability_windows_profile_idx ON public.availability_windows USING btree (profile_id);


--
-- Name: calendar_shares_audience_uniq; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX calendar_shares_audience_uniq ON public.calendar_shares USING btree (owner_id, audience_type, COALESCE(audience_space_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(audience_profile_id, '00000000-0000-0000-0000-000000000000'::uuid));


--
-- Name: care_plan_items_plan_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX care_plan_items_plan_idx ON public.care_plan_items USING btree (plan_id, is_daily DESC, item_date, sort);


--
-- Name: care_plans_patient_week_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX care_plans_patient_week_idx ON public.care_plans USING btree (patient_id, week_start DESC);


--
-- Name: care_posts_dims_gin; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX care_posts_dims_gin ON public.care_posts USING gin (dimensions) WHERE (kind = 'wow'::text);


--
-- Name: care_posts_koc_range_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX care_posts_koc_range_idx ON public.care_posts USING btree (patient_id, start_date, end_date) WHERE (kind = 'koc'::text);


--
-- Name: care_posts_wow_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX care_posts_wow_idx ON public.care_posts USING btree (patient_id, created_at DESC) WHERE (kind = 'wow'::text);


--
-- Name: chats_direct_uidx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX chats_direct_uidx ON public.chats USING btree (direct_key) WHERE (direct_key IS NOT NULL);


--
-- Name: chats_event_uniq; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX chats_event_uniq ON public.chats USING btree (event_id) WHERE (kind = 'event'::text);


--
-- Name: chats_patient_uidx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX chats_patient_uidx ON public.chats USING btree (patient_id) WHERE (patient_id IS NOT NULL);


--
-- Name: chats_space_uidx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX chats_space_uidx ON public.chats USING btree (space_id) WHERE (space_id IS NOT NULL);


--
-- Name: event_attendees_profile_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX event_attendees_profile_idx ON public.event_attendees USING btree (profile_id);


--
-- Name: events_creator_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX events_creator_idx ON public.events USING btree (creator_id, start_date);


--
-- Name: events_owner_profile_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX events_owner_profile_idx ON public.events USING btree (owner_profile_id, start_date) WHERE (owner_profile_id IS NOT NULL);


--
-- Name: events_owner_space_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX events_owner_space_idx ON public.events USING btree (owner_space_id, start_date) WHERE (owner_space_id IS NOT NULL);


--
-- Name: health_snapshots_patient_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX health_snapshots_patient_date_idx ON public.health_snapshots USING btree (patient_id, snapshot_date DESC, created_at DESC);


--
-- Name: location_shares_audience_uniq; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX location_shares_audience_uniq ON public.location_shares USING btree (owner_id, kind, audience_type, COALESCE(audience_space_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(audience_profile_id, '00000000-0000-0000-0000-000000000000'::uuid));


--
-- Name: mycelium_target_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX mycelium_target_idx ON public.mycelium USING btree (target_type, target_id);


--
-- Name: notifications_recipient_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX notifications_recipient_created_idx ON public.notifications USING btree (recipient_id, created_at DESC);


--
-- Name: notifications_recipient_section_unread_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX notifications_recipient_section_unread_idx ON public.notifications USING btree (recipient_id, section) WHERE (read_at IS NULL);


--
-- Name: notifications_recipient_space_unread_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX notifications_recipient_space_unread_idx ON public.notifications USING btree (recipient_id, space_id) WHERE (read_at IS NULL);


--
-- Name: posts_audience_spaces_gin; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX posts_audience_spaces_gin ON public.posts USING gin (audience_space_ids);


--
-- Name: posts_author_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX posts_author_idx ON public.posts USING btree (author_id);


--
-- Name: posts_author_space_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX posts_author_space_idx ON public.posts USING btree (author_space_id) WHERE (author_space_id IS NOT NULL);


--
-- Name: posts_event_category_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX posts_event_category_idx ON public.posts USING btree (event_category) WHERE (event_category IS NOT NULL);


--
-- Name: posts_linked_event_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX posts_linked_event_idx ON public.posts USING btree (linked_event_id) WHERE (linked_event_id IS NOT NULL);


--
-- Name: posts_service_area_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX posts_service_area_idx ON public.posts USING btree (service_area);


--
-- Name: posts_service_areas_gin; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX posts_service_areas_gin ON public.posts USING gin (service_areas);


--
-- Name: posts_space_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX posts_space_idx ON public.posts USING btree (space_id);


--
-- Name: recommendations_target_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX recommendations_target_idx ON public.recommendations USING btree (target_type, target_id);


--
-- Name: spaces a_on_space_create_chat; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER a_on_space_create_chat AFTER INSERT ON public.spaces FOR EACH ROW EXECUTE FUNCTION public.create_space_chat();


--
-- Name: care_plans care_plans_touch; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER care_plans_touch BEFORE UPDATE ON public.care_plans FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: care_posts care_posts_touch; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER care_posts_touch BEFORE UPDATE ON public.care_posts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: events events_touch; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER events_touch BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: health_snapshots health_snapshots_touch; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER health_snapshots_touch BEFORE UPDATE ON public.health_snapshots FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: notifications notification-email; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "notification-email" AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request('https://mjqnaevertyzgjlpwynr.supabase.co/functions/v1/send-notification-email', 'POST', '{"Content-type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qcW5hZXZlcnR5emdqbHB3eW5yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTExNzM5NCwiZXhwIjoyMDk2NjkzMzk0fQ.9rmFsLYywpgMXwvGMBj45wHKKbjKmGn2WP48X931vH0","x-webhook-secret":"a36ae5c10a370a51335c92203c57356ff4865c9746c5ab8e"}', '{}', '5000');


--
-- Name: care_team_members on_care_active_trg; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_care_active_trg BEFORE UPDATE ON public.care_team_members FOR EACH ROW WHEN (((new.status = 'active'::text) AND (old.status IS DISTINCT FROM 'active'::text))) EXECUTE FUNCTION public.on_care_active();


--
-- Name: care_plans on_care_plan_notify_trg; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_care_plan_notify_trg AFTER INSERT ON public.care_plans FOR EACH ROW EXECUTE FUNCTION public.on_care_plan_notify();


--
-- Name: care_team_members on_care_remove_trg; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_care_remove_trg AFTER DELETE ON public.care_team_members FOR EACH ROW EXECUTE FUNCTION public.on_care_remove();


--
-- Name: care_team_members on_care_request_notify_trg; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_care_request_notify_trg AFTER INSERT ON public.care_team_members FOR EACH ROW EXECUTE FUNCTION public.on_care_request_notify();


--
-- Name: event_attendees on_event_invite_notify_trg; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_event_invite_notify_trg AFTER INSERT ON public.event_attendees FOR EACH ROW EXECUTE FUNCTION public.on_event_invite_notify();


--
-- Name: event_attendees on_event_rsvp_notify_trg; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_event_rsvp_notify_trg AFTER UPDATE ON public.event_attendees FOR EACH ROW EXECUTE FUNCTION public.on_event_rsvp_notify();


--
-- Name: space_members on_member_sync_chat; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_member_sync_chat AFTER INSERT OR DELETE ON public.space_members FOR EACH ROW EXECUTE FUNCTION public.sync_member_to_chat();


--
-- Name: chat_messages on_message_notify_trg; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_message_notify_trg AFTER INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION public.on_message_notify();


--
-- Name: health_snapshots on_snapshot_notify_trg; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_snapshot_notify_trg AFTER INSERT ON public.health_snapshots FOR EACH ROW EXECUTE FUNCTION public.on_snapshot_notify();


--
-- Name: spaces on_space_created; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_space_created AFTER INSERT ON public.spaces FOR EACH ROW EXECUTE FUNCTION public.handle_new_space();


--
-- Name: posts posts_audience_sync_trg; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER posts_audience_sync_trg BEFORE INSERT ON public.posts FOR EACH ROW EXECUTE FUNCTION public.posts_audience_sync();


--
-- Name: profiles profiles_compose_full_name; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER profiles_compose_full_name BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.compose_full_name();


--
-- Name: profiles profiles_touch_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER profiles_touch_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: event_attendees sync_attendee_event_chat_trg; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER sync_attendee_event_chat_trg AFTER INSERT OR DELETE OR UPDATE ON public.event_attendees FOR EACH ROW EXECUTE FUNCTION public.sync_attendee_to_event_chat();


--
-- Name: availability_windows availability_windows_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.availability_windows
    ADD CONSTRAINT availability_windows_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: calendar_shares calendar_shares_audience_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.calendar_shares
    ADD CONSTRAINT calendar_shares_audience_profile_id_fkey FOREIGN KEY (audience_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: calendar_shares calendar_shares_audience_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.calendar_shares
    ADD CONSTRAINT calendar_shares_audience_space_id_fkey FOREIGN KEY (audience_space_id) REFERENCES public.spaces(id) ON DELETE CASCADE;


--
-- Name: calendar_shares calendar_shares_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.calendar_shares
    ADD CONSTRAINT calendar_shares_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: care_invitations care_invitations_accepted_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_invitations
    ADD CONSTRAINT care_invitations_accepted_profile_id_fkey FOREIGN KEY (accepted_profile_id) REFERENCES public.profiles(id);


--
-- Name: care_invitations care_invitations_inviter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_invitations
    ADD CONSTRAINT care_invitations_inviter_id_fkey FOREIGN KEY (inviter_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: care_plan_items care_plan_items_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_plan_items
    ADD CONSTRAINT care_plan_items_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.care_plans(id) ON DELETE CASCADE;


--
-- Name: care_plan_items care_plan_items_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_plan_items
    ADD CONSTRAINT care_plan_items_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: care_plans care_plans_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_plans
    ADD CONSTRAINT care_plans_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id);


--
-- Name: care_plans care_plans_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_plans
    ADD CONSTRAINT care_plans_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: care_posts care_posts_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_posts
    ADD CONSTRAINT care_posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id);


--
-- Name: care_posts care_posts_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_posts
    ADD CONSTRAINT care_posts_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: care_team_members care_team_members_caregiver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_team_members
    ADD CONSTRAINT care_team_members_caregiver_id_fkey FOREIGN KEY (caregiver_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: care_team_members care_team_members_initiated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_team_members
    ADD CONSTRAINT care_team_members_initiated_by_fkey FOREIGN KEY (initiated_by) REFERENCES public.profiles(id);


--
-- Name: care_team_members care_team_members_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_team_members
    ADD CONSTRAINT care_team_members_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: category_suggestions category_suggestions_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.category_suggestions
    ADD CONSTRAINT category_suggestions_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);


--
-- Name: category_suggestions category_suggestions_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.category_suggestions
    ADD CONSTRAINT category_suggestions_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.profiles(id);


--
-- Name: category_suggestions category_suggestions_proposer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.category_suggestions
    ADD CONSTRAINT category_suggestions_proposer_id_fkey FOREIGN KEY (proposer_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: chat_members chat_members_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_members
    ADD CONSTRAINT chat_members_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE;


--
-- Name: chat_members chat_members_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_members
    ADD CONSTRAINT chat_members_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: chat_message_reactions chat_message_reactions_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_message_reactions
    ADD CONSTRAINT chat_message_reactions_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE;


--
-- Name: chat_message_reactions chat_message_reactions_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_message_reactions
    ADD CONSTRAINT chat_message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.chat_messages(id) ON DELETE CASCADE;


--
-- Name: chat_message_reactions chat_message_reactions_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_message_reactions
    ADD CONSTRAINT chat_message_reactions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_reply_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_reply_to_fkey FOREIGN KEY (reply_to) REFERENCES public.chat_messages(id) ON DELETE SET NULL;


--
-- Name: chat_messages chat_messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: chats chats_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: chats chats_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: chats chats_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE CASCADE;


--
-- Name: event_attendees event_attendees_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.event_attendees
    ADD CONSTRAINT event_attendees_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: event_attendees event_attendees_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.event_attendees
    ADD CONSTRAINT event_attendees_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: event_attendees event_attendees_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.event_attendees
    ADD CONSTRAINT event_attendees_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: events events_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: events events_owner_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_owner_profile_id_fkey FOREIGN KEY (owner_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: events events_owner_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_owner_space_id_fkey FOREIGN KEY (owner_space_id) REFERENCES public.spaces(id) ON DELETE CASCADE;


--
-- Name: health_snapshots health_snapshots_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.health_snapshots
    ADD CONSTRAINT health_snapshots_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id);


--
-- Name: health_snapshots health_snapshots_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.health_snapshots
    ADD CONSTRAINT health_snapshots_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: location_shares location_shares_audience_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.location_shares
    ADD CONSTRAINT location_shares_audience_profile_id_fkey FOREIGN KEY (audience_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: location_shares location_shares_audience_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.location_shares
    ADD CONSTRAINT location_shares_audience_space_id_fkey FOREIGN KEY (audience_space_id) REFERENCES public.spaces(id) ON DELETE CASCADE;


--
-- Name: location_shares location_shares_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.location_shares
    ADD CONSTRAINT location_shares_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: mycelium mycelium_truster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mycelium
    ADD CONSTRAINT mycelium_truster_id_fkey FOREIGN KEY (truster_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE CASCADE;


--
-- Name: posts posts_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: posts posts_author_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_author_space_id_fkey FOREIGN KEY (author_space_id) REFERENCES public.spaces(id) ON DELETE SET NULL;


--
-- Name: posts posts_linked_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_linked_event_id_fkey FOREIGN KEY (linked_event_id) REFERENCES public.events(id) ON DELETE SET NULL;


--
-- Name: posts posts_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE CASCADE;


--
-- Name: profile_capabilities profile_capabilities_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profile_capabilities
    ADD CONSTRAINT profile_capabilities_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: profile_categories profile_categories_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profile_categories
    ADD CONSTRAINT profile_categories_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE;


--
-- Name: profile_categories profile_categories_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profile_categories
    ADD CONSTRAINT profile_categories_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: recommendations recommendations_recommender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recommendations
    ADD CONSTRAINT recommendations_recommender_id_fkey FOREIGN KEY (recommender_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: space_members space_members_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.space_members
    ADD CONSTRAINT space_members_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: space_members space_members_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.space_members
    ADD CONSTRAINT space_members_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE CASCADE;


--
-- Name: spaces spaces_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.spaces
    ADD CONSTRAINT spaces_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: subscriptions subscriptions_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.profiles(id);


--
-- Name: subscriptions subscriptions_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: category_suggestions Admins read all suggestions; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins read all suggestions" ON public.category_suggestions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND p.is_admin))));


--
-- Name: spaces Admins update their space; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins update their space" ON public.spaces FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.space_members m
  WHERE ((m.space_id = spaces.id) AND (m.profile_id = auth.uid()) AND (m.role = ANY (ARRAY['admin'::public.space_member_role, 'super_admin'::public.space_member_role])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.space_members m
  WHERE ((m.space_id = spaces.id) AND (m.profile_id = auth.uid()) AND (m.role = ANY (ARRAY['admin'::public.space_member_role, 'super_admin'::public.space_member_role]))))));


--
-- Name: spaces Authenticated create spaces; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Authenticated create spaces" ON public.spaces FOR INSERT TO authenticated WITH CHECK ((auth.uid() = created_by));


--
-- Name: profile_capabilities Capabilities readable by authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Capabilities readable by authenticated" ON public.profile_capabilities FOR SELECT TO authenticated USING (true);


--
-- Name: categories Categories readable by authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Categories readable by authenticated" ON public.categories FOR SELECT TO authenticated USING (true);


--
-- Name: space_members Memberships readable by authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Memberships readable by authenticated" ON public.space_members FOR SELECT TO authenticated USING (true);


--
-- Name: profile_categories Profile categories readable by authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Profile categories readable by authenticated" ON public.profile_categories FOR SELECT TO authenticated USING (true);


--
-- Name: profiles Profiles readable by authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Profiles readable by authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);


--
-- Name: category_suggestions Proposer inserts own suggestion; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Proposer inserts own suggestion" ON public.category_suggestions FOR INSERT TO authenticated WITH CHECK ((auth.uid() = proposer_id));


--
-- Name: category_suggestions Proposer reads own suggestions; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Proposer reads own suggestions" ON public.category_suggestions FOR SELECT TO authenticated USING ((auth.uid() = proposer_id));


--
-- Name: spaces Spaces readable by authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Spaces readable by authenticated" ON public.spaces FOR SELECT TO authenticated USING (true);


--
-- Name: profile_capabilities Users add own capabilities; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users add own capabilities" ON public.profile_capabilities FOR INSERT TO authenticated WITH CHECK ((auth.uid() = profile_id));


--
-- Name: profile_categories Users add own categories; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users add own categories" ON public.profile_categories FOR INSERT TO authenticated WITH CHECK ((auth.uid() = profile_id));


--
-- Name: space_members Users join a space as member; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users join a space as member" ON public.space_members FOR INSERT TO authenticated WITH CHECK (((auth.uid() = profile_id) AND (role = 'member'::public.space_member_role)));


--
-- Name: space_members Users leave a space; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users leave a space" ON public.space_members FOR DELETE TO authenticated USING ((auth.uid() = profile_id));


--
-- Name: profile_capabilities Users remove own capabilities; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users remove own capabilities" ON public.profile_capabilities FOR DELETE TO authenticated USING ((auth.uid() = profile_id));


--
-- Name: profile_categories Users remove own categories; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users remove own categories" ON public.profile_categories FOR DELETE TO authenticated USING ((auth.uid() = profile_id));


--
-- Name: profiles Users update own profile; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));


--
-- Name: availability_windows availability owner all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "availability owner all" ON public.availability_windows TO authenticated USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));


--
-- Name: availability_windows; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.availability_windows ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_shares; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.calendar_shares ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_shares calendar_shares owner all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "calendar_shares owner all" ON public.calendar_shares TO authenticated USING ((owner_id = auth.uid())) WITH CHECK ((owner_id = auth.uid()));


--
-- Name: care_team_members care approve; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "care approve" ON public.care_team_members FOR UPDATE TO authenticated USING (((status = 'pending'::text) AND (auth.uid() <> initiated_by) AND ((auth.uid() = patient_id) OR (auth.uid() = caregiver_id)))) WITH CHECK ((status = 'active'::text));


--
-- Name: care_team_members care initiate; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "care initiate" ON public.care_team_members FOR INSERT TO authenticated WITH CHECK (((auth.uid() = initiated_by) AND ((auth.uid() = patient_id) OR (auth.uid() = caregiver_id)) AND (status = 'pending'::text)));


--
-- Name: care_team_members care read own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "care read own" ON public.care_team_members FOR SELECT TO authenticated USING (((auth.uid() = patient_id) OR (auth.uid() = caregiver_id)));


--
-- Name: care_team_members care remove; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "care remove" ON public.care_team_members FOR DELETE TO authenticated USING (((auth.uid() = patient_id) OR (auth.uid() = caregiver_id)));


--
-- Name: care_invitations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.care_invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: care_plan_items; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.care_plan_items ENABLE ROW LEVEL SECURITY;

--
-- Name: care_plans; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.care_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: care_posts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.care_posts ENABLE ROW LEVEL SECURITY;

--
-- Name: care_posts care_posts delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "care_posts delete" ON public.care_posts FOR DELETE TO authenticated USING (public.is_active_caregiver(patient_id, auth.uid()));


--
-- Name: care_posts care_posts insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "care_posts insert" ON public.care_posts FOR INSERT TO authenticated WITH CHECK (((author_id = auth.uid()) AND public.is_active_caregiver(patient_id, auth.uid())));


--
-- Name: care_posts care_posts read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "care_posts read" ON public.care_posts FOR SELECT TO authenticated USING (public.is_on_care_team(patient_id, auth.uid()));


--
-- Name: care_posts care_posts update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "care_posts update" ON public.care_posts FOR UPDATE TO authenticated USING (public.is_active_caregiver(patient_id, auth.uid())) WITH CHECK (((author_id = auth.uid()) AND public.is_active_caregiver(patient_id, auth.uid())));


--
-- Name: care_team_members; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.care_team_members ENABLE ROW LEVEL SECURITY;

--
-- Name: categories; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

--
-- Name: category_suggestions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.category_suggestions ENABLE ROW LEVEL SECURITY;

--
-- Name: chats chat read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "chat read" ON public.chats FOR SELECT TO authenticated USING (public.is_chat_member(id, auth.uid()));


--
-- Name: chat_members; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.chat_members ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_members chat_members read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "chat_members read" ON public.chat_members FOR SELECT TO authenticated USING (public.is_chat_member(chat_id, auth.uid()));


--
-- Name: chat_message_reactions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.chat_message_reactions ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_messages; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: chats; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;

--
-- Name: event_attendees; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.event_attendees ENABLE ROW LEVEL SECURITY;

--
-- Name: event_attendees event_attendees delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "event_attendees delete" ON public.event_attendees FOR DELETE TO authenticated USING (((profile_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.events e
  WHERE ((e.id = event_attendees.event_id) AND (e.creator_id = auth.uid()))))));


--
-- Name: event_attendees event_attendees insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "event_attendees insert" ON public.event_attendees FOR INSERT TO authenticated WITH CHECK (((invited_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.events e
  WHERE ((e.id = event_attendees.event_id) AND (e.creator_id = auth.uid()))))));


--
-- Name: event_attendees event_attendees read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "event_attendees read" ON public.event_attendees FOR SELECT TO authenticated USING (public.can_read_event(event_id, auth.uid()));


--
-- Name: event_attendees event_attendees read via post; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "event_attendees read via post" ON public.event_attendees FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.posts p
  WHERE (p.linked_event_id = event_attendees.event_id))));


--
-- Name: event_attendees event_attendees self rsvp; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "event_attendees self rsvp" ON public.event_attendees FOR INSERT TO authenticated WITH CHECK (((profile_id = auth.uid()) AND (invited_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.posts p
  WHERE (p.linked_event_id = event_attendees.event_id)))));


--
-- Name: event_attendees event_attendees update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "event_attendees update" ON public.event_attendees FOR UPDATE TO authenticated USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));


--
-- Name: events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

--
-- Name: events events delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "events delete" ON public.events FOR DELETE TO authenticated USING ((creator_id = auth.uid()));


--
-- Name: events events insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "events insert" ON public.events FOR INSERT TO authenticated WITH CHECK (((creator_id = auth.uid()) AND ((owner_profile_id = auth.uid()) OR ((owner_space_id IS NOT NULL) AND public.is_space_member(owner_space_id, auth.uid())))));


--
-- Name: events events read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "events read" ON public.events FOR SELECT TO authenticated USING (((creator_id = auth.uid()) OR (owner_profile_id = auth.uid()) OR ((owner_space_id IS NOT NULL) AND public.is_space_member(owner_space_id, auth.uid())) OR public.is_event_attendee(id, auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.posts p
  WHERE (p.linked_event_id = p.id)))));


--
-- Name: events events update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "events update" ON public.events FOR UPDATE TO authenticated USING ((creator_id = auth.uid())) WITH CHECK ((creator_id = auth.uid()));


--
-- Name: health_snapshots; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.health_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: care_invitations inv cancel own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "inv cancel own" ON public.care_invitations FOR DELETE TO authenticated USING ((auth.uid() = inviter_id));


--
-- Name: care_invitations inv create own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "inv create own" ON public.care_invitations FOR INSERT TO authenticated WITH CHECK ((auth.uid() = inviter_id));


--
-- Name: care_invitations inv read own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "inv read own" ON public.care_invitations FOR SELECT TO authenticated USING ((auth.uid() = inviter_id));


--
-- Name: care_plan_items koc item read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "koc item read" ON public.care_plan_items FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.care_plans p
  WHERE ((p.id = care_plan_items.plan_id) AND public.is_on_care_team(p.patient_id, auth.uid())))));


--
-- Name: care_plan_items koc item write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "koc item write" ON public.care_plan_items TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.care_plans p
  WHERE ((p.id = care_plan_items.plan_id) AND public.is_active_caregiver(p.patient_id, auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.care_plans p
  WHERE ((p.id = care_plan_items.plan_id) AND public.is_active_caregiver(p.patient_id, auth.uid())))));


--
-- Name: care_plans koc plan delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "koc plan delete" ON public.care_plans FOR DELETE TO authenticated USING (public.is_active_caregiver(patient_id, auth.uid()));


--
-- Name: care_plans koc plan insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "koc plan insert" ON public.care_plans FOR INSERT TO authenticated WITH CHECK (((author_id = auth.uid()) AND public.is_active_caregiver(patient_id, auth.uid())));


--
-- Name: care_plans koc plan read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "koc plan read" ON public.care_plans FOR SELECT TO authenticated USING (public.is_on_care_team(patient_id, auth.uid()));


--
-- Name: care_plans koc plan update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "koc plan update" ON public.care_plans FOR UPDATE TO authenticated USING (public.is_active_caregiver(patient_id, auth.uid())) WITH CHECK (((author_id = auth.uid()) AND public.is_active_caregiver(patient_id, auth.uid())));


--
-- Name: location_shares; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.location_shares ENABLE ROW LEVEL SECURITY;

--
-- Name: location_shares location_shares owner all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "location_shares owner all" ON public.location_shares TO authenticated USING ((owner_id = auth.uid())) WITH CHECK ((owner_id = auth.uid()));


--
-- Name: chat_messages messages read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "messages read" ON public.chat_messages FOR SELECT TO authenticated USING (public.is_chat_member(chat_id, auth.uid()));


--
-- Name: chat_messages messages send; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "messages send" ON public.chat_messages FOR INSERT TO authenticated WITH CHECK (((sender_id = auth.uid()) AND public.is_chat_member(chat_id, auth.uid())));


--
-- Name: mycelium; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.mycelium ENABLE ROW LEVEL SECURITY;

--
-- Name: mycelium mycelium: add own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "mycelium: add own" ON public.mycelium FOR INSERT TO authenticated WITH CHECK ((truster_id = auth.uid()));


--
-- Name: mycelium mycelium: drop own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "mycelium: drop own" ON public.mycelium FOR DELETE TO authenticated USING ((truster_id = auth.uid()));


--
-- Name: mycelium mycelium: read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "mycelium: read" ON public.mycelium FOR SELECT TO authenticated USING (true);


--
-- Name: notifications notif delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "notif delete" ON public.notifications FOR DELETE TO authenticated USING ((recipient_id = auth.uid()));


--
-- Name: notifications notif read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "notif read" ON public.notifications FOR SELECT TO authenticated USING ((recipient_id = auth.uid()));


--
-- Name: notifications notif update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "notif update" ON public.notifications FOR UPDATE TO authenticated USING ((recipient_id = auth.uid())) WITH CHECK ((recipient_id = auth.uid()));


--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: posts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

--
-- Name: posts posts: delete own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "posts: delete own" ON public.posts FOR DELETE TO authenticated USING ((author_id = auth.uid()));


--
-- Name: posts posts: insert own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "posts: insert own" ON public.posts FOR INSERT TO authenticated WITH CHECK (((author_id = auth.uid()) AND (is_public OR to_mycelium OR (cardinality(audience_space_ids) > 0)) AND (NOT (EXISTS ( SELECT 1
   FROM unnest(posts.audience_space_ids) a(sid)
  WHERE (NOT (EXISTS ( SELECT 1
           FROM public.space_members m
          WHERE ((m.space_id = a.sid) AND (m.profile_id = auth.uid())))))))) AND ((author_space_id IS NULL) OR public.is_space_admin(author_space_id, auth.uid()))));


--
-- Name: posts posts: read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "posts: read" ON public.posts FOR SELECT TO authenticated USING ((is_public OR (author_id = auth.uid()) OR (to_mycelium AND (EXISTS ( SELECT 1
   FROM public.mycelium my
  WHERE ((my.truster_id = auth.uid()) AND (((my.target_type = 'profile'::text) AND (my.target_id = posts.author_id)) OR ((my.target_type = 'space'::text) AND (my.target_id = posts.author_space_id))))))) OR (EXISTS ( SELECT 1
   FROM public.space_members m
  WHERE ((m.profile_id = auth.uid()) AND (m.space_id = ANY (posts.audience_space_ids)))))));


--
-- Name: posts posts: update own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "posts: update own" ON public.posts FOR UPDATE TO authenticated USING ((author_id = auth.uid())) WITH CHECK ((author_id = auth.uid()));


--
-- Name: profile_capabilities; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.profile_capabilities ENABLE ROW LEVEL SECURITY;

--
-- Name: profile_categories; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.profile_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_message_reactions reactions add; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "reactions add" ON public.chat_message_reactions FOR INSERT TO authenticated WITH CHECK (((profile_id = auth.uid()) AND public.is_chat_member(chat_id, auth.uid())));


--
-- Name: chat_message_reactions reactions read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "reactions read" ON public.chat_message_reactions FOR SELECT TO authenticated USING (public.is_chat_member(chat_id, auth.uid()));


--
-- Name: chat_message_reactions reactions remove; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "reactions remove" ON public.chat_message_reactions FOR DELETE TO authenticated USING (((profile_id = auth.uid()) AND public.is_chat_member(chat_id, auth.uid())));


--
-- Name: recommendations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;

--
-- Name: recommendations recs: add own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "recs: add own" ON public.recommendations FOR INSERT TO authenticated WITH CHECK ((recommender_id = auth.uid()));


--
-- Name: recommendations recs: drop own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "recs: drop own" ON public.recommendations FOR DELETE TO authenticated USING ((recommender_id = auth.uid()));


--
-- Name: recommendations recs: read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "recs: read" ON public.recommendations FOR SELECT TO authenticated USING (true);


--
-- Name: space_members; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.space_members ENABLE ROW LEVEL SECURITY;

--
-- Name: spaces; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.spaces ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions sub admin read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "sub admin read" ON public.subscriptions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND p.is_admin))));


--
-- Name: subscriptions sub read own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "sub read own" ON public.subscriptions FOR SELECT TO authenticated USING ((auth.uid() = profile_id));


--
-- Name: subscriptions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: health_snapshots wow delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "wow delete" ON public.health_snapshots FOR DELETE TO authenticated USING (public.is_active_caregiver(patient_id, auth.uid()));


--
-- Name: health_snapshots wow insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "wow insert" ON public.health_snapshots FOR INSERT TO authenticated WITH CHECK (((author_id = auth.uid()) AND public.is_active_caregiver(patient_id, auth.uid())));


--
-- Name: health_snapshots wow read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "wow read" ON public.health_snapshots FOR SELECT TO authenticated USING (public.is_on_care_team(patient_id, auth.uid()));


--
-- Name: health_snapshots wow update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "wow update" ON public.health_snapshots FOR UPDATE TO authenticated USING (public.is_active_caregiver(patient_id, auth.uid())) WITH CHECK (((author_id = auth.uid()) AND public.is_active_caregiver(patient_id, auth.uid())));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION admin_list_supporters(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.admin_list_supporters() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_list_supporters() TO authenticated;
GRANT ALL ON FUNCTION public.admin_list_supporters() TO service_role;


--
-- Name: FUNCTION approve_category_suggestion(p_suggestion_id uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.approve_category_suggestion(p_suggestion_id uuid) TO anon;
GRANT ALL ON FUNCTION public.approve_category_suggestion(p_suggestion_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.approve_category_suggestion(p_suggestion_id uuid) TO service_role;


--
-- Name: FUNCTION availability_of(p_profiles uuid[]); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.availability_of(p_profiles uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.availability_of(p_profiles uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.availability_of(p_profiles uuid[]) TO service_role;


--
-- Name: FUNCTION calendar_level(p_owner uuid, p_viewer uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.calendar_level(p_owner uuid, p_viewer uuid) TO anon;
GRANT ALL ON FUNCTION public.calendar_level(p_owner uuid, p_viewer uuid) TO authenticated;
GRANT ALL ON FUNCTION public.calendar_level(p_owner uuid, p_viewer uuid) TO service_role;


--
-- Name: FUNCTION can_read_event(p_event uuid, p_uid uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.can_read_event(p_event uuid, p_uid uuid) TO anon;
GRANT ALL ON FUNCTION public.can_read_event(p_event uuid, p_uid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_read_event(p_event uuid, p_uid uuid) TO service_role;


--
-- Name: FUNCTION care_member_display(p_ids uuid[]); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.care_member_display(p_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.care_member_display(p_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.care_member_display(p_ids uuid[]) TO service_role;


--
-- Name: FUNCTION claim_care_invitations(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.claim_care_invitations() TO anon;
GRANT ALL ON FUNCTION public.claim_care_invitations() TO authenticated;
GRANT ALL ON FUNCTION public.claim_care_invitations() TO service_role;


--
-- Name: FUNCTION compose_full_name(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.compose_full_name() TO anon;
GRANT ALL ON FUNCTION public.compose_full_name() TO authenticated;
GRANT ALL ON FUNCTION public.compose_full_name() TO service_role;


--
-- Name: FUNCTION create_space_chat(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.create_space_chat() TO anon;
GRANT ALL ON FUNCTION public.create_space_chat() TO authenticated;
GRANT ALL ON FUNCTION public.create_space_chat() TO service_role;


--
-- Name: FUNCTION ensure_care_chat(p_patient uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.ensure_care_chat(p_patient uuid) TO anon;
GRANT ALL ON FUNCTION public.ensure_care_chat(p_patient uuid) TO authenticated;
GRANT ALL ON FUNCTION public.ensure_care_chat(p_patient uuid) TO service_role;


--
-- Name: FUNCTION ensure_direct_chat(p_other uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.ensure_direct_chat(p_other uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ensure_direct_chat(p_other uuid) TO authenticated;
GRANT ALL ON FUNCTION public.ensure_direct_chat(p_other uuid) TO service_role;


--
-- Name: FUNCTION ensure_event_chat(p_event uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.ensure_event_chat(p_event uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ensure_event_chat(p_event uuid) TO authenticated;
GRANT ALL ON FUNCTION public.ensure_event_chat(p_event uuid) TO service_role;


--
-- Name: FUNCTION ensure_help_chat(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.ensure_help_chat() TO anon;
GRANT ALL ON FUNCTION public.ensure_help_chat() TO authenticated;
GRANT ALL ON FUNCTION public.ensure_help_chat() TO service_role;


--
-- Name: FUNCTION find_member_by_email(p_email text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.find_member_by_email(p_email text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.find_member_by_email(p_email text) TO authenticated;
GRANT ALL ON FUNCTION public.find_member_by_email(p_email text) TO service_role;


--
-- Name: FUNCTION free_busy(p_profiles uuid[], p_from date, p_to date); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.free_busy(p_profiles uuid[], p_from date, p_to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.free_busy(p_profiles uuid[], p_from date, p_to date) TO authenticated;
GRANT ALL ON FUNCTION public.free_busy(p_profiles uuid[], p_from date, p_to date) TO service_role;


--
-- Name: FUNCTION gift_subscription(p_email text, p_tier text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.gift_subscription(p_email text, p_tier text) TO anon;
GRANT ALL ON FUNCTION public.gift_subscription(p_email text, p_tier text) TO authenticated;
GRANT ALL ON FUNCTION public.gift_subscription(p_email text, p_tier text) TO service_role;


--
-- Name: FUNCTION handle_new_space(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.handle_new_space() TO anon;
GRANT ALL ON FUNCTION public.handle_new_space() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_space() TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION is_active_caregiver(p_patient uuid, p_uid uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.is_active_caregiver(p_patient uuid, p_uid uuid) TO anon;
GRANT ALL ON FUNCTION public.is_active_caregiver(p_patient uuid, p_uid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_active_caregiver(p_patient uuid, p_uid uuid) TO service_role;


--
-- Name: FUNCTION is_chat_member(p_chat uuid, p_uid uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.is_chat_member(p_chat uuid, p_uid uuid) TO anon;
GRANT ALL ON FUNCTION public.is_chat_member(p_chat uuid, p_uid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_chat_member(p_chat uuid, p_uid uuid) TO service_role;


--
-- Name: FUNCTION is_event_attendee(p_event uuid, p_uid uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.is_event_attendee(p_event uuid, p_uid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_event_attendee(p_event uuid, p_uid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_event_attendee(p_event uuid, p_uid uuid) TO service_role;


--
-- Name: FUNCTION is_on_care_team(p_patient uuid, p_uid uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.is_on_care_team(p_patient uuid, p_uid uuid) TO anon;
GRANT ALL ON FUNCTION public.is_on_care_team(p_patient uuid, p_uid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_on_care_team(p_patient uuid, p_uid uuid) TO service_role;


--
-- Name: FUNCTION is_space_admin(p_space uuid, p_uid uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.is_space_admin(p_space uuid, p_uid uuid) TO anon;
GRANT ALL ON FUNCTION public.is_space_admin(p_space uuid, p_uid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_space_admin(p_space uuid, p_uid uuid) TO service_role;


--
-- Name: FUNCTION is_space_member(p_space uuid, p_uid uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.is_space_member(p_space uuid, p_uid uuid) TO anon;
GRANT ALL ON FUNCTION public.is_space_member(p_space uuid, p_uid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_space_member(p_space uuid, p_uid uuid) TO service_role;


--
-- Name: FUNCTION location_level(p_owner uuid, p_viewer uuid, p_kind text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.location_level(p_owner uuid, p_viewer uuid, p_kind text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.location_level(p_owner uuid, p_viewer uuid, p_kind text) TO authenticated;
GRANT ALL ON FUNCTION public.location_level(p_owner uuid, p_viewer uuid, p_kind text) TO service_role;


--
-- Name: FUNCTION mappable_members(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.mappable_members() FROM PUBLIC;
GRANT ALL ON FUNCTION public.mappable_members() TO authenticated;
GRANT ALL ON FUNCTION public.mappable_members() TO service_role;


--
-- Name: FUNCTION my_home(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.my_home() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_home() TO authenticated;
GRANT ALL ON FUNCTION public.my_home() TO service_role;


--
-- Name: FUNCTION my_phone(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.my_phone() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_phone() TO authenticated;
GRANT ALL ON FUNCTION public.my_phone() TO service_role;


--
-- Name: FUNCTION notify(p_recipient uuid, p_section text, p_space uuid, p_type text, p_title text, p_body text, p_link text, p_actor uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.notify(p_recipient uuid, p_section text, p_space uuid, p_type text, p_title text, p_body text, p_link text, p_actor uuid) TO anon;
GRANT ALL ON FUNCTION public.notify(p_recipient uuid, p_section text, p_space uuid, p_type text, p_title text, p_body text, p_link text, p_actor uuid) TO authenticated;
GRANT ALL ON FUNCTION public.notify(p_recipient uuid, p_section text, p_space uuid, p_type text, p_title text, p_body text, p_link text, p_actor uuid) TO service_role;


--
-- Name: FUNCTION on_call_roster(p_patient uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.on_call_roster(p_patient uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.on_call_roster(p_patient uuid) TO authenticated;
GRANT ALL ON FUNCTION public.on_call_roster(p_patient uuid) TO service_role;


--
-- Name: FUNCTION on_care_active(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.on_care_active() TO anon;
GRANT ALL ON FUNCTION public.on_care_active() TO authenticated;
GRANT ALL ON FUNCTION public.on_care_active() TO service_role;


--
-- Name: FUNCTION on_care_plan_notify(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.on_care_plan_notify() TO anon;
GRANT ALL ON FUNCTION public.on_care_plan_notify() TO authenticated;
GRANT ALL ON FUNCTION public.on_care_plan_notify() TO service_role;


--
-- Name: FUNCTION on_care_remove(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.on_care_remove() TO anon;
GRANT ALL ON FUNCTION public.on_care_remove() TO authenticated;
GRANT ALL ON FUNCTION public.on_care_remove() TO service_role;


--
-- Name: FUNCTION on_care_request_notify(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.on_care_request_notify() TO anon;
GRANT ALL ON FUNCTION public.on_care_request_notify() TO authenticated;
GRANT ALL ON FUNCTION public.on_care_request_notify() TO service_role;


--
-- Name: FUNCTION on_event_invite_notify(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.on_event_invite_notify() TO anon;
GRANT ALL ON FUNCTION public.on_event_invite_notify() TO authenticated;
GRANT ALL ON FUNCTION public.on_event_invite_notify() TO service_role;


--
-- Name: FUNCTION on_event_rsvp_notify(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.on_event_rsvp_notify() TO anon;
GRANT ALL ON FUNCTION public.on_event_rsvp_notify() TO authenticated;
GRANT ALL ON FUNCTION public.on_event_rsvp_notify() TO service_role;


--
-- Name: FUNCTION on_message_notify(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.on_message_notify() TO anon;
GRANT ALL ON FUNCTION public.on_message_notify() TO authenticated;
GRANT ALL ON FUNCTION public.on_message_notify() TO service_role;


--
-- Name: FUNCTION on_snapshot_notify(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.on_snapshot_notify() TO anon;
GRANT ALL ON FUNCTION public.on_snapshot_notify() TO authenticated;
GRANT ALL ON FUNCTION public.on_snapshot_notify() TO service_role;


--
-- Name: FUNCTION posts_audience_sync(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.posts_audience_sync() TO anon;
GRANT ALL ON FUNCTION public.posts_audience_sync() TO authenticated;
GRANT ALL ON FUNCTION public.posts_audience_sync() TO service_role;


--
-- Name: FUNCTION reject_category_suggestion(p_suggestion_id uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.reject_category_suggestion(p_suggestion_id uuid) TO anon;
GRANT ALL ON FUNCTION public.reject_category_suggestion(p_suggestion_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.reject_category_suggestion(p_suggestion_id uuid) TO service_role;


--
-- Name: FUNCTION revoke_subscription(p_email text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.revoke_subscription(p_email text) TO anon;
GRANT ALL ON FUNCTION public.revoke_subscription(p_email text) TO authenticated;
GRANT ALL ON FUNCTION public.revoke_subscription(p_email text) TO service_role;


--
-- Name: FUNCTION rls_auto_enable(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.rls_auto_enable() TO anon;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO authenticated;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO service_role;


--
-- Name: FUNCTION sync_attendee_to_event_chat(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.sync_attendee_to_event_chat() TO anon;
GRANT ALL ON FUNCTION public.sync_attendee_to_event_chat() TO authenticated;
GRANT ALL ON FUNCTION public.sync_attendee_to_event_chat() TO service_role;


--
-- Name: FUNCTION sync_member_to_chat(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.sync_member_to_chat() TO anon;
GRANT ALL ON FUNCTION public.sync_member_to_chat() TO authenticated;
GRANT ALL ON FUNCTION public.sync_member_to_chat() TO service_role;


--
-- Name: FUNCTION touch_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.touch_updated_at() TO anon;
GRANT ALL ON FUNCTION public.touch_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.touch_updated_at() TO service_role;


--
-- Name: TABLE availability_windows; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.availability_windows TO anon;
GRANT ALL ON TABLE public.availability_windows TO authenticated;
GRANT ALL ON TABLE public.availability_windows TO service_role;


--
-- Name: TABLE calendar_shares; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.calendar_shares TO anon;
GRANT ALL ON TABLE public.calendar_shares TO authenticated;
GRANT ALL ON TABLE public.calendar_shares TO service_role;


--
-- Name: TABLE care_invitations; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.care_invitations TO anon;
GRANT ALL ON TABLE public.care_invitations TO authenticated;
GRANT ALL ON TABLE public.care_invitations TO service_role;


--
-- Name: TABLE care_plan_items; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.care_plan_items TO anon;
GRANT ALL ON TABLE public.care_plan_items TO authenticated;
GRANT ALL ON TABLE public.care_plan_items TO service_role;


--
-- Name: TABLE care_plans; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.care_plans TO anon;
GRANT ALL ON TABLE public.care_plans TO authenticated;
GRANT ALL ON TABLE public.care_plans TO service_role;


--
-- Name: TABLE care_posts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.care_posts TO anon;
GRANT ALL ON TABLE public.care_posts TO authenticated;
GRANT ALL ON TABLE public.care_posts TO service_role;


--
-- Name: TABLE care_team_members; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.care_team_members TO anon;
GRANT ALL ON TABLE public.care_team_members TO authenticated;
GRANT ALL ON TABLE public.care_team_members TO service_role;


--
-- Name: TABLE categories; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.categories TO anon;
GRANT ALL ON TABLE public.categories TO authenticated;
GRANT ALL ON TABLE public.categories TO service_role;


--
-- Name: TABLE category_suggestions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.category_suggestions TO anon;
GRANT ALL ON TABLE public.category_suggestions TO authenticated;
GRANT ALL ON TABLE public.category_suggestions TO service_role;


--
-- Name: TABLE chat_members; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.chat_members TO anon;
GRANT ALL ON TABLE public.chat_members TO authenticated;
GRANT ALL ON TABLE public.chat_members TO service_role;


--
-- Name: TABLE chat_message_reactions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.chat_message_reactions TO anon;
GRANT ALL ON TABLE public.chat_message_reactions TO authenticated;
GRANT ALL ON TABLE public.chat_message_reactions TO service_role;


--
-- Name: TABLE chat_messages; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.chat_messages TO anon;
GRANT ALL ON TABLE public.chat_messages TO authenticated;
GRANT ALL ON TABLE public.chat_messages TO service_role;


--
-- Name: TABLE chats; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.chats TO anon;
GRANT ALL ON TABLE public.chats TO authenticated;
GRANT ALL ON TABLE public.chats TO service_role;


--
-- Name: TABLE event_attendees; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.event_attendees TO anon;
GRANT ALL ON TABLE public.event_attendees TO authenticated;
GRANT ALL ON TABLE public.event_attendees TO service_role;


--
-- Name: TABLE events; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.events TO anon;
GRANT ALL ON TABLE public.events TO authenticated;
GRANT ALL ON TABLE public.events TO service_role;


--
-- Name: TABLE health_snapshots; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.health_snapshots TO anon;
GRANT ALL ON TABLE public.health_snapshots TO authenticated;
GRANT ALL ON TABLE public.health_snapshots TO service_role;


--
-- Name: TABLE location_shares; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.location_shares TO anon;
GRANT ALL ON TABLE public.location_shares TO authenticated;
GRANT ALL ON TABLE public.location_shares TO service_role;


--
-- Name: TABLE mycelium; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.mycelium TO anon;
GRANT ALL ON TABLE public.mycelium TO authenticated;
GRANT ALL ON TABLE public.mycelium TO service_role;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.notifications TO anon;
GRANT ALL ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;


--
-- Name: TABLE posts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.posts TO anon;
GRANT ALL ON TABLE public.posts TO authenticated;
GRANT ALL ON TABLE public.posts TO service_role;


--
-- Name: TABLE profile_capabilities; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.profile_capabilities TO anon;
GRANT ALL ON TABLE public.profile_capabilities TO authenticated;
GRANT ALL ON TABLE public.profile_capabilities TO service_role;


--
-- Name: TABLE profile_categories; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.profile_categories TO anon;
GRANT ALL ON TABLE public.profile_categories TO authenticated;
GRANT ALL ON TABLE public.profile_categories TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: postgres
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.profiles TO anon;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: COLUMN profiles.id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(id) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.full_name; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(full_name) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.handle; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(handle) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.headline; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(headline) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.bio; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(bio) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.avatar_url; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(avatar_url) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.location; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(location) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.created_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(created_at) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.updated_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(updated_at) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.onboarded; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(onboarded) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.is_admin; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(is_admin) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.notification_pref; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(notification_pref) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.first_name; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(first_name) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.last_name; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(last_name) ON TABLE public.profiles TO authenticated;


--
-- Name: TABLE recommendations; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.recommendations TO anon;
GRANT ALL ON TABLE public.recommendations TO authenticated;
GRANT ALL ON TABLE public.recommendations TO service_role;


--
-- Name: TABLE space_members; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.space_members TO anon;
GRANT ALL ON TABLE public.space_members TO authenticated;
GRANT ALL ON TABLE public.space_members TO service_role;


--
-- Name: TABLE spaces; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.spaces TO anon;
GRANT ALL ON TABLE public.spaces TO authenticated;
GRANT ALL ON TABLE public.spaces TO service_role;


--
-- Name: TABLE subscriptions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.subscriptions TO anon;
GRANT ALL ON TABLE public.subscriptions TO authenticated;
GRANT ALL ON TABLE public.subscriptions TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict xjeOThdlbCrWRHhefNlF5eDgtxGMwM7zsR2AU8f70d6WSwHWanVE7hPHUdH9bNg

-- MANUAL ADDITION — trigger on auth.users (outside the public schema)
--
-- pg_dump --schema=public captures the public.handle_new_user() function
-- (defined above) but NOT the trigger that fires it, because the trigger is
-- attached to auth.users in Supabase's managed `auth` schema. Captured via:
--   SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
--   WHERE t.tgrelid = 'auth.users'::regclass AND NOT t.tgisinternal;
-- This is what auto-creates a public.profiles row on every new signup.
--

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
