--
-- PostgreSQL database dump
--

\restrict iYkGKUgf2N6bSB3aSc9FZp4lw03AOBhC04j6gKhYYXsNlY4o6t7DpTtXaPPbf2l

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
-- Name: accept_inkind_donation(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.accept_inkind_donation(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare d record;
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only admins can accept donations.';
  end if;
  select * into d from inkind_donations where id = p_id for update;
  if not found then raise exception 'No such donation offer.'; end if;
  if d.status <> 'offered' then raise exception 'Already resolved.'; end if;
  update inkind_donations
     set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
   where id = p_id;
end $$;


ALTER FUNCTION public.accept_inkind_donation(p_id uuid) OWNER TO postgres;

--
-- Name: accept_space_invite(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.accept_space_invite(p_space uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not exists (
    select 1
    from public.space_membership_requests r
    where r.space_id = p_space and r.profile_id = auth.uid()
      and r.initiated_by <> r.profile_id
      and public.has_space_duty(r.space_id, r.initiated_by, 'members')
  ) then
    raise exception 'No invitation to accept';
  end if;
  insert into public.space_members (space_id, profile_id, role)
  values (p_space, auth.uid(), 'member')
  on conflict do nothing;
  delete from public.space_membership_requests
  where space_id = p_space and profile_id = auth.uid();
end; $$;


ALTER FUNCTION public.accept_space_invite(p_space uuid) OWNER TO postgres;

--
-- Name: admin_list_supporters(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.admin_list_supporters() RETURNS TABLE(profile_id uuid, tier text, source text, status text, full_name text, email text, current_period_end timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;
  return query
    select s.profile_id, s.tier, s.source, s.status, p.full_name, p.email, s.current_period_end
    from public.subscriptions s
    left join public.profiles p on p.id = s.profile_id
    order by s.granted_at desc nulls last;
end;
$$;


ALTER FUNCTION public.admin_list_supporters() OWNER TO postgres;

--
-- Name: admin_search_members(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.admin_search_members(p_q text) RETURNS TABLE(profile_id uuid, full_name text, email text, tier text, source text, status text, current_period_end timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select p.id, p.full_name, p.email,
         s.tier, s.source, s.status, s.current_period_end
  from public.profiles p
  left join public.subscriptions s on s.profile_id = p.id
  where (select is_admin from public.profiles where id = auth.uid())
    and (
      p.full_name ilike '%' || p_q || '%'
      or p.email ilike '%' || p_q || '%'
    )
  order by p.full_name nulls last
  limit 12;
$$;


ALTER FUNCTION public.admin_search_members(p_q text) OWNER TO postgres;

--
-- Name: alias_category_suggestion(uuid, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.alias_category_suggestion(p_suggestion uuid, p_category text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_name text;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Admins only.';
  end if;
  if not exists (select 1 from public.categories c where c.id = p_category) then
    raise exception 'No such category.';
  end if;
  select name into v_name from public.category_suggestions where id = p_suggestion;
  if v_name is null then raise exception 'No such suggestion.'; end if;

  insert into public.category_aliases (alias, category_id, created_by)
  values (lower(btrim(v_name)), p_category, auth.uid())
  on conflict (alias) do update set category_id = excluded.category_id;

  update public.category_suggestions set status = 'approved' where id = p_suggestion;
end $$;


ALTER FUNCTION public.alias_category_suggestion(p_suggestion uuid, p_category text) OWNER TO postgres;

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
-- Name: approve_exchange_guardian(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.approve_exchange_guardian(p_exchange uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_x public.exchanges%rowtype;
begin
  select * into v_x from public.exchanges where id = p_exchange;
  if v_x.id is null then raise exception 'No such exchange.'; end if;
  if not (public.is_guardian_of(v_x.buyer_id, auth.uid())
          or public.is_guardian_of(v_x.seller_id, auth.uid())) then
    raise exception 'Only a guardian can approve this.';
  end if;
  update public.exchanges set guardian_ok_at = now() where id = p_exchange;
  perform public.notify(v_x.buyer_id, 'market', null, 'exchange_guardian_ok',
    'A grown-up said yes', 'Your exchange can go ahead.',
    '/posts/' || v_x.post_id, auth.uid());
end $$;


ALTER FUNCTION public.approve_exchange_guardian(p_exchange uuid) OWNER TO postgres;

--
-- Name: approve_group_nesting(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.approve_group_nesting(p_group uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_parent uuid; v_gname text; v_pname text; v_admin uuid;
begin
  select parent_id into v_parent from public.space_nesting_requests where group_id = p_group;
  if v_parent is null then
    raise exception 'No nesting proposal for this group';
  end if;
  if not exists (
    select 1 from public.space_members m
    where m.space_id = v_parent and m.profile_id = auth.uid()
      and m.role in ('admin', 'super_admin')
  ) then
    raise exception 'Only the community''s admins can approve this';
  end if;
  update public.spaces set parent_space_id = v_parent where id = p_group;
  delete from public.space_nesting_requests where group_id = p_group;
  select name into v_gname from public.spaces where id = p_group;
  select name into v_pname from public.spaces where id = v_parent;
  for v_admin in
    select m.profile_id from public.space_members m
    where m.space_id = p_group and m.role in ('admin', 'super_admin')
  loop
    perform public.notify(
      v_admin, 'home', p_group, 'group_nesting_approved',
      coalesce(v_gname, 'Your group') || ' is now part of ' || coalesce(v_pname, 'the community'),
      'The admins welcomed your group in.',
      '/spaces/' || p_group, auth.uid()
    );
  end loop;
end; $$;


ALTER FUNCTION public.approve_group_nesting(p_group uuid) OWNER TO postgres;

--
-- Name: approve_join_request(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.approve_join_request(p_space uuid, p_profile uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_name text;
begin
  if not public.has_space_duty(p_space, auth.uid(), 'members') then
    raise exception 'Only admins who steward members can approve join requests';
  end if;
  if not exists (
    select 1 from public.space_membership_requests r
    where r.space_id = p_space and r.profile_id = p_profile
      and r.initiated_by = r.profile_id
  ) then
    raise exception 'No pending join request';
  end if;
  insert into public.space_members (space_id, profile_id, role)
  values (p_space, p_profile, 'member')
  on conflict do nothing;
  delete from public.space_membership_requests
  where space_id = p_space and profile_id = p_profile;
  select name into v_name from public.spaces where id = p_space;
  perform public.notify(
    p_profile, 'home', p_space, 'space_join_approved',
    'Welcome to ' || coalesce(v_name, 'the space'),
    'Your request to join was approved.',
    '/spaces/' || p_space, auth.uid()
  );
end; $$;


ALTER FUNCTION public.approve_join_request(p_space uuid, p_profile uuid) OWNER TO postgres;

--
-- Name: assistant_on_feed_post(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.assistant_on_feed_post() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_secret text;
begin
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'push_hook_secret';
    perform net.http_post(
      url := 'https://mjqnaevertyzgjlpwynr.supabase.co/functions/v1/assistant-feed',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', coalesce(v_secret, '')),
      body := jsonb_build_object('feed_post_id', new.id, 'profile_id', new.profile_id)
    );
  exception when others then
    null;  -- the assistant failing must never block a member's post
  end;
  return new;
end $$;


ALTER FUNCTION public.assistant_on_feed_post() OWNER TO postgres;

--
-- Name: assistant_on_message(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.assistant_on_message() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_secret text; v_assistant uuid;
begin
  if exists (select 1 from public.assistant_identities where profile_id = new.sender_id) then
    return new;
  end if;
  select ai.profile_id into v_assistant
  from public.assistant_identities ai
  join public.chat_members cm on cm.profile_id = ai.profile_id and cm.chat_id = new.chat_id
  where ai.active
  limit 1;
  if v_assistant is null then return new; end if;
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'push_hook_secret';
    perform net.http_post(
      url := 'https://mjqnaevertyzgjlpwynr.supabase.co/functions/v1/claude-chat',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', coalesce(v_secret, '')),
      body := jsonb_build_object('chat_id', new.chat_id, 'message_id', new.id, 'assistant_id', v_assistant)
    );
  exception when others then
    null;
  end;
  return new;
end $$;


ALTER FUNCTION public.assistant_on_message() OWNER TO postgres;

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
-- Name: booking_board(uuid, date, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.booking_board(p_type uuid, p_from date, p_to date) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare t record; v jsonb;
begin
  if not public.booking_type_visible(p_type, auth.uid()) then
    return null;
  end if;
  select * into t from public.booking_types where id = p_type;
  select jsonb_build_object(
    'type', jsonb_build_object(
      'id', t.id, 'provider_id', t.profile_id, 'title', t.title,
      'description', t.description, 'duration_min', t.duration_min,
      'buffer_min', t.buffer_min, 'price', t.price, 'location', t.location,
      'approval', t.approval),
    'windows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'weekday', w.weekday, 'start_min', w.start_min, 'end_min', w.end_min,
        'valid_from', w.valid_from, 'valid_to', w.valid_to))
      from public.availability_windows w
      where w.profile_id = t.profile_id and w.kind = 'available'), '[]'::jsonb),
    'busy', coalesce((
      select jsonb_agg(b) from (
        select e.start_date, e.end_date, e.all_day, e.start_min, e.end_min, e.recurrence
        from public.events e
        where (e.owner_profile_id = t.profile_id
               or exists (select 1 from public.event_attendees a
                          where a.event_id = e.id and a.profile_id = t.profile_id
                            and a.status <> 'declined'))
          and e.start_date <= p_to and (e.end_date >= p_from or e.recurrence is not null)
        union all
        select x.on_date, x.on_date, x.all_day, x.start_min, x.end_min, null::jsonb
        from public.external_busy x
        where x.profile_id = t.profile_id and x.on_date between p_from and p_to
        union all
        select bk.on_date, bk.on_date, false, bk.start_min, bk.end_min, null::jsonb
        from public.bookings bk
        where bk.provider_id = t.profile_id
          and bk.status in ('pending', 'confirmed')
          and bk.on_date between p_from and p_to
      ) b), '[]'::jsonb)
  ) into v;
  return v;
end; $$;


ALTER FUNCTION public.booking_board(p_type uuid, p_from date, p_to date) OWNER TO postgres;

--
-- Name: booking_type_visible(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.booking_type_visible(p_type uuid, p_viewer uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.booking_types t
    where t.id = p_type and t.active and (
      t.profile_id = p_viewer
      or t.audience in ('everyone', 'public')
      or (t.audience = 'mycelium' and exists (
        select 1 from public.mycelium m
        where m.truster_id = t.profile_id and m.target_type = 'profile' and m.target_id = p_viewer))
      or (t.audience = 'space' and t.audience_space_id is not null
          and public.is_space_member(t.audience_space_id, p_viewer))));
$$;


ALTER FUNCTION public.booking_type_visible(p_type uuid, p_viewer uuid) OWNER TO postgres;

--
-- Name: burn_currentcy(text, uuid, numeric, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.burn_currentcy(p_from_type text, p_from_id uuid, p_amount numeric, p_memo text DEFAULT ''::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_id uuid; v_amt numeric; v_bal numeric;
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only admins can burn Current.';
  end if;
  v_amt := round(coalesce(p_amount, 0), 2);
  if v_amt <= 0 then raise exception 'Amount must be positive.'; end if;
  if p_from_type = 'profile' then
    if not exists (select 1 from profiles where id = p_from_id) then raise exception 'No such member.'; end if;
  elsif p_from_type = 'space' then
    if not exists (select 1 from spaces where id = p_from_id) then raise exception 'No such group.'; end if;
  else
    raise exception 'Unknown holder kind.';
  end if;

  -- Same lock keyspace as send_currentcy and complete_exchange: every spend
  -- from one party serializes, whichever door the money leaves by.
  perform pg_advisory_xact_lock(hashtextextended(p_from_type || ':' || p_from_id::text, 42));

  select coalesce(sum(case when to_type = p_from_type and to_id = p_from_id then amount else 0 end), 0)
       - coalesce(sum(case when from_type = p_from_type and from_id = p_from_id then amount else 0 end), 0)
    into v_bal
    from ledger_entries
   where (to_type = p_from_type and to_id = p_from_id)
      or (from_type = p_from_type and from_id = p_from_id);
  if v_bal < v_amt then
    raise exception 'Not enough Current — this account holds %.', trim(to_char(v_bal, 'FM999999990.##'));
  end if;

  insert into ledger_entries (from_type, from_id, to_type, to_id, amount, context, memo, created_by)
  values (p_from_type, p_from_id, null, null, v_amt, 'burn', coalesce(p_memo, ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;


ALTER FUNCTION public.burn_currentcy(p_from_type text, p_from_id uuid, p_amount numeric, p_memo text) OWNER TO postgres;

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

  select level into v from public.calendar_shares
   where owner_id = p_owner and external_calendar_id is null
     and audience_type = 'profile' and audience_profile_id = p_viewer;
  if v is not null then return v; end if;

  select level into v
  from public.calendar_shares s
  where s.owner_id = p_owner and s.external_calendar_id is null
    and s.audience_type = 'space'
    and public.is_space_member(s.audience_space_id, p_owner)
    and public.is_space_member(s.audience_space_id, p_viewer)
  order by case s.level when 'details' then 2 when 'busy' then 1 else 0 end desc
  limit 1;
  if v is not null then return v; end if;

  select level into v from public.calendar_shares
   where owner_id = p_owner and external_calendar_id is null and audience_type = 'everyone';
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
-- Name: can_see_profile(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.can_see_profile(p_target uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    p_target = auth.uid()
    or coalesce((select p.findable from public.profiles p where p.id = p_target), true)
    -- Somewhere you both stand
    or exists (
      select 1 from public.space_members a
      join public.space_members b on b.space_id = a.space_id
      where a.profile_id = p_target and b.profile_id = auth.uid()
    )
    -- Woven, either direction (membership, not trust — trust is private)
    or exists (
      select 1 from public.mycelium m
      where m.target_type = 'profile'
        and ((m.truster_id = auth.uid() and m.target_id = p_target)
          or (m.truster_id = p_target and m.target_id = auth.uid()))
    )
    -- Care, either direction, at any stage
    or exists (
      select 1 from public.care_team_members c
      where (c.patient_id = p_target and c.caregiver_id = auth.uid())
         or (c.caregiver_id = p_target and c.patient_id = auth.uid())
    )
    -- In a room together
    or exists (
      select 1 from public.chat_members a
      join public.chat_members b on b.chat_id = a.chat_id
      where a.profile_id = p_target and b.profile_id = auth.uid()
    )
    -- They put their name on something public
    or exists (
      select 1 from public.posts po
      where po.author_id = p_target and po.visibility = 'public'
    );
$$;


ALTER FUNCTION public.can_see_profile(p_target uuid) OWNER TO postgres;

--
-- Name: cancel_booking(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.cancel_booking(p_booking uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare b record; t record; v_other uuid; v_name text;
begin
  select * into b from public.bookings where id = p_booking;
  if b is null or (auth.uid() is distinct from b.provider_id
                   and auth.uid() is distinct from b.booker_id) then
    raise exception 'Not yours to cancel';
  end if;
  if b.status in ('cancelled', 'declined') then return; end if;
  select * into t from public.booking_types where id = b.type_id;
  if b.event_id is not null then delete from public.events where id = b.event_id; end if;
  update public.bookings set status = 'cancelled', event_id = null where id = p_booking;
  v_other := case when auth.uid() = b.provider_id then b.booker_id else b.provider_id end;
  if v_other is not null then
    select full_name into v_name from public.profiles where id = auth.uid();
    perform public.notify(v_other, 'calendar', null, 'booking',
      t.title || ' on ' || to_char(b.on_date, 'FMMon FMDD') || ' was cancelled',
      'Cancelled by ' || coalesce(v_name, 'the other member') || '.', '/bookings', auth.uid());
  end if;
end; $$;


ALTER FUNCTION public.cancel_booking(p_booking uuid) OWNER TO postgres;

--
-- Name: cancel_exchange(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.cancel_exchange(p_exchange uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_x public.exchanges%rowtype;
begin
  select * into v_x from public.exchanges where id = p_exchange;
  if v_x.id is null then raise exception 'No such exchange.'; end if;
  if v_x.status = 'completed' then raise exception 'That one already happened.'; end if;
  if not (v_x.buyer_id = auth.uid() or v_x.seller_id = auth.uid()
          or (v_x.seller_space_id is not null
              and public.is_space_admin(v_x.seller_space_id, auth.uid()))
          or (v_x.buyer_space_id is not null
              and public.is_space_admin(v_x.buyer_space_id, auth.uid()))) then
    raise exception 'Not yours to cancel.';
  end if;
  update public.exchanges set status = 'canceled' where id = p_exchange;
  perform public.notify(
    case when v_x.buyer_id = auth.uid() then v_x.seller_id else v_x.buyer_id end,
    'market', null, 'exchange_canceled',
    'An exchange was called off', 'The listing is open again.',
    '/posts/' || v_x.post_id, auth.uid());
end $$;


ALTER FUNCTION public.cancel_exchange(p_exchange uuid) OWNER TO postgres;

--
-- Name: cancel_resource_booking(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.cancel_resource_booking(p_booking uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_b public.resource_bookings%rowtype;
begin
  select * into v_b from public.resource_bookings where id = p_booking;
  if v_b.id is null then return; end if;
  if v_b.requester_id <> auth.uid()
    and not public.is_resource_steward(v_b.resource_id, auth.uid()) then
    raise exception 'Not yours to cancel';
  end if;
  if v_b.event_id is not null then delete from public.events where id = v_b.event_id; end if;
  update public.resource_bookings set status = 'canceled' where id = p_booking;
end; $$;


ALTER FUNCTION public.cancel_resource_booking(p_booking uuid) OWNER TO postgres;

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
-- Name: chat_unread_counts(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.chat_unread_counts() RETURNS TABLE(chat_id uuid, unread bigint)
    LANGUAGE sql STABLE
    AS $$
  select m.chat_id, count(msg.id)
  from public.chat_members m
  join public.chat_messages msg
    on msg.chat_id = m.chat_id
   and msg.created_at > m.last_read_at
   and msg.sender_id <> auth.uid()
  where m.profile_id = auth.uid()
  group by m.chat_id;
$$;


ALTER FUNCTION public.chat_unread_counts() OWNER TO postgres;

--
-- Name: check_invite(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.check_invite(p_token uuid) RETURNS json
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case when t.token is null then json_build_object('valid', false)
    else json_build_object(
      'valid', t.claimed_by is null,
      'inviter', coalesce(p.full_name, 'A member'),
      'for_minor', t.for_minor)
  end
  from (select 1) x
  left join public.invite_tokens t on t.token = p_token
  left join public.profiles p on p.id = t.created_by;
$$;


ALTER FUNCTION public.check_invite(p_token uuid) OWNER TO postgres;

--
-- Name: check_offering_recommend(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.check_offering_recommend() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.offering_category is null then return new; end if;
  if new.target_type <> 'profile' then
    raise exception 'Only a person''s offerings can be recommended by category.';
  end if;
  if not exists (
    select 1 from public.profile_categories pc
    where pc.profile_id = new.target_id and pc.category_id = new.offering_category
  ) then
    raise exception 'They don''t list that offering.';
  end if;
  return new;
end $$;


ALTER FUNCTION public.check_offering_recommend() OWNER TO postgres;

--
-- Name: check_recommend_voice(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.check_recommend_voice() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.recommender_space_id is null then return new; end if;
  if not public.is_space_admin(new.recommender_space_id, auth.uid()) then
    raise exception 'You don''t speak for that space.';
  end if;
  if new.target_type = 'space' and new.target_id = new.recommender_space_id then
    raise exception 'A space can''t recommend itself.';
  end if;
  return new;
end $$;


ALTER FUNCTION public.check_recommend_voice() OWNER TO postgres;

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
-- Name: claim_gifts_for_email(uuid, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.claim_gifts_for_email(p_user uuid, p_email text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare g record; v_count int := 0;
begin
  if p_user is null or coalesce(p_email, '') = '' then return 0; end if;
  for g in
    select * from public.membership_gifts
    where lower(invitee_email) = lower(p_email) and status = 'pending'
    order by (tier = 'concierge') desc, created_at desc
  loop
    insert into public.subscriptions (profile_id, tier, source, status, granted_by, granted_at, current_period_end, updated_at)
    values (
      p_user, g.tier, 'gift', 'active', g.inviter_id, now(),
      case when g.months is null then null else now() + make_interval(months => g.months) end,
      now()
    )
    on conflict (profile_id) do nothing;
    update public.membership_gifts
      set status = 'claimed', claimed_profile_id = p_user, claimed_at = now()
      where id = g.id;
    perform public.notify(
      p_user, 'membership', null, 'membership_gifted',
      'Your gift is active: ' || coalesce(public.gift_span_text(g.months) || ' of ', '') || 'Lichen (' || initcap(g.tier) || ')',
      'Welcome in.',
      '/membership', g.inviter_id
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;


ALTER FUNCTION public.claim_gifts_for_email(p_user uuid, p_email text) OWNER TO postgres;

--
-- Name: claim_invite(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.claim_invite(p_token uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_inviter uuid; v_name text; v_minor boolean; v_invitee text;
begin
  update public.invite_tokens
  set claimed_by = auth.uid(), claimed_at = now()
  where token = p_token and claimed_by is null and created_by <> auth.uid()
  returning created_by, for_minor, invitee_email into v_inviter, v_minor, v_invitee;
  if v_inviter is null then return; end if;

  if coalesce(v_minor, false) then
    insert into public.guardians (minor_id, guardian_id)
    values (auth.uid(), v_inviter)
    on conflict do nothing;
  end if;

  insert into public.mycelium (truster_id, target_type, target_id)
  values (v_inviter, 'profile', auth.uid()), (auth.uid(), 'profile', v_inviter)
  on conflict do nothing;

  -- The token proves this is the invited person even when they signed up
  -- under a different address — deliver any gift riding the invitation
  -- (the audit found one orphaned exactly this way).
  perform public.claim_gifts_for_email(auth.uid(), v_invitee);

  select full_name into v_name from public.profiles where id = auth.uid();
  perform public.notify(
    v_inviter, 'home', null, 'invite_accepted',
    coalesce(v_name, 'Someone') || ' just joined Lichen',
    case when coalesce(v_minor, false)
      then 'They''re on Lichen, and you''re holding the account.'
      else 'Your invitation was accepted — they''re woven into your web.' end,
    '/members/' || auth.uid(), auth.uid());
end; $$;


ALTER FUNCTION public.claim_invite(p_token uuid) OWNER TO postgres;

--
-- Name: claim_membership_gift(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.claim_membership_gift() RETURNS integer
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.claim_gifts_for_email(auth.uid(), auth.jwt() ->> 'email');
$$;


ALTER FUNCTION public.claim_membership_gift() OWNER TO postgres;

--
-- Name: collection_duty(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.collection_duty(p_kind text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$ select case when p_kind = 'course' then 'courses' else 'library' end $$;


ALTER FUNCTION public.collection_duty(p_kind text) OWNER TO postgres;

--
-- Name: complete_exchange(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.complete_exchange(p_exchange uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_x public.exchanges%rowtype;
  v_is_buyer boolean; v_is_seller boolean;
  v_bal numeric; v_entry uuid; v_who text; v_space text; v_admin record;
  v_from_type text; v_from_id uuid; v_to_type text; v_to_id uuid;
begin
  select * into v_x from public.exchanges where id = p_exchange;
  if v_x.id is null then raise exception 'No such exchange.'; end if;
  if v_x.status <> 'accepted' then
    raise exception 'This one isn''t agreed yet.';
  end if;
  if v_x.needs_guardian and v_x.guardian_ok_at is null then
    raise exception 'A grown-up needs to say yes first.';
  end if;

  v_is_buyer := v_x.buyer_id = auth.uid()
    or (v_x.buyer_space_id is not null
        and public.is_space_admin(v_x.buyer_space_id, auth.uid()));
  v_is_seller := v_x.seller_id = auth.uid()
    or (v_x.seller_space_id is not null
        and public.is_space_admin(v_x.seller_space_id, auth.uid()));
  if not (v_is_buyer or v_is_seller) then
    raise exception 'Only the two of you can close this.';
  end if;

  update public.exchanges
     set buyer_done_at = case when v_is_buyer then now() else buyer_done_at end,
         seller_done_at = case when v_is_seller then now() else seller_done_at end
   where id = p_exchange
  returning * into v_x;

  -- One hand isn't a handoff — wait for the other.
  if v_x.buyer_done_at is null or v_x.seller_done_at is null then return; end if;

  if v_x.amount > 0 then
    -- The PARTIES, not the people: a space buyer pays from its treasury, a
    -- space seller is paid INTO its treasury (this used to credit the human
    -- who posted the space's listing — the treasury never saw its own sales).
    v_from_type := case when v_x.buyer_space_id is not null then 'space' else 'profile' end;
    v_from_id   := coalesce(v_x.buyer_space_id, v_x.buyer_id);
    v_to_type   := case when v_x.seller_space_id is not null then 'space' else 'profile' end;
    v_to_id     := coalesce(v_x.seller_space_id, v_x.seller_id);

    -- Same lock keyspace as send_currentcy, so concurrent spends from the
    -- same party serialize against each other no matter which door they use.
    perform pg_advisory_xact_lock(hashtextextended(v_from_type || ':' || v_from_id::text, 42));

    select coalesce(sum(case when to_type = v_from_type and to_id = v_from_id then amount else 0 end), 0)
         - coalesce(sum(case when from_type = v_from_type and from_id = v_from_id then amount else 0 end), 0)
      into v_bal from public.ledger_entries
     where (to_type = v_from_type and to_id = v_from_id)
        or (from_type = v_from_type and from_id = v_from_id);
    if v_bal < v_x.amount then
      raise exception 'Not enough Current-cy — this account holds %.', v_bal;
    end if;
    insert into public.ledger_entries
      (from_type, from_id, to_type, to_id, amount, context, memo,
       ref_type, ref_id, created_by)
    values (v_from_type, v_from_id, v_to_type, v_to_id, v_x.amount,
            'exchange', 'Marketplace exchange', 'exchange', v_x.id, auth.uid())
    returning id into v_entry;
  end if;

  update public.exchanges
     set status = 'completed', completed_at = now(), ledger_entry_id = v_entry
   where id = p_exchange;

  select coalesce(full_name, 'They') into v_who from public.profiles where id = auth.uid();
  perform public.notify(
    case when v_is_buyer then v_x.seller_id else v_x.buyer_id end,
    'market', null, 'exchange_completed',
    'That exchange is complete',
    v_who || ' marked it done. It''s in your statement.',
    '/posts/' || v_x.post_id, auth.uid());

  -- Money landed in a treasury: its stewards hear, same as send_currentcy.
  if v_entry is not null and v_x.seller_space_id is not null then
    select name into v_space from public.spaces where id = v_x.seller_space_id;
    for v_admin in
      select m.profile_id from public.space_members m
       where m.space_id = v_x.seller_space_id
         and m.role in ('admin', 'super_admin')
         and m.profile_id <> auth.uid()
    loop
      perform public.notify(v_admin.profile_id, 'home', v_x.seller_space_id, 'currentcy',
        coalesce(v_space, 'Your group') || ' received '
          || trim(to_char(v_x.amount, 'FM999999990.##')) || ' Current',
        'A marketplace exchange completed.',
        '/spaces/' || v_x.seller_space_id::text || '?manage=1', auth.uid());
    end loop;
  end if;
end $$;


ALTER FUNCTION public.complete_exchange(p_exchange uuid) OWNER TO postgres;

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
-- Name: confirm_resource_booking_inner(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.confirm_resource_booking_inner(p_booking uuid, p_actor uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_b public.resource_bookings%rowtype; v_res public.resources%rowtype; v_event uuid;
begin
  select * into v_b from public.resource_bookings where id = p_booking;
  select * into v_res from public.resources where id = v_b.resource_id;
  insert into public.events
    (creator_id, owner_resource_id, title, start_date, end_date, start_min, end_min, all_day)
  values
    (p_actor, v_b.resource_id, 'Booked', v_b.start_date, v_b.end_date,
     v_b.start_min, v_b.end_min, v_b.start_min is null)
  returning id into v_event;
  insert into public.event_attendees (event_id, profile_id, status)
  values (v_event, v_b.requester_id, 'going')
  on conflict do nothing;
  update public.resource_bookings
  set status = 'confirmed', event_id = v_event where id = p_booking;
  perform public.notify(
    v_b.requester_id, 'calendar', v_res.space_id, 'resource_booking_confirmed',
    v_res.name || ' is yours',
    v_b.start_date::text || case when v_b.end_date > v_b.start_date
      then ' ‚Äì ' || v_b.end_date::text else '' end,
    '/calendar', p_actor);
end; $$;


ALTER FUNCTION public.confirm_resource_booking_inner(p_booking uuid, p_actor uuid) OWNER TO postgres;

--
-- Name: create_booking(uuid, date, integer, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_booking(p_type uuid, p_date date, p_start integer, p_note text DEFAULT ''::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare t record; v_end integer; v_id uuid; v_event uuid;
        v_booker_name text; v_weekday int; v_ok boolean;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.booking_type_visible(p_type, auth.uid()) then
    raise exception 'This session isn''t open to you';
  end if;
  select * into t from public.booking_types where id = p_type;
  if t.profile_id = auth.uid() then raise exception 'That''s your own session type'; end if;
  v_end := p_start + t.duration_min;
  if v_end > 1440 then raise exception 'Slot runs past midnight'; end if;
  if p_date < current_date then raise exception 'That day has passed'; end if;

  -- Inside a declared availability window? (weekday 0=Mon … 6=Sun)
  v_weekday := extract(isodow from p_date)::int - 1;
  select exists (
    select 1 from public.availability_windows w
    where w.profile_id = t.profile_id and w.kind = 'available'
      and w.weekday = v_weekday
      and w.start_min <= p_start and w.end_min >= v_end
      and (w.valid_from is null or w.valid_from <= p_date)
      and (w.valid_to is null or w.valid_to >= p_date)
  ) into v_ok;
  if not v_ok then raise exception 'That time isn''t offered'; end if;

  -- Conflicts: held bookings + non-recurring events + imported busy.
  -- (Recurring-event conflicts are filtered by the slot picker; request-mode
  -- approval is the human backstop.)
  if exists (
    select 1 from public.bookings b
    where b.provider_id = t.profile_id and b.on_date = p_date
      and b.status in ('pending', 'confirmed')
      and b.start_min < v_end + t.buffer_min and b.end_min + t.buffer_min > p_start
  ) or exists (
    select 1 from public.events e
    where e.owner_profile_id = t.profile_id and e.recurrence is null
      and p_date between e.start_date and e.end_date
      and (e.all_day or (coalesce(e.start_min, 0) < v_end + t.buffer_min
                         and coalesce(e.end_min, 1440) + t.buffer_min > p_start))
  ) or exists (
    select 1 from public.external_busy x
    where x.profile_id = t.profile_id and x.on_date = p_date
      and (x.all_day or (coalesce(x.start_min, 0) < v_end + t.buffer_min
                         and coalesce(x.end_min, 1440) + t.buffer_min > p_start))
  ) then
    raise exception 'That slot was just taken — pick another';
  end if;

  insert into public.bookings (type_id, provider_id, booker_id, on_date, start_min, end_min, status, note)
  values (p_type, t.profile_id, auth.uid(), p_date, p_start, v_end,
          case when t.approval = 'instant' then 'confirmed' else 'pending' end, coalesce(p_note, ''))
  returning id into v_id;

  select full_name into v_booker_name from public.profiles where id = auth.uid();

  if t.approval = 'instant' then
    insert into public.events (creator_id, owner_profile_id, title, description, location,
                               start_date, end_date, all_day, start_min, end_min)
    values (t.profile_id, t.profile_id, t.title || ' — ' || coalesce(v_booker_name, 'a member'),
            coalesce(p_note, ''), t.location, p_date, p_date, false, p_start, v_end)
    returning id into v_event;
    insert into public.event_attendees (event_id, profile_id, status, invited_by)
    values (v_event, auth.uid(), 'going', t.profile_id);
    update public.bookings set event_id = v_event where id = v_id;
    perform public.notify(t.profile_id, 'calendar', null, 'booking',
      coalesce(v_booker_name, 'A member') || ' booked ' || t.title,
      to_char(p_date, 'FMMon FMDD') || ' — it''s on your calendar.', '/bookings', auth.uid());
  else
    perform public.notify(t.profile_id, 'calendar', null, 'booking',
      coalesce(v_booker_name, 'A member') || ' requested ' || t.title,
      to_char(p_date, 'FMMon FMDD') || ' — accept or decline in Bookings.', '/bookings', auth.uid());
  end if;
  return v_id;
end; $$;


ALTER FUNCTION public.create_booking(p_type uuid, p_date date, p_start integer, p_note text) OWNER TO postgres;

--
-- Name: create_entity_profile(text, text, text, uuid, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_entity_profile(p_name text, p_kind text, p_aspect text DEFAULT 'individual'::text, p_steward_space uuid DEFAULT NULL::uuid, p_jurisdiction text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_id uuid := gen_random_uuid();
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  if p_kind = 'person' or p_kind not in ('plant','animal','place','element','collective') then
    raise exception 'a stewarded being is not a person';
  end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'a being needs a name'; end if;
  if p_kind in ('plant','element') and btrim(coalesce(p_jurisdiction, '')) = '' then
    raise exception 'Plants and elements are in many places at once — name the jurisdiction this one is tended within.';
  end if;
  if p_steward_space is not null and not public.is_space_admin(p_steward_space, v_uid) then
    raise exception 'you do not steward that space';
  end if;
  insert into public.profiles (id, full_name, kind, aspect, onboarded, jurisdiction,
                               steward_profile_id, steward_space_id)
  values (v_id, btrim(p_name), p_kind, coalesce(p_aspect, 'individual'), true,
          nullif(btrim(coalesce(p_jurisdiction, '')), ''),
          case when p_steward_space is null then v_uid else null end,
          p_steward_space);
  return v_id;
end $$;


ALTER FUNCTION public.create_entity_profile(p_name text, p_kind text, p_aspect text, p_steward_space uuid, p_jurisdiction text) OWNER TO postgres;

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
-- Name: currentcy_float_summary(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.currentcy_float_summary() RETURNS json
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_circulation numeric; v_operating bigint;
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Admins only.';
  end if;
  select coalesce(sum(case when from_type is null then amount else 0 end), 0)
       - coalesce(sum(case when to_type is null then amount else 0 end), 0)
    into v_circulation
    from ledger_entries
   where from_type is null or to_type is null;
  select coalesce(sum(central_cents), 0) into v_operating
    from donations where central_cents is not null;
  return json_build_object(
    'circulation', v_circulation,
    'operating_cents', v_operating
  );
end $$;


ALTER FUNCTION public.currentcy_float_summary() OWNER TO postgres;

--
-- Name: decide_exchange(uuid, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.decide_exchange(p_exchange uuid, p_accept boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_x public.exchanges%rowtype; v_who text;
begin
  select * into v_x from public.exchanges where id = p_exchange;
  if v_x.id is null then raise exception 'No such exchange.'; end if;
  if not (v_x.seller_id = auth.uid()
          or (v_x.seller_space_id is not null
              and public.is_space_admin(v_x.seller_space_id, auth.uid()))) then
    raise exception 'Only the person offering it can answer.';
  end if;
  if v_x.status <> 'pending' then raise exception 'That''s already settled.'; end if;

  update public.exchanges
     set status = case when p_accept then 'accepted' else 'declined' end,
         decided_at = now()
   where id = p_exchange;

  select coalesce(full_name, 'They') into v_who from public.profiles where id = v_x.seller_id;
  perform public.notify(
    v_x.buyer_id, 'market', null,
    case when p_accept then 'exchange_accepted' else 'exchange_declined' end,
    case when p_accept then v_who || ' said yes' else v_who || ' passed this time' end,
    case when p_accept then 'Arrange the handoff — mark it done when it''s done.'
         else 'The listing stays open for others.' end,
    '/posts/' || v_x.post_id, auth.uid());
end $$;


ALTER FUNCTION public.decide_exchange(p_exchange uuid, p_accept boolean) OWNER TO postgres;

--
-- Name: decide_resource_booking(uuid, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.decide_resource_booking(p_booking uuid, p_approve boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_b public.resource_bookings%rowtype; v_res public.resources%rowtype;
begin
  select * into v_b from public.resource_bookings where id = p_booking;
  if v_b.id is null or v_b.status <> 'pending' then raise exception 'No pending booking'; end if;
  if not public.is_resource_steward(v_b.resource_id, auth.uid()) then
    raise exception 'Only this resource''s steward decides';
  end if;
  if p_approve then
    perform public.confirm_resource_booking_inner(p_booking, auth.uid());
  else
    select * into v_res from public.resources where id = v_b.resource_id;
    update public.resource_bookings set status = 'declined' where id = p_booking;
    perform public.notify(
      v_b.requester_id, 'calendar', v_res.space_id, 'resource_booking_declined',
      v_res.name || ' isn''t available then',
      'Try other dates ‚Äî or message whoever holds them.', null, auth.uid());
  end if;
end; $$;


ALTER FUNCTION public.decide_resource_booking(p_booking uuid, p_approve boolean) OWNER TO postgres;

--
-- Name: decide_section_share(uuid, uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.decide_section_share(p_space uuid, p_post uuid, p_area text, p_approve boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_req uuid; v_name text; v_title text;
begin
  if not public.has_space_duty(p_space, auth.uid(),
        case when p_area = 'courses' then 'courses' else 'library' end) then
    raise exception 'Only this section''s stewards can decide shares';
  end if;
  select requested_by into v_req from public.space_section_shares
  where space_id = p_space and post_id = p_post and area = p_area and status = 'pending';
  if v_req is null then
    raise exception 'No pending share';
  end if;
  update public.space_section_shares
  set status = case when p_approve then 'approved' else 'declined' end,
      decided_by = auth.uid()
  where space_id = p_space and post_id = p_post and area = p_area;
  -- Approvals ring; declines stay quiet.
  if p_approve then
    select name into v_name from public.spaces where id = p_space;
    select coalesce(nullif(title, ''), left(body, 60)) into v_title from public.posts where id = p_post;
    perform public.notify(
      v_req, 'home', p_space, 'section_share_approved',
      'Your ' || (case when p_area = 'courses' then 'course' else 'piece' end) ||
        ' now lives in ' || coalesce(v_name, 'the space') || '''s ' || p_area,
      coalesce(v_title, ''), '/spaces/' || p_space, auth.uid());
  end if;
end; $$;


ALTER FUNCTION public.decide_section_share(p_space uuid, p_post uuid, p_area text, p_approve boolean) OWNER TO postgres;

--
-- Name: decline_inkind_donation(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.decline_inkind_donation(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only admins can decline donations.';
  end if;
  update inkind_donations set status = 'declined'
   where id = p_id and status = 'offered';
end $$;


ALTER FUNCTION public.decline_inkind_donation(p_id uuid) OWNER TO postgres;

--
-- Name: eject_group(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.eject_group(p_group uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_parent uuid; v_gname text; v_pname text; v_admin uuid;
begin
  select parent_space_id into v_parent from public.spaces where id = p_group;
  if v_parent is null then
    raise exception 'This group is not nested anywhere';
  end if;
  if not exists (
    select 1 from public.space_members m
    where m.space_id = v_parent and m.profile_id = auth.uid()
      and m.role in ('admin', 'super_admin')
  ) then
    raise exception 'Only the community''s admins can release a group';
  end if;
  select name into v_gname from public.spaces where id = p_group;
  select name into v_pname from public.spaces where id = v_parent;
  update public.spaces set parent_space_id = null where id = p_group;
  for v_admin in
    select m.profile_id from public.space_members m
    where m.space_id = p_group and m.role in ('admin', 'super_admin')
  loop
    perform public.notify(
      v_admin, 'home', p_group, 'group_unnested',
      coalesce(v_gname, 'Your group') || ' now stands on its own',
      coalesce(v_pname, 'The community') || '''s admins released it — everything else about the group is unchanged.',
      '/spaces/' || p_group, auth.uid()
    );
  end loop;
end; $$;


ALTER FUNCTION public.eject_group(p_group uuid) OWNER TO postgres;

--
-- Name: endorse_member_suggestion(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.endorse_member_suggestion(p_space uuid, p_profile uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_name text; v_who text;
begin
  if not public.has_space_duty(p_space, auth.uid(), 'members') then
    raise exception 'Only admins who steward members can endorse suggestions';
  end if;
  if not exists (
    select 1 from public.space_membership_requests r
    where r.space_id = p_space and r.profile_id = p_profile
      and r.initiated_by <> r.profile_id
  ) then
    raise exception 'No suggestion to endorse';
  end if;
  update public.space_membership_requests
  set initiated_by = auth.uid()
  where space_id = p_space and profile_id = p_profile;
  select name into v_name from public.spaces where id = p_space;
  select full_name into v_who from public.profiles where id = auth.uid();
  perform public.notify(
    p_profile, 'home', p_space, 'space_invite',
    coalesce(v_who, 'An admin') || ' invited you to ' || coalesce(v_name, 'a space'),
    'Accept or decline on the profile page.',
    '/spaces/' || p_space, auth.uid()
  );
end; $$;


ALTER FUNCTION public.endorse_member_suggestion(p_space uuid, p_profile uuid) OWNER TO postgres;

--
-- Name: enforce_parent_consent(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.enforce_parent_consent() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.parent_space_id is not null
     and new.parent_space_id is distinct from old.parent_space_id
     and auth.uid() is not null
     and not exists (
       select 1 from public.space_members m
       where m.space_id = new.parent_space_id and m.profile_id = auth.uid()
         and m.role in ('admin', 'super_admin')
     ) then
    raise exception 'Propose the group to that community — its admins decide';
  end if;
  return new;
end; $$;


ALTER FUNCTION public.enforce_parent_consent() OWNER TO postgres;

--
-- Name: enforce_weaveable(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.enforce_weaveable() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_author uuid; v_noweave text;
begin
  if new.target_type <> 'post' then return new; end if;
  select p.author_id, p.details->>'noWeave' into v_author, v_noweave
    from posts p where p.id = new.target_id;
  if v_author is null then return new; end if;  -- not a post row; nothing to guard
  if v_author <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
     and v_noweave = 'true' then
    raise exception 'They keep this piece out of others'' collections.';
  end if;
  return new;
end $$;


ALTER FUNCTION public.enforce_weaveable() OWNER TO postgres;

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
-- Name: external_calendar_level(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.external_calendar_level(p_cal uuid, p_owner uuid, p_viewer uuid) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v text;
begin
  if p_owner = p_viewer then return 'details'; end if;

  select level into v from public.calendar_shares
   where owner_id = p_owner and external_calendar_id = p_cal
     and audience_type = 'profile' and audience_profile_id = p_viewer;
  if v is not null then return v; end if;

  select level into v
  from public.calendar_shares s
  where s.owner_id = p_owner and s.external_calendar_id = p_cal
    and s.audience_type = 'space'
    and public.is_space_member(s.audience_space_id, p_owner)
    and public.is_space_member(s.audience_space_id, p_viewer)
  order by case s.level when 'details' then 2 when 'busy' then 1 else 0 end desc
  limit 1;
  if v is not null then return v; end if;

  select level into v from public.calendar_shares
   where owner_id = p_owner and external_calendar_id = p_cal and audience_type = 'everyone';
  return v;
end; $$;


ALTER FUNCTION public.external_calendar_level(p_cal uuid, p_owner uuid, p_viewer uuid) OWNER TO postgres;

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
  where start_date <= p_to and (end_date >= p_from or recurrence is not null)
  union all
  select l.owner, lvx.level, b.on_date, b.on_date, b.all_day,
         b.start_min::smallint, b.end_min::smallint, null::jsonb,
         case when lvx.level = 'details' then b.title else null end
  from lv l
  join public.external_busy b on b.profile_id = l.owner
  join public.external_calendars c on c.id = b.calendar_id
  cross join lateral (
    select coalesce(
      public.external_calendar_level(c.id, l.owner, auth.uid()),
      case when l.level = 'hidden' then 'hidden' else 'busy' end
    ) as level
  ) lvx
  where lvx.level <> 'hidden'
    and b.on_date between p_from and p_to;
$$;


ALTER FUNCTION public.free_busy(p_profiles uuid[], p_from date, p_to date) OWNER TO postgres;

--
-- Name: gift_span_text(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.gift_span_text(p_months integer) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select case
    when p_months is null then null
    when p_months % 12 = 0 and p_months = 12 then 'a year'
    when p_months % 12 = 0 then (p_months / 12) || ' years'
    when p_months = 1 then 'a month'
    else p_months || ' months'
  end;
$$;


ALTER FUNCTION public.gift_span_text(p_months integer) OWNER TO postgres;

--
-- Name: gift_subscription(text, text, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.gift_subscription(p_email text, p_tier text, p_months integer DEFAULT NULL::integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_target uuid;
  v_end timestamptz := case when p_months is null then null else now() + make_interval(months => p_months) end;
  v_span text := public.gift_span_text(p_months);
begin
  select is_admin into v_is_admin from public.profiles where id = v_caller;
  if not coalesce(v_is_admin, false) then raise exception 'Not authorized'; end if;
  if p_tier not in ('community','concierge') then raise exception 'Invalid tier'; end if;
  if p_months is not null and p_months <= 0 then raise exception 'Invalid duration'; end if;
  select id into v_target from public.profiles where lower(email) = lower(p_email);
  if v_target is null then raise exception 'No member with that email'; end if;
  insert into public.subscriptions (profile_id, tier, source, status, granted_by, granted_at, current_period_end, updated_at)
  values (v_target, p_tier, 'gift', 'active', v_caller, now(), v_end, now())
  on conflict (profile_id) do update set
    tier = excluded.tier, source = 'gift', status = 'active',
    granted_by = v_caller, granted_at = now(), current_period_end = excluded.current_period_end,
    stripe_customer_id = null, stripe_subscription_id = null, updated_at = now();
  perform public.notify(
    v_target, 'membership', null, 'membership_gifted',
    'You''ve been gifted ' || coalesce(v_span || ' of ', '') || 'Lichen (' || initcap(p_tier) || ')',
    'It''s already active — welcome in.',
    '/membership', v_caller
  );
end;
$$;


ALTER FUNCTION public.gift_subscription(p_email text, p_tier text, p_months integer) OWNER TO postgres;

--
-- Name: grant_growth_gift(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.grant_growth_gift() RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then return false; end if;
  insert into public.subscriptions (profile_id, tier, source, status, current_period_end, granted_at)
  values (uid, 'concierge', 'gift', 'active', now() + interval '3 months', now())
  on conflict (profile_id) do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;


ALTER FUNCTION public.grant_growth_gift() OWNER TO postgres;

--
-- Name: guest_booking(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.guest_booking(p_token text) RETURNS TABLE(guest_name text, status text, on_date date, start_min integer, end_min integer, note text, type_title text, type_location text, duration_min integer, provider_name text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select b.guest_name, b.status, b.on_date, b.start_min, b.end_min, b.note,
         t.title, t.location, t.duration_min,
         coalesce(p.full_name, 'A Lichen member')
  from public.bookings b
  join public.booking_types t on t.id = b.type_id
  join public.profiles p on p.id = b.provider_id
  where b.guest_token = p_token and b.guest_email is not null;
$$;


ALTER FUNCTION public.guest_booking(p_token text) OWNER TO postgres;

--
-- Name: guest_cancel_booking(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.guest_cancel_booking(p_token text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare b record; t record;
begin
  select * into b from public.bookings where guest_token = p_token and guest_email is not null;
  if b is null then return; end if;
  if b.status in ('cancelled', 'declined') then return; end if;
  select * into t from public.booking_types where id = b.type_id;
  if b.event_id is not null then delete from public.events where id = b.event_id; end if;
  update public.bookings set status = 'cancelled', event_id = null where id = b.id;
  perform public.notify(b.provider_id, 'calendar', null, 'booking',
    t.title || ' on ' || to_char(b.on_date, 'FMMon FMDD') || ' was cancelled',
    'Cancelled by ' || coalesce(b.guest_name, 'the guest') || ' (outside Lichen).', '/bookings', null);
end; $$;


ALTER FUNCTION public.guest_cancel_booking(p_token text) OWNER TO postgres;

--
-- Name: guest_create_booking(uuid, date, integer, text, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.guest_create_booking(p_type uuid, p_date date, p_start integer, p_name text, p_email text, p_note text DEFAULT ''::text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare t record; v_end integer; v_id uuid; v_event uuid; v_token text;
        v_weekday int; v_ok boolean;
begin
  select * into t from public.booking_types where id = p_type and active and audience = 'public';
  if t is null then raise exception 'This session isn''t open to the public'; end if;
  if btrim(coalesce(p_name, '')) = '' or p_email !~ '^\S+@\S+\.\S+$' then
    raise exception 'A name and a real email are how the confirmation reaches you';
  end if;
  v_end := p_start + t.duration_min;
  if v_end > 1440 then raise exception 'Slot runs past midnight'; end if;
  if p_date < current_date then raise exception 'That day has passed'; end if;

  v_weekday := extract(isodow from p_date)::int - 1;
  select exists (
    select 1 from public.availability_windows w
    where w.profile_id = t.profile_id and w.kind = 'available'
      and w.weekday = v_weekday
      and w.start_min <= p_start and w.end_min >= v_end
      and (w.valid_from is null or w.valid_from <= p_date)
      and (w.valid_to is null or w.valid_to >= p_date)
  ) into v_ok;
  if not v_ok then raise exception 'That time isn''t offered'; end if;

  if exists (
    select 1 from public.bookings b
    where b.provider_id = t.profile_id and b.on_date = p_date
      and b.status in ('pending', 'confirmed')
      and b.start_min < v_end + t.buffer_min and b.end_min + t.buffer_min > p_start
  ) or exists (
    select 1 from public.events e
    where e.owner_profile_id = t.profile_id and e.recurrence is null
      and p_date between e.start_date and e.end_date
      and (e.all_day or (coalesce(e.start_min, 0) < v_end + t.buffer_min
                         and coalesce(e.end_min, 1440) + t.buffer_min > p_start))
  ) or exists (
    select 1 from public.external_busy x
    where x.profile_id = t.profile_id and x.on_date = p_date
      and (x.all_day or (coalesce(x.start_min, 0) < v_end + t.buffer_min
                         and coalesce(x.end_min, 1440) + t.buffer_min > p_start))
  ) then
    raise exception 'That slot was just taken — pick another';
  end if;

  insert into public.bookings (type_id, provider_id, booker_id, on_date, start_min, end_min,
                               status, note, guest_name, guest_email)
  values (p_type, t.profile_id, null, p_date, p_start, v_end,
          case when t.approval = 'instant' then 'confirmed' else 'pending' end,
          coalesce(p_note, ''), btrim(p_name), lower(btrim(p_email)))
  returning id, guest_token into v_id, v_token;

  if t.approval = 'instant' then
    insert into public.events (creator_id, owner_profile_id, title, description, location,
                               start_date, end_date, all_day, start_min, end_min)
    values (t.profile_id, t.profile_id, t.title || ' — ' || btrim(p_name),
            coalesce(p_note, ''), t.location, p_date, p_date, false, p_start, v_end)
    returning id into v_event;
    update public.bookings set event_id = v_event where id = v_id;
    perform public.notify(t.profile_id, 'calendar', null, 'booking',
      btrim(p_name) || ' booked ' || t.title || ' (from outside Lichen)',
      to_char(p_date, 'FMMon FMDD') || ' — it''s on your calendar.', '/bookings', null);
  else
    perform public.notify(t.profile_id, 'calendar', null, 'booking',
      btrim(p_name) || ' requested ' || t.title || ' (from outside Lichen)',
      to_char(p_date, 'FMMon FMDD') || ' — accept or decline in Bookings.', '/bookings', null);
  end if;
  return v_token;
end; $_$;


ALTER FUNCTION public.guest_create_booking(p_type uuid, p_date date, p_start integer, p_name text, p_email text, p_note text) OWNER TO postgres;

--
-- Name: guest_event(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.guest_event(p_token text) RETURNS TABLE(guest_name text, guest_status text, title text, description text, location text, start_date date, end_date date, all_day boolean, start_min smallint, end_min smallint, recurrence jsonb, host_name text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select g.name, g.status, e.title, e.description, e.location,
         e.start_date, e.end_date, e.all_day, e.start_min, e.end_min, e.recurrence,
         coalesce(sp.name, pr.full_name, 'A member')
  from public.event_guests g
  join public.events e on e.id = g.event_id
  left join public.profiles pr on pr.id = e.owner_profile_id
  left join public.spaces sp on sp.id = e.owner_space_id
  where g.token = p_token;
$$;


ALTER FUNCTION public.guest_event(p_token text) OWNER TO postgres;

--
-- Name: guest_rsvp(text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.guest_rsvp(p_token text, p_status text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if p_status not in ('going', 'tentative', 'declined') then return; end if;
  update public.event_guests set status = p_status where token = p_token;
end $$;


ALTER FUNCTION public.guest_rsvp(p_token text, p_status text) OWNER TO postgres;

--
-- Name: handle_auth_user_deleted(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.handle_auth_user_deleted() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  delete from public.profiles where id = old.id;
  return old;
end $$;


ALTER FUNCTION public.handle_auth_user_deleted() OWNER TO postgres;

--
-- Name: handle_new_category_suggestion(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.handle_new_category_suggestion() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_who text;
  v_admin uuid;
begin
  select full_name into v_who from public.profiles where id = new.proposer_id;
  for v_admin in select id from public.profiles where is_admin loop
    perform public.notify(
      v_admin, 'profile', null, 'category_suggested',
      coalesce(v_who, 'A member') || ' suggests a new category: “' || new.name || '”',
      'Review it under Admin on your Profile.',
      '/admin/categories', new.proposer_id
    );
  end loop;
  return new;
end;
$$;


ALTER FUNCTION public.handle_new_category_suggestion() OWNER TO postgres;

--
-- Name: handle_new_collection_suggestion(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.handle_new_collection_suggestion() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_name text; v_owner uuid; v_space uuid; v_kind text; v_who text; v_cur uuid;
begin
  select c.name, c.owner_id, c.space_id, c.kind
  into v_name, v_owner, v_space, v_kind
  from public.collections c where c.id = new.collection_id;
  select full_name into v_who from public.profiles where id = new.suggested_by;
  for v_cur in
    select distinct p from (
      select v_owner as p
      union
      select m.profile_id from public.space_members m
      where v_space is not null and m.space_id = v_space
        and m.role in ('admin', 'super_admin')
        and public.has_space_duty(v_space, m.profile_id, public.collection_duty(v_kind))
    ) t where t.p is not null and t.p <> new.suggested_by
  loop
    perform public.notify(
      v_cur, 'home', v_space, 'collection_suggestion',
      coalesce(v_who, 'A member') || ' suggests '
        || case when new.post_id is not null then 'a piece for ' else 'a change to ' end
        || coalesce(v_name, 'your collection'),
      'Review it on the collection page.',
      '/collections/' || new.collection_id, new.suggested_by);
  end loop;
  return new;
end; $$;


ALTER FUNCTION public.handle_new_collection_suggestion() OWNER TO postgres;

--
-- Name: handle_new_nesting_request(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.handle_new_nesting_request() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_gname text; v_pname text; v_admin uuid;
begin
  select name into v_gname from public.spaces where id = new.group_id;
  select name into v_pname from public.spaces where id = new.parent_id;
  for v_admin in
    select m.profile_id from public.space_members m
    where m.space_id = new.parent_id and m.role in ('admin', 'super_admin')
  loop
    perform public.notify(
      v_admin, 'home', new.parent_id, 'group_nesting_request',
      'The group ' || coalesce(v_gname, 'a group') || ' proposes to join ' || coalesce(v_pname, 'your community'),
      'Approve or decline on your community''s profile page.',
      '/spaces/' || new.parent_id, new.initiated_by
    );
  end loop;
  return new;
end; $$;


ALTER FUNCTION public.handle_new_nesting_request() OWNER TO postgres;

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
-- Name: handle_new_space_request(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.handle_new_space_request() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_name text; v_who text; v_target text; v_admin uuid;
begin
  select name into v_name from public.spaces where id = new.space_id;
  if new.initiated_by = new.profile_id then
    -- join request → tell the member-stewards
    select full_name into v_who from public.profiles where id = new.profile_id;
    for v_admin in
      select m.profile_id from public.space_members m
      where m.space_id = new.space_id and m.role in ('admin', 'super_admin')
        and public.has_space_duty(new.space_id, m.profile_id, 'members')
    loop
      perform public.notify(
        v_admin, 'home', new.space_id, 'space_join_request',
        coalesce(v_who, 'A member') || ' asked to join ' || coalesce(v_name, 'your space'),
        'Approve or decline on the profile page.',
        '/spaces/' || new.space_id, new.profile_id
      );
    end loop;
    return new;
  end if;

  if public.has_space_duty(new.space_id, new.initiated_by, 'members') then
    -- invite → tell the invitee
    select full_name into v_who from public.profiles where id = new.initiated_by;
    perform public.notify(
      new.profile_id, 'home', new.space_id, 'space_invite',
      coalesce(v_who, 'An admin') || ' invited you to ' || coalesce(v_name, 'a space'),
      'Accept or decline on the profile page.',
      '/spaces/' || new.space_id, new.initiated_by
    );
  else
    -- member suggestion → tell the member-stewards; the suggested person waits
    select full_name into v_who from public.profiles where id = new.initiated_by;
    select full_name into v_target from public.profiles where id = new.profile_id;
    for v_admin in
      select m.profile_id from public.space_members m
      where m.space_id = new.space_id and m.role in ('admin', 'super_admin')
        and public.has_space_duty(new.space_id, m.profile_id, 'members')
    loop
      perform public.notify(
        v_admin, 'home', new.space_id, 'space_member_suggested',
        coalesce(v_who, 'A member') || ' suggests ' || coalesce(v_target, 'someone')
          || ' for ' || coalesce(v_name, 'your space'),
        'Send them an invite (or decline) on the profile page.',
        '/spaces/' || new.space_id, new.initiated_by
      );
    end loop;
  end if;
  return new;
end; $$;


ALTER FUNCTION public.handle_new_space_request() OWNER TO postgres;

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

  -- Claim any invite addressed to this email the moment the account exists —
  -- the old client-side path only fired for people who arrived through the
  -- exact emailed link AND finished onboarding AND weren't admins, which
  -- left real joiners shown as "open" forever. The weave is the invite's
  -- promise, so it happens here too; claim_invite() (token path, for people
  -- who signed up under a different address) no-ops on rows claimed here.
  update public.invite_tokens t
  set claimed_by = new.id, claimed_at = now()
  where t.claimed_by is null
    and lower(t.invitee_email) = lower(new.email)
    and t.created_by <> new.id;

  insert into public.mycelium (truster_id, target_type, target_id)
  select x.created_by, 'profile', new.id
  from public.invite_tokens x
  where x.claimed_by = new.id
  on conflict do nothing;
  insert into public.mycelium (truster_id, target_type, target_id)
  select new.id, 'profile', x.created_by
  from public.invite_tokens x
  where x.claimed_by = new.id
  on conflict do nothing;

  return new;
end;
$$;


ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

--
-- Name: handle_section_shares(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.handle_section_shares() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_sid uuid; v_area text; v_duty text; v_name text; v_who text; v_admin uuid;
  v_areas text[];
begin
  if new.audience_space_ids is null or array_length(new.audience_space_ids, 1) is null then
    return new;
  end if;
  v_areas := array(select unnest(new.service_areas) intersect select unnest(array['courses','library']));
  if array_length(v_areas, 1) is null then
    return new;
  end if;
  foreach v_sid in array new.audience_space_ids loop
    foreach v_area in array v_areas loop
      v_duty := case when v_area = 'courses' then 'courses' else 'library' end;
      -- The space's own voice, or a duty-holder: straight in (approved).
      if new.author_space_id = v_sid or public.has_space_duty(v_sid, new.author_id, v_duty) then
        insert into public.space_section_shares (space_id, post_id, area, status, requested_by, decided_by)
        values (v_sid, new.id, v_area, 'approved', new.author_id, new.author_id)
        on conflict do nothing;
      else
        insert into public.space_section_shares (space_id, post_id, area, status, requested_by)
        values (v_sid, new.id, v_area, 'pending', new.author_id)
        on conflict do nothing;
        -- Bell the stewards.
        select name into v_name from public.spaces where id = v_sid;
        select full_name into v_who from public.profiles where id = new.author_id;
        for v_admin in
          select m.profile_id from public.space_members m
          where m.space_id = v_sid and m.role in ('admin', 'super_admin')
            and public.has_space_duty(v_sid, m.profile_id, v_duty)
        loop
          perform public.notify(
            v_admin, 'home', v_sid, 'section_share_request',
            coalesce(v_who, 'A member') || ' shared a ' ||
              (case when v_area = 'courses' then 'course' else 'library piece' end) ||
              ' with ' || coalesce(v_name, 'your space'),
            'Approve it into the ' || v_area || ' section on the profile page.',
            '/spaces/' || v_sid, new.author_id
          );
        end loop;
      end if;
    end loop;
  end loop;
  return new;
end; $$;


ALTER FUNCTION public.handle_section_shares() OWNER TO postgres;

--
-- Name: has_space_duty(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.has_space_duty(p_space uuid, p_uid uuid, p_duty text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.space_members m
    where m.space_id = p_space and m.profile_id = p_uid
      and (m.role = 'super_admin'
           or (m.role = 'admin' and (m.duties is null or p_duty = any(m.duties))))
  );
$$;


ALTER FUNCTION public.has_space_duty(p_space uuid, p_uid uuid, p_duty text) OWNER TO postgres;

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
-- Name: is_collection_curator(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.is_collection_curator(p_collection uuid, p_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.collections c
    where c.id = p_collection
      and (c.owner_id = p_uid
           or (c.space_id is not null
               and public.has_space_duty(c.space_id, p_uid, public.collection_duty(c.kind))))
  );
$$;


ALTER FUNCTION public.is_collection_curator(p_collection uuid, p_uid uuid) OWNER TO postgres;

--
-- Name: is_entity_steward(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.is_entity_steward(p_entity uuid, p_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_entity
      and p.kind <> 'person'
      and (
        p.steward_profile_id = p_uid
        or (p.steward_space_id is not null and public.is_space_admin(p.steward_space_id, p_uid))
      )
  );
$$;


ALTER FUNCTION public.is_entity_steward(p_entity uuid, p_uid uuid) OWNER TO postgres;

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
-- Name: is_guardian_of(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.is_guardian_of(p_minor uuid, p_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.guardians g
    where g.minor_id = p_minor and g.guardian_id = p_uid
  );
$$;


ALTER FUNCTION public.is_guardian_of(p_minor uuid, p_uid uuid) OWNER TO postgres;

--
-- Name: is_minor(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.is_minor(p_profile uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case
    when p.birth_date is not null then p.birth_date > (current_date - interval '18 years')
    else coalesce(p.is_adult, true) = false
  end
  from public.profiles p where p.id = p_profile;
$$;


ALTER FUNCTION public.is_minor(p_profile uuid) OWNER TO postgres;

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
-- Name: is_on_reminder(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.is_on_reminder(p_reminder uuid, p_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.reminders r where r.id = p_reminder and r.profile_id = p_uid)
      or exists (
        select 1 from public.reminder_recipients rr
        where rr.reminder_id = p_reminder
          and ((rr.recipient_type = 'profile' and rr.recipient_id = p_uid)
            or (rr.recipient_type = 'space' and public.is_space_member(rr.recipient_id, p_uid))));
$$;


ALTER FUNCTION public.is_on_reminder(p_reminder uuid, p_uid uuid) OWNER TO postgres;

--
-- Name: is_resource_steward(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.is_resource_steward(p_resource uuid, p_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.resources r
    where r.id = p_resource
      and (r.owner_profile_id = p_uid
        or (r.space_id is not null and public.is_space_admin(r.space_id, p_uid)))
  );
$$;


ALTER FUNCTION public.is_resource_steward(p_resource uuid, p_uid uuid) OWNER TO postgres;

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
-- Name: keep_donation_for_operations(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.keep_donation_for_operations(p_donation uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare d record;
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only admins can do this.';
  end if;
  select * into d from donations where id = p_donation for update;
  if not found then raise exception 'No such donation.'; end if;
  if d.status <> 'received' then raise exception 'Already resolved.'; end if;
  update donations
     set status = 'operations', translated_at = now(), central_cents = amount_cents
   where id = p_donation;
end $$;


ALTER FUNCTION public.keep_donation_for_operations(p_donation uuid) OWNER TO postgres;

--
-- Name: ledger_balance(text, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ledger_balance(p_type text, p_id uuid) RETURNS numeric
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v numeric;
begin
  if not (
    (p_type = 'profile' and p_id = auth.uid())
    -- the steward reads the being's wallet as if it were their own
    or (p_type = 'profile' and public.is_entity_steward(p_id, auth.uid()))
    or (p_type = 'space' and exists (
          select 1 from space_members m where m.space_id = p_id and m.profile_id = auth.uid()))
    or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
  ) then
    raise exception 'Balances are private to their holders.';
  end if;
  select coalesce(sum(case when to_type = p_type and to_id = p_id then amount else 0 end), 0)
       - coalesce(sum(case when from_type = p_type and from_id = p_id then amount else 0 end), 0)
    into v
    from ledger_entries
   where (to_type = p_type and to_id = p_id) or (from_type = p_type and from_id = p_id);
  return coalesce(v, 0);
end $$;


ALTER FUNCTION public.ledger_balance(p_type text, p_id uuid) OWNER TO postgres;

--
-- Name: ledger_no_rewrite(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ledger_no_rewrite() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  raise exception 'The ledger is append-only — record an adjustment entry instead.';
end $$;


ALTER FUNCTION public.ledger_no_rewrite() OWNER TO postgres;

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
  order by case s.level
    when 'hidden' then 0 when 'state' then 1 when 'county' then 2
    when 'area' then 3 else 4 end asc
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
         case lv.level
           when 'exact'  then p.home_lat
           when 'area'   then round((p.home_lat / 0.05)::numeric) * 0.05
           when 'county' then round((p.home_lat / 0.25)::numeric) * 0.25
           else null end as lat,
         case lv.level
           when 'exact'  then p.home_lng
           when 'area'   then round((p.home_lng / 0.05)::numeric) * 0.05
           when 'county' then round((p.home_lng / 0.25)::numeric) * 0.25
           else null end as lng,
         case lv.level
           when 'exact'  then p.home_location
           when 'area'   then p.home_area
           when 'county' then coalesce(p.home_county, p.home_state)
           else p.home_state end as place
  from public.profiles p
  cross join lateral (select public.location_level(p.id, auth.uid()) as level) lv
  where p.home_lat is not null and p.home_lng is not null
    and lv.level <> 'hidden';
$$;


ALTER FUNCTION public.mappable_members() OWNER TO postgres;

--
-- Name: mark_chat_read(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.mark_chat_read(p_chat uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update public.chat_members set last_read_at = now()
    where chat_id = p_chat and profile_id = auth.uid();
  if not found then return; end if;   -- not a member: touch nothing
  update public.notifications set read_at = now()
    where recipient_id = auth.uid() and section = 'chat'
      and link = '/chat/' || p_chat and read_at is null;
end;
$$;


ALTER FUNCTION public.mark_chat_read(p_chat uuid) OWNER TO postgres;

--
-- Name: mark_invite_opened(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.mark_invite_opened(p_token uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  update public.invite_tokens
  set opened_at = coalesce(opened_at, now())
  where token = p_token;
$$;


ALTER FUNCTION public.mark_invite_opened(p_token uuid) OWNER TO postgres;

--
-- Name: match_marketplace_post(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.match_marketplace_post() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_mode text;
  v_words text[];
  r record;
begin
  if not (new.service_areas @> array['marketplace']) or not new.is_public then
    return new;
  end if;
  v_mode := coalesce(new.details->>'mode', '');
  v_words := tsvector_to_array(
    to_tsvector('english', coalesce(new.title, '') || ' ' || coalesce(new.body, '')));
  if coalesce(array_length(v_words, 1), 0) < 2 then return new; end if;

  if v_mode = 'iso' then
    for r in
      select p.author_id, p.details->>'mode' as mode
        from posts p
       where p.service_areas @> array['marketplace']
         and p.is_public
         and coalesce(p.details->>'mode', '') not in ('', 'iso')
         and p.author_id <> new.author_id
         and p.created_at > now() - interval '90 days'
      and not exists (select 1 from public.exchanges x
                       where x.post_id = p.id and x.status in ('accepted', 'completed'))
         and (select count(*)
                from unnest(tsvector_to_array(
                       to_tsvector('english', coalesce(p.title,'') || ' ' || coalesce(p.body,'')))) w
               where w = any(v_words)) >= 2
       order by p.created_at desc
       limit 5
    loop
      perform public.notify(r.author_id, 'home', null, 'iso_match',
        'Someone is in search of what you''re offering',
        left(coalesce(nullif(new.title, ''), new.body), 140),
        '/posts/' || new.id, new.author_id);
    end loop;
  elsif v_mode <> '' then
    for r in
      select p.author_id
        from posts p
       where p.service_areas @> array['marketplace']
         and p.is_public
         and p.details->>'mode' = 'iso'
         and p.author_id <> new.author_id
         and p.created_at > now() - interval '90 days'
      and not exists (select 1 from public.exchanges x
                       where x.post_id = p.id and x.status in ('accepted', 'completed'))
         and (select count(*)
                from unnest(tsvector_to_array(
                       to_tsvector('english', coalesce(p.title,'') || ' ' || coalesce(p.body,'')))) w
               where w = any(v_words)) >= 2
       order by p.created_at desc
       limit 5
    loop
      perform public.notify(r.author_id, 'home', null, 'iso_match',
        case when v_mode = 'gift' then 'A gift matches what you''re seeking'
             else 'An offer matches what you''re seeking' end,
        left(coalesce(nullif(new.title, ''), new.body), 140),
        '/posts/' || new.id, new.author_id);
    end loop;
  end if;
  return new;
end $$;


ALTER FUNCTION public.match_marketplace_post() OWNER TO postgres;

--
-- Name: mint_currentcy(text, uuid, numeric, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.mint_currentcy(p_to_type text, p_to_id uuid, p_amount numeric, p_memo text DEFAULT ''::text, p_context text DEFAULT 'grant'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_id uuid; v_amt numeric;
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only admins can mint Current.';
  end if;
  v_amt := round(coalesce(p_amount, 0), 2);
  if v_amt <= 0 then raise exception 'Amount must be positive.'; end if;
  if p_context not in ('mint', 'grant', 'gift', 'adjustment') then
    raise exception 'Context must be mint, grant, gift, or adjustment.';
  end if;
  if p_to_type = 'profile' then
    if not exists (select 1 from profiles where id = p_to_id) then raise exception 'No such member.'; end if;
  elsif p_to_type = 'space' then
    if not exists (select 1 from spaces where id = p_to_id) then raise exception 'No such group.'; end if;
  else
    raise exception 'Unknown recipient kind.';
  end if;

  insert into ledger_entries (from_type, from_id, to_type, to_id, amount, context, memo, created_by)
  values (null, null, p_to_type, p_to_id, v_amt, p_context, coalesce(p_memo, ''), auth.uid())
  returning id into v_id;

  if p_to_type = 'profile' then
    perform public.notify(p_to_id, 'home', null, 'currentcy',
      'Lichen granted you ' || trim(to_char(v_amt, 'FM999999990.##')) || ' Current',
      nullif(coalesce(p_memo, ''), ''), '/profile', auth.uid());
  end if;
  return v_id;
end $$;


ALTER FUNCTION public.mint_currentcy(p_to_type text, p_to_id uuid, p_amount numeric, p_memo text, p_context text) OWNER TO postgres;

--
-- Name: my_age(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.my_age() RETURNS TABLE(birth_date date, is_adult boolean, declared_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select p.birth_date, p.is_adult, p.age_declared_at
  from public.profiles p where p.id = auth.uid();
$$;


ALTER FUNCTION public.my_age() OWNER TO postgres;

--
-- Name: my_guardians(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.my_guardians() RETURNS TABLE(id uuid, full_name text, avatar_url text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select p.id, p.full_name, p.avatar_url
  from public.guardians g join public.profiles p on p.id = g.guardian_id
  where g.minor_id = auth.uid()
  order by p.full_name;
$$;


ALTER FUNCTION public.my_guardians() OWNER TO postgres;

--
-- Name: my_home(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.my_home() RETURNS TABLE(home_location text, home_lat double precision, home_lng double precision, home_area text, home_county text, home_state text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ select home_location, home_lat, home_lng, home_area, home_county, home_state
   from public.profiles where id = auth.uid() $$;


ALTER FUNCTION public.my_home() OWNER TO postgres;

--
-- Name: my_minors(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.my_minors() RETURNS TABLE(id uuid, full_name text, avatar_url text, is_adult boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select p.id, p.full_name, p.avatar_url, p.is_adult
  from public.guardians g join public.profiles p on p.id = g.minor_id
  where g.guardian_id = auth.uid()
  order by p.full_name;
$$;


ALTER FUNCTION public.my_minors() OWNER TO postgres;

--
-- Name: my_phone(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.my_phone() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ select phone from public.profiles where id = auth.uid() $$;


ALTER FUNCTION public.my_phone() OWNER TO postgres;

--
-- Name: network_available_list(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.network_available_list() RETURNS TABLE(id uuid, full_name text, avatar_url text, headline text, local_date date, local_min smallint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with local_now as (
    select p.id,
           (now() at time zone coalesce(nullif(p.timezone, ''), 'UTC')) as lt
    from public.profiles p
  )
  -- local_date / local_min come back so the client can subtract what's booked
  -- in the MEMBER's own frame rather than the viewer's — 2pm busy means 2pm
  -- where they are. It leaks nothing their being in-hours doesn't already imply.
  select distinct p.id, p.full_name, p.avatar_url, p.headline,
         ln.lt::date as local_date,
         (extract(hour from ln.lt) * 60 + extract(minute from ln.lt))::smallint as local_min
  from public.profiles p
  join local_now ln on ln.id = p.id
  join public.availability_windows w on w.profile_id = p.id
  where p.id <> auth.uid()
    and w.kind = 'social'
    and extract(dow from ln.lt)::smallint = w.weekday
    and (extract(hour from ln.lt) * 60 + extract(minute from ln.lt))
          between w.start_min and w.end_min
    and (w.valid_from is null or ln.lt::date >= w.valid_from)
    and (w.valid_to   is null or ln.lt::date <= w.valid_to)
    -- Their calendar has to be visible to you at all.
    and public.calendar_level(p.id, auth.uid()) <> 'hidden'
    -- Present outranks available; never count someone twice.
    and not ((p.presence_always_present or p.presence_lit_until > now())
             and p.last_seen_at > now() - interval '5 minutes')
    -- The same web as presence: your mycelium, plus people you share a space with.
    and (
      p.id in (select m.target_id from public.mycelium m
               where m.truster_id = auth.uid() and m.target_type = 'profile')
      or p.id in (select m2.profile_id
                  from public.space_members m1
                  join public.space_members m2 on m2.space_id = m1.space_id
                  where m1.profile_id = auth.uid())
    )
  order by p.full_name;
$$;


ALTER FUNCTION public.network_available_list() OWNER TO postgres;

--
-- Name: network_present_count(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.network_present_count() RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select count(distinct p.id)::int
  from public.profiles p
  where p.id <> auth.uid()
    and (p.presence_always_present or p.presence_lit_until > now())
    and p.last_seen_at > now() - interval '5 minutes'
    and (
      p.id in (select m.target_id from public.mycelium m
               where m.truster_id = auth.uid() and m.target_type = 'profile')
      or p.id in (select m2.profile_id
                  from public.space_members m1
                  join public.space_members m2 on m2.space_id = m1.space_id
                  where m1.profile_id = auth.uid())
    );
$$;


ALTER FUNCTION public.network_present_count() OWNER TO postgres;

--
-- Name: network_present_list(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.network_present_list() RETURNS TABLE(id uuid, full_name text, avatar_url text, headline text, lit boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select distinct p.id, p.full_name, p.avatar_url, p.headline, true as lit
  from public.profiles p
  where p.id <> auth.uid()
    and (p.presence_always_present or p.presence_lit_until > now())
    and p.last_seen_at > now() - interval '5 minutes'
    and (
      p.id in (select m.target_id from public.mycelium m
               where m.truster_id = auth.uid() and m.target_type = 'profile')
      or p.id in (select m2.profile_id
                  from public.space_members m1
                  join public.space_members m2 on m2.space_id = m1.space_id
                  where m1.profile_id = auth.uid())
    )
  order by p.full_name;
$$;


ALTER FUNCTION public.network_present_list() OWNER TO postgres;

--
-- Name: notice_gift_ending(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.notice_gift_ending() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  s record;
begin
  if v_uid is null then return 0; end if;
  select * into s from public.subscriptions
    where profile_id = v_uid and source = 'gift' and status = 'active'
      and current_period_end is not null
      and current_period_end > now()
      and current_period_end <= now() + interval '14 days';
  if s.profile_id is null then return 0; end if;
  if exists (
    select 1 from public.notifications
    where recipient_id = v_uid and type = 'membership_ending'
      and created_at > s.current_period_end - interval '14 days'
  ) then return 0; end if;
  perform public.notify(
    v_uid, 'membership', null, 'membership_ending',
    'Your gifted membership ends ' || to_char(s.current_period_end, 'FMMonth FMDD'),
    'Choose a plan to keep your access uninterrupted.',
    '/membership', null
  );
  return 1;
end;
$$;


ALTER FUNCTION public.notice_gift_ending() OWNER TO postgres;

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
-- Name: notify_reminder(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.notify_reminder(p_reminder uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare r record;
begin
  select * into r from reminders where id = p_reminder;
  if not found or r.profile_id <> auth.uid() then return; end if;
  perform public.notify(t.pid, 'calendar', null, 'reminder_shared',
    'Reminder: ' || r.title, null, '/calendar', auth.uid())
  from (
    select rr.recipient_id as pid from reminder_recipients rr
      where rr.reminder_id = p_reminder and rr.recipient_type = 'profile'
    union
    select m.profile_id from reminder_recipients rr
      join space_members m on m.space_id = rr.recipient_id
      where rr.reminder_id = p_reminder and rr.recipient_type = 'space'
  ) t
  where t.pid <> auth.uid();
end
$$;


ALTER FUNCTION public.notify_reminder(p_reminder uuid) OWNER TO postgres;

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
-- Name: owns_reminder(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.owns_reminder(p_reminder uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.reminders where id = p_reminder and profile_id = auth.uid());
$$;


ALTER FUNCTION public.owns_reminder(p_reminder uuid) OWNER TO postgres;

--
-- Name: post_claimed(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.post_claimed(p_post uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.exchanges x
    where x.post_id = p_post and x.status in ('accepted', 'completed')
  );
$$;


ALTER FUNCTION public.post_claimed(p_post uuid) OWNER TO postgres;

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
-- Name: public_booking_board(uuid, date, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.public_booking_board(p_type uuid, p_from date, p_to date) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'type', jsonb_build_object(
      'id', t.id, 'provider_id', t.profile_id, 'title', t.title,
      'description', t.description, 'duration_min', t.duration_min,
      'buffer_min', t.buffer_min, 'price', t.price, 'location', t.location,
      'approval', t.approval),
    'windows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'weekday', w.weekday, 'start_min', w.start_min, 'end_min', w.end_min,
        'valid_from', w.valid_from, 'valid_to', w.valid_to))
      from public.availability_windows w
      where w.profile_id = t.profile_id and w.kind = 'available'), '[]'::jsonb),
    'busy', coalesce((
      select jsonb_agg(x) from (
        select e.start_date, e.end_date, e.all_day, e.start_min, e.end_min, e.recurrence
        from public.events e
        where (e.owner_profile_id = t.profile_id
               or exists (select 1 from public.event_attendees a
                          where a.event_id = e.id and a.profile_id = t.profile_id and a.status <> 'declined'))
          and e.start_date <= p_to and (e.end_date >= p_from or e.recurrence is not null)
        union all
        select b.on_date, b.on_date, false, b.start_min, b.end_min, null::jsonb
        from public.bookings b
        where b.provider_id = t.profile_id and b.status in ('pending', 'confirmed')
          and b.on_date between p_from and p_to
        union all
        select xb.on_date, xb.on_date, xb.all_day, xb.start_min, xb.end_min, null::jsonb
        from public.external_busy xb
        where xb.profile_id = t.profile_id and xb.on_date between p_from and p_to
      ) x), '[]'::jsonb))
  from public.booking_types t
  where t.id = p_type and t.active and t.audience = 'public';
$$;


ALTER FUNCTION public.public_booking_board(p_type uuid, p_from date, p_to date) OWNER TO postgres;

--
-- Name: public_booking_page(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.public_booking_page(p_handle text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'provider', jsonb_build_object(
      'id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url,
      'headline', p.headline, 'timezone', p.timezone),
    'types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'description', t.description,
        'duration_min', t.duration_min, 'buffer_min', t.buffer_min,
        'price', t.price, 'location', t.location, 'approval', t.approval)
        order by t.created_at)
      from public.booking_types t
      where t.profile_id = p.id and t.active and t.audience = 'public'), '[]'::jsonb))
  from public.profiles p
  where lower(p.handle) = lower(p_handle)
    and exists (select 1 from public.booking_types t
                where t.profile_id = p.id and t.active and t.audience = 'public');
$$;


ALTER FUNCTION public.public_booking_page(p_handle text) OWNER TO postgres;

--
-- Name: push_on_notification(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.push_on_notification() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_secret text;
begin
  if not exists (select 1 from public.push_subscriptions where profile_id = new.recipient_id) then
    return new;
  end if;
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'push_hook_secret';
    perform net.http_post(
      url := 'https://mjqnaevertyzgjlpwynr.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', coalesce(v_secret, '')),
      body := jsonb_build_object(
        'type', 'INSERT',
        'record', jsonb_build_object(
          'recipient_id', new.recipient_id, 'type', new.type,
          'title', new.title, 'body', new.body, 'link', new.link
        )
      )
    );
  exception when others then
    null;  -- a push hiccup must NEVER block the in-app bell
  end;
  return new;
end $$;


ALTER FUNCTION public.push_on_notification() OWNER TO postgres;

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
-- Name: request_exchange(uuid, text, text, text, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.request_exchange(p_post uuid, p_mode text DEFAULT NULL::text, p_fulfillment text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_as_space uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_post public.posts%rowtype;
  v_mode text; v_amount numeric(12,2); v_id uuid;
  v_minor boolean; v_who text;
begin
  select * into v_post from public.posts where id = p_post;
  if v_post.id is null then raise exception 'That listing is gone.'; end if;
  if not (v_post.service_areas @> array['marketplace']) then
    raise exception 'That isn''t a marketplace listing.';
  end if;

  if p_as_space is not null then
    if not public.is_space_admin(p_as_space, auth.uid()) then
      raise exception 'Only that group''s admins can buy on its behalf.';
    end if;
    if v_post.author_space_id = p_as_space then
      raise exception 'That''s this group''s own listing.';
    end if;
  elsif v_post.author_id = auth.uid() then
    raise exception 'That''s your own listing.';
  end if;

  if public.post_claimed(p_post) then
    raise exception 'Someone already claimed this one.';
  end if;
  -- One live ask per PARTY: yours as yourself, and one per space you steward.
  if exists (select 1 from public.exchanges x
              where x.post_id = p_post and x.status = 'pending'
                and ((p_as_space is null and x.buyer_id = auth.uid() and x.buyer_space_id is null)
                  or (p_as_space is not null and x.buyer_space_id = p_as_space))) then
    raise exception 'You''ve already asked for this — it''s waiting on them.';
  end if;

  -- Freeze the terms as they stand right now. The FIRST number in the price
  -- text, not every digit mashed together — the old strip-non-numerics turned
  -- "sliding $10–$25" into 1025 Current. A range freezes at its low end; the
  -- seller can always decline and name a figure in chat.
  v_mode := coalesce(nullif(p_mode, ''), v_post.details->>'mode', 'gift');
  v_amount := coalesce(
    nullif(substring(coalesce(v_post.details->>'price', '') from '[0-9]+\.?[0-9]*'), '')::numeric,
    0);
  -- Only priced modes carry money; a gift is a gift.
  if v_mode not in ('sale', 'sliding', 'rent') then v_amount := 0; end if;

  -- A treasury purchase is admin-gated, not guardian-gated — but a minor
  -- SELLER still gets a grown-up's yes before anything changes hands.
  v_minor := (p_as_space is null and public.is_minor(auth.uid()))
             or public.is_minor(v_post.author_id);

  insert into public.exchanges (post_id, seller_id, seller_space_id,
                                buyer_id, buyer_space_id,
                                mode, amount, fulfillment, note, needs_guardian)
  values (p_post, v_post.author_id, v_post.author_space_id,
          auth.uid(), p_as_space,
          v_mode, v_amount, nullif(p_fulfillment, ''), nullif(p_note, ''), v_minor)
  returning id into v_id;

  if p_as_space is not null then
    select name into v_who from public.spaces where id = p_as_space;
    v_who := coalesce(v_who, 'A group');
  else
    select coalesce(full_name, 'Someone') into v_who from public.profiles where id = auth.uid();
  end if;
  perform public.notify(
    v_post.author_id, 'market', null, 'exchange_request',
    v_who || ' would like your ' || coalesce(v_post.title, 'listing'),
    coalesce(p_note, 'Open it to say yes or not now.'),
    '/posts/' || p_post, auth.uid());

  -- And the grown-ups who hold either party.
  perform public.notify(g.guardian_id, 'market', null, 'exchange_guardian',
    v_who || ' started an exchange that needs your yes',
    coalesce(v_post.title, 'A marketplace listing'),
    '/profile#holding', auth.uid())
  from public.guardians g
  where v_minor and g.minor_id in (auth.uid(), v_post.author_id);

  return v_id;
end $_$;


ALTER FUNCTION public.request_exchange(p_post uuid, p_mode text, p_fulfillment text, p_note text, p_as_space uuid) OWNER TO postgres;

--
-- Name: request_resource_booking(uuid, date, date, integer, integer, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.request_resource_booking(p_resource uuid, p_start date, p_end date, p_start_min integer DEFAULT NULL::integer, p_end_min integer DEFAULT NULL::integer, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_res public.resources%rowtype;
  v_id uuid; v_event uuid; v_who text; v_steward uuid;
begin
  select * into v_res from public.resources where id = p_resource;
  if v_res.id is null or not v_res.bookable then
    raise exception 'This isn''t bookable';
  end if;
  if p_end < p_start then raise exception 'Backwards dates'; end if;
  -- Overlap check: confirmed bookings and any calendar block on the resource.
  if exists (
    select 1 from public.resource_bookings b
    where b.resource_id = p_resource and b.status = 'confirmed'
      and b.start_date <= p_end and b.end_date >= p_start
  ) or exists (
    select 1 from public.events e
    where e.owner_resource_id = p_resource
      and e.start_date <= p_end and e.end_date >= p_start
  ) then
    raise exception 'Those dates are already taken';
  end if;

  insert into public.resource_bookings
    (resource_id, requester_id, start_date, end_date, start_min, end_min, note)
  values (p_resource, auth.uid(), p_start, p_end, p_start_min, p_end_min, p_note)
  returning id into v_id;

  if v_res.approval = 'instant' then
    perform public.confirm_resource_booking_inner(v_id, auth.uid());
  else
    select full_name into v_who from public.profiles where id = auth.uid();
    for v_steward in
      select distinct s.profile_id from (
        select r.owner_profile_id as profile_id from public.resources r
          where r.id = p_resource and r.owner_profile_id is not null
        union
        select m.profile_id from public.resources r
          join public.space_members m on m.space_id = r.space_id
          where r.id = p_resource and m.role in ('admin', 'super_admin')
      ) s
    loop
      perform public.notify(
        v_steward, 'calendar', (select space_id from public.resources where id = p_resource),
        'resource_booking_request',
        coalesce(v_who, 'A member') || ' asked to book ' || v_res.name,
        p_start::text || case when p_end > p_start then ' ‚Äì ' || p_end::text else '' end
          || coalesce(' ¬∑ ' || p_note, ''),
        case when v_res.space_id is not null
          then '/spaces/' || v_res.space_id || '?manage=1' else '/bookings' end,
        auth.uid());
    end loop;
  end if;
  return v_id;
end; $$;


ALTER FUNCTION public.request_resource_booking(p_resource uuid, p_start date, p_end date, p_start_min integer, p_end_min integer, p_note text) OWNER TO postgres;

--
-- Name: resolve_category(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.resolve_category(p_word text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(
    (select c.id from public.categories c where c.id = lower(btrim(p_word))),
    (select c.id from public.categories c where lower(c.name) = lower(btrim(p_word))),
    (select a.category_id from public.category_aliases a where a.alias = lower(btrim(p_word)))
  );
$$;


ALTER FUNCTION public.resolve_category(p_word text) OWNER TO postgres;

--
-- Name: resolve_collection_suggestion(uuid, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.resolve_collection_suggestion(p_id uuid, p_accept boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_sugg public.collection_suggestions; v_name text; v_pos int;
begin
  select * into v_sugg from public.collection_suggestions
  where id = p_id and status = 'pending';
  if v_sugg.id is null then
    raise exception 'No pending suggestion';
  end if;
  if not public.is_collection_curator(v_sugg.collection_id, auth.uid()) then
    raise exception 'Only the collection''s organizers can decide this';
  end if;
  if p_accept and v_sugg.post_id is not null then
    select coalesce(max(position) + 1, 0) into v_pos
    from public.collection_items where collection_id = v_sugg.collection_id;
    insert into public.collection_items (collection_id, target_type, target_id, position)
    values (v_sugg.collection_id, 'post', v_sugg.post_id, v_pos)
    on conflict do nothing;
  end if;
  update public.collection_suggestions
  set status = case when p_accept then 'accepted' else 'declined' end
  where id = p_id;
  -- Tell the suggester on accept; declines stay quiet.
  if p_accept then
    select name into v_name from public.collections where id = v_sugg.collection_id;
    perform public.notify(
      v_sugg.suggested_by, 'home', null, 'collection_suggestion_accepted',
      'Your suggestion was added to ' || coalesce(v_name, 'the collection'),
      case when v_sugg.post_id is not null
        then 'The piece you suggested is now part of it.'
        else 'The organizers took your note on board.' end,
      '/collections/' || v_sugg.collection_id, auth.uid());
  end if;
end; $$;


ALTER FUNCTION public.resolve_collection_suggestion(p_id uuid, p_accept boolean) OWNER TO postgres;

--
-- Name: resource_busy(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.resource_busy(p_resource uuid) RETURNS TABLE(start_date date, end_date date, start_min integer, end_min integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select e.start_date, e.end_date, e.start_min, e.end_min
  from public.events e
  where e.owner_resource_id = p_resource
    and e.end_date >= current_date - 1
  order by e.start_date;
$$;


ALTER FUNCTION public.resource_busy(p_resource uuid) OWNER TO postgres;

--
-- Name: resource_span_contact(uuid, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.resource_span_contact(p_resource uuid, p_date date) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select b.requester_id from public.resource_bookings b
  where b.resource_id = p_resource and b.status = 'confirmed'
    and b.start_date <= p_date and b.end_date >= p_date
  order by b.created_at limit 1;
$$;


ALTER FUNCTION public.resource_span_contact(p_resource uuid, p_date date) OWNER TO postgres;

--
-- Name: respond_booking(uuid, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.respond_booking(p_booking uuid, p_accept boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare b record; t record; v_event uuid; v_booker_name text;
begin
  select * into b from public.bookings where id = p_booking;
  if b is null or b.provider_id <> auth.uid() then raise exception 'Not yours to answer'; end if;
  if b.status <> 'pending' then raise exception 'Already answered'; end if;
  select * into t from public.booking_types where id = b.type_id;
  if p_accept then
    select coalesce(
      (select full_name from public.profiles where id = b.booker_id),
      b.guest_name) into v_booker_name;
    insert into public.events (creator_id, owner_profile_id, title, description, location,
                               start_date, end_date, all_day, start_min, end_min)
    values (b.provider_id, b.provider_id, t.title || ' — ' || coalesce(v_booker_name, 'a member'),
            b.note, t.location, b.on_date, b.on_date, false, b.start_min, b.end_min)
    returning id into v_event;
    if b.booker_id is not null then
      insert into public.event_attendees (event_id, profile_id, status, invited_by)
      values (v_event, b.booker_id, 'going', b.provider_id);
    end if;
    update public.bookings set status = 'confirmed', event_id = v_event where id = p_booking;
    if b.booker_id is not null then
      perform public.notify(b.booker_id, 'calendar', null, 'booking',
        t.title || ' is confirmed',
        to_char(b.on_date, 'FMMon FMDD') || ' — it''s on your calendar.', '/bookings', auth.uid());
    end if;
  else
    update public.bookings set status = 'declined' where id = p_booking;
    if b.booker_id is not null then
      perform public.notify(b.booker_id, 'calendar', null, 'booking',
        t.title || ' — this time didn''t work',
        'Pick another slot whenever you like.', '/bookings', auth.uid());
    end if;
  end if;
end; $$;


ALTER FUNCTION public.respond_booking(p_booking uuid, p_accept boolean) OWNER TO postgres;

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
-- Name: send_currentcy(text, uuid, text, uuid, numeric, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.send_currentcy(p_from_type text, p_from_id uuid, p_to_type text, p_to_id uuid, p_amount numeric, p_memo text DEFAULT ''::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_id uuid; v_bal numeric; v_sender text; v_amt numeric; v_space text; v_admin record;
begin
  v_amt := round(coalesce(p_amount, 0), 2);
  if v_amt <= 0 then raise exception 'Amount must be positive.'; end if;

  if p_from_type = 'profile' then
    if public.is_minor(auth.uid()) then raise exception 'A guardian sends on your behalf — ask a grown-up who holds your account.'; end if;
  if p_from_id <> auth.uid() and not public.is_entity_steward(p_from_id, auth.uid()) then raise exception 'You can only send from yourself, or from a being you steward.'; end if;
  elsif p_from_type = 'space' then
    if not exists (select 1 from space_members m
                    where m.space_id = p_from_id and m.profile_id = auth.uid()
                      and m.role in ('admin', 'super_admin')) then
      raise exception 'Only that group''s admins can send from it.';
    end if;
  else
    raise exception 'Unknown sender kind.';
  end if;

  if p_to_type = 'profile' then
    if not exists (select 1 from profiles where id = p_to_id) then raise exception 'No such member.'; end if;
  elsif p_to_type = 'space' then
    if not exists (select 1 from spaces where id = p_to_id) then raise exception 'No such group.'; end if;
  else
    raise exception 'Unknown recipient kind.';
  end if;
  if p_from_type = p_to_type and p_from_id = p_to_id then
    raise exception 'Sender and recipient are the same.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_from_type || ':' || p_from_id::text, 42));

  select coalesce(sum(case when to_type = p_from_type and to_id = p_from_id then amount else 0 end), 0)
       - coalesce(sum(case when from_type = p_from_type and from_id = p_from_id then amount else 0 end), 0)
    into v_bal
    from ledger_entries
   where (to_type = p_from_type and to_id = p_from_id)
      or (from_type = p_from_type and from_id = p_from_id);
  if v_bal < v_amt then
    raise exception 'Not enough Current — this account holds %.', trim(to_char(v_bal, 'FM999999990.##'));
  end if;

  insert into ledger_entries (from_type, from_id, to_type, to_id, amount, context, memo, created_by)
  values (p_from_type, p_from_id, p_to_type, p_to_id, v_amt, 'exchange', coalesce(p_memo, ''), auth.uid())
  returning id into v_id;

  -- The sender's name reads as whoever the money actually came FROM: the
  -- space when a treasury paid, the human otherwise.
  if p_from_type = 'space' then
    select name into v_sender from spaces where id = p_from_id;
  else
    select coalesce(full_name, 'A member') into v_sender from profiles where id = auth.uid();
  end if;

  if p_to_type = 'profile' then
    perform public.notify(p_to_id, 'home', null, 'currentcy',
      v_sender || ' sent you ' || trim(to_char(v_amt, 'FM999999990.##')) || ' Current',
      nullif(coalesce(p_memo, ''), ''), '/profile', auth.uid());
  else
    -- A space's money is stewarded, not owned — every admin hears, and the
    -- bell opens the backstage where the space's Current-cy card lives.
    select name into v_space from spaces where id = p_to_id;
    for v_admin in
      select m.profile_id from space_members m
       where m.space_id = p_to_id and m.role in ('admin', 'super_admin')
         and m.profile_id <> auth.uid()
    loop
      perform public.notify(v_admin.profile_id, 'home', p_to_id, 'currentcy',
        v_sender || ' sent ' || coalesce(v_space, 'your group') || ' '
          || trim(to_char(v_amt, 'FM999999990.##')) || ' Current',
        nullif(coalesce(p_memo, ''), ''),
        '/spaces/' || p_to_id::text || '?manage=1', auth.uid());
    end loop;
  end if;
  return v_id;
end $$;


ALTER FUNCTION public.send_currentcy(p_from_type text, p_from_id uuid, p_to_type text, p_to_id uuid, p_amount numeric, p_memo text) OWNER TO postgres;

--
-- Name: set_member_role(uuid, uuid, text, text[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_member_role(p_space uuid, p_profile uuid, p_role text, p_duties text[] DEFAULT NULL::text[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_name text; v_line text;
begin
  if not exists (
    select 1 from public.space_members m
    where m.space_id = p_space and m.profile_id = auth.uid() and m.role = 'super_admin'
  ) then
    raise exception 'Only the super admin can change roles';
  end if;
  if p_profile = auth.uid() then
    raise exception 'You already run this space';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception 'Role must be admin or member';
  end if;
  if not exists (
    select 1 from public.space_members m
    where m.space_id = p_space and m.profile_id = p_profile and m.role <> 'super_admin'
  ) then
    raise exception 'Not a member of this space';
  end if;
  update public.space_members
  set role = p_role::public.space_member_role,
      duties = case when p_role = 'admin' then p_duties else null end
  where space_id = p_space and profile_id = p_profile;
  -- Bell on the grant; demotion stays silent (no shame bells).
  if p_role = 'admin' then
    select name into v_name from public.spaces where id = p_space;
    v_line := case when p_duties is null
      then 'You steward everything admins can.'
      else 'You steward: ' || array_to_string(p_duties, ', ') || '.' end;
    perform public.notify(
      p_profile, 'home', p_space, 'space_role',
      'You''re now an admin of ' || coalesce(v_name, 'a space'),
      v_line, '/spaces/' || p_space, auth.uid());
  end if;
end; $$;


ALTER FUNCTION public.set_member_role(p_space uuid, p_profile uuid, p_role text, p_duties text[]) OWNER TO postgres;

--
-- Name: set_space_public_page_default(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_space_public_page_default() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.public_page is null then
    new.public_page := (new.kind in ('organization', 'place'));
  end if;
  return new;
end;
$$;


ALTER FUNCTION public.set_space_public_page_default() OWNER TO postgres;

--
-- Name: space_present_count(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.space_present_count(p_space uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case
    when not exists (
      select 1 from public.space_members me
      where me.space_id = p_space and me.profile_id = auth.uid()
    ) then 0
    else (
      select count(distinct p.id)::int
      from public.profiles p
      join public.space_members m on m.profile_id = p.id and m.space_id = p_space
      where (p.presence_always_present or p.presence_lit_until > now())
        and p.last_seen_at > now() - interval '5 minutes'
    )
  end;
$$;


ALTER FUNCTION public.space_present_count(p_space uuid) OWNER TO postgres;

--
-- Name: space_present_list(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.space_present_list(p_space uuid) RETURNS TABLE(id uuid, full_name text, avatar_url text, headline text, lit boolean, me boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select distinct p.id, p.full_name, p.avatar_url, p.headline,
         true as lit,
         (p.id = auth.uid()) as me
  from public.profiles p
  join public.space_members m on m.profile_id = p.id and m.space_id = p_space
  where (p.presence_always_present or p.presence_lit_until > now())
    and p.last_seen_at > now() - interval '5 minutes'
    and exists (
      select 1 from public.space_members me2
      where me2.space_id = p_space and me2.profile_id = auth.uid()
    )
  order by p.full_name;
$$;


ALTER FUNCTION public.space_present_list(p_space uuid) OWNER TO postgres;

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
-- Name: sync_is_adult(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sync_is_adult() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.birth_date is not null then
    new.is_adult := (new.birth_date <= (current_date - interval '18 years'));
  end if;
  return new;
end $$;


ALTER FUNCTION public.sync_is_adult() OWNER TO postgres;

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
-- Name: task_level(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.task_level(p_owner uuid, p_viewer uuid) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v text;
begin
  if p_viewer is null then return 'hidden'; end if;
  if p_owner = p_viewer then return 'see'; end if;

  -- 1. An explicit person rule wins outright.
  select s.level into v from public.task_shares s
   where s.owner_id = p_owner and s.audience_type = 'profile'
     and s.audience_profile_id = p_viewer;
  if v is not null then return v; end if;

  -- 2. Space rules over spaces BOTH belong to — most restrictive wins.
  select s.level into v from public.task_shares s
   where s.owner_id = p_owner and s.audience_type = 'space'
     and public.is_space_member(s.audience_space_id, p_owner)
     and public.is_space_member(s.audience_space_id, p_viewer)
   order by case s.level when 'hidden' then 0 else 1 end asc
   limit 1;
  if v is not null then return v; end if;

  -- 3. The web: a mycelium rule speaks to anyone the owner holds in theirs.
  select s.level into v from public.task_shares s
   where s.owner_id = p_owner and s.audience_type = 'mycelium'
     and exists (select 1 from public.mycelium m
                 where m.truster_id = p_owner
                   and m.target_type = 'profile' and m.target_id = p_viewer);
  if v is not null then return v; end if;

  -- 4. Everyone, else the privacy-first default.
  select s.level into v from public.task_shares s
   where s.owner_id = p_owner and s.audience_type = 'everyone';
  return coalesce(v, 'hidden');
end $$;


ALTER FUNCTION public.task_level(p_owner uuid, p_viewer uuid) OWNER TO postgres;

--
-- Name: tick_reminders(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.tick_reminders() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_secret text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'push_hook_secret';
  perform net.http_post(
    url := 'https://mjqnaevertyzgjlpwynr.supabase.co/functions/v1/fire-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', coalesce(v_secret, '')),
    body := '{}'::jsonb
  );
end $$;


ALTER FUNCTION public.tick_reminders() OWNER TO postgres;

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

--
-- Name: translate_donation(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.translate_donation(p_donation uuid, p_to_type text, p_to_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  d record; v_grant numeric; v_central integer; v_ledger uuid; v_memo text;
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only admins can translate donations.';
  end if;

  select * into d from donations where id = p_donation for update;
  if not found then raise exception 'No such donation.'; end if;
  if d.status <> 'received' then raise exception 'Already translated.'; end if;

  if p_to_type = 'profile' then
    if not exists (select 1 from profiles where id = p_to_id) then raise exception 'No such member.'; end if;
  elsif p_to_type = 'space' then
    if not exists (select 1 from spaces where id = p_to_id) then raise exception 'No such group.'; end if;
  else
    raise exception 'Unknown recipient kind.';
  end if;

  v_grant := round((d.amount_cents * 0.95) / 100.0, 2);
  v_central := d.amount_cents - round(d.amount_cents * 0.95)::integer;
  if v_grant <= 0 then raise exception 'Donation too small to translate.'; end if;

  v_memo := 'Donor-directed gift · 95%% of $' || trim(to_char(d.amount_cents / 100.0, 'FM999999990.00'));
  v_memo := replace(v_memo, '%%', '%');
  if coalesce(d.designation, '') <> '' then
    v_memo := v_memo || ' · "' || d.designation || '"';
  end if;

  insert into ledger_entries (from_type, from_id, to_type, to_id, amount, context, memo, ref_type, ref_id, created_by)
  values (null, null, p_to_type, p_to_id, v_grant, 'grant', v_memo, 'donation', d.id, auth.uid())
  returning id into v_ledger;

  update donations
     set status = 'translated', translated_at = now(),
         ledger_entry_id = v_ledger, central_cents = v_central
   where id = p_donation;

  if p_to_type = 'profile' then
    perform public.notify(p_to_id, 'home', null, 'currentcy',
      'A donor directed ' || trim(to_char(v_grant, 'FM999999990.##')) || ' Current to you',
      nullif(d.designation, ''), '/profile', auth.uid());
  end if;
  return v_ledger;
end $_$;


ALTER FUNCTION public.translate_donation(p_donation uuid, p_to_type text, p_to_id uuid) OWNER TO postgres;

--
-- Name: trust_edges_for_targets(jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.trust_edges_for_targets(p_targets jsonb) RETURNS TABLE(target_type text, target_id uuid, truster_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT m.target_type, m.target_id, m.truster_id
  FROM public.mycelium m
  JOIN (
    SELECT (t->>'type')::text AS target_type, (t->>'id')::uuid AS target_id
    FROM jsonb_array_elements(p_targets) AS t
  ) tg ON tg.target_type = m.target_type AND tg.target_id = m.target_id
  WHERE m.vouched = true;
$$;


ALTER FUNCTION public.trust_edges_for_targets(p_targets jsonb) OWNER TO postgres;

--
-- Name: visible_tasks_of(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.visible_tasks_of(p_owner uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case when public.task_level(p_owner, auth.uid()) = 'hidden'
    then null
    else jsonb_build_object(
      'owner_name', (select coalesce(full_name, 'A member') from public.profiles where id = p_owner),
      'todos', coalesce((
        select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title) order by t.created_at desc)
        from public.todos t where t.profile_id = p_owner and not t.done), '[]'::jsonb),
      'reminders', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id, 'title', r.title, 'start_date', r.start_date,
          'end_date', r.end_date, 'at_min', r.at_min, 'recurrence', r.recurrence))
        from public.reminders r
        where r.profile_id = p_owner
          and (r.end_date >= current_date - 1 or r.recurrence is not null)), '[]'::jsonb))
  end;
$$;


ALTER FUNCTION public.visible_tasks_of(p_owner uuid) OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: assistant_feed_posts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.assistant_feed_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    author text NOT NULL,
    body text NOT NULL,
    attachments jsonb,
    source_post_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    thread text DEFAULT 'general'::text NOT NULL,
    CONSTRAINT assistant_feed_posts_author_check CHECK ((author = ANY (ARRAY['member'::text, 'claude'::text])))
);


ALTER TABLE public.assistant_feed_posts OWNER TO postgres;

--
-- Name: assistant_identities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.assistant_identities (
    profile_id uuid NOT NULL,
    label text NOT NULL,
    persona text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.assistant_identities OWNER TO postgres;

--
-- Name: assistant_queries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.assistant_queries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    context text DEFAULT 'search'::text NOT NULL,
    model text,
    input_tokens integer,
    output_tokens integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.assistant_queries OWNER TO postgres;

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
    CONSTRAINT availability_windows_kind_check CHECK ((kind = ANY (ARRAY['available'::text, 'social'::text, 'on_call'::text]))),
    CONSTRAINT availability_windows_span CHECK ((end_min > start_min)),
    CONSTRAINT availability_windows_start_min_check CHECK (((start_min >= 0) AND (start_min <= 1439))),
    CONSTRAINT availability_windows_validity CHECK (((valid_from IS NULL) OR (valid_to IS NULL) OR (valid_to >= valid_from))),
    CONSTRAINT availability_windows_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)))
);


ALTER TABLE public.availability_windows OWNER TO postgres;

--
-- Name: COLUMN availability_windows.kind; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.availability_windows.kind IS 'available = work hours, bookable. social = hours you welcome a chat in; this is what Home''s "N are available" counts. on_call = the care rota (Concierge), deliberately not subtracted by bookings.';


--
-- Name: booking_types; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.booking_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    duration_min integer DEFAULT 60 NOT NULL,
    buffer_min integer DEFAULT 0 NOT NULL,
    price text DEFAULT ''::text NOT NULL,
    location text DEFAULT ''::text NOT NULL,
    approval text DEFAULT 'request'::text NOT NULL,
    audience text DEFAULT 'everyone'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    audience_space_id uuid,
    CONSTRAINT booking_types_approval_check CHECK ((approval = ANY (ARRAY['request'::text, 'instant'::text]))),
    CONSTRAINT booking_types_audience_check CHECK ((audience = ANY (ARRAY['everyone'::text, 'mycelium'::text, 'public'::text, 'space'::text]))),
    CONSTRAINT booking_types_buffer_min_check CHECK (((buffer_min >= 0) AND (buffer_min <= 120))),
    CONSTRAINT booking_types_duration_min_check CHECK (((duration_min >= 15) AND (duration_min <= 480))),
    CONSTRAINT booking_types_space_audience_check CHECK (((audience <> 'space'::text) OR (audience_space_id IS NOT NULL)))
);


ALTER TABLE public.booking_types OWNER TO postgres;

--
-- Name: COLUMN booking_types.audience_space_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.booking_types.audience_space_id IS 'When audience=''space'': only members of this space may see and book the session.';


--
-- Name: bookings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type_id uuid NOT NULL,
    provider_id uuid NOT NULL,
    booker_id uuid,
    on_date date NOT NULL,
    start_min integer NOT NULL,
    end_min integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    event_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    guest_name text,
    guest_email text,
    guest_token text DEFAULT replace(((gen_random_uuid())::text || (gen_random_uuid())::text), '-'::text, ''::text),
    CONSTRAINT bookings_end_min_check CHECK (((end_min >= 1) AND (end_min <= 1440))),
    CONSTRAINT bookings_some_booker_check CHECK (((booker_id IS NOT NULL) OR ((guest_name IS NOT NULL) AND (guest_email IS NOT NULL)))),
    CONSTRAINT bookings_span CHECK ((end_min > start_min)),
    CONSTRAINT bookings_start_min_check CHECK (((start_min >= 0) AND (start_min <= 1439))),
    CONSTRAINT bookings_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'declined'::text, 'cancelled'::text])))
);


ALTER TABLE public.bookings OWNER TO postgres;

--
-- Name: COLUMN bookings.guest_token; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.bookings.guest_token IS 'The unguessable token IS the guest''s authorization (event_guests pattern): /b/<token> shows and manages their booking.';


--
-- Name: calendar_pins; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.calendar_pins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    target_kind text NOT NULL,
    target_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calendar_pins_target_kind_check CHECK ((target_kind = ANY (ARRAY['profile'::text, 'space'::text])))
);


ALTER TABLE public.calendar_pins OWNER TO postgres;

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
    external_calendar_id uuid,
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
    CONSTRAINT care_posts_kind_shape CHECK ((((kind = 'wow'::text) AND (start_date IS NULL) AND (end_date IS NULL) AND (recurrence IS NULL)) OR ((kind = 'koc'::text) AND (score IS NULL) AND (start_date IS NOT NULL) AND (cardinality(dimensions) = 0) AND (((recurrence IS NULL) AND (end_date IS NOT NULL) AND (end_date >= start_date)) OR ((recurrence IS NOT NULL) AND ((end_date IS NULL) OR (end_date >= start_date))))))),
    CONSTRAINT care_posts_nonempty CHECK (((length(btrim(body)) > 0) OR (jsonb_array_length(attachments) > 0) OR (jsonb_array_length(links) > 0))),
    CONSTRAINT care_posts_score_check CHECK (((score >= 0) AND (score <= 100)))
);


ALTER TABLE public.care_posts OWNER TO postgres;

--
-- Name: care_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.care_settings (
    patient_id uuid NOT NULL,
    wow_window_days smallint,
    wow_window_auto boolean DEFAULT false NOT NULL,
    wow_window_reason text,
    wow_window_set_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT care_settings_wow_window_days_check CHECK (((wow_window_days >= 14) AND (wow_window_days <= 120)))
);


ALTER TABLE public.care_settings OWNER TO postgres;

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
    section text DEFAULT 'everyday'::text NOT NULL,
    CONSTRAINT categories_domain_check CHECK ((domain = ANY (ARRAY['good'::text, 'service'::text, 'place'::text]))),
    CONSTRAINT categories_section_check CHECK ((section = ANY (ARRAY['healing'::text, 'everyday'::text])))
);


ALTER TABLE public.categories OWNER TO postgres;

--
-- Name: category_aliases; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.category_aliases (
    alias text NOT NULL,
    category_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


ALTER TABLE public.category_aliases OWNER TO postgres;

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
    CONSTRAINT category_suggestions_domain_check CHECK ((domain = ANY (ARRAY['good'::text, 'service'::text, 'place'::text]))),
    CONSTRAINT category_suggestions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


ALTER TABLE public.category_suggestions OWNER TO postgres;

--
-- Name: chat_members; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chat_members (
    chat_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_read_at timestamp with time zone DEFAULT now() NOT NULL
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
-- Name: collection_enrollments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.collection_enrollments (
    profile_id uuid NOT NULL,
    collection_id uuid NOT NULL,
    enrolled_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.collection_enrollments OWNER TO postgres;

--
-- Name: collection_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.collection_items (
    collection_id uuid NOT NULL,
    target_type text DEFAULT 'post'::text NOT NULL,
    target_id uuid NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT collection_items_target_type_check CHECK ((target_type = 'post'::text))
);


ALTER TABLE public.collection_items OWNER TO postgres;

--
-- Name: collection_progress; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.collection_progress (
    profile_id uuid NOT NULL,
    collection_id uuid NOT NULL,
    post_id uuid NOT NULL,
    done_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.collection_progress OWNER TO postgres;

--
-- Name: collection_suggestions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.collection_suggestions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    collection_id uuid NOT NULL,
    post_id uuid,
    note text,
    suggested_by uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT collection_suggestions_check CHECK (((post_id IS NOT NULL) OR (note IS NOT NULL))),
    CONSTRAINT collection_suggestions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text])))
);


ALTER TABLE public.collection_suggestions OWNER TO postgres;

--
-- Name: collections; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.collections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    is_public boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    kind text DEFAULT 'collection'::text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    space_id uuid,
    CONSTRAINT collections_kind_check CHECK ((kind = ANY (ARRAY['collection'::text, 'course'::text, 'path'::text])))
);


ALTER TABLE public.collections OWNER TO postgres;

--
-- Name: donations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.donations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    amount_cents integer NOT NULL,
    currency text DEFAULT 'usd'::text NOT NULL,
    donor_email text,
    donor_profile_id uuid,
    designation text DEFAULT ''::text NOT NULL,
    frequency text DEFAULT 'one-time'::text NOT NULL,
    stripe_session_id text NOT NULL,
    status text DEFAULT 'received'::text NOT NULL,
    translated_at timestamp with time zone,
    ledger_entry_id uuid,
    central_cents integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    kind text DEFAULT 'donation'::text NOT NULL,
    CONSTRAINT donations_amount_cents_check CHECK ((amount_cents > 0)),
    CONSTRAINT donations_kind_check CHECK ((kind = ANY (ARRAY['donation'::text, 'sponsorship'::text]))),
    CONSTRAINT donations_status_check CHECK ((status = ANY (ARRAY['received'::text, 'translated'::text, 'operations'::text])))
);


ALTER TABLE public.donations OWNER TO postgres;

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
-- Name: event_guests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.event_guests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    invited_by uuid NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    token text DEFAULT replace(((gen_random_uuid())::text || (gen_random_uuid())::text), '-'::text, ''::text) NOT NULL,
    status text DEFAULT 'invited'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT event_guests_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'going'::text, 'tentative'::text, 'declined'::text])))
);


ALTER TABLE public.event_guests OWNER TO postgres;

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
    owner_resource_id uuid,
    CONSTRAINT events_end_min_check CHECK (((end_min >= 1) AND (end_min <= 1440))),
    CONSTRAINT events_one_owner CHECK ((((((owner_profile_id IS NOT NULL))::integer + ((owner_space_id IS NOT NULL))::integer) + ((owner_resource_id IS NOT NULL))::integer) = 1)),
    CONSTRAINT events_recur_single_day CHECK (((recurrence IS NULL) OR (start_date = end_date))),
    CONSTRAINT events_span CHECK ((end_date >= start_date)),
    CONSTRAINT events_start_min_check CHECK (((start_min >= 0) AND (start_min <= 1439))),
    CONSTRAINT events_times CHECK (((all_day AND (start_min IS NULL) AND (end_min IS NULL)) OR ((NOT all_day) AND (start_min IS NOT NULL) AND (end_min IS NOT NULL) AND ((start_date <> end_date) OR (end_min > start_min))))),
    CONSTRAINT events_title_check CHECK ((length(btrim(title)) > 0))
);


ALTER TABLE public.events OWNER TO postgres;

--
-- Name: exchanges; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.exchanges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    seller_space_id uuid,
    buyer_id uuid NOT NULL,
    mode text NOT NULL,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    fulfillment text,
    note text,
    status text DEFAULT 'pending'::text NOT NULL,
    needs_guardian boolean DEFAULT false NOT NULL,
    guardian_ok_at timestamp with time zone,
    buyer_done_at timestamp with time zone,
    seller_done_at timestamp with time zone,
    ledger_entry_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    completed_at timestamp with time zone,
    buyer_space_id uuid,
    CONSTRAINT exchanges_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT exchanges_no_space_self_deal CHECK (((buyer_space_id IS NULL) OR (seller_space_id IS NULL) OR (buyer_space_id <> seller_space_id))),
    CONSTRAINT exchanges_not_self CHECK (((buyer_id <> seller_id) OR (buyer_space_id IS NOT NULL))),
    CONSTRAINT exchanges_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'completed'::text, 'canceled'::text])))
);


ALTER TABLE public.exchanges OWNER TO postgres;

--
-- Name: COLUMN exchanges.buyer_space_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.exchanges.buyer_space_id IS 'Set when a SPACE is the buyer, acting through the admin in buyer_id. Completion debits the space''s treasury, not the human.';


--
-- Name: external_busy; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.external_busy (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    calendar_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    on_date date NOT NULL,
    all_day boolean DEFAULT false NOT NULL,
    start_min integer,
    end_min integer,
    title text
);


ALTER TABLE public.external_busy OWNER TO postgres;

--
-- Name: external_calendars; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.external_calendars (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    name text DEFAULT 'Calendar'::text NOT NULL,
    url text NOT NULL,
    timezone text,
    last_synced_at timestamp with time zone,
    last_error text,
    event_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.external_calendars OWNER TO postgres;

--
-- Name: financial_positions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.financial_positions (
    profile_id uuid NOT NULL,
    income_band text,
    household_size integer,
    circumstances text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    care_team_visible boolean DEFAULT true NOT NULL,
    CONSTRAINT financial_positions_household_size_check CHECK (((household_size >= 1) AND (household_size <= 20))),
    CONSTRAINT financial_positions_income_band_check CHECK ((income_band = ANY (ARRAY['under_25k'::text, '25k_50k'::text, '50k_100k'::text, '100k_200k'::text, 'over_200k'::text])))
);


ALTER TABLE public.financial_positions OWNER TO postgres;

--
-- Name: google_calendar_accounts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.google_calendar_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    google_email text,
    refresh_token text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.google_calendar_accounts OWNER TO postgres;

--
-- Name: guardians; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.guardians (
    minor_id uuid NOT NULL,
    guardian_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT guardians_not_self CHECK ((minor_id <> guardian_id))
);


ALTER TABLE public.guardians OWNER TO postgres;

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
-- Name: hidden_posts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.hidden_posts (
    profile_id uuid NOT NULL,
    post_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.hidden_posts OWNER TO postgres;

--
-- Name: inkind_donations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inkind_donations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    donor_profile_id uuid NOT NULL,
    post_id uuid,
    description text NOT NULL,
    status text DEFAULT 'offered'::text NOT NULL,
    accepted_at timestamp with time zone,
    accepted_by uuid,
    receipt_sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inkind_donations_status_check CHECK ((status = ANY (ARRAY['offered'::text, 'accepted'::text, 'declined'::text])))
);


ALTER TABLE public.inkind_donations OWNER TO postgres;

--
-- Name: invite_tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invite_tokens (
    token uuid DEFAULT gen_random_uuid() NOT NULL,
    created_by uuid NOT NULL,
    invitee_email text,
    claimed_by uuid,
    claimed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    for_minor boolean DEFAULT false NOT NULL,
    opened_at timestamp with time zone
);


ALTER TABLE public.invite_tokens OWNER TO postgres;

--
-- Name: COLUMN invite_tokens.opened_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.invite_tokens.opened_at IS 'First time the invite link landed on the signup page — the "Opened" status. Stronger signal than an email-open pixel.';


--
-- Name: join_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.join_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    story text,
    status text DEFAULT 'new'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT join_requests_status_check CHECK ((status = ANY (ARRAY['new'::text, 'invited'::text, 'declined'::text])))
);


ALTER TABLE public.join_requests OWNER TO postgres;

--
-- Name: ledger_entries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ledger_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    from_type text,
    from_id uuid,
    to_type text,
    to_id uuid,
    amount numeric(12,2) NOT NULL,
    context text DEFAULT 'exchange'::text NOT NULL,
    memo text DEFAULT ''::text NOT NULL,
    ref_type text,
    ref_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ledger_entries_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT ledger_entries_check CHECK (((from_type IS NULL) = (from_id IS NULL))),
    CONSTRAINT ledger_entries_context_check CHECK ((context = ANY (ARRAY['mint'::text, 'grant'::text, 'gift'::text, 'exchange'::text, 'contribution'::text, 'adjustment'::text, 'burn'::text]))),
    CONSTRAINT ledger_entries_from_type_check CHECK ((from_type = ANY (ARRAY['profile'::text, 'space'::text]))),
    CONSTRAINT ledger_entries_some_party_check CHECK ((NOT ((from_type IS NULL) AND (to_type IS NULL)))),
    CONSTRAINT ledger_entries_to_pair_check CHECK (((to_type IS NULL) = (to_id IS NULL))),
    CONSTRAINT ledger_entries_to_type_check CHECK ((to_type = ANY (ARRAY['profile'::text, 'space'::text])))
);


ALTER TABLE public.ledger_entries OWNER TO postgres;

--
-- Name: COLUMN ledger_entries.context; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ledger_entries.context IS 'mint/grant/gift = Current entering circulation (from is null). burn = Current leaving it (to is null) — the redemption channel. exchange/contribution move it inside; adjustment corrects, since the ledger is append-only.';


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
    CONSTRAINT location_shares_level_check CHECK ((level = ANY (ARRAY['hidden'::text, 'state'::text, 'county'::text, 'area'::text, 'exact'::text])))
);


ALTER TABLE public.location_shares OWNER TO postgres;

--
-- Name: member_prompts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.member_prompts (
    profile_id uuid NOT NULL,
    topic text NOT NULL,
    seen_at timestamp with time zone DEFAULT now() NOT NULL,
    times_seen integer DEFAULT 1 NOT NULL
);


ALTER TABLE public.member_prompts OWNER TO postgres;

--
-- Name: COLUMN member_prompts.times_seen; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.member_prompts.times_seen IS 'How many times this member has met this prompt. Lets a teaching prompt run for the first few visits and then fall silent, instead of asking forever.';


--
-- Name: membership_gifts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.membership_gifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inviter_id uuid NOT NULL,
    invitee_email text NOT NULL,
    tier text DEFAULT 'community'::text NOT NULL,
    months integer,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_at timestamp with time zone,
    claimed_profile_id uuid,
    CONSTRAINT membership_gifts_months_check CHECK (((months IS NULL) OR (months > 0))),
    CONSTRAINT membership_gifts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'claimed'::text]))),
    CONSTRAINT membership_gifts_tier_check CHECK ((tier = ANY (ARRAY['community'::text, 'concierge'::text])))
);


ALTER TABLE public.membership_gifts OWNER TO postgres;

--
-- Name: mycelium; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mycelium (
    truster_id uuid NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    vouched boolean DEFAULT true NOT NULL,
    truster_space_id uuid,
    CONSTRAINT mycelium_no_self_weave CHECK ((NOT ((target_type = 'space'::text) AND (target_id = truster_space_id)))),
    CONSTRAINT mycelium_no_space_trust CHECK ((NOT ((vouched = true) AND (target_type = 'space'::text)))),
    CONSTRAINT mycelium_space_cannot_vouch CHECK ((NOT ((vouched = true) AND (truster_space_id IS NOT NULL)))),
    CONSTRAINT mycelium_target_type_check CHECK ((target_type = ANY (ARRAY['profile'::text, 'space'::text, 'post'::text])))
);


ALTER TABLE public.mycelium OWNER TO postgres;

--
-- Name: COLUMN mycelium.truster_space_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.mycelium.truster_space_id IS 'Set when this edge is a SPACE''s, woven by an admin acting as it. truster_id still records which human did it. Null = an ordinary personal edge. A space edge can never be vouched — trust stays person-to-person.';


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
    CONSTRAINT posts_service_area_check CHECK ((service_area = ANY (ARRAY['marketplace'::text, 'work'::text, 'courses'::text, 'food'::text, 'art'::text, 'events'::text, 'places'::text, 'library'::text, 'people'::text, 'travel'::text]))),
    CONSTRAINT posts_service_areas_valid CHECK ((service_areas <@ ARRAY['marketplace'::text, 'work'::text, 'courses'::text, 'food'::text, 'art'::text, 'events'::text, 'places'::text, 'library'::text, 'people'::text, 'travel'::text])),
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
-- Name: profile_locations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.profile_locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    label text DEFAULT ''::text NOT NULL,
    location text NOT NULL,
    lat double precision,
    lng double precision,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    show_on_maps boolean DEFAULT true NOT NULL,
    show_on_profile boolean DEFAULT true NOT NULL
);


ALTER TABLE public.profile_locations OWNER TO postgres;

--
-- Name: TABLE profile_locations; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.profile_locations IS 'A member''s goods & services addresses — deliberately public-to-members, unlike the privacy-laddered home location.';


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
    last_seen_at timestamp with time zone,
    home_county text,
    home_state text,
    presence_visible boolean DEFAULT true NOT NULL,
    presence_lit_until timestamp with time zone,
    presence_always_present boolean DEFAULT true NOT NULL,
    timezone text,
    identity_tags text[],
    assistant_readable boolean DEFAULT true NOT NULL,
    contact jsonb,
    public_page boolean DEFAULT false NOT NULL,
    page jsonb,
    content_ai_default boolean DEFAULT true NOT NULL,
    content_download_default boolean DEFAULT true NOT NULL,
    assistant_enabled boolean DEFAULT true NOT NULL,
    kind text DEFAULT 'person'::text NOT NULL,
    aspect text,
    steward_profile_id uuid,
    steward_space_id uuid,
    birth_date date,
    is_adult boolean,
    age_declared_at timestamp with time zone,
    findable boolean DEFAULT true NOT NULL,
    assistant_can_edit boolean DEFAULT false NOT NULL,
    weaveable_default boolean DEFAULT true NOT NULL,
    jurisdiction text,
    CONSTRAINT profiles_aspect_check CHECK (((aspect IS NULL) OR (aspect = ANY (ARRAY['individual'::text, 'collective'::text])))),
    CONSTRAINT profiles_birth_date_sane CHECK (((birth_date IS NULL) OR ((birth_date > '1900-01-01'::date) AND (birth_date <= CURRENT_DATE)))),
    CONSTRAINT profiles_distributed_jurisdiction CHECK (((kind <> ALL (ARRAY['plant'::text, 'element'::text])) OR (jurisdiction IS NOT NULL))),
    CONSTRAINT profiles_kind_check CHECK ((kind = ANY (ARRAY['person'::text, 'plant'::text, 'animal'::text, 'place'::text, 'element'::text, 'collective'::text]))),
    CONSTRAINT profiles_notification_pref_check CHECK ((notification_pref = ANY (ARRAY['off'::text, 'in_app'::text, 'both'::text]))),
    CONSTRAINT profiles_steward_check CHECK (
CASE
    WHEN (kind = 'person'::text) THEN ((steward_profile_id IS NULL) AND (steward_space_id IS NULL))
    ELSE ((steward_profile_id IS NOT NULL) <> (steward_space_id IS NOT NULL))
END)
);


ALTER TABLE public.profiles OWNER TO postgres;

--
-- Name: COLUMN profiles.assistant_can_edit; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.profiles.assistant_can_edit IS 'Member consent for the assistant to write their own public-page fields (page/contact/profile_categories) via assistant-feed tool use. Default false; never extends to private data, other members, or spaces.';


--
-- Name: COLUMN profiles.weaveable_default; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.profiles.weaveable_default IS 'Compose preselection for the per-post weaveable toggle. The per-post truth is posts.details.noWeave (stored only when switched OFF).';


--
-- Name: COLUMN profiles.jurisdiction; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.profiles.jurisdiction IS 'The named scope a stewarded being is tended within ("the Skagit watershed"). REQUIRED for plant/element kinds (distributed beings), optional otherwise. Public — it is part of the being''s identity.';


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.push_subscriptions OWNER TO postgres;

--
-- Name: recommendations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.recommendations (
    recommender_id uuid NOT NULL,
    target_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    target_type text DEFAULT 'post'::text NOT NULL,
    offering_category text,
    recommender_space_id uuid,
    CONSTRAINT recommendations_one_voice CHECK (((recommender_space_id IS NULL) OR (recommender_id IS NOT NULL))),
    CONSTRAINT recommendations_target_type_check CHECK ((target_type = ANY (ARRAY['post'::text, 'profile'::text, 'space'::text])))
);


ALTER TABLE public.recommendations OWNER TO postgres;

--
-- Name: reminder_done; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.reminder_done (
    reminder_id uuid NOT NULL,
    on_date date NOT NULL,
    profile_id uuid NOT NULL
);


ALTER TABLE public.reminder_done OWNER TO postgres;

--
-- Name: reminder_fired; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.reminder_fired (
    reminder_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    on_date date NOT NULL,
    fired_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.reminder_fired OWNER TO postgres;

--
-- Name: reminder_recipients; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.reminder_recipients (
    reminder_id uuid NOT NULL,
    recipient_type text NOT NULL,
    recipient_id uuid NOT NULL,
    CONSTRAINT reminder_recipients_recipient_type_check CHECK ((recipient_type = ANY (ARRAY['profile'::text, 'space'::text])))
);


ALTER TABLE public.reminder_recipients OWNER TO postgres;

--
-- Name: reminders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.reminders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    title text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    at_min integer,
    lead_min integer DEFAULT 0 NOT NULL,
    recurrence jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    done_mode text DEFAULT 'shared'::text NOT NULL,
    CONSTRAINT reminders_done_mode_check CHECK ((done_mode = ANY (ARRAY['shared'::text, 'each'::text])))
);


ALTER TABLE public.reminders OWNER TO postgres;

--
-- Name: COLUMN reminders.done_mode; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.reminders.done_mode IS 'shared = whoever ticks it completes it for everyone (default); each = every recipient ticks their own copy.';


--
-- Name: resource_bookings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.resource_bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    resource_id uuid NOT NULL,
    requester_id uuid NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    start_min integer,
    end_min integer,
    note text,
    status text DEFAULT 'pending'::text NOT NULL,
    event_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT resource_bookings_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'declined'::text, 'canceled'::text])))
);


ALTER TABLE public.resource_bookings OWNER TO postgres;

--
-- Name: resources; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.resources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    space_id uuid,
    owner_profile_id uuid,
    name text NOT NULL,
    kind text NOT NULL,
    description text,
    photo_url text,
    bookable boolean DEFAULT true NOT NULL,
    approval text DEFAULT 'request'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT resources_approval_check CHECK ((approval = ANY (ARRAY['request'::text, 'instant'::text]))),
    CONSTRAINT resources_kind_check CHECK ((kind = ANY (ARRAY['room'::text, 'thing'::text]))),
    CONSTRAINT resources_one_owner CHECK (((((space_id IS NOT NULL))::integer + ((owner_profile_id IS NOT NULL))::integer) = 1))
);


ALTER TABLE public.resources OWNER TO postgres;

--
-- Name: saved_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.saved_items (
    profile_id uuid NOT NULL,
    target_type text DEFAULT 'post'::text NOT NULL,
    target_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT saved_items_target_type_check CHECK ((target_type = ANY (ARRAY['post'::text, 'profile'::text, 'space'::text, 'event'::text])))
);


ALTER TABLE public.saved_items OWNER TO postgres;

--
-- Name: space_members; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.space_members (
    space_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    role public.space_member_role DEFAULT 'member'::public.space_member_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    duties text[]
);


ALTER TABLE public.space_members OWNER TO postgres;

--
-- Name: space_membership_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.space_membership_requests (
    space_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    initiated_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.space_membership_requests OWNER TO postgres;

--
-- Name: space_nesting_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.space_nesting_requests (
    group_id uuid NOT NULL,
    parent_id uuid NOT NULL,
    initiated_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.space_nesting_requests OWNER TO postgres;

--
-- Name: space_section_shares; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.space_section_shares (
    space_id uuid NOT NULL,
    post_id uuid NOT NULL,
    area text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    requested_by uuid NOT NULL,
    decided_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT space_section_shares_area_check CHECK ((area = ANY (ARRAY['courses'::text, 'library'::text]))),
    CONSTRAINT space_section_shares_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text])))
);


ALTER TABLE public.space_section_shares OWNER TO postgres;

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
    lng double precision,
    parent_space_id uuid,
    cohort_of uuid,
    term text,
    contact jsonb,
    public_page boolean NOT NULL,
    page jsonb,
    assistant_enabled boolean DEFAULT true NOT NULL,
    findable boolean DEFAULT true NOT NULL,
    assistant_readable boolean DEFAULT true NOT NULL,
    content_ai_default boolean DEFAULT true NOT NULL,
    content_download_default boolean DEFAULT true NOT NULL
);


ALTER TABLE public.spaces OWNER TO postgres;

--
-- Name: COLUMN spaces.findable; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.spaces.findable IS 'Appears in directory/search — mirrors profiles.findable.';


--
-- Name: COLUMN spaces.assistant_readable; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.spaces.assistant_readable IS 'Other members'' assistants may read this space''s content when briefing — mirrors profiles.assistant_readable. Distinct from assistant_enabled (whether THIS space''s own assistant is on).';


--
-- Name: COLUMN spaces.content_ai_default; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.spaces.content_ai_default IS 'Default AI-readable flag for this space''s new posts — mirrors profiles.content_ai_default.';


--
-- Name: COLUMN spaces.content_download_default; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.spaces.content_download_default IS 'Default downloadable-media flag for this space''s new posts — mirrors profiles.content_download_default.';


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
-- Name: task_shares; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.task_shares (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    audience_type text NOT NULL,
    audience_space_id uuid,
    audience_profile_id uuid,
    level text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT task_shares_audience_shape CHECK ((((audience_type = ANY (ARRAY['everyone'::text, 'mycelium'::text])) AND (audience_space_id IS NULL) AND (audience_profile_id IS NULL)) OR ((audience_type = 'space'::text) AND (audience_space_id IS NOT NULL) AND (audience_profile_id IS NULL)) OR ((audience_type = 'profile'::text) AND (audience_profile_id IS NOT NULL) AND (audience_space_id IS NULL)))),
    CONSTRAINT task_shares_audience_type_check CHECK ((audience_type = ANY (ARRAY['everyone'::text, 'mycelium'::text, 'space'::text, 'profile'::text]))),
    CONSTRAINT task_shares_level_check CHECK ((level = ANY (ARRAY['hidden'::text, 'see'::text])))
);


ALTER TABLE public.task_shares OWNER TO postgres;

--
-- Name: todos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.todos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    title text NOT NULL,
    done boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.todos OWNER TO postgres;

--
-- Name: video_jobs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.video_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    src_path text NOT NULL,
    status text DEFAULT 'uploaded'::text NOT NULL,
    error text,
    hls_path text,
    poster_path text,
    duration_secs integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT video_jobs_status_check CHECK ((status = ANY (ARRAY['uploaded'::text, 'processing'::text, 'ready'::text, 'failed'::text])))
);


ALTER TABLE public.video_jobs OWNER TO postgres;

--
-- Name: assistant_feed_posts assistant_feed_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assistant_feed_posts
    ADD CONSTRAINT assistant_feed_posts_pkey PRIMARY KEY (id);


--
-- Name: assistant_identities assistant_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assistant_identities
    ADD CONSTRAINT assistant_identities_pkey PRIMARY KEY (profile_id);


--
-- Name: assistant_queries assistant_queries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assistant_queries
    ADD CONSTRAINT assistant_queries_pkey PRIMARY KEY (id);


--
-- Name: availability_windows availability_windows_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.availability_windows
    ADD CONSTRAINT availability_windows_pkey PRIMARY KEY (id);


--
-- Name: booking_types booking_types_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_types
    ADD CONSTRAINT booking_types_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_guest_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_guest_token_key UNIQUE (guest_token);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: calendar_pins calendar_pins_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.calendar_pins
    ADD CONSTRAINT calendar_pins_pkey PRIMARY KEY (id);


--
-- Name: calendar_pins calendar_pins_profile_id_target_kind_target_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.calendar_pins
    ADD CONSTRAINT calendar_pins_profile_id_target_kind_target_id_key UNIQUE (profile_id, target_kind, target_id);


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
-- Name: care_settings care_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_settings
    ADD CONSTRAINT care_settings_pkey PRIMARY KEY (patient_id);


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
-- Name: category_aliases category_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.category_aliases
    ADD CONSTRAINT category_aliases_pkey PRIMARY KEY (alias);


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
-- Name: collection_enrollments collection_enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.collection_enrollments
    ADD CONSTRAINT collection_enrollments_pkey PRIMARY KEY (profile_id, collection_id);


--
-- Name: collection_items collection_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.collection_items
    ADD CONSTRAINT collection_items_pkey PRIMARY KEY (collection_id, target_type, target_id);


--
-- Name: collection_progress collection_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.collection_progress
    ADD CONSTRAINT collection_progress_pkey PRIMARY KEY (profile_id, collection_id, post_id);


--
-- Name: collection_suggestions collection_suggestions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.collection_suggestions
    ADD CONSTRAINT collection_suggestions_pkey PRIMARY KEY (id);


--
-- Name: collections collections_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.collections
    ADD CONSTRAINT collections_pkey PRIMARY KEY (id);


--
-- Name: donations donations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_pkey PRIMARY KEY (id);


--
-- Name: donations donations_stripe_session_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_stripe_session_id_key UNIQUE (stripe_session_id);


--
-- Name: event_attendees event_attendees_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.event_attendees
    ADD CONSTRAINT event_attendees_pkey PRIMARY KEY (event_id, profile_id);


--
-- Name: event_guests event_guests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.event_guests
    ADD CONSTRAINT event_guests_pkey PRIMARY KEY (id);


--
-- Name: event_guests event_guests_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.event_guests
    ADD CONSTRAINT event_guests_token_key UNIQUE (token);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: exchanges exchanges_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exchanges
    ADD CONSTRAINT exchanges_pkey PRIMARY KEY (id);


--
-- Name: external_busy external_busy_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.external_busy
    ADD CONSTRAINT external_busy_pkey PRIMARY KEY (id);


--
-- Name: external_calendars external_calendars_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.external_calendars
    ADD CONSTRAINT external_calendars_pkey PRIMARY KEY (id);


--
-- Name: financial_positions financial_positions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.financial_positions
    ADD CONSTRAINT financial_positions_pkey PRIMARY KEY (profile_id);


--
-- Name: google_calendar_accounts google_calendar_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.google_calendar_accounts
    ADD CONSTRAINT google_calendar_accounts_pkey PRIMARY KEY (id);


--
-- Name: guardians guardians_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.guardians
    ADD CONSTRAINT guardians_pkey PRIMARY KEY (minor_id, guardian_id);


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
-- Name: hidden_posts hidden_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hidden_posts
    ADD CONSTRAINT hidden_posts_pkey PRIMARY KEY (profile_id, post_id);


--
-- Name: inkind_donations inkind_donations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inkind_donations
    ADD CONSTRAINT inkind_donations_pkey PRIMARY KEY (id);


--
-- Name: invite_tokens invite_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invite_tokens
    ADD CONSTRAINT invite_tokens_pkey PRIMARY KEY (token);


--
-- Name: join_requests join_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.join_requests
    ADD CONSTRAINT join_requests_pkey PRIMARY KEY (id);


--
-- Name: ledger_entries ledger_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_pkey PRIMARY KEY (id);


--
-- Name: location_shares location_shares_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.location_shares
    ADD CONSTRAINT location_shares_pkey PRIMARY KEY (id);


--
-- Name: member_prompts member_prompts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.member_prompts
    ADD CONSTRAINT member_prompts_pkey PRIMARY KEY (profile_id, topic);


--
-- Name: membership_gifts membership_gifts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.membership_gifts
    ADD CONSTRAINT membership_gifts_pkey PRIMARY KEY (id);


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
-- Name: profile_locations profile_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profile_locations
    ADD CONSTRAINT profile_locations_pkey PRIMARY KEY (id);


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
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: reminder_done reminder_done_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reminder_done
    ADD CONSTRAINT reminder_done_pkey PRIMARY KEY (reminder_id, profile_id, on_date);


--
-- Name: reminder_fired reminder_fired_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reminder_fired
    ADD CONSTRAINT reminder_fired_pkey PRIMARY KEY (reminder_id, profile_id, on_date);


--
-- Name: reminder_recipients reminder_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reminder_recipients
    ADD CONSTRAINT reminder_recipients_pkey PRIMARY KEY (reminder_id, recipient_type, recipient_id);


--
-- Name: reminders reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reminders
    ADD CONSTRAINT reminders_pkey PRIMARY KEY (id);


--
-- Name: resource_bookings resource_bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.resource_bookings
    ADD CONSTRAINT resource_bookings_pkey PRIMARY KEY (id);


--
-- Name: resources resources_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.resources
    ADD CONSTRAINT resources_pkey PRIMARY KEY (id);


--
-- Name: saved_items saved_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.saved_items
    ADD CONSTRAINT saved_items_pkey PRIMARY KEY (profile_id, target_type, target_id);


--
-- Name: space_members space_members_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.space_members
    ADD CONSTRAINT space_members_pkey PRIMARY KEY (space_id, profile_id);


--
-- Name: space_membership_requests space_membership_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.space_membership_requests
    ADD CONSTRAINT space_membership_requests_pkey PRIMARY KEY (space_id, profile_id);


--
-- Name: space_nesting_requests space_nesting_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.space_nesting_requests
    ADD CONSTRAINT space_nesting_requests_pkey PRIMARY KEY (group_id);


--
-- Name: space_section_shares space_section_shares_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.space_section_shares
    ADD CONSTRAINT space_section_shares_pkey PRIMARY KEY (space_id, post_id, area);


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
-- Name: task_shares task_shares_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_shares
    ADD CONSTRAINT task_shares_pkey PRIMARY KEY (id);


--
-- Name: todos todos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.todos
    ADD CONSTRAINT todos_pkey PRIMARY KEY (id);


--
-- Name: video_jobs video_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.video_jobs
    ADD CONSTRAINT video_jobs_pkey PRIMARY KEY (id);


--
-- Name: assistant_feed_posts_profile_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX assistant_feed_posts_profile_time ON public.assistant_feed_posts USING btree (profile_id, created_at);


--
-- Name: assistant_feed_posts_thread_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX assistant_feed_posts_thread_time ON public.assistant_feed_posts USING btree (profile_id, thread, created_at);


--
-- Name: assistant_queries_profile_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX assistant_queries_profile_time ON public.assistant_queries USING btree (profile_id, created_at DESC);


--
-- Name: availability_windows_profile_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX availability_windows_profile_idx ON public.availability_windows USING btree (profile_id);


--
-- Name: bookings_booker; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX bookings_booker ON public.bookings USING btree (booker_id);


--
-- Name: bookings_provider_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX bookings_provider_date ON public.bookings USING btree (provider_id, on_date);


--
-- Name: calendar_shares_audience_uniq; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX calendar_shares_audience_uniq ON public.calendar_shares USING btree (owner_id, audience_type, COALESCE(audience_space_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(audience_profile_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(external_calendar_id, '00000000-0000-0000-0000-000000000000'::uuid));


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
-- Name: category_aliases_cat_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX category_aliases_cat_idx ON public.category_aliases USING btree (category_id);


--
-- Name: chat_messages_chat_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX chat_messages_chat_created_idx ON public.chat_messages USING btree (chat_id, created_at DESC);


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
-- Name: collection_progress_lookup; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX collection_progress_lookup ON public.collection_progress USING btree (profile_id, collection_id);


--
-- Name: collections_space_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX collections_space_idx ON public.collections USING btree (space_id);


--
-- Name: csugg_collection_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX csugg_collection_idx ON public.collection_suggestions USING btree (collection_id, status);


--
-- Name: donations_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX donations_status_idx ON public.donations USING btree (status, created_at DESC);


--
-- Name: event_attendees_profile_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX event_attendees_profile_idx ON public.event_attendees USING btree (profile_id);


--
-- Name: event_guests_event; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX event_guests_event ON public.event_guests USING btree (event_id, invited_by);


--
-- Name: events_creator_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX events_creator_idx ON public.events USING btree (creator_id, start_date);


--
-- Name: events_owner_profile_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX events_owner_profile_idx ON public.events USING btree (owner_profile_id, start_date) WHERE (owner_profile_id IS NOT NULL);


--
-- Name: events_owner_resource_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX events_owner_resource_idx ON public.events USING btree (owner_resource_id, start_date) WHERE (owner_resource_id IS NOT NULL);


--
-- Name: events_owner_space_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX events_owner_space_idx ON public.events USING btree (owner_space_id, start_date) WHERE (owner_space_id IS NOT NULL);


--
-- Name: exchanges_buyer_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX exchanges_buyer_idx ON public.exchanges USING btree (buyer_id, status);


--
-- Name: exchanges_buyer_space_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX exchanges_buyer_space_idx ON public.exchanges USING btree (buyer_space_id, status) WHERE (buyer_space_id IS NOT NULL);


--
-- Name: exchanges_post_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX exchanges_post_idx ON public.exchanges USING btree (post_id);


--
-- Name: exchanges_seller_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX exchanges_seller_idx ON public.exchanges USING btree (seller_id, status);


--
-- Name: external_busy_calendar; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX external_busy_calendar ON public.external_busy USING btree (calendar_id);


--
-- Name: external_busy_profile_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX external_busy_profile_date ON public.external_busy USING btree (profile_id, on_date);


--
-- Name: guardians_guardian_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX guardians_guardian_idx ON public.guardians USING btree (guardian_id);


--
-- Name: health_snapshots_patient_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX health_snapshots_patient_date_idx ON public.health_snapshots USING btree (patient_id, snapshot_date DESC, created_at DESC);


--
-- Name: inkind_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX inkind_status_idx ON public.inkind_donations USING btree (status, created_at DESC);


--
-- Name: ledger_from_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ledger_from_idx ON public.ledger_entries USING btree (from_type, from_id, created_at DESC);


--
-- Name: ledger_to_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ledger_to_idx ON public.ledger_entries USING btree (to_type, to_id, created_at DESC);


--
-- Name: location_shares_audience_uniq; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX location_shares_audience_uniq ON public.location_shares USING btree (owner_id, kind, audience_type, COALESCE(audience_space_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(audience_profile_id, '00000000-0000-0000-0000-000000000000'::uuid));


--
-- Name: membership_gifts_one_pending; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX membership_gifts_one_pending ON public.membership_gifts USING btree (lower(invitee_email)) WHERE (status = 'pending'::text);


--
-- Name: mycelium_personal_edge_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX mycelium_personal_edge_idx ON public.mycelium USING btree (truster_id, target_type, target_id) WHERE (truster_space_id IS NULL);


--
-- Name: mycelium_space_edge_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX mycelium_space_edge_idx ON public.mycelium USING btree (truster_space_id, target_type, target_id) WHERE (truster_space_id IS NOT NULL);


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
-- Name: profile_locations_profile_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX profile_locations_profile_idx ON public.profile_locations USING btree (profile_id);


--
-- Name: profiles_steward_profile_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX profiles_steward_profile_idx ON public.profiles USING btree (steward_profile_id) WHERE (steward_profile_id IS NOT NULL);


--
-- Name: profiles_steward_space_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX profiles_steward_space_idx ON public.profiles USING btree (steward_space_id) WHERE (steward_space_id IS NOT NULL);


--
-- Name: push_subscriptions_profile; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX push_subscriptions_profile ON public.push_subscriptions USING btree (profile_id);


--
-- Name: recommendations_offering_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX recommendations_offering_idx ON public.recommendations USING btree (target_id, offering_category) WHERE (offering_category IS NOT NULL);


--
-- Name: recommendations_target_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX recommendations_target_idx ON public.recommendations USING btree (target_type, target_id);


--
-- Name: recommendations_unique_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX recommendations_unique_idx ON public.recommendations USING btree (recommender_id, COALESCE((recommender_space_id)::text, ''::text), target_type, target_id, COALESCE(offering_category, ''::text));


--
-- Name: reminders_profile; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX reminders_profile ON public.reminders USING btree (profile_id, start_date);


--
-- Name: resource_bookings_resource_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX resource_bookings_resource_idx ON public.resource_bookings USING btree (resource_id, status);


--
-- Name: resources_owner_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX resources_owner_idx ON public.resources USING btree (owner_profile_id);


--
-- Name: resources_space_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX resources_space_idx ON public.resources USING btree (space_id);


--
-- Name: spaces_cohort_of_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX spaces_cohort_of_idx ON public.spaces USING btree (cohort_of) WHERE (cohort_of IS NOT NULL);


--
-- Name: spaces_parent_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX spaces_parent_idx ON public.spaces USING btree (parent_space_id);


--
-- Name: sss_space_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sss_space_status_idx ON public.space_section_shares USING btree (space_id, area, status);


--
-- Name: task_shares_one_rule_per_audience; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX task_shares_one_rule_per_audience ON public.task_shares USING btree (owner_id, audience_type, COALESCE(audience_space_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(audience_profile_id, '00000000-0000-0000-0000-000000000000'::uuid));


--
-- Name: todos_owner_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX todos_owner_idx ON public.todos USING btree (profile_id, done, created_at);


--
-- Name: video_jobs_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX video_jobs_status_idx ON public.video_jobs USING btree (status, created_at);


--
-- Name: spaces a_on_space_create_chat; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER a_on_space_create_chat AFTER INSERT ON public.spaces FOR EACH ROW EXECUTE FUNCTION public.create_space_chat();


--
-- Name: assistant_feed_posts assistant_on_feed_post; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER assistant_on_feed_post AFTER INSERT ON public.assistant_feed_posts FOR EACH ROW WHEN ((new.author = 'member'::text)) EXECUTE FUNCTION public.assistant_on_feed_post();


--
-- Name: chat_messages assistant_on_message; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER assistant_on_message AFTER INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION public.assistant_on_message();


--
-- Name: spaces before_space_public_page_default; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER before_space_public_page_default BEFORE INSERT ON public.spaces FOR EACH ROW EXECUTE FUNCTION public.set_space_public_page_default();


--
-- Name: care_plans care_plans_touch; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER care_plans_touch BEFORE UPDATE ON public.care_plans FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: care_posts care_posts_touch; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER care_posts_touch BEFORE UPDATE ON public.care_posts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: collection_items enforce_weaveable; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER enforce_weaveable BEFORE INSERT ON public.collection_items FOR EACH ROW EXECUTE FUNCTION public.enforce_weaveable();


--
-- Name: events events_touch; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER events_touch BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: health_snapshots health_snapshots_touch; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER health_snapshots_touch BEFORE UPDATE ON public.health_snapshots FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: ledger_entries ledger_no_rewrite; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER ledger_no_rewrite BEFORE DELETE OR UPDATE ON public.ledger_entries FOR EACH ROW EXECUTE FUNCTION public.ledger_no_rewrite();


--
-- Name: posts match_marketplace_post; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER match_marketplace_post AFTER INSERT ON public.posts FOR EACH ROW EXECUTE FUNCTION public.match_marketplace_post();


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
-- Name: category_suggestions on_category_suggestion; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_category_suggestion AFTER INSERT ON public.category_suggestions FOR EACH ROW EXECUTE FUNCTION public.handle_new_category_suggestion();


--
-- Name: collection_suggestions on_collection_suggestion_created; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_collection_suggestion_created AFTER INSERT ON public.collection_suggestions FOR EACH ROW EXECUTE FUNCTION public.handle_new_collection_suggestion();


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
-- Name: space_nesting_requests on_nesting_request_created; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_nesting_request_created AFTER INSERT ON public.space_nesting_requests FOR EACH ROW EXECUTE FUNCTION public.handle_new_nesting_request();


--
-- Name: posts on_post_section_shares; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_post_section_shares AFTER INSERT ON public.posts FOR EACH ROW EXECUTE FUNCTION public.handle_section_shares();


--
-- Name: health_snapshots on_snapshot_notify_trg; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_snapshot_notify_trg AFTER INSERT ON public.health_snapshots FOR EACH ROW EXECUTE FUNCTION public.on_snapshot_notify();


--
-- Name: spaces on_space_created; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_space_created AFTER INSERT ON public.spaces FOR EACH ROW EXECUTE FUNCTION public.handle_new_space();


--
-- Name: spaces on_space_parent_change; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_space_parent_change BEFORE UPDATE OF parent_space_id ON public.spaces FOR EACH ROW EXECUTE FUNCTION public.enforce_parent_consent();


--
-- Name: space_membership_requests on_space_request_created; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_space_request_created AFTER INSERT ON public.space_membership_requests FOR EACH ROW EXECUTE FUNCTION public.handle_new_space_request();


--
-- Name: posts posts_audience_sync_trg; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER posts_audience_sync_trg BEFORE INSERT ON public.posts FOR EACH ROW EXECUTE FUNCTION public.posts_audience_sync();


--
-- Name: profiles profiles_compose_full_name; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER profiles_compose_full_name BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.compose_full_name();


--
-- Name: profiles profiles_sync_is_adult; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER profiles_sync_is_adult BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.sync_is_adult();


--
-- Name: profiles profiles_touch_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER profiles_touch_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: notifications push_on_notification; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER push_on_notification AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.push_on_notification();


--
-- Name: recommendations recommendations_check_offering; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER recommendations_check_offering BEFORE INSERT OR UPDATE ON public.recommendations FOR EACH ROW EXECUTE FUNCTION public.check_offering_recommend();


--
-- Name: recommendations recommendations_check_voice; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER recommendations_check_voice BEFORE INSERT OR UPDATE ON public.recommendations FOR EACH ROW EXECUTE FUNCTION public.check_recommend_voice();


--
-- Name: event_attendees sync_attendee_event_chat_trg; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER sync_attendee_event_chat_trg AFTER INSERT OR DELETE OR UPDATE ON public.event_attendees FOR EACH ROW EXECUTE FUNCTION public.sync_attendee_to_event_chat();


--
-- Name: assistant_feed_posts assistant_feed_posts_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assistant_feed_posts
    ADD CONSTRAINT assistant_feed_posts_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: assistant_feed_posts assistant_feed_posts_source_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assistant_feed_posts
    ADD CONSTRAINT assistant_feed_posts_source_post_id_fkey FOREIGN KEY (source_post_id) REFERENCES public.posts(id) ON DELETE SET NULL;


--
-- Name: assistant_identities assistant_identities_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assistant_identities
    ADD CONSTRAINT assistant_identities_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: assistant_queries assistant_queries_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assistant_queries
    ADD CONSTRAINT assistant_queries_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: availability_windows availability_windows_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.availability_windows
    ADD CONSTRAINT availability_windows_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: booking_types booking_types_audience_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_types
    ADD CONSTRAINT booking_types_audience_space_id_fkey FOREIGN KEY (audience_space_id) REFERENCES public.spaces(id) ON DELETE SET NULL;


--
-- Name: booking_types booking_types_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_types
    ADD CONSTRAINT booking_types_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: bookings bookings_booker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_booker_id_fkey FOREIGN KEY (booker_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: bookings bookings_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;


--
-- Name: bookings bookings_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: bookings bookings_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_type_id_fkey FOREIGN KEY (type_id) REFERENCES public.booking_types(id) ON DELETE CASCADE;


--
-- Name: calendar_pins calendar_pins_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.calendar_pins
    ADD CONSTRAINT calendar_pins_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


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
-- Name: calendar_shares calendar_shares_external_calendar_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.calendar_shares
    ADD CONSTRAINT calendar_shares_external_calendar_id_fkey FOREIGN KEY (external_calendar_id) REFERENCES public.external_calendars(id) ON DELETE CASCADE;


--
-- Name: calendar_shares calendar_shares_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.calendar_shares
    ADD CONSTRAINT calendar_shares_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: care_invitations care_invitations_accepted_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_invitations
    ADD CONSTRAINT care_invitations_accepted_profile_id_fkey FOREIGN KEY (accepted_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


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
    ADD CONSTRAINT care_plans_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: care_plans care_plans_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_plans
    ADD CONSTRAINT care_plans_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: care_posts care_posts_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_posts
    ADD CONSTRAINT care_posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: care_posts care_posts_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_posts
    ADD CONSTRAINT care_posts_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: care_settings care_settings_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_settings
    ADD CONSTRAINT care_settings_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: care_team_members care_team_members_caregiver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_team_members
    ADD CONSTRAINT care_team_members_caregiver_id_fkey FOREIGN KEY (caregiver_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: care_team_members care_team_members_initiated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_team_members
    ADD CONSTRAINT care_team_members_initiated_by_fkey FOREIGN KEY (initiated_by) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: care_team_members care_team_members_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.care_team_members
    ADD CONSTRAINT care_team_members_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: category_aliases category_aliases_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.category_aliases
    ADD CONSTRAINT category_aliases_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE;


--
-- Name: category_aliases category_aliases_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.category_aliases
    ADD CONSTRAINT category_aliases_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: category_suggestions category_suggestions_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.category_suggestions
    ADD CONSTRAINT category_suggestions_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);


--
-- Name: category_suggestions category_suggestions_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.category_suggestions
    ADD CONSTRAINT category_suggestions_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


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
-- Name: collection_enrollments collection_enrollments_collection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.collection_enrollments
    ADD CONSTRAINT collection_enrollments_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES public.collections(id) ON DELETE CASCADE;


--
-- Name: collection_enrollments collection_enrollments_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.collection_enrollments
    ADD CONSTRAINT collection_enrollments_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: collection_items collection_items_collection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.collection_items
    ADD CONSTRAINT collection_items_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES public.collections(id) ON DELETE CASCADE;


--
-- Name: collection_progress collection_progress_collection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.collection_progress
    ADD CONSTRAINT collection_progress_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES public.collections(id) ON DELETE CASCADE;


--
-- Name: collection_progress collection_progress_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.collection_progress
    ADD CONSTRAINT collection_progress_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: collection_progress collection_progress_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.collection_progress
    ADD CONSTRAINT collection_progress_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: collection_suggestions collection_suggestions_collection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.collection_suggestions
    ADD CONSTRAINT collection_suggestions_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES public.collections(id) ON DELETE CASCADE;


--
-- Name: collection_suggestions collection_suggestions_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.collection_suggestions
    ADD CONSTRAINT collection_suggestions_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: collection_suggestions collection_suggestions_suggested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.collection_suggestions
    ADD CONSTRAINT collection_suggestions_suggested_by_fkey FOREIGN KEY (suggested_by) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: collections collections_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.collections
    ADD CONSTRAINT collections_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: collections collections_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.collections
    ADD CONSTRAINT collections_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE CASCADE;


--
-- Name: donations donations_donor_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_donor_profile_id_fkey FOREIGN KEY (donor_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: donations donations_ledger_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_ledger_entry_id_fkey FOREIGN KEY (ledger_entry_id) REFERENCES public.ledger_entries(id);


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
-- Name: event_guests event_guests_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.event_guests
    ADD CONSTRAINT event_guests_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: event_guests event_guests_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.event_guests
    ADD CONSTRAINT event_guests_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE CASCADE;


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
-- Name: events events_owner_resource_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_owner_resource_id_fkey FOREIGN KEY (owner_resource_id) REFERENCES public.resources(id) ON DELETE CASCADE;


--
-- Name: events events_owner_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_owner_space_id_fkey FOREIGN KEY (owner_space_id) REFERENCES public.spaces(id) ON DELETE CASCADE;


--
-- Name: exchanges exchanges_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exchanges
    ADD CONSTRAINT exchanges_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: exchanges exchanges_buyer_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exchanges
    ADD CONSTRAINT exchanges_buyer_space_id_fkey FOREIGN KEY (buyer_space_id) REFERENCES public.spaces(id) ON DELETE SET NULL;


--
-- Name: exchanges exchanges_ledger_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exchanges
    ADD CONSTRAINT exchanges_ledger_entry_id_fkey FOREIGN KEY (ledger_entry_id) REFERENCES public.ledger_entries(id) ON DELETE SET NULL;


--
-- Name: exchanges exchanges_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exchanges
    ADD CONSTRAINT exchanges_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: exchanges exchanges_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exchanges
    ADD CONSTRAINT exchanges_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: exchanges exchanges_seller_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exchanges
    ADD CONSTRAINT exchanges_seller_space_id_fkey FOREIGN KEY (seller_space_id) REFERENCES public.spaces(id) ON DELETE SET NULL;


--
-- Name: external_busy external_busy_calendar_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.external_busy
    ADD CONSTRAINT external_busy_calendar_id_fkey FOREIGN KEY (calendar_id) REFERENCES public.external_calendars(id) ON DELETE CASCADE;


--
-- Name: external_busy external_busy_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.external_busy
    ADD CONSTRAINT external_busy_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: external_calendars external_calendars_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.external_calendars
    ADD CONSTRAINT external_calendars_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: financial_positions financial_positions_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.financial_positions
    ADD CONSTRAINT financial_positions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: google_calendar_accounts google_calendar_accounts_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.google_calendar_accounts
    ADD CONSTRAINT google_calendar_accounts_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: guardians guardians_guardian_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.guardians
    ADD CONSTRAINT guardians_guardian_id_fkey FOREIGN KEY (guardian_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: guardians guardians_minor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.guardians
    ADD CONSTRAINT guardians_minor_id_fkey FOREIGN KEY (minor_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: health_snapshots health_snapshots_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.health_snapshots
    ADD CONSTRAINT health_snapshots_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: health_snapshots health_snapshots_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.health_snapshots
    ADD CONSTRAINT health_snapshots_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: hidden_posts hidden_posts_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hidden_posts
    ADD CONSTRAINT hidden_posts_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: inkind_donations inkind_donations_accepted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inkind_donations
    ADD CONSTRAINT inkind_donations_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES public.profiles(id);


--
-- Name: inkind_donations inkind_donations_donor_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inkind_donations
    ADD CONSTRAINT inkind_donations_donor_profile_id_fkey FOREIGN KEY (donor_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: inkind_donations inkind_donations_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inkind_donations
    ADD CONSTRAINT inkind_donations_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE SET NULL;


--
-- Name: invite_tokens invite_tokens_claimed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invite_tokens
    ADD CONSTRAINT invite_tokens_claimed_by_fkey FOREIGN KEY (claimed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: invite_tokens invite_tokens_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invite_tokens
    ADD CONSTRAINT invite_tokens_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: ledger_entries ledger_entries_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


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
-- Name: member_prompts member_prompts_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.member_prompts
    ADD CONSTRAINT member_prompts_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: membership_gifts membership_gifts_claimed_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.membership_gifts
    ADD CONSTRAINT membership_gifts_claimed_profile_id_fkey FOREIGN KEY (claimed_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: membership_gifts membership_gifts_inviter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.membership_gifts
    ADD CONSTRAINT membership_gifts_inviter_id_fkey FOREIGN KEY (inviter_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: mycelium mycelium_truster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mycelium
    ADD CONSTRAINT mycelium_truster_id_fkey FOREIGN KEY (truster_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: mycelium mycelium_truster_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mycelium
    ADD CONSTRAINT mycelium_truster_space_id_fkey FOREIGN KEY (truster_space_id) REFERENCES public.spaces(id) ON DELETE CASCADE;


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
-- Name: profile_locations profile_locations_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profile_locations
    ADD CONSTRAINT profile_locations_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_steward_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_steward_profile_id_fkey FOREIGN KEY (steward_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: profiles profiles_steward_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_steward_space_id_fkey FOREIGN KEY (steward_space_id) REFERENCES public.spaces(id) ON DELETE SET NULL;


--
-- Name: push_subscriptions push_subscriptions_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: recommendations recommendations_offering_category_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recommendations
    ADD CONSTRAINT recommendations_offering_category_fkey FOREIGN KEY (offering_category) REFERENCES public.categories(id) ON DELETE CASCADE;


--
-- Name: recommendations recommendations_recommender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recommendations
    ADD CONSTRAINT recommendations_recommender_id_fkey FOREIGN KEY (recommender_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: recommendations recommendations_recommender_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recommendations
    ADD CONSTRAINT recommendations_recommender_space_id_fkey FOREIGN KEY (recommender_space_id) REFERENCES public.spaces(id) ON DELETE CASCADE;


--
-- Name: reminder_done reminder_done_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reminder_done
    ADD CONSTRAINT reminder_done_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: reminder_done reminder_done_reminder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reminder_done
    ADD CONSTRAINT reminder_done_reminder_id_fkey FOREIGN KEY (reminder_id) REFERENCES public.reminders(id) ON DELETE CASCADE;


--
-- Name: reminder_fired reminder_fired_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reminder_fired
    ADD CONSTRAINT reminder_fired_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: reminder_fired reminder_fired_reminder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reminder_fired
    ADD CONSTRAINT reminder_fired_reminder_id_fkey FOREIGN KEY (reminder_id) REFERENCES public.reminders(id) ON DELETE CASCADE;


--
-- Name: reminder_recipients reminder_recipients_reminder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reminder_recipients
    ADD CONSTRAINT reminder_recipients_reminder_id_fkey FOREIGN KEY (reminder_id) REFERENCES public.reminders(id) ON DELETE CASCADE;


--
-- Name: reminders reminders_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reminders
    ADD CONSTRAINT reminders_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: resource_bookings resource_bookings_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.resource_bookings
    ADD CONSTRAINT resource_bookings_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;


--
-- Name: resource_bookings resource_bookings_requester_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.resource_bookings
    ADD CONSTRAINT resource_bookings_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: resource_bookings resource_bookings_resource_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.resource_bookings
    ADD CONSTRAINT resource_bookings_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES public.resources(id) ON DELETE CASCADE;


--
-- Name: resources resources_owner_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.resources
    ADD CONSTRAINT resources_owner_profile_id_fkey FOREIGN KEY (owner_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: resources resources_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.resources
    ADD CONSTRAINT resources_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE CASCADE;


--
-- Name: saved_items saved_items_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.saved_items
    ADD CONSTRAINT saved_items_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


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
-- Name: space_membership_requests space_membership_requests_initiated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.space_membership_requests
    ADD CONSTRAINT space_membership_requests_initiated_by_fkey FOREIGN KEY (initiated_by) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: space_membership_requests space_membership_requests_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.space_membership_requests
    ADD CONSTRAINT space_membership_requests_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: space_membership_requests space_membership_requests_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.space_membership_requests
    ADD CONSTRAINT space_membership_requests_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE CASCADE;


--
-- Name: space_nesting_requests space_nesting_requests_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.space_nesting_requests
    ADD CONSTRAINT space_nesting_requests_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.spaces(id) ON DELETE CASCADE;


--
-- Name: space_nesting_requests space_nesting_requests_initiated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.space_nesting_requests
    ADD CONSTRAINT space_nesting_requests_initiated_by_fkey FOREIGN KEY (initiated_by) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: space_nesting_requests space_nesting_requests_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.space_nesting_requests
    ADD CONSTRAINT space_nesting_requests_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.spaces(id) ON DELETE CASCADE;


--
-- Name: space_section_shares space_section_shares_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.space_section_shares
    ADD CONSTRAINT space_section_shares_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: space_section_shares space_section_shares_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.space_section_shares
    ADD CONSTRAINT space_section_shares_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: space_section_shares space_section_shares_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.space_section_shares
    ADD CONSTRAINT space_section_shares_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: space_section_shares space_section_shares_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.space_section_shares
    ADD CONSTRAINT space_section_shares_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE CASCADE;


--
-- Name: spaces spaces_cohort_of_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.spaces
    ADD CONSTRAINT spaces_cohort_of_fkey FOREIGN KEY (cohort_of) REFERENCES public.collections(id) ON DELETE SET NULL;


--
-- Name: spaces spaces_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.spaces
    ADD CONSTRAINT spaces_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: spaces spaces_parent_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.spaces
    ADD CONSTRAINT spaces_parent_space_id_fkey FOREIGN KEY (parent_space_id) REFERENCES public.spaces(id) ON DELETE SET NULL;


--
-- Name: subscriptions subscriptions_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: subscriptions subscriptions_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: task_shares task_shares_audience_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_shares
    ADD CONSTRAINT task_shares_audience_profile_id_fkey FOREIGN KEY (audience_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: task_shares task_shares_audience_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_shares
    ADD CONSTRAINT task_shares_audience_space_id_fkey FOREIGN KEY (audience_space_id) REFERENCES public.spaces(id) ON DELETE CASCADE;


--
-- Name: task_shares task_shares_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_shares
    ADD CONSTRAINT task_shares_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: todos todos_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.todos
    ADD CONSTRAINT todos_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: video_jobs video_jobs_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.video_jobs
    ADD CONSTRAINT video_jobs_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: category_suggestions Admins read all suggestions; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins read all suggestions" ON public.category_suggestions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND p.is_admin))));


--
-- Name: spaces Admins update their space; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins update their space" ON public.spaces FOR UPDATE USING (public.is_space_admin(id, auth.uid())) WITH CHECK (public.is_space_admin(id, auth.uid()));


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

CREATE POLICY "Profiles readable by authenticated" ON public.profiles FOR SELECT TO authenticated USING (public.can_see_profile(id));


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

CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (((auth.uid() = id) OR public.is_entity_steward(id, auth.uid()))) WITH CHECK (((auth.uid() = id) OR public.is_entity_steward(id, auth.uid())));


--
-- Name: category_aliases aliases: readable; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "aliases: readable" ON public.category_aliases FOR SELECT TO authenticated, anon USING (true);


--
-- Name: assistant_feed_posts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.assistant_feed_posts ENABLE ROW LEVEL SECURITY;

--
-- Name: assistant_identities; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.assistant_identities ENABLE ROW LEVEL SECURITY;

--
-- Name: assistant_queries; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.assistant_queries ENABLE ROW LEVEL SECURITY;

--
-- Name: availability_windows availability owner all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "availability owner all" ON public.availability_windows TO authenticated USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));


--
-- Name: availability_windows; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.availability_windows ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_types; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.booking_types ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_types booking_types owner all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "booking_types owner all" ON public.booking_types TO authenticated USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));


--
-- Name: booking_types booking_types visible; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "booking_types visible" ON public.booking_types FOR SELECT TO authenticated USING ((active AND ((audience = ANY (ARRAY['everyone'::text, 'public'::text])) OR ((audience = 'mycelium'::text) AND (EXISTS ( SELECT 1
   FROM public.mycelium m
  WHERE ((m.truster_id = booking_types.profile_id) AND (m.target_type = 'profile'::text) AND (m.target_id = auth.uid()))))) OR ((audience = 'space'::text) AND (audience_space_id IS NOT NULL) AND public.is_space_member(audience_space_id, auth.uid())))));


--
-- Name: bookings; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: bookings bookings participants read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "bookings participants read" ON public.bookings FOR SELECT TO authenticated USING (((auth.uid() = provider_id) OR (auth.uid() = booker_id)));


--
-- Name: calendar_pins; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.calendar_pins ENABLE ROW LEVEL SECURITY;

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

CREATE POLICY "care_posts delete" ON public.care_posts FOR DELETE USING ((public.is_active_caregiver(patient_id, auth.uid()) OR ((author_id = auth.uid()) AND (patient_id = auth.uid()))));


--
-- Name: care_posts care_posts insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "care_posts insert" ON public.care_posts FOR INSERT WITH CHECK (((author_id = auth.uid()) AND ((patient_id = auth.uid()) OR public.is_active_caregiver(patient_id, auth.uid()))));


--
-- Name: care_posts care_posts read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "care_posts read" ON public.care_posts FOR SELECT TO authenticated USING (public.is_on_care_team(patient_id, auth.uid()));


--
-- Name: care_posts care_posts update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "care_posts update" ON public.care_posts FOR UPDATE USING ((public.is_active_caregiver(patient_id, auth.uid()) OR ((author_id = auth.uid()) AND (patient_id = auth.uid())))) WITH CHECK (((author_id = auth.uid()) AND ((patient_id = auth.uid()) OR public.is_active_caregiver(patient_id, auth.uid()))));


--
-- Name: care_settings; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.care_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: care_settings care_settings care team read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "care_settings care team read" ON public.care_settings FOR SELECT USING (public.is_on_care_team(patient_id, auth.uid()));


--
-- Name: care_settings care_settings own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "care_settings own" ON public.care_settings USING ((patient_id = auth.uid())) WITH CHECK ((patient_id = auth.uid()));


--
-- Name: care_team_members; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.care_team_members ENABLE ROW LEVEL SECURITY;

--
-- Name: categories; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

--
-- Name: categories categories: readable; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "categories: readable" ON public.categories FOR SELECT TO anon USING (true);


--
-- Name: category_aliases; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.category_aliases ENABLE ROW LEVEL SECURITY;

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
-- Name: collection_items citems: read via collection; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "citems: read via collection" ON public.collection_items FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.collections c
  WHERE ((c.id = collection_items.collection_id) AND ((c.owner_id = auth.uid()) OR c.is_public OR ((c.space_id IS NOT NULL) AND (EXISTS ( SELECT 1
           FROM public.space_members m
          WHERE ((m.space_id = c.space_id) AND (m.profile_id = auth.uid()))))))))));


--
-- Name: collection_items citems: write own or stewarded; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "citems: write own or stewarded" ON public.collection_items TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.collections c
  WHERE ((c.id = collection_items.collection_id) AND ((c.owner_id = auth.uid()) OR ((c.space_id IS NOT NULL) AND public.has_space_duty(c.space_id, auth.uid(), public.collection_duty(c.kind)))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.collections c
  WHERE ((c.id = collection_items.collection_id) AND ((c.owner_id = auth.uid()) OR ((c.space_id IS NOT NULL) AND public.has_space_duty(c.space_id, auth.uid(), public.collection_duty(c.kind))))))));


--
-- Name: collection_enrollments col_enroll_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY col_enroll_own ON public.collection_enrollments USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));


--
-- Name: collection_progress col_progress_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY col_progress_own ON public.collection_progress USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));


--
-- Name: collection_enrollments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.collection_enrollments ENABLE ROW LEVEL SECURITY;

--
-- Name: collection_items; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.collection_items ENABLE ROW LEVEL SECURITY;

--
-- Name: collection_items collection_items: public read (anon); Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "collection_items: public read (anon)" ON public.collection_items FOR SELECT TO anon USING ((EXISTS ( SELECT 1
   FROM public.collections c
  WHERE ((c.id = collection_items.collection_id) AND c.is_public))));


--
-- Name: collection_progress; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.collection_progress ENABLE ROW LEVEL SECURITY;

--
-- Name: collection_suggestions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.collection_suggestions ENABLE ROW LEVEL SECURITY;

--
-- Name: collections; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;

--
-- Name: collections collections: delete own or stewarded; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "collections: delete own or stewarded" ON public.collections FOR DELETE TO authenticated USING (((owner_id = auth.uid()) OR ((space_id IS NOT NULL) AND public.has_space_duty(space_id, auth.uid(), public.collection_duty(kind)))));


--
-- Name: collections collections: insert own or stewarded; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "collections: insert own or stewarded" ON public.collections FOR INSERT TO authenticated WITH CHECK (((owner_id = auth.uid()) AND ((space_id IS NULL) OR public.has_space_duty(space_id, auth.uid(), public.collection_duty(kind)))));


--
-- Name: collections collections: public read (anon); Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "collections: public read (anon)" ON public.collections FOR SELECT TO anon USING (is_public);


--
-- Name: collections collections: read own, public, or space; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "collections: read own, public, or space" ON public.collections FOR SELECT TO authenticated USING (((owner_id = auth.uid()) OR is_public OR ((space_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.space_members m
  WHERE ((m.space_id = collections.space_id) AND (m.profile_id = auth.uid())))))));


--
-- Name: collections collections: update own or stewarded; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "collections: update own or stewarded" ON public.collections FOR UPDATE TO authenticated USING (((owner_id = auth.uid()) OR ((space_id IS NOT NULL) AND public.has_space_duty(space_id, auth.uid(), public.collection_duty(kind))))) WITH CHECK (((owner_id = auth.uid()) OR ((space_id IS NOT NULL) AND public.has_space_duty(space_id, auth.uid(), public.collection_duty(kind)))));


--
-- Name: collection_suggestions csugg: read own or curator; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "csugg: read own or curator" ON public.collection_suggestions FOR SELECT TO authenticated USING (((suggested_by = auth.uid()) OR public.is_collection_curator(collection_id, auth.uid())));


--
-- Name: collection_suggestions csugg: suggest to visible collections; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "csugg: suggest to visible collections" ON public.collection_suggestions FOR INSERT TO authenticated WITH CHECK (((suggested_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.collections c
  WHERE (c.id = collection_suggestions.collection_id)))));


--
-- Name: collection_suggestions csugg: withdraw own pending; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "csugg: withdraw own pending" ON public.collection_suggestions FOR DELETE TO authenticated USING (((suggested_by = auth.uid()) AND (status = 'pending'::text)));


--
-- Name: donations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;

--
-- Name: donations donations_admin_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY donations_admin_read ON public.donations FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND p.is_admin))));


--
-- Name: donations donations_donor_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY donations_donor_read ON public.donations FOR SELECT TO authenticated USING ((donor_profile_id = auth.uid()));


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
-- Name: event_guests; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.event_guests ENABLE ROW LEVEL SECURITY;

--
-- Name: event_guests event_guests_host; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY event_guests_host ON public.event_guests USING ((invited_by = auth.uid())) WITH CHECK ((invited_by = auth.uid()));


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
  WHERE (p.linked_event_id = events.id)))));


--
-- Name: events events update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "events update" ON public.events FOR UPDATE TO authenticated USING ((creator_id = auth.uid())) WITH CHECK ((creator_id = auth.uid()));


--
-- Name: exchanges; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.exchanges ENABLE ROW LEVEL SECURITY;

--
-- Name: exchanges exchanges: parties read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "exchanges: parties read" ON public.exchanges FOR SELECT TO authenticated USING (((buyer_id = auth.uid()) OR (seller_id = auth.uid()) OR ((seller_space_id IS NOT NULL) AND public.is_space_admin(seller_space_id, auth.uid())) OR ((buyer_space_id IS NOT NULL) AND public.is_space_admin(buyer_space_id, auth.uid())) OR public.is_guardian_of(buyer_id, auth.uid()) OR public.is_guardian_of(seller_id, auth.uid())));


--
-- Name: external_busy; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.external_busy ENABLE ROW LEVEL SECURITY;

--
-- Name: external_calendars; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.external_calendars ENABLE ROW LEVEL SECURITY;

--
-- Name: financial_positions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.financial_positions ENABLE ROW LEVEL SECURITY;

--
-- Name: google_calendar_accounts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.google_calendar_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: guardians; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.guardians ENABLE ROW LEVEL SECURITY;

--
-- Name: guardians guardians: parties read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "guardians: parties read" ON public.guardians FOR SELECT TO authenticated USING (((minor_id = auth.uid()) OR (guardian_id = auth.uid())));


--
-- Name: health_snapshots; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.health_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: hidden_posts hidden: own only; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "hidden: own only" ON public.hidden_posts TO authenticated USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));


--
-- Name: hidden_posts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.hidden_posts ENABLE ROW LEVEL SECURITY;

--
-- Name: inkind_donations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.inkind_donations ENABLE ROW LEVEL SECURITY;

--
-- Name: inkind_donations inkind_own_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY inkind_own_insert ON public.inkind_donations FOR INSERT TO authenticated WITH CHECK ((donor_profile_id = auth.uid()));


--
-- Name: inkind_donations inkind_own_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY inkind_own_read ON public.inkind_donations FOR SELECT TO authenticated USING (((donor_profile_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND p.is_admin)))));


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
-- Name: invite_tokens; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.invite_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: invite_tokens invites: admins see all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "invites: admins see all" ON public.invite_tokens FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND p.is_admin))));


--
-- Name: invite_tokens invites: mine; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "invites: mine" ON public.invite_tokens FOR SELECT TO authenticated USING (((created_by = auth.uid()) OR (claimed_by = auth.uid())));


--
-- Name: invite_tokens invites: mint; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "invites: mint" ON public.invite_tokens FOR INSERT TO authenticated WITH CHECK ((created_by = auth.uid()));


--
-- Name: join_requests; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.join_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: join_requests knocks: admins; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "knocks: admins" ON public.join_requests FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND p.is_admin))));


--
-- Name: join_requests knocks: admins decide; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "knocks: admins decide" ON public.join_requests FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND p.is_admin))));


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
-- Name: ledger_entries; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: ledger_entries ledger_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ledger_read ON public.ledger_entries FOR SELECT TO authenticated USING ((((from_type = 'profile'::text) AND (from_id = auth.uid())) OR ((to_type = 'profile'::text) AND (to_id = auth.uid())) OR ((from_type = 'space'::text) AND (EXISTS ( SELECT 1
   FROM public.space_members m
  WHERE ((m.space_id = ledger_entries.from_id) AND (m.profile_id = auth.uid()))))) OR ((to_type = 'space'::text) AND (EXISTS ( SELECT 1
   FROM public.space_members m
  WHERE ((m.space_id = ledger_entries.to_id) AND (m.profile_id = auth.uid()))))) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND p.is_admin)))));


--
-- Name: location_shares; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.location_shares ENABLE ROW LEVEL SECURITY;

--
-- Name: location_shares location_shares owner all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "location_shares owner all" ON public.location_shares TO authenticated USING ((owner_id = auth.uid())) WITH CHECK ((owner_id = auth.uid()));


--
-- Name: profile_locations locations readable by members; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "locations readable by members" ON public.profile_locations FOR SELECT TO authenticated USING (true);


--
-- Name: financial_positions means: care team reads; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "means: care team reads" ON public.financial_positions FOR SELECT TO authenticated USING ((care_team_visible AND (EXISTS ( SELECT 1
   FROM public.care_team_members c
  WHERE ((c.patient_id = financial_positions.profile_id) AND (c.caregiver_id = auth.uid()) AND (c.status = 'active'::text))))));


--
-- Name: financial_positions means: own all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "means: own all" ON public.financial_positions TO authenticated USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));


--
-- Name: member_prompts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.member_prompts ENABLE ROW LEVEL SECURITY;

--
-- Name: membership_gifts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.membership_gifts ENABLE ROW LEVEL SECURITY;

--
-- Name: membership_gifts membership_gifts: admins all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "membership_gifts: admins all" ON public.membership_gifts TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND p.is_admin)))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND p.is_admin))));


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

CREATE POLICY "mycelium: add own" ON public.mycelium FOR INSERT TO authenticated WITH CHECK (((truster_id = auth.uid()) AND ((truster_space_id IS NULL) OR public.is_space_admin(truster_space_id, auth.uid()))));


--
-- Name: mycelium mycelium: drop own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "mycelium: drop own" ON public.mycelium FOR DELETE TO authenticated USING (((truster_id = auth.uid()) OR ((truster_space_id IS NOT NULL) AND public.is_space_admin(truster_space_id, auth.uid()))));


--
-- Name: mycelium mycelium: read own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "mycelium: read own" ON public.mycelium FOR SELECT USING (((truster_id = auth.uid()) OR ((truster_space_id IS NOT NULL) AND public.is_space_member(truster_space_id, auth.uid()))));


--
-- Name: mycelium mycelium: update own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "mycelium: update own" ON public.mycelium FOR UPDATE TO authenticated USING (((truster_id = auth.uid()) OR ((truster_space_id IS NOT NULL) AND public.is_space_admin(truster_space_id, auth.uid())))) WITH CHECK (((truster_id = auth.uid()) OR ((truster_space_id IS NOT NULL) AND public.is_space_admin(truster_space_id, auth.uid()))));


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
-- Name: calendar_pins own calendar pins; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "own calendar pins" ON public.calendar_pins TO authenticated USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));


--
-- Name: external_busy own external busy; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "own external busy" ON public.external_busy TO authenticated USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));


--
-- Name: external_calendars own external calendars; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "own external calendars" ON public.external_calendars TO authenticated USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));


--
-- Name: assistant_feed_posts own feed read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "own feed read" ON public.assistant_feed_posts FOR SELECT TO authenticated USING ((profile_id = auth.uid()));


--
-- Name: assistant_feed_posts own feed write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "own feed write" ON public.assistant_feed_posts FOR INSERT TO authenticated WITH CHECK (((profile_id = auth.uid()) AND (author = 'member'::text)));


--
-- Name: profile_locations own locations: all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "own locations: all" ON public.profile_locations TO authenticated USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));


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

CREATE POLICY "posts: insert own" ON public.posts FOR INSERT TO authenticated WITH CHECK ((((author_id = auth.uid()) OR public.is_entity_steward(author_id, auth.uid())) AND (is_public OR to_mycelium OR (cardinality(audience_space_ids) > 0)) AND (NOT (EXISTS ( SELECT 1
   FROM unnest(posts.audience_space_ids) a(sid)
  WHERE (NOT (EXISTS ( SELECT 1
           FROM public.space_members m
          WHERE ((m.space_id = a.sid) AND (m.profile_id = auth.uid())))))))) AND ((author_space_id IS NULL) OR public.is_space_admin(author_space_id, auth.uid()))));


--
-- Name: posts posts: public read (anon); Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "posts: public read (anon)" ON public.posts FOR SELECT TO anon USING ((visibility = 'public'::text));


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
-- Name: profile_categories profile_categories: public pages; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "profile_categories: public pages" ON public.profile_categories FOR SELECT TO anon USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = profile_categories.profile_id) AND p.public_page AND p.onboarded))));


--
-- Name: profile_locations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.profile_locations ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles: public pages; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "profiles: public pages" ON public.profiles FOR SELECT TO anon USING (((public_page = true) AND (onboarded = true)));


--
-- Name: member_prompts prompts: own read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "prompts: own read" ON public.member_prompts FOR SELECT TO authenticated USING ((profile_id = auth.uid()));


--
-- Name: member_prompts prompts: own update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "prompts: own update" ON public.member_prompts FOR UPDATE TO authenticated USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));


--
-- Name: member_prompts prompts: own write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "prompts: own write" ON public.member_prompts FOR INSERT TO authenticated WITH CHECK ((profile_id = auth.uid()));


--
-- Name: push_subscriptions push_subs_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY push_subs_own ON public.push_subscriptions USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));


--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: resource_bookings rb: parties read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "rb: parties read" ON public.resource_bookings FOR SELECT TO authenticated USING (((requester_id = auth.uid()) OR public.is_resource_steward(resource_id, auth.uid())));


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
-- Name: reminder_done; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.reminder_done ENABLE ROW LEVEL SECURITY;

--
-- Name: reminder_done reminder_done read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "reminder_done read" ON public.reminder_done FOR SELECT USING (((profile_id = auth.uid()) OR public.is_on_reminder(reminder_id, auth.uid())));


--
-- Name: reminder_done reminder_done tick; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "reminder_done tick" ON public.reminder_done FOR INSERT WITH CHECK ((profile_id = auth.uid()));


--
-- Name: reminder_done reminder_done untick; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "reminder_done untick" ON public.reminder_done FOR DELETE USING (((profile_id = auth.uid()) OR (public.is_on_reminder(reminder_id, auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.reminders r
  WHERE ((r.id = reminder_done.reminder_id) AND (r.done_mode = 'shared'::text)))))));


--
-- Name: reminder_done reminder_done update own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "reminder_done update own" ON public.reminder_done FOR UPDATE USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));


--
-- Name: reminder_fired; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.reminder_fired ENABLE ROW LEVEL SECURITY;

--
-- Name: reminder_recipients; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.reminder_recipients ENABLE ROW LEVEL SECURITY;

--
-- Name: reminder_recipients reminder_recipients leave; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "reminder_recipients leave" ON public.reminder_recipients FOR DELETE USING (((recipient_type = 'profile'::text) AND (recipient_id = auth.uid())));


--
-- Name: reminder_recipients reminder_recipients_owner; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY reminder_recipients_owner ON public.reminder_recipients USING (public.owns_reminder(reminder_id)) WITH CHECK (public.owns_reminder(reminder_id));


--
-- Name: reminder_recipients reminder_recipients_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY reminder_recipients_read ON public.reminder_recipients FOR SELECT USING ((((recipient_type = 'profile'::text) AND (recipient_id = auth.uid())) OR ((recipient_type = 'space'::text) AND (EXISTS ( SELECT 1
   FROM public.space_members m
  WHERE ((m.space_id = reminder_recipients.recipient_id) AND (m.profile_id = auth.uid())))))));


--
-- Name: reminders; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;

--
-- Name: reminders reminders_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY reminders_own ON public.reminders USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));


--
-- Name: reminders reminders_recipient_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY reminders_recipient_read ON public.reminders FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.reminder_recipients rr
  WHERE ((rr.reminder_id = reminders.id) AND (((rr.recipient_type = 'profile'::text) AND (rr.recipient_id = auth.uid())) OR ((rr.recipient_type = 'space'::text) AND (EXISTS ( SELECT 1
           FROM public.space_members m
          WHERE ((m.space_id = rr.recipient_id) AND (m.profile_id = auth.uid()))))))))));


--
-- Name: resource_bookings; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.resource_bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: resources; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;

--
-- Name: resources resources: read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "resources: read" ON public.resources FOR SELECT TO authenticated USING (true);


--
-- Name: resources resources: steward writes; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "resources: steward writes" ON public.resources TO authenticated USING (((owner_profile_id = auth.uid()) OR ((space_id IS NOT NULL) AND public.is_space_admin(space_id, auth.uid())))) WITH CHECK (((owner_profile_id = auth.uid()) OR ((space_id IS NOT NULL) AND public.is_space_admin(space_id, auth.uid()))));


--
-- Name: saved_items; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.saved_items ENABLE ROW LEVEL SECURITY;

--
-- Name: saved_items saves: own only; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "saves: own only" ON public.saved_items TO authenticated USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));


--
-- Name: space_membership_requests smr: read own or admin; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "smr: read own or admin" ON public.space_membership_requests FOR SELECT USING (((profile_id = auth.uid()) OR public.is_space_admin(space_id, auth.uid())));


--
-- Name: space_membership_requests smr: request, invite, or suggest; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "smr: request, invite, or suggest" ON public.space_membership_requests FOR INSERT TO authenticated WITH CHECK ((((profile_id = auth.uid()) AND (initiated_by = auth.uid())) OR ((initiated_by = auth.uid()) AND (profile_id <> auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.space_members m
  WHERE ((m.space_id = space_membership_requests.space_id) AND (m.profile_id = auth.uid())))))));


--
-- Name: space_membership_requests smr: withdraw or decline; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "smr: withdraw or decline" ON public.space_membership_requests FOR DELETE USING (((profile_id = auth.uid()) OR public.is_space_admin(space_id, auth.uid())));


--
-- Name: space_nesting_requests snr: group admins propose; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "snr: group admins propose" ON public.space_nesting_requests FOR INSERT WITH CHECK (((initiated_by = auth.uid()) AND public.is_space_admin(group_id, auth.uid())));


--
-- Name: space_nesting_requests snr: read either side; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "snr: read either side" ON public.space_nesting_requests FOR SELECT USING ((public.is_space_admin(group_id, auth.uid()) OR public.is_space_admin(parent_id, auth.uid())));


--
-- Name: space_nesting_requests snr: withdraw or decline; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "snr: withdraw or decline" ON public.space_nesting_requests FOR DELETE USING ((public.is_space_admin(group_id, auth.uid()) OR public.is_space_admin(parent_id, auth.uid())));


--
-- Name: space_members; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.space_members ENABLE ROW LEVEL SECURITY;

--
-- Name: space_membership_requests; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.space_membership_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: space_nesting_requests; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.space_nesting_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: space_section_shares; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.space_section_shares ENABLE ROW LEVEL SECURITY;

--
-- Name: spaces; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.spaces ENABLE ROW LEVEL SECURITY;

--
-- Name: spaces spaces: public pages; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "spaces: public pages" ON public.spaces FOR SELECT TO anon USING ((public_page = true));


--
-- Name: space_section_shares sss: read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "sss: read" ON public.space_section_shares FOR SELECT TO authenticated USING (((status = 'approved'::text) OR (requested_by = auth.uid()) OR public.is_space_admin(space_id, auth.uid())));


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
-- Name: task_shares; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.task_shares ENABLE ROW LEVEL SECURITY;

--
-- Name: task_shares task_shares owner; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "task_shares owner" ON public.task_shares USING ((owner_id = auth.uid())) WITH CHECK ((owner_id = auth.uid()));


--
-- Name: todos; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;

--
-- Name: todos todos_own_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY todos_own_all ON public.todos TO authenticated USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));


--
-- Name: video_jobs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.video_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: video_jobs vjobs: insert own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "vjobs: insert own" ON public.video_jobs FOR INSERT TO authenticated WITH CHECK ((profile_id = auth.uid()));


--
-- Name: video_jobs vjobs: read for playback; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "vjobs: read for playback" ON public.video_jobs FOR SELECT TO authenticated USING (true);


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
-- Name: FUNCTION accept_inkind_donation(p_id uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.accept_inkind_donation(p_id uuid) TO anon;
GRANT ALL ON FUNCTION public.accept_inkind_donation(p_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.accept_inkind_donation(p_id uuid) TO service_role;


--
-- Name: FUNCTION accept_space_invite(p_space uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.accept_space_invite(p_space uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.accept_space_invite(p_space uuid) TO authenticated;
GRANT ALL ON FUNCTION public.accept_space_invite(p_space uuid) TO service_role;


--
-- Name: FUNCTION admin_list_supporters(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.admin_list_supporters() TO anon;
GRANT ALL ON FUNCTION public.admin_list_supporters() TO authenticated;
GRANT ALL ON FUNCTION public.admin_list_supporters() TO service_role;


--
-- Name: FUNCTION admin_search_members(p_q text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.admin_search_members(p_q text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_search_members(p_q text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_search_members(p_q text) TO service_role;


--
-- Name: FUNCTION alias_category_suggestion(p_suggestion uuid, p_category text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.alias_category_suggestion(p_suggestion uuid, p_category text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.alias_category_suggestion(p_suggestion uuid, p_category text) TO authenticated;
GRANT ALL ON FUNCTION public.alias_category_suggestion(p_suggestion uuid, p_category text) TO service_role;


--
-- Name: FUNCTION approve_category_suggestion(p_suggestion_id uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.approve_category_suggestion(p_suggestion_id uuid) TO anon;
GRANT ALL ON FUNCTION public.approve_category_suggestion(p_suggestion_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.approve_category_suggestion(p_suggestion_id uuid) TO service_role;


--
-- Name: FUNCTION approve_exchange_guardian(p_exchange uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.approve_exchange_guardian(p_exchange uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.approve_exchange_guardian(p_exchange uuid) TO authenticated;
GRANT ALL ON FUNCTION public.approve_exchange_guardian(p_exchange uuid) TO service_role;


--
-- Name: FUNCTION approve_group_nesting(p_group uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.approve_group_nesting(p_group uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.approve_group_nesting(p_group uuid) TO authenticated;
GRANT ALL ON FUNCTION public.approve_group_nesting(p_group uuid) TO service_role;


--
-- Name: FUNCTION approve_join_request(p_space uuid, p_profile uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.approve_join_request(p_space uuid, p_profile uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.approve_join_request(p_space uuid, p_profile uuid) TO authenticated;
GRANT ALL ON FUNCTION public.approve_join_request(p_space uuid, p_profile uuid) TO service_role;


--
-- Name: FUNCTION assistant_on_feed_post(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.assistant_on_feed_post() TO anon;
GRANT ALL ON FUNCTION public.assistant_on_feed_post() TO authenticated;
GRANT ALL ON FUNCTION public.assistant_on_feed_post() TO service_role;


--
-- Name: FUNCTION assistant_on_message(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.assistant_on_message() TO anon;
GRANT ALL ON FUNCTION public.assistant_on_message() TO authenticated;
GRANT ALL ON FUNCTION public.assistant_on_message() TO service_role;


--
-- Name: FUNCTION availability_of(p_profiles uuid[]); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.availability_of(p_profiles uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.availability_of(p_profiles uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.availability_of(p_profiles uuid[]) TO service_role;


--
-- Name: FUNCTION booking_board(p_type uuid, p_from date, p_to date); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.booking_board(p_type uuid, p_from date, p_to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.booking_board(p_type uuid, p_from date, p_to date) TO authenticated;
GRANT ALL ON FUNCTION public.booking_board(p_type uuid, p_from date, p_to date) TO service_role;


--
-- Name: FUNCTION booking_type_visible(p_type uuid, p_viewer uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.booking_type_visible(p_type uuid, p_viewer uuid) TO anon;
GRANT ALL ON FUNCTION public.booking_type_visible(p_type uuid, p_viewer uuid) TO authenticated;
GRANT ALL ON FUNCTION public.booking_type_visible(p_type uuid, p_viewer uuid) TO service_role;


--
-- Name: FUNCTION burn_currentcy(p_from_type text, p_from_id uuid, p_amount numeric, p_memo text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.burn_currentcy(p_from_type text, p_from_id uuid, p_amount numeric, p_memo text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.burn_currentcy(p_from_type text, p_from_id uuid, p_amount numeric, p_memo text) TO authenticated;
GRANT ALL ON FUNCTION public.burn_currentcy(p_from_type text, p_from_id uuid, p_amount numeric, p_memo text) TO service_role;


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
-- Name: FUNCTION can_see_profile(p_target uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.can_see_profile(p_target uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_see_profile(p_target uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_see_profile(p_target uuid) TO service_role;


--
-- Name: FUNCTION cancel_booking(p_booking uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.cancel_booking(p_booking uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_booking(p_booking uuid) TO authenticated;
GRANT ALL ON FUNCTION public.cancel_booking(p_booking uuid) TO service_role;


--
-- Name: FUNCTION cancel_exchange(p_exchange uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.cancel_exchange(p_exchange uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_exchange(p_exchange uuid) TO authenticated;
GRANT ALL ON FUNCTION public.cancel_exchange(p_exchange uuid) TO service_role;


--
-- Name: FUNCTION cancel_resource_booking(p_booking uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.cancel_resource_booking(p_booking uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_resource_booking(p_booking uuid) TO authenticated;
GRANT ALL ON FUNCTION public.cancel_resource_booking(p_booking uuid) TO service_role;


--
-- Name: FUNCTION care_member_display(p_ids uuid[]); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.care_member_display(p_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.care_member_display(p_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.care_member_display(p_ids uuid[]) TO service_role;


--
-- Name: FUNCTION chat_unread_counts(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.chat_unread_counts() TO anon;
GRANT ALL ON FUNCTION public.chat_unread_counts() TO authenticated;
GRANT ALL ON FUNCTION public.chat_unread_counts() TO service_role;


--
-- Name: FUNCTION check_invite(p_token uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.check_invite(p_token uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.check_invite(p_token uuid) TO anon;
GRANT ALL ON FUNCTION public.check_invite(p_token uuid) TO authenticated;
GRANT ALL ON FUNCTION public.check_invite(p_token uuid) TO service_role;


--
-- Name: FUNCTION check_offering_recommend(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.check_offering_recommend() TO anon;
GRANT ALL ON FUNCTION public.check_offering_recommend() TO authenticated;
GRANT ALL ON FUNCTION public.check_offering_recommend() TO service_role;


--
-- Name: FUNCTION check_recommend_voice(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.check_recommend_voice() TO anon;
GRANT ALL ON FUNCTION public.check_recommend_voice() TO authenticated;
GRANT ALL ON FUNCTION public.check_recommend_voice() TO service_role;


--
-- Name: FUNCTION claim_care_invitations(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.claim_care_invitations() TO anon;
GRANT ALL ON FUNCTION public.claim_care_invitations() TO authenticated;
GRANT ALL ON FUNCTION public.claim_care_invitations() TO service_role;


--
-- Name: FUNCTION claim_gifts_for_email(p_user uuid, p_email text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.claim_gifts_for_email(p_user uuid, p_email text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_gifts_for_email(p_user uuid, p_email text) TO service_role;


--
-- Name: FUNCTION claim_invite(p_token uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.claim_invite(p_token uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_invite(p_token uuid) TO authenticated;
GRANT ALL ON FUNCTION public.claim_invite(p_token uuid) TO service_role;


--
-- Name: FUNCTION claim_membership_gift(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.claim_membership_gift() TO anon;
GRANT ALL ON FUNCTION public.claim_membership_gift() TO authenticated;
GRANT ALL ON FUNCTION public.claim_membership_gift() TO service_role;


--
-- Name: FUNCTION collection_duty(p_kind text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.collection_duty(p_kind text) TO anon;
GRANT ALL ON FUNCTION public.collection_duty(p_kind text) TO authenticated;
GRANT ALL ON FUNCTION public.collection_duty(p_kind text) TO service_role;


--
-- Name: FUNCTION complete_exchange(p_exchange uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.complete_exchange(p_exchange uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.complete_exchange(p_exchange uuid) TO authenticated;
GRANT ALL ON FUNCTION public.complete_exchange(p_exchange uuid) TO service_role;


--
-- Name: FUNCTION compose_full_name(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.compose_full_name() TO anon;
GRANT ALL ON FUNCTION public.compose_full_name() TO authenticated;
GRANT ALL ON FUNCTION public.compose_full_name() TO service_role;


--
-- Name: FUNCTION confirm_resource_booking_inner(p_booking uuid, p_actor uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.confirm_resource_booking_inner(p_booking uuid, p_actor uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.confirm_resource_booking_inner(p_booking uuid, p_actor uuid) TO service_role;


--
-- Name: FUNCTION create_booking(p_type uuid, p_date date, p_start integer, p_note text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.create_booking(p_type uuid, p_date date, p_start integer, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_booking(p_type uuid, p_date date, p_start integer, p_note text) TO authenticated;
GRANT ALL ON FUNCTION public.create_booking(p_type uuid, p_date date, p_start integer, p_note text) TO service_role;


--
-- Name: FUNCTION create_entity_profile(p_name text, p_kind text, p_aspect text, p_steward_space uuid, p_jurisdiction text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.create_entity_profile(p_name text, p_kind text, p_aspect text, p_steward_space uuid, p_jurisdiction text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_entity_profile(p_name text, p_kind text, p_aspect text, p_steward_space uuid, p_jurisdiction text) TO authenticated;
GRANT ALL ON FUNCTION public.create_entity_profile(p_name text, p_kind text, p_aspect text, p_steward_space uuid, p_jurisdiction text) TO service_role;


--
-- Name: FUNCTION create_space_chat(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.create_space_chat() TO anon;
GRANT ALL ON FUNCTION public.create_space_chat() TO authenticated;
GRANT ALL ON FUNCTION public.create_space_chat() TO service_role;


--
-- Name: FUNCTION currentcy_float_summary(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.currentcy_float_summary() TO anon;
GRANT ALL ON FUNCTION public.currentcy_float_summary() TO authenticated;
GRANT ALL ON FUNCTION public.currentcy_float_summary() TO service_role;


--
-- Name: FUNCTION decide_exchange(p_exchange uuid, p_accept boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.decide_exchange(p_exchange uuid, p_accept boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.decide_exchange(p_exchange uuid, p_accept boolean) TO authenticated;
GRANT ALL ON FUNCTION public.decide_exchange(p_exchange uuid, p_accept boolean) TO service_role;


--
-- Name: FUNCTION decide_resource_booking(p_booking uuid, p_approve boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.decide_resource_booking(p_booking uuid, p_approve boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.decide_resource_booking(p_booking uuid, p_approve boolean) TO authenticated;
GRANT ALL ON FUNCTION public.decide_resource_booking(p_booking uuid, p_approve boolean) TO service_role;


--
-- Name: FUNCTION decide_section_share(p_space uuid, p_post uuid, p_area text, p_approve boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.decide_section_share(p_space uuid, p_post uuid, p_area text, p_approve boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.decide_section_share(p_space uuid, p_post uuid, p_area text, p_approve boolean) TO authenticated;
GRANT ALL ON FUNCTION public.decide_section_share(p_space uuid, p_post uuid, p_area text, p_approve boolean) TO service_role;


--
-- Name: FUNCTION decline_inkind_donation(p_id uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.decline_inkind_donation(p_id uuid) TO anon;
GRANT ALL ON FUNCTION public.decline_inkind_donation(p_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.decline_inkind_donation(p_id uuid) TO service_role;


--
-- Name: FUNCTION eject_group(p_group uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.eject_group(p_group uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.eject_group(p_group uuid) TO authenticated;
GRANT ALL ON FUNCTION public.eject_group(p_group uuid) TO service_role;


--
-- Name: FUNCTION endorse_member_suggestion(p_space uuid, p_profile uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.endorse_member_suggestion(p_space uuid, p_profile uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.endorse_member_suggestion(p_space uuid, p_profile uuid) TO authenticated;
GRANT ALL ON FUNCTION public.endorse_member_suggestion(p_space uuid, p_profile uuid) TO service_role;


--
-- Name: FUNCTION enforce_parent_consent(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.enforce_parent_consent() TO anon;
GRANT ALL ON FUNCTION public.enforce_parent_consent() TO authenticated;
GRANT ALL ON FUNCTION public.enforce_parent_consent() TO service_role;


--
-- Name: FUNCTION enforce_weaveable(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.enforce_weaveable() TO anon;
GRANT ALL ON FUNCTION public.enforce_weaveable() TO authenticated;
GRANT ALL ON FUNCTION public.enforce_weaveable() TO service_role;


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
-- Name: FUNCTION external_calendar_level(p_cal uuid, p_owner uuid, p_viewer uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.external_calendar_level(p_cal uuid, p_owner uuid, p_viewer uuid) TO anon;
GRANT ALL ON FUNCTION public.external_calendar_level(p_cal uuid, p_owner uuid, p_viewer uuid) TO authenticated;
GRANT ALL ON FUNCTION public.external_calendar_level(p_cal uuid, p_owner uuid, p_viewer uuid) TO service_role;


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
-- Name: FUNCTION gift_span_text(p_months integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.gift_span_text(p_months integer) TO anon;
GRANT ALL ON FUNCTION public.gift_span_text(p_months integer) TO authenticated;
GRANT ALL ON FUNCTION public.gift_span_text(p_months integer) TO service_role;


--
-- Name: FUNCTION gift_subscription(p_email text, p_tier text, p_months integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.gift_subscription(p_email text, p_tier text, p_months integer) TO anon;
GRANT ALL ON FUNCTION public.gift_subscription(p_email text, p_tier text, p_months integer) TO authenticated;
GRANT ALL ON FUNCTION public.gift_subscription(p_email text, p_tier text, p_months integer) TO service_role;


--
-- Name: FUNCTION grant_growth_gift(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.grant_growth_gift() TO anon;
GRANT ALL ON FUNCTION public.grant_growth_gift() TO authenticated;
GRANT ALL ON FUNCTION public.grant_growth_gift() TO service_role;


--
-- Name: FUNCTION guest_booking(p_token text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.guest_booking(p_token text) TO anon;
GRANT ALL ON FUNCTION public.guest_booking(p_token text) TO authenticated;
GRANT ALL ON FUNCTION public.guest_booking(p_token text) TO service_role;


--
-- Name: FUNCTION guest_cancel_booking(p_token text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.guest_cancel_booking(p_token text) TO anon;
GRANT ALL ON FUNCTION public.guest_cancel_booking(p_token text) TO authenticated;
GRANT ALL ON FUNCTION public.guest_cancel_booking(p_token text) TO service_role;


--
-- Name: FUNCTION guest_create_booking(p_type uuid, p_date date, p_start integer, p_name text, p_email text, p_note text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.guest_create_booking(p_type uuid, p_date date, p_start integer, p_name text, p_email text, p_note text) TO anon;
GRANT ALL ON FUNCTION public.guest_create_booking(p_type uuid, p_date date, p_start integer, p_name text, p_email text, p_note text) TO authenticated;
GRANT ALL ON FUNCTION public.guest_create_booking(p_type uuid, p_date date, p_start integer, p_name text, p_email text, p_note text) TO service_role;


--
-- Name: FUNCTION guest_event(p_token text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.guest_event(p_token text) TO anon;
GRANT ALL ON FUNCTION public.guest_event(p_token text) TO authenticated;
GRANT ALL ON FUNCTION public.guest_event(p_token text) TO service_role;


--
-- Name: FUNCTION guest_rsvp(p_token text, p_status text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.guest_rsvp(p_token text, p_status text) TO anon;
GRANT ALL ON FUNCTION public.guest_rsvp(p_token text, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.guest_rsvp(p_token text, p_status text) TO service_role;


--
-- Name: FUNCTION handle_auth_user_deleted(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.handle_auth_user_deleted() TO anon;
GRANT ALL ON FUNCTION public.handle_auth_user_deleted() TO authenticated;
GRANT ALL ON FUNCTION public.handle_auth_user_deleted() TO service_role;


--
-- Name: FUNCTION handle_new_category_suggestion(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.handle_new_category_suggestion() TO anon;
GRANT ALL ON FUNCTION public.handle_new_category_suggestion() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_category_suggestion() TO service_role;


--
-- Name: FUNCTION handle_new_collection_suggestion(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.handle_new_collection_suggestion() TO anon;
GRANT ALL ON FUNCTION public.handle_new_collection_suggestion() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_collection_suggestion() TO service_role;


--
-- Name: FUNCTION handle_new_nesting_request(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.handle_new_nesting_request() TO anon;
GRANT ALL ON FUNCTION public.handle_new_nesting_request() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_nesting_request() TO service_role;


--
-- Name: FUNCTION handle_new_space(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.handle_new_space() TO anon;
GRANT ALL ON FUNCTION public.handle_new_space() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_space() TO service_role;


--
-- Name: FUNCTION handle_new_space_request(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.handle_new_space_request() TO anon;
GRANT ALL ON FUNCTION public.handle_new_space_request() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_space_request() TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION handle_section_shares(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.handle_section_shares() TO anon;
GRANT ALL ON FUNCTION public.handle_section_shares() TO authenticated;
GRANT ALL ON FUNCTION public.handle_section_shares() TO service_role;


--
-- Name: FUNCTION has_space_duty(p_space uuid, p_uid uuid, p_duty text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.has_space_duty(p_space uuid, p_uid uuid, p_duty text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.has_space_duty(p_space uuid, p_uid uuid, p_duty text) TO authenticated;
GRANT ALL ON FUNCTION public.has_space_duty(p_space uuid, p_uid uuid, p_duty text) TO service_role;


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
-- Name: FUNCTION is_collection_curator(p_collection uuid, p_uid uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.is_collection_curator(p_collection uuid, p_uid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_collection_curator(p_collection uuid, p_uid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_collection_curator(p_collection uuid, p_uid uuid) TO service_role;


--
-- Name: FUNCTION is_entity_steward(p_entity uuid, p_uid uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.is_entity_steward(p_entity uuid, p_uid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_entity_steward(p_entity uuid, p_uid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_entity_steward(p_entity uuid, p_uid uuid) TO service_role;


--
-- Name: FUNCTION is_event_attendee(p_event uuid, p_uid uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.is_event_attendee(p_event uuid, p_uid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_event_attendee(p_event uuid, p_uid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_event_attendee(p_event uuid, p_uid uuid) TO service_role;


--
-- Name: FUNCTION is_guardian_of(p_minor uuid, p_uid uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.is_guardian_of(p_minor uuid, p_uid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_guardian_of(p_minor uuid, p_uid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_guardian_of(p_minor uuid, p_uid uuid) TO service_role;


--
-- Name: FUNCTION is_minor(p_profile uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.is_minor(p_profile uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_minor(p_profile uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_minor(p_profile uuid) TO service_role;


--
-- Name: FUNCTION is_on_care_team(p_patient uuid, p_uid uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.is_on_care_team(p_patient uuid, p_uid uuid) TO anon;
GRANT ALL ON FUNCTION public.is_on_care_team(p_patient uuid, p_uid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_on_care_team(p_patient uuid, p_uid uuid) TO service_role;


--
-- Name: FUNCTION is_on_reminder(p_reminder uuid, p_uid uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.is_on_reminder(p_reminder uuid, p_uid uuid) TO anon;
GRANT ALL ON FUNCTION public.is_on_reminder(p_reminder uuid, p_uid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_on_reminder(p_reminder uuid, p_uid uuid) TO service_role;


--
-- Name: FUNCTION is_resource_steward(p_resource uuid, p_uid uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.is_resource_steward(p_resource uuid, p_uid uuid) TO anon;
GRANT ALL ON FUNCTION public.is_resource_steward(p_resource uuid, p_uid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_resource_steward(p_resource uuid, p_uid uuid) TO service_role;


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
-- Name: FUNCTION keep_donation_for_operations(p_donation uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.keep_donation_for_operations(p_donation uuid) TO anon;
GRANT ALL ON FUNCTION public.keep_donation_for_operations(p_donation uuid) TO authenticated;
GRANT ALL ON FUNCTION public.keep_donation_for_operations(p_donation uuid) TO service_role;


--
-- Name: FUNCTION ledger_balance(p_type text, p_id uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.ledger_balance(p_type text, p_id uuid) TO anon;
GRANT ALL ON FUNCTION public.ledger_balance(p_type text, p_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.ledger_balance(p_type text, p_id uuid) TO service_role;


--
-- Name: FUNCTION ledger_no_rewrite(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.ledger_no_rewrite() TO anon;
GRANT ALL ON FUNCTION public.ledger_no_rewrite() TO authenticated;
GRANT ALL ON FUNCTION public.ledger_no_rewrite() TO service_role;


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
-- Name: FUNCTION mark_chat_read(p_chat uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.mark_chat_read(p_chat uuid) TO anon;
GRANT ALL ON FUNCTION public.mark_chat_read(p_chat uuid) TO authenticated;
GRANT ALL ON FUNCTION public.mark_chat_read(p_chat uuid) TO service_role;


--
-- Name: FUNCTION mark_invite_opened(p_token uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.mark_invite_opened(p_token uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_invite_opened(p_token uuid) TO anon;
GRANT ALL ON FUNCTION public.mark_invite_opened(p_token uuid) TO authenticated;
GRANT ALL ON FUNCTION public.mark_invite_opened(p_token uuid) TO service_role;


--
-- Name: FUNCTION match_marketplace_post(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.match_marketplace_post() TO anon;
GRANT ALL ON FUNCTION public.match_marketplace_post() TO authenticated;
GRANT ALL ON FUNCTION public.match_marketplace_post() TO service_role;


--
-- Name: FUNCTION mint_currentcy(p_to_type text, p_to_id uuid, p_amount numeric, p_memo text, p_context text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.mint_currentcy(p_to_type text, p_to_id uuid, p_amount numeric, p_memo text, p_context text) TO anon;
GRANT ALL ON FUNCTION public.mint_currentcy(p_to_type text, p_to_id uuid, p_amount numeric, p_memo text, p_context text) TO authenticated;
GRANT ALL ON FUNCTION public.mint_currentcy(p_to_type text, p_to_id uuid, p_amount numeric, p_memo text, p_context text) TO service_role;


--
-- Name: FUNCTION my_age(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.my_age() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_age() TO authenticated;
GRANT ALL ON FUNCTION public.my_age() TO service_role;


--
-- Name: FUNCTION my_guardians(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.my_guardians() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_guardians() TO authenticated;
GRANT ALL ON FUNCTION public.my_guardians() TO service_role;


--
-- Name: FUNCTION my_home(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.my_home() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_home() TO authenticated;
GRANT ALL ON FUNCTION public.my_home() TO service_role;


--
-- Name: FUNCTION my_minors(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.my_minors() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_minors() TO authenticated;
GRANT ALL ON FUNCTION public.my_minors() TO service_role;


--
-- Name: FUNCTION my_phone(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.my_phone() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_phone() TO authenticated;
GRANT ALL ON FUNCTION public.my_phone() TO service_role;


--
-- Name: FUNCTION network_available_list(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.network_available_list() FROM PUBLIC;
GRANT ALL ON FUNCTION public.network_available_list() TO authenticated;
GRANT ALL ON FUNCTION public.network_available_list() TO service_role;


--
-- Name: FUNCTION network_present_count(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.network_present_count() TO anon;
GRANT ALL ON FUNCTION public.network_present_count() TO authenticated;
GRANT ALL ON FUNCTION public.network_present_count() TO service_role;


--
-- Name: FUNCTION network_present_list(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.network_present_list() TO anon;
GRANT ALL ON FUNCTION public.network_present_list() TO authenticated;
GRANT ALL ON FUNCTION public.network_present_list() TO service_role;


--
-- Name: FUNCTION notice_gift_ending(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.notice_gift_ending() TO anon;
GRANT ALL ON FUNCTION public.notice_gift_ending() TO authenticated;
GRANT ALL ON FUNCTION public.notice_gift_ending() TO service_role;


--
-- Name: FUNCTION notify(p_recipient uuid, p_section text, p_space uuid, p_type text, p_title text, p_body text, p_link text, p_actor uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.notify(p_recipient uuid, p_section text, p_space uuid, p_type text, p_title text, p_body text, p_link text, p_actor uuid) TO anon;
GRANT ALL ON FUNCTION public.notify(p_recipient uuid, p_section text, p_space uuid, p_type text, p_title text, p_body text, p_link text, p_actor uuid) TO authenticated;
GRANT ALL ON FUNCTION public.notify(p_recipient uuid, p_section text, p_space uuid, p_type text, p_title text, p_body text, p_link text, p_actor uuid) TO service_role;


--
-- Name: FUNCTION notify_reminder(p_reminder uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.notify_reminder(p_reminder uuid) TO anon;
GRANT ALL ON FUNCTION public.notify_reminder(p_reminder uuid) TO authenticated;
GRANT ALL ON FUNCTION public.notify_reminder(p_reminder uuid) TO service_role;


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
-- Name: FUNCTION owns_reminder(p_reminder uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.owns_reminder(p_reminder uuid) TO anon;
GRANT ALL ON FUNCTION public.owns_reminder(p_reminder uuid) TO authenticated;
GRANT ALL ON FUNCTION public.owns_reminder(p_reminder uuid) TO service_role;


--
-- Name: FUNCTION post_claimed(p_post uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.post_claimed(p_post uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.post_claimed(p_post uuid) TO authenticated;
GRANT ALL ON FUNCTION public.post_claimed(p_post uuid) TO service_role;


--
-- Name: FUNCTION posts_audience_sync(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.posts_audience_sync() TO anon;
GRANT ALL ON FUNCTION public.posts_audience_sync() TO authenticated;
GRANT ALL ON FUNCTION public.posts_audience_sync() TO service_role;


--
-- Name: FUNCTION public_booking_board(p_type uuid, p_from date, p_to date); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.public_booking_board(p_type uuid, p_from date, p_to date) TO anon;
GRANT ALL ON FUNCTION public.public_booking_board(p_type uuid, p_from date, p_to date) TO authenticated;
GRANT ALL ON FUNCTION public.public_booking_board(p_type uuid, p_from date, p_to date) TO service_role;


--
-- Name: FUNCTION public_booking_page(p_handle text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.public_booking_page(p_handle text) TO anon;
GRANT ALL ON FUNCTION public.public_booking_page(p_handle text) TO authenticated;
GRANT ALL ON FUNCTION public.public_booking_page(p_handle text) TO service_role;


--
-- Name: FUNCTION push_on_notification(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.push_on_notification() TO anon;
GRANT ALL ON FUNCTION public.push_on_notification() TO authenticated;
GRANT ALL ON FUNCTION public.push_on_notification() TO service_role;


--
-- Name: FUNCTION reject_category_suggestion(p_suggestion_id uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.reject_category_suggestion(p_suggestion_id uuid) TO anon;
GRANT ALL ON FUNCTION public.reject_category_suggestion(p_suggestion_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.reject_category_suggestion(p_suggestion_id uuid) TO service_role;


--
-- Name: FUNCTION request_exchange(p_post uuid, p_mode text, p_fulfillment text, p_note text, p_as_space uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.request_exchange(p_post uuid, p_mode text, p_fulfillment text, p_note text, p_as_space uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_exchange(p_post uuid, p_mode text, p_fulfillment text, p_note text, p_as_space uuid) TO authenticated;
GRANT ALL ON FUNCTION public.request_exchange(p_post uuid, p_mode text, p_fulfillment text, p_note text, p_as_space uuid) TO service_role;


--
-- Name: FUNCTION request_resource_booking(p_resource uuid, p_start date, p_end date, p_start_min integer, p_end_min integer, p_note text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.request_resource_booking(p_resource uuid, p_start date, p_end date, p_start_min integer, p_end_min integer, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_resource_booking(p_resource uuid, p_start date, p_end date, p_start_min integer, p_end_min integer, p_note text) TO authenticated;
GRANT ALL ON FUNCTION public.request_resource_booking(p_resource uuid, p_start date, p_end date, p_start_min integer, p_end_min integer, p_note text) TO service_role;


--
-- Name: FUNCTION resolve_category(p_word text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.resolve_category(p_word text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_category(p_word text) TO anon;
GRANT ALL ON FUNCTION public.resolve_category(p_word text) TO authenticated;
GRANT ALL ON FUNCTION public.resolve_category(p_word text) TO service_role;


--
-- Name: FUNCTION resolve_collection_suggestion(p_id uuid, p_accept boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.resolve_collection_suggestion(p_id uuid, p_accept boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_collection_suggestion(p_id uuid, p_accept boolean) TO authenticated;
GRANT ALL ON FUNCTION public.resolve_collection_suggestion(p_id uuid, p_accept boolean) TO service_role;


--
-- Name: FUNCTION resource_busy(p_resource uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.resource_busy(p_resource uuid) TO anon;
GRANT ALL ON FUNCTION public.resource_busy(p_resource uuid) TO authenticated;
GRANT ALL ON FUNCTION public.resource_busy(p_resource uuid) TO service_role;


--
-- Name: FUNCTION resource_span_contact(p_resource uuid, p_date date); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.resource_span_contact(p_resource uuid, p_date date) TO anon;
GRANT ALL ON FUNCTION public.resource_span_contact(p_resource uuid, p_date date) TO authenticated;
GRANT ALL ON FUNCTION public.resource_span_contact(p_resource uuid, p_date date) TO service_role;


--
-- Name: FUNCTION respond_booking(p_booking uuid, p_accept boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.respond_booking(p_booking uuid, p_accept boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.respond_booking(p_booking uuid, p_accept boolean) TO authenticated;
GRANT ALL ON FUNCTION public.respond_booking(p_booking uuid, p_accept boolean) TO service_role;


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
-- Name: FUNCTION send_currentcy(p_from_type text, p_from_id uuid, p_to_type text, p_to_id uuid, p_amount numeric, p_memo text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.send_currentcy(p_from_type text, p_from_id uuid, p_to_type text, p_to_id uuid, p_amount numeric, p_memo text) TO anon;
GRANT ALL ON FUNCTION public.send_currentcy(p_from_type text, p_from_id uuid, p_to_type text, p_to_id uuid, p_amount numeric, p_memo text) TO authenticated;
GRANT ALL ON FUNCTION public.send_currentcy(p_from_type text, p_from_id uuid, p_to_type text, p_to_id uuid, p_amount numeric, p_memo text) TO service_role;


--
-- Name: FUNCTION set_member_role(p_space uuid, p_profile uuid, p_role text, p_duties text[]); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.set_member_role(p_space uuid, p_profile uuid, p_role text, p_duties text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_member_role(p_space uuid, p_profile uuid, p_role text, p_duties text[]) TO authenticated;
GRANT ALL ON FUNCTION public.set_member_role(p_space uuid, p_profile uuid, p_role text, p_duties text[]) TO service_role;


--
-- Name: FUNCTION set_space_public_page_default(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.set_space_public_page_default() TO anon;
GRANT ALL ON FUNCTION public.set_space_public_page_default() TO authenticated;
GRANT ALL ON FUNCTION public.set_space_public_page_default() TO service_role;


--
-- Name: FUNCTION space_present_count(p_space uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.space_present_count(p_space uuid) TO anon;
GRANT ALL ON FUNCTION public.space_present_count(p_space uuid) TO authenticated;
GRANT ALL ON FUNCTION public.space_present_count(p_space uuid) TO service_role;


--
-- Name: FUNCTION space_present_list(p_space uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.space_present_list(p_space uuid) TO anon;
GRANT ALL ON FUNCTION public.space_present_list(p_space uuid) TO authenticated;
GRANT ALL ON FUNCTION public.space_present_list(p_space uuid) TO service_role;


--
-- Name: FUNCTION sync_attendee_to_event_chat(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.sync_attendee_to_event_chat() TO anon;
GRANT ALL ON FUNCTION public.sync_attendee_to_event_chat() TO authenticated;
GRANT ALL ON FUNCTION public.sync_attendee_to_event_chat() TO service_role;


--
-- Name: FUNCTION sync_is_adult(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.sync_is_adult() TO anon;
GRANT ALL ON FUNCTION public.sync_is_adult() TO authenticated;
GRANT ALL ON FUNCTION public.sync_is_adult() TO service_role;


--
-- Name: FUNCTION sync_member_to_chat(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.sync_member_to_chat() TO anon;
GRANT ALL ON FUNCTION public.sync_member_to_chat() TO authenticated;
GRANT ALL ON FUNCTION public.sync_member_to_chat() TO service_role;


--
-- Name: FUNCTION task_level(p_owner uuid, p_viewer uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.task_level(p_owner uuid, p_viewer uuid) TO anon;
GRANT ALL ON FUNCTION public.task_level(p_owner uuid, p_viewer uuid) TO authenticated;
GRANT ALL ON FUNCTION public.task_level(p_owner uuid, p_viewer uuid) TO service_role;


--
-- Name: FUNCTION tick_reminders(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.tick_reminders() TO anon;
GRANT ALL ON FUNCTION public.tick_reminders() TO authenticated;
GRANT ALL ON FUNCTION public.tick_reminders() TO service_role;


--
-- Name: FUNCTION touch_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.touch_updated_at() TO anon;
GRANT ALL ON FUNCTION public.touch_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.touch_updated_at() TO service_role;


--
-- Name: FUNCTION translate_donation(p_donation uuid, p_to_type text, p_to_id uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.translate_donation(p_donation uuid, p_to_type text, p_to_id uuid) TO anon;
GRANT ALL ON FUNCTION public.translate_donation(p_donation uuid, p_to_type text, p_to_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.translate_donation(p_donation uuid, p_to_type text, p_to_id uuid) TO service_role;


--
-- Name: FUNCTION trust_edges_for_targets(p_targets jsonb); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.trust_edges_for_targets(p_targets jsonb) TO anon;
GRANT ALL ON FUNCTION public.trust_edges_for_targets(p_targets jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.trust_edges_for_targets(p_targets jsonb) TO service_role;


--
-- Name: FUNCTION visible_tasks_of(p_owner uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.visible_tasks_of(p_owner uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.visible_tasks_of(p_owner uuid) TO authenticated;
GRANT ALL ON FUNCTION public.visible_tasks_of(p_owner uuid) TO service_role;


--
-- Name: TABLE assistant_feed_posts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.assistant_feed_posts TO anon;
GRANT ALL ON TABLE public.assistant_feed_posts TO authenticated;
GRANT ALL ON TABLE public.assistant_feed_posts TO service_role;


--
-- Name: TABLE assistant_identities; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.assistant_identities TO anon;
GRANT ALL ON TABLE public.assistant_identities TO authenticated;
GRANT ALL ON TABLE public.assistant_identities TO service_role;


--
-- Name: TABLE assistant_queries; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.assistant_queries TO anon;
GRANT ALL ON TABLE public.assistant_queries TO authenticated;
GRANT ALL ON TABLE public.assistant_queries TO service_role;


--
-- Name: TABLE availability_windows; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.availability_windows TO anon;
GRANT ALL ON TABLE public.availability_windows TO authenticated;
GRANT ALL ON TABLE public.availability_windows TO service_role;


--
-- Name: TABLE booking_types; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.booking_types TO anon;
GRANT ALL ON TABLE public.booking_types TO authenticated;
GRANT ALL ON TABLE public.booking_types TO service_role;


--
-- Name: TABLE bookings; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.bookings TO anon;
GRANT ALL ON TABLE public.bookings TO authenticated;
GRANT ALL ON TABLE public.bookings TO service_role;


--
-- Name: TABLE calendar_pins; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.calendar_pins TO anon;
GRANT ALL ON TABLE public.calendar_pins TO authenticated;
GRANT ALL ON TABLE public.calendar_pins TO service_role;


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
-- Name: TABLE care_settings; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.care_settings TO anon;
GRANT ALL ON TABLE public.care_settings TO authenticated;
GRANT ALL ON TABLE public.care_settings TO service_role;


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
-- Name: TABLE category_aliases; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.category_aliases TO anon;
GRANT ALL ON TABLE public.category_aliases TO authenticated;
GRANT ALL ON TABLE public.category_aliases TO service_role;


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
-- Name: TABLE collection_enrollments; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.collection_enrollments TO anon;
GRANT ALL ON TABLE public.collection_enrollments TO authenticated;
GRANT ALL ON TABLE public.collection_enrollments TO service_role;


--
-- Name: TABLE collection_items; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.collection_items TO anon;
GRANT ALL ON TABLE public.collection_items TO authenticated;
GRANT ALL ON TABLE public.collection_items TO service_role;


--
-- Name: TABLE collection_progress; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.collection_progress TO anon;
GRANT ALL ON TABLE public.collection_progress TO authenticated;
GRANT ALL ON TABLE public.collection_progress TO service_role;


--
-- Name: TABLE collection_suggestions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.collection_suggestions TO anon;
GRANT ALL ON TABLE public.collection_suggestions TO authenticated;
GRANT ALL ON TABLE public.collection_suggestions TO service_role;


--
-- Name: TABLE collections; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.collections TO anon;
GRANT ALL ON TABLE public.collections TO authenticated;
GRANT ALL ON TABLE public.collections TO service_role;


--
-- Name: TABLE donations; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.donations TO anon;
GRANT ALL ON TABLE public.donations TO authenticated;
GRANT ALL ON TABLE public.donations TO service_role;


--
-- Name: TABLE event_attendees; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.event_attendees TO anon;
GRANT ALL ON TABLE public.event_attendees TO authenticated;
GRANT ALL ON TABLE public.event_attendees TO service_role;


--
-- Name: TABLE event_guests; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.event_guests TO anon;
GRANT ALL ON TABLE public.event_guests TO authenticated;
GRANT ALL ON TABLE public.event_guests TO service_role;


--
-- Name: TABLE events; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.events TO anon;
GRANT ALL ON TABLE public.events TO authenticated;
GRANT ALL ON TABLE public.events TO service_role;


--
-- Name: TABLE exchanges; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.exchanges TO anon;
GRANT ALL ON TABLE public.exchanges TO authenticated;
GRANT ALL ON TABLE public.exchanges TO service_role;


--
-- Name: TABLE external_busy; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.external_busy TO anon;
GRANT ALL ON TABLE public.external_busy TO authenticated;
GRANT ALL ON TABLE public.external_busy TO service_role;


--
-- Name: TABLE external_calendars; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.external_calendars TO anon;
GRANT ALL ON TABLE public.external_calendars TO authenticated;
GRANT ALL ON TABLE public.external_calendars TO service_role;


--
-- Name: TABLE financial_positions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.financial_positions TO anon;
GRANT ALL ON TABLE public.financial_positions TO authenticated;
GRANT ALL ON TABLE public.financial_positions TO service_role;


--
-- Name: TABLE google_calendar_accounts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.google_calendar_accounts TO anon;
GRANT ALL ON TABLE public.google_calendar_accounts TO authenticated;
GRANT ALL ON TABLE public.google_calendar_accounts TO service_role;


--
-- Name: TABLE guardians; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.guardians TO anon;
GRANT ALL ON TABLE public.guardians TO authenticated;
GRANT ALL ON TABLE public.guardians TO service_role;


--
-- Name: TABLE health_snapshots; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.health_snapshots TO anon;
GRANT ALL ON TABLE public.health_snapshots TO authenticated;
GRANT ALL ON TABLE public.health_snapshots TO service_role;


--
-- Name: TABLE hidden_posts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.hidden_posts TO anon;
GRANT ALL ON TABLE public.hidden_posts TO authenticated;
GRANT ALL ON TABLE public.hidden_posts TO service_role;


--
-- Name: TABLE inkind_donations; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.inkind_donations TO anon;
GRANT ALL ON TABLE public.inkind_donations TO authenticated;
GRANT ALL ON TABLE public.inkind_donations TO service_role;


--
-- Name: TABLE invite_tokens; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.invite_tokens TO anon;
GRANT ALL ON TABLE public.invite_tokens TO authenticated;
GRANT ALL ON TABLE public.invite_tokens TO service_role;


--
-- Name: TABLE join_requests; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.join_requests TO anon;
GRANT ALL ON TABLE public.join_requests TO authenticated;
GRANT ALL ON TABLE public.join_requests TO service_role;


--
-- Name: TABLE ledger_entries; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ledger_entries TO anon;
GRANT ALL ON TABLE public.ledger_entries TO authenticated;
GRANT ALL ON TABLE public.ledger_entries TO service_role;


--
-- Name: TABLE location_shares; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.location_shares TO anon;
GRANT ALL ON TABLE public.location_shares TO authenticated;
GRANT ALL ON TABLE public.location_shares TO service_role;


--
-- Name: TABLE member_prompts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.member_prompts TO anon;
GRANT ALL ON TABLE public.member_prompts TO authenticated;
GRANT ALL ON TABLE public.member_prompts TO service_role;


--
-- Name: TABLE membership_gifts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.membership_gifts TO anon;
GRANT ALL ON TABLE public.membership_gifts TO authenticated;
GRANT ALL ON TABLE public.membership_gifts TO service_role;


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
-- Name: TABLE profile_locations; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.profile_locations TO anon;
GRANT ALL ON TABLE public.profile_locations TO authenticated;
GRANT ALL ON TABLE public.profile_locations TO service_role;


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
GRANT SELECT(id) ON TABLE public.profiles TO anon;


--
-- Name: COLUMN profiles.full_name; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(full_name) ON TABLE public.profiles TO authenticated;
GRANT SELECT(full_name) ON TABLE public.profiles TO anon;


--
-- Name: COLUMN profiles.handle; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(handle) ON TABLE public.profiles TO authenticated;
GRANT SELECT(handle) ON TABLE public.profiles TO anon;


--
-- Name: COLUMN profiles.headline; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(headline) ON TABLE public.profiles TO authenticated;
GRANT SELECT(headline) ON TABLE public.profiles TO anon;


--
-- Name: COLUMN profiles.bio; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(bio) ON TABLE public.profiles TO authenticated;
GRANT SELECT(bio) ON TABLE public.profiles TO anon;


--
-- Name: COLUMN profiles.avatar_url; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(avatar_url) ON TABLE public.profiles TO authenticated;
GRANT SELECT(avatar_url) ON TABLE public.profiles TO anon;


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
-- Name: COLUMN profiles.presence_visible; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(presence_visible),UPDATE(presence_visible) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.presence_lit_until; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(presence_lit_until),UPDATE(presence_lit_until) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.presence_always_present; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(presence_always_present) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.identity_tags; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(identity_tags) ON TABLE public.profiles TO anon;
GRANT SELECT(identity_tags) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.assistant_readable; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(assistant_readable) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.contact; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(contact) ON TABLE public.profiles TO anon;
GRANT SELECT(contact) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.public_page; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(public_page) ON TABLE public.profiles TO anon;
GRANT SELECT(public_page) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.page; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(page) ON TABLE public.profiles TO anon;
GRANT SELECT(page) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.content_ai_default; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(content_ai_default) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.content_download_default; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(content_download_default) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.assistant_enabled; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(assistant_enabled),UPDATE(assistant_enabled) ON TABLE public.profiles TO authenticated;
GRANT SELECT(assistant_enabled) ON TABLE public.profiles TO anon;


--
-- Name: COLUMN profiles.kind; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(kind) ON TABLE public.profiles TO authenticated;
GRANT SELECT(kind) ON TABLE public.profiles TO anon;


--
-- Name: COLUMN profiles.aspect; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(aspect) ON TABLE public.profiles TO authenticated;
GRANT SELECT(aspect) ON TABLE public.profiles TO anon;


--
-- Name: COLUMN profiles.steward_profile_id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(steward_profile_id) ON TABLE public.profiles TO authenticated;
GRANT SELECT(steward_profile_id) ON TABLE public.profiles TO anon;


--
-- Name: COLUMN profiles.steward_space_id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(steward_space_id) ON TABLE public.profiles TO authenticated;
GRANT SELECT(steward_space_id) ON TABLE public.profiles TO anon;


--
-- Name: COLUMN profiles.birth_date; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(birth_date) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.is_adult; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(is_adult),UPDATE(is_adult) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.age_declared_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(age_declared_at) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.findable; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(findable) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.assistant_can_edit; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(assistant_can_edit) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.weaveable_default; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(weaveable_default) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.jurisdiction; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(jurisdiction) ON TABLE public.profiles TO anon;
GRANT SELECT(jurisdiction) ON TABLE public.profiles TO authenticated;


--
-- Name: TABLE push_subscriptions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.push_subscriptions TO anon;
GRANT ALL ON TABLE public.push_subscriptions TO authenticated;
GRANT ALL ON TABLE public.push_subscriptions TO service_role;


--
-- Name: TABLE recommendations; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.recommendations TO anon;
GRANT ALL ON TABLE public.recommendations TO authenticated;
GRANT ALL ON TABLE public.recommendations TO service_role;


--
-- Name: TABLE reminder_done; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.reminder_done TO anon;
GRANT ALL ON TABLE public.reminder_done TO authenticated;
GRANT ALL ON TABLE public.reminder_done TO service_role;


--
-- Name: TABLE reminder_fired; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.reminder_fired TO anon;
GRANT ALL ON TABLE public.reminder_fired TO authenticated;
GRANT ALL ON TABLE public.reminder_fired TO service_role;


--
-- Name: TABLE reminder_recipients; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.reminder_recipients TO anon;
GRANT ALL ON TABLE public.reminder_recipients TO authenticated;
GRANT ALL ON TABLE public.reminder_recipients TO service_role;


--
-- Name: TABLE reminders; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.reminders TO anon;
GRANT ALL ON TABLE public.reminders TO authenticated;
GRANT ALL ON TABLE public.reminders TO service_role;


--
-- Name: TABLE resource_bookings; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.resource_bookings TO anon;
GRANT ALL ON TABLE public.resource_bookings TO authenticated;
GRANT ALL ON TABLE public.resource_bookings TO service_role;


--
-- Name: TABLE resources; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.resources TO anon;
GRANT ALL ON TABLE public.resources TO authenticated;
GRANT ALL ON TABLE public.resources TO service_role;


--
-- Name: TABLE saved_items; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.saved_items TO anon;
GRANT ALL ON TABLE public.saved_items TO authenticated;
GRANT ALL ON TABLE public.saved_items TO service_role;


--
-- Name: TABLE space_members; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.space_members TO anon;
GRANT ALL ON TABLE public.space_members TO authenticated;
GRANT ALL ON TABLE public.space_members TO service_role;


--
-- Name: TABLE space_membership_requests; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.space_membership_requests TO anon;
GRANT ALL ON TABLE public.space_membership_requests TO authenticated;
GRANT ALL ON TABLE public.space_membership_requests TO service_role;


--
-- Name: TABLE space_nesting_requests; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.space_nesting_requests TO anon;
GRANT ALL ON TABLE public.space_nesting_requests TO authenticated;
GRANT ALL ON TABLE public.space_nesting_requests TO service_role;


--
-- Name: TABLE space_section_shares; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.space_section_shares TO anon;
GRANT ALL ON TABLE public.space_section_shares TO authenticated;
GRANT ALL ON TABLE public.space_section_shares TO service_role;


--
-- Name: TABLE spaces; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.spaces TO anon;
GRANT ALL ON TABLE public.spaces TO authenticated;
GRANT ALL ON TABLE public.spaces TO service_role;


--
-- Name: COLUMN spaces.id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(id) ON TABLE public.spaces TO anon;


--
-- Name: COLUMN spaces.kind; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(kind) ON TABLE public.spaces TO anon;


--
-- Name: COLUMN spaces.name; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(name) ON TABLE public.spaces TO anon;


--
-- Name: COLUMN spaces.handle; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(handle) ON TABLE public.spaces TO anon;


--
-- Name: COLUMN spaces.description; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(description) ON TABLE public.spaces TO anon;


--
-- Name: COLUMN spaces.avatar_url; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(avatar_url) ON TABLE public.spaces TO anon;


--
-- Name: COLUMN spaces.location; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(location) ON TABLE public.spaces TO anon;


--
-- Name: COLUMN spaces.lat; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(lat) ON TABLE public.spaces TO anon;


--
-- Name: COLUMN spaces.lng; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(lng) ON TABLE public.spaces TO anon;


--
-- Name: COLUMN spaces.contact; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(contact) ON TABLE public.spaces TO anon;


--
-- Name: COLUMN spaces.public_page; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(public_page) ON TABLE public.spaces TO anon;


--
-- Name: COLUMN spaces.page; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(page) ON TABLE public.spaces TO anon;
GRANT SELECT(page) ON TABLE public.spaces TO authenticated;


--
-- Name: TABLE subscriptions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.subscriptions TO anon;
GRANT ALL ON TABLE public.subscriptions TO authenticated;
GRANT ALL ON TABLE public.subscriptions TO service_role;


--
-- Name: TABLE task_shares; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.task_shares TO anon;
GRANT ALL ON TABLE public.task_shares TO authenticated;
GRANT ALL ON TABLE public.task_shares TO service_role;


--
-- Name: TABLE todos; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.todos TO anon;
GRANT ALL ON TABLE public.todos TO authenticated;
GRANT ALL ON TABLE public.todos TO service_role;


--
-- Name: TABLE video_jobs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.video_jobs TO anon;
GRANT ALL ON TABLE public.video_jobs TO authenticated;
GRANT ALL ON TABLE public.video_jobs TO service_role;


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

\unrestrict iYkGKUgf2N6bSB3aSc9FZp4lw03AOBhC04j6gKhYYXsNlY4o6t7DpTtXaPPbf2l

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
