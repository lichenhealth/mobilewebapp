-- NAME A CONVERSATION LIKE A FILE (founder 2026-10-12: "maybe you can name
-- a convo, like you can name a file? So we can organize them?"): a chosen
-- title for one assistant conversation. A row means a CHOSEN name — absent,
-- the list keeps the self-organizing first-words title; clearing a name
-- deletes the row. Owner-only by construction, the assistant_feed_posts
-- doctrine: this is the member's own relationship with Claude.
create table if not exists public.assistant_convo_names (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  convo_id uuid not null,
  title text not null check (char_length(title) between 1 and 120),
  updated_at timestamptz not null default now(),
  primary key (profile_id, convo_id)
);

alter table public.assistant_convo_names enable row level security;

create policy "convo names: own" on public.assistant_convo_names
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
