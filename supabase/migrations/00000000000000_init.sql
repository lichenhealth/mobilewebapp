--
-- PostgreSQL database dump
--

\restrict xsIOUEMnFLXII45YZ6Vs6lTKFBPp68QrV3bCDWg6s1LNvBycx95OkKQginCYwhQ

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
    CONSTRAINT chats_kind_check CHECK ((kind = ANY (ARRAY['organization'::text, 'community'::text, 'group'::text, 'place'::text, 'care_team'::text, 'direct'::text])))
);


ALTER TABLE public.chats OWNER TO postgres;

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
    CONSTRAINT posts_content_type_check CHECK ((content_type = ANY (ARRAY['social'::text, 'creative'::text, 'educational'::text, 'actionable'::text, 'qa'::text]))),
    CONSTRAINT posts_service_area_check CHECK ((service_area = ANY (ARRAY['marketplace'::text, 'work'::text, 'courses'::text, 'food'::text, 'art'::text, 'events'::text, 'places'::text, 'library'::text, 'people'::text]))),
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
    is_admin boolean DEFAULT false NOT NULL
);


ALTER TABLE public.profiles OWNER TO postgres;

--
-- Name: recommendations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.recommendations (
    recommender_id uuid NOT NULL,
    post_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
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
    created_at timestamp with time zone DEFAULT now() NOT NULL
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
-- Name: care_invitations care_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_invitations
    ADD CONSTRAINT care_invitations_pkey PRIMARY KEY (id);


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
-- Name: mycelium mycelium_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mycelium
    ADD CONSTRAINT mycelium_pkey PRIMARY KEY (truster_id, target_type, target_id);


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
    ADD CONSTRAINT recommendations_pkey PRIMARY KEY (recommender_id, post_id);


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
-- Name: chats_direct_uidx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX chats_direct_uidx ON public.chats USING btree (direct_key) WHERE (direct_key IS NOT NULL);


--
-- Name: chats_patient_uidx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX chats_patient_uidx ON public.chats USING btree (patient_id) WHERE (patient_id IS NOT NULL);


--
-- Name: chats_space_uidx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX chats_space_uidx ON public.chats USING btree (space_id) WHERE (space_id IS NOT NULL);


--
-- Name: mycelium_target_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX mycelium_target_idx ON public.mycelium USING btree (target_type, target_id);


--
-- Name: posts_author_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX posts_author_idx ON public.posts USING btree (author_id);


--
-- Name: posts_service_area_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX posts_service_area_idx ON public.posts USING btree (service_area);


--
-- Name: posts_space_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX posts_space_idx ON public.posts USING btree (space_id);


--
-- Name: recommendations_post_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX recommendations_post_idx ON public.recommendations USING btree (post_id);


--
-- Name: spaces a_on_space_create_chat; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER a_on_space_create_chat AFTER INSERT ON public.spaces FOR EACH ROW EXECUTE FUNCTION public.create_space_chat();


--
-- Name: care_team_members on_care_active_trg; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_care_active_trg BEFORE UPDATE ON public.care_team_members FOR EACH ROW WHEN (((new.status = 'active'::text) AND (old.status IS DISTINCT FROM 'active'::text))) EXECUTE FUNCTION public.on_care_active();


--
-- Name: care_team_members on_care_remove_trg; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_care_remove_trg AFTER DELETE ON public.care_team_members FOR EACH ROW EXECUTE FUNCTION public.on_care_remove();


--
-- Name: space_members on_member_sync_chat; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_member_sync_chat AFTER INSERT OR DELETE ON public.space_members FOR EACH ROW EXECUTE FUNCTION public.sync_member_to_chat();


--
-- Name: spaces on_space_created; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_space_created AFTER INSERT ON public.spaces FOR EACH ROW EXECUTE FUNCTION public.handle_new_space();


--
-- Name: profiles profiles_touch_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER profiles_touch_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


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
-- Name: mycelium mycelium_truster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mycelium
    ADD CONSTRAINT mycelium_truster_id_fkey FOREIGN KEY (truster_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: posts posts_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


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
-- Name: recommendations recommendations_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recommendations
    ADD CONSTRAINT recommendations_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


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
  WHERE ((m.space_id = spaces.id) AND (m.profile_id = auth.uid()) AND (m.role = 'admin'::public.space_member_role)))));


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

CREATE POLICY "posts: insert own" ON public.posts FOR INSERT TO authenticated WITH CHECK (((author_id = auth.uid()) AND ((visibility <> 'space'::text) OR (EXISTS ( SELECT 1
   FROM public.space_members m
  WHERE ((m.space_id = posts.space_id) AND (m.profile_id = auth.uid())))))));


--
-- Name: posts posts: read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "posts: read" ON public.posts FOR SELECT TO authenticated USING (((visibility = 'public'::text) OR (author_id = auth.uid()) OR ((visibility = 'space'::text) AND (EXISTS ( SELECT 1
   FROM public.space_members m
  WHERE ((m.space_id = posts.space_id) AND (m.profile_id = auth.uid()))))) OR ((visibility = 'mycelium'::text) AND (EXISTS ( SELECT 1
   FROM public.mycelium my
  WHERE ((my.truster_id = auth.uid()) AND (my.target_type = 'profile'::text) AND (my.target_id = posts.author_id)))))));


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
-- Name: FUNCTION claim_care_invitations(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.claim_care_invitations() TO anon;
GRANT ALL ON FUNCTION public.claim_care_invitations() TO authenticated;
GRANT ALL ON FUNCTION public.claim_care_invitations() TO service_role;


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
-- Name: FUNCTION find_member_by_email(p_email text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.find_member_by_email(p_email text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.find_member_by_email(p_email text) TO authenticated;
GRANT ALL ON FUNCTION public.find_member_by_email(p_email text) TO service_role;


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
-- Name: FUNCTION is_chat_member(p_chat uuid, p_uid uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.is_chat_member(p_chat uuid, p_uid uuid) TO anon;
GRANT ALL ON FUNCTION public.is_chat_member(p_chat uuid, p_uid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_chat_member(p_chat uuid, p_uid uuid) TO service_role;


--
-- Name: FUNCTION on_care_active(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.on_care_active() TO anon;
GRANT ALL ON FUNCTION public.on_care_active() TO authenticated;
GRANT ALL ON FUNCTION public.on_care_active() TO service_role;


--
-- Name: FUNCTION on_care_remove(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.on_care_remove() TO anon;
GRANT ALL ON FUNCTION public.on_care_remove() TO authenticated;
GRANT ALL ON FUNCTION public.on_care_remove() TO service_role;


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
-- Name: TABLE care_invitations; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.care_invitations TO anon;
GRANT ALL ON TABLE public.care_invitations TO authenticated;
GRANT ALL ON TABLE public.care_invitations TO service_role;


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
-- Name: TABLE mycelium; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.mycelium TO anon;
GRANT ALL ON TABLE public.mycelium TO authenticated;
GRANT ALL ON TABLE public.mycelium TO service_role;


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

\unrestrict xsIOUEMnFLXII45YZ6Vs6lTKFBPp68QrV3bCDWg6s1LNvBycx95OkKQginCYwhQ


--
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
