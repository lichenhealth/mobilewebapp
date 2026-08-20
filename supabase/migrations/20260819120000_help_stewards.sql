-- HELP STEWARDS (founder 2026-08-19): sunsetting the connect@ LOGIN. Lichen
-- Health stays as the desk's identity — the orange brain, the history, the
-- room key — but no human signs into it again. Humans who answer help are
-- STEWARDS: an explicit per-person grant (never inherited from any admin
-- role — being an org admin must not drag someone into support), they sit in
-- every help room as themselves, get the bells (first-come-first-serve is
-- social, not machinery), and answer under their own name with the peach
-- ring the UI already draws.

alter table public.profiles add column if not exists help_steward boolean not null default false;

-- Platform admins grant/revoke. Own-row UPDATE policy can't cover this
-- (a member must not self-grant), so a definer RPC.
create or replace function public.set_help_steward(p_profile uuid, p_on boolean)
returns void language plpgsql security definer set search_path to 'public' as $func$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'admins only';
  end if;
  update public.profiles set help_steward = p_on where id = p_profile;
  -- Granting seats them in every existing help room; revoking stands them up.
  if p_on then
    insert into public.chat_members (chat_id, profile_id)
    select c.id, p_profile from public.chats c where c.kind = 'help'
      and c.direct_key <> 'help:' || p_profile::text
    on conflict do nothing;
  else
    delete from public.chat_members m using public.chats c
     where c.id = m.chat_id and c.kind = 'help' and m.profile_id = p_profile
       and c.direct_key <> 'help:' || p_profile::text;
  end if;
end; $func$;
revoke all on function public.set_help_steward(uuid, boolean) from public;
grant execute on function public.set_help_steward(uuid, boolean) to authenticated;

-- The founder is the first steward.
update public.profiles set help_steward = true where lower(email) = 'galyn@lichen.health';
insert into public.chat_members (chat_id, profile_id)
select c.id, p.id from public.chats c cross join public.profiles p
 where c.kind = 'help' and p.help_steward
   and c.direct_key <> 'help:' || p.id::text
on conflict do nothing;

-- New rooms seat every current steward; re-opening seats new ones.
create or replace function public.ensure_help_chat()
returns uuid language plpgsql security definer set search_path to 'public' as $func$
declare
  v_me      uuid := auth.uid();
  v_support uuid;
  v_claude  uuid := '85c04e7a-5a47-4c0e-85a4-0b35ff67a682';
  v_key     text;
  v_chat    uuid;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  select id into v_support from public.profiles where lower(email) = 'connect@lichen.health' limit 1;
  if v_support is null then raise exception 'Help is not available yet'; end if;
  if v_support = v_me then raise exception 'This is the help account'; end if;
  v_key := 'help:' || v_me::text;
  select id into v_chat from public.chats where direct_key = v_key;
  if v_chat is null then
    insert into public.chats (kind, direct_key, title) values ('help', v_key, null)
    on conflict (direct_key) where direct_key is not null do nothing
    returning id into v_chat;
    if v_chat is null then select id into v_chat from public.chats where direct_key = v_key; end if;
  end if;
  insert into public.chat_members (chat_id, profile_id) values (v_chat, v_me)      on conflict do nothing;
  insert into public.chat_members (chat_id, profile_id) values (v_chat, v_support) on conflict do nothing;
  insert into public.chat_members (chat_id, profile_id) values (v_chat, v_claude)  on conflict do nothing;
  insert into public.chat_members (chat_id, profile_id)
  select v_chat, p.id from public.profiles p where p.help_steward and p.id <> v_me
  on conflict do nothing;
  return v_chat;
end; $func$;
