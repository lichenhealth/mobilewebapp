-- A DECISION BELONGS TO THE PERSON, NOT THE DEVICE (founder 2026-08-07: "I have
-- it set that I'm findable and I get a new iPhone. Getting that iPhone has
-- nothing to do with me changing my mind about the settings of an app on it, so
-- it shouldn't ask me again").
--
-- Consent bubbles tracked "seen" in localStorage, which meant a new phone, a
-- second browser, or a cleared cache re-asked a question the member had already
-- answered. For a privacy prompt that's the worst place to be careless: it
-- trains people to dismiss the thing without reading it, and the one time it
-- matters they'll wave it away out of habit.
--
-- One row per member per topic. Existence answers the once-ever prompts
-- (findability); seen_at's date answers the recurring ones (presence asks daily).

create table if not exists public.member_prompts (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  topic text not null,
  seen_at timestamptz not null default now(),
  primary key (profile_id, topic)
);
alter table public.member_prompts enable row level security;

-- Yours alone. Nobody else has any business knowing which prompts you've read.
create policy "prompts: own read" on public.member_prompts
  for select to authenticated using (profile_id = auth.uid());
create policy "prompts: own write" on public.member_prompts
  for insert to authenticated with check (profile_id = auth.uid());
create policy "prompts: own update" on public.member_prompts
  for update to authenticated using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

grant select, insert, update on public.member_prompts to authenticated;
