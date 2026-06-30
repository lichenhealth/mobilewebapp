-- =============================================================================
-- Real content backbone: posts + mycelium (trust edges) + recommendations.
--
-- NOT yet applied to the live DB — review, then run in the Supabase SQL editor.
--
-- author_id / truster_id reference `profiles` for now. When profiles generalizes
-- to multi-species entities (kind + steward), these rows simply become entities;
-- no change needed here.
-- =============================================================================

-- ---- posts: one unified content stream ----
create table public.posts (
  id           uuid primary key default gen_random_uuid(),
  author_id    uuid not null references public.profiles(id) on delete cascade,
  space_id     uuid references public.spaces(id) on delete cascade,   -- set when visibility='space'
  visibility   text not null default 'public' check (visibility in ('public','mycelium','space')),
  content_type text not null check (content_type in ('social','creative','educational','actionable','qa')),
  service_area text check (service_area in ('marketplace','work','courses','food','art','events','places','library','people')),
  title        text,
  body         text not null,
  image_url    text,
  details      jsonb not null default '{}'::jsonb,   -- area-specifics: price, mode, schedule, location…
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint posts_space_required check (visibility <> 'space' or space_id is not null)
);
create index posts_author_idx       on public.posts(author_id);
create index posts_space_idx        on public.posts(space_id);
create index posts_service_area_idx on public.posts(service_area);
alter table public.posts enable row level security;

-- ---- mycelium: your trusted web ("Trust" / "Add to Mycelium" = one edge) ----
create table public.mycelium (
  truster_id  uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('profile','space','post')),
  target_id   uuid not null,                          -- polymorphic; validated by app
  created_at  timestamptz not null default now(),
  primary key (truster_id, target_type, target_id)
);
create index mycelium_target_idx on public.mycelium(target_type, target_id);
alter table public.mycelium enable row level security;

-- ---- recommendations: amplify a specific post to people who trust you ----
create table public.recommendations (
  recommender_id uuid not null references public.profiles(id) on delete cascade,
  post_id        uuid not null references public.posts(id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (recommender_id, post_id)
);
create index recommendations_post_idx on public.recommendations(post_id);
alter table public.recommendations enable row level security;

-- ---- RLS ----

-- posts: read public, posts in your spaces, mycelium posts from people you trust, and your own.
create policy "posts: read" on public.posts for select to authenticated using (
  visibility = 'public'
  or author_id = auth.uid()
  or (visibility = 'space'    and exists (select 1 from public.space_members m
                                          where m.space_id = posts.space_id and m.profile_id = auth.uid()))
  or (visibility = 'mycelium' and exists (select 1 from public.mycelium my
                                          where my.truster_id = auth.uid()
                                            and my.target_type = 'profile' and my.target_id = posts.author_id))
);
create policy "posts: insert own" on public.posts for insert to authenticated with check (
  author_id = auth.uid()
  and (visibility <> 'space' or exists (select 1 from public.space_members m
                                        where m.space_id = posts.space_id and m.profile_id = auth.uid()))
);
create policy "posts: update own" on public.posts for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "posts: delete own" on public.posts for delete to authenticated using (author_id = auth.uid());

-- mycelium + recommendations: trust/endorsement edges are part of the social fabric —
-- readable by members (this powers the "who in MY mycelium endorsed this" overlays);
-- each member writes only their own edges.
create policy "mycelium: read"      on public.mycelium for select to authenticated using (true);
create policy "mycelium: add own"   on public.mycelium for insert to authenticated with check (truster_id = auth.uid());
create policy "mycelium: drop own"  on public.mycelium for delete to authenticated using (truster_id = auth.uid());

create policy "recs: read"     on public.recommendations for select to authenticated using (true);
create policy "recs: add own"  on public.recommendations for insert to authenticated with check (recommender_id = auth.uid());
create policy "recs: drop own" on public.recommendations for delete to authenticated using (recommender_id = auth.uid());

-- PostgREST needs table grants for the authenticated role (RLS still gates rows).
grant select, insert, update, delete on public.posts          to authenticated;
grant select, insert, delete         on public.mycelium        to authenticated;
grant select, insert, delete         on public.recommendations to authenticated;
