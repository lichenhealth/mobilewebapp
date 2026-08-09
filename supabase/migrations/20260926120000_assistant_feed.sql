-- ASSISTANT FEED (founder, 2026-08-09): the member<->Claude relationship
-- moves from a chat thread to a feed — typing into a thread felt redundant
-- with a relationship that's really about gathering context over time.
-- Private by construction (profile_id = auth.uid() is the whole access
-- rule) rather than reusing `posts`' public/mycelium/space visibility model,
-- which has no private-pairwise mode. Mirrors `care_posts`' precedent of a
-- dedicated table for a closed relationship that doesn't fit `posts`.
--
-- Purely additive: the existing claude-chat / assistant_on_message chat
-- path is untouched — this is a new, parallel surface, not a migration of
-- old data.

create table public.assistant_feed_posts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  author text not null check (author in ('member','claude')),
  body text not null,
  attachments jsonb,
  source_post_id uuid references public.posts(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.assistant_feed_posts enable row level security;
create index assistant_feed_posts_profile_time on public.assistant_feed_posts (profile_id, created_at);

create policy "own feed read" on public.assistant_feed_posts
  for select to authenticated using (profile_id = auth.uid());
create policy "own feed write" on public.assistant_feed_posts
  for insert to authenticated with check (profile_id = auth.uid() and author = 'member');
-- Claude's own entries (author='claude') get no client insert policy at all —
-- written only by the assistant-feed edge function via the service role,
-- same deny-unless-service-role posture as assistant_queries/assistant_identities.

-- Fire the assistant whenever a member posts into their feed. Always
-- replies (unlike assistant_on_message's group "speak only when named"
-- branch) since this is inherently 1:1.
create or replace function public.assistant_on_feed_post()
returns trigger language plpgsql security definer set search_path = public as $fn$
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
end $fn$;

create trigger assistant_on_feed_post
  after insert on public.assistant_feed_posts
  for each row when (new.author = 'member')
  execute function public.assistant_on_feed_post();
