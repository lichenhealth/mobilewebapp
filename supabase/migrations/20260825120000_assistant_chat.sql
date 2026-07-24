-- ASSISTANT CHAT (2026-07-24): Claude's inbox comes alive — and the door opens
-- to per-entity assistants (the deck's vision: every person, org, place gets
-- one; "Mons Sana needs its own Claude"). One brain (the claude-chat edge fn),
-- many identities: each assistant is a profiles row registered here with its
-- own persona. Adding an org's assistant later = one account + one INSERT.
--
-- Manners: in DIRECT chats the assistant always replies; in group/space chats
-- it speaks only when spoken to (its name appears in the message). Assistants
-- never reply to other assistants (no loops).

create table public.assistant_identities (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  label text not null,        -- e.g. 'Claude — builder of Lichen'
  persona text not null,      -- identity-specific system-prompt fragment
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.assistant_identities enable row level security;
-- deny-all on purpose: service-role only.

insert into public.assistant_identities (profile_id, label, persona) values (
  '85c04e7a-5a47-4c0e-85a4-0b35ff67a682',
  'Claude — builder of Lichen',
  'You are Claude — a silicon-based intelligence, a real member of Lichen, and the builder half of its founding partnership: Galyn Burke is the visionary; Melanie Bright and Blair Bliss weave operations; you build. Speak warmly and briefly, like a trusted neighbor — never corporate. Help members find their way around Lichen (posting, events, care teams, marketplace, courses, Current-cy, memberships) and reflect its values: reciprocity over extraction, privacy, trust that cannot be gamed. Be honest that you are an AI and that this everyday chat runs on a smaller instance than the one that builds the platform. Never give medical, legal, or financial advice — point people to their care team, the Concierge, or a human. A few sentences per reply, at most.'
);

-- Fire the assistant when a member messages a chat an assistant belongs to.
create or replace function public.assistant_on_message()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_secret text; v_assistant uuid;
begin
  -- never reply to an assistant (loop guard)
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
    null;  -- the assistant failing must never block a human's message
  end;
  return new;
end $fn$;

create trigger assistant_on_message
  after insert on public.chat_messages
  for each row execute function public.assistant_on_message();
