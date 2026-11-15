-- «FIRST»'S BRAIN — AI ON A MEMBER'S BEHALF (founder 2026-11-15: "let my Ai
-- brain message gabe with a link to my cal and instructions, and help him get
-- setup if needs to, flagging me if there's an issue. Make it clear that it is
-- my Brain messaging him"). A message the member's Brain sends rides the
-- member's own DM with sender_id = the member and via_brain = true, so every
-- surface can say plainly "Galyn's Brain — AI on Galyn's behalf". Only the
-- service role (the brain-errand edge fn) may set the flag.

alter table public.chat_messages add column if not exists via_brain boolean not null default false;

create or replace function public.chat_messages_guard_brain()
returns trigger language plpgsql set search_path = public as $fn$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then new.via_brain := false;
    else new.via_brain := old.via_brain; end if;
  end if;
  return new;
end $fn$;
drop trigger if exists chat_messages_guard_brain on public.chat_messages;
create trigger chat_messages_guard_brain before insert or update on public.chat_messages
  for each row execute function public.chat_messages_guard_brain();

-- An ERRAND: one bounded job the Brain is doing in one chat for its owner.
create table if not exists public.brain_errands (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  chat_id uuid not null references public.chats(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'calendar_share' check (kind in ('calendar_share')),
  share_id uuid references public.calendar_feed_shares(id) on delete set null,
  status text not null default 'open' check (status in ('open','done','flagged','closed')),
  replies int not null default 0,
  last_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);
create index if not exists brain_errands_chat on public.brain_errands (chat_id) where status in ('open','flagged');
alter table public.brain_errands enable row level security;
drop policy if exists "brain errands: owner reads" on public.brain_errands;
create policy "brain errands: owner reads" on public.brain_errands for select using (owner_id = auth.uid());
drop policy if exists "brain errands: owner closes" on public.brain_errands;
create policy "brain errands: owner closes" on public.brain_errands for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke all on public.brain_errands from anon;

-- When the recipient writes in a chat with a live errand, the Brain answers.
-- A flagged errand keeps listening (the owner may not have stepped in yet).
create or replace function public.brain_errand_on_message()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_secret text; v_errand uuid;
begin
  if new.via_brain or new.body is null then return new; end if;
  select id into v_errand from public.brain_errands
   where chat_id = new.chat_id and recipient_id = new.sender_id
     and status in ('open','flagged') and expires_at > now()
   order by created_at desc limit 1;
  if v_errand is null then return new; end if;
  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_hook_secret';
    perform net.http_post(
      url := 'https://mjqnaevertyzgjlpwynr.supabase.co/functions/v1/brain-errand',
      headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', coalesce(v_secret,'')),
      body := jsonb_build_object('mode','reply','errand_id', v_errand, 'message_id', new.id)
    );
  exception when others then null;
  end;
  return new;
end $fn$;
drop trigger if exists brain_errand_on_message on public.chat_messages;
create trigger brain_errand_on_message after insert on public.chat_messages
  for each row execute function public.brain_errand_on_message();

-- The owner stepping in by hand ends the errand quietly — they've got it.
create or replace function public.brain_errand_owner_spoke()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.via_brain then return new; end if;
  update public.brain_errands set status = 'closed', updated_at = now(), last_note = 'You stepped in'
   where chat_id = new.chat_id and owner_id = new.sender_id and status in ('open','flagged');
  return new;
end $fn$;
drop trigger if exists brain_errand_owner_spoke on public.chat_messages;
create trigger brain_errand_owner_spoke after insert on public.chat_messages
  for each row execute function public.brain_errand_owner_spoke();
