-- YOUR PROFILE IS YOUR WEBSITE (founder 2026-07-28): a space — or a person
-- who opts in — can serve as a public page on the open web: who they are,
-- what they offer, how to reach them. Engaging (recommend, book, message,
-- events, calendar) still means joining Lichen. Every deeper interaction
-- becomes an invitation.
--
-- CONSENT: people are OPT-IN (default false) — being findable by name on the
-- open web is a different exposure from being visible inside Lichen.
-- Organizations, communities, groups and places default TRUE: a stable wants
-- to be found. Either can flip it.

-- ── 1. Contact facts + the switch ───────────────────────────────────────────
-- contact = { website, email, phone, booking, hours, address, socials{} }
alter table public.profiles
  add column if not exists contact jsonb,
  add column if not exists public_page boolean not null default false;

alter table public.spaces
  add column if not exists contact jsonb,
  add column if not exists public_page boolean not null default true;

-- ── 2. What the open web may read ───────────────────────────────────────────
-- Column-scoped, exactly like the email-privacy pattern: anon sees the
-- public-page fields and nothing else. A person's location is NOT here — it
-- stays behind the location_shares ladder no matter what.
grant select (id, full_name, handle, headline, bio, avatar_url, identity_tags,
              contact, public_page)
  on public.profiles to anon;

grant select (id, name, handle, kind, description, avatar_url, location,
              lat, lng, contact, public_page)
  on public.spaces to anon;

drop policy if exists "profiles: public pages" on public.profiles;
create policy "profiles: public pages" on public.profiles
  for select to anon using (public_page = true and onboarded = true);

drop policy if exists "spaces: public pages" on public.spaces;
create policy "spaces: public pages" on public.spaces
  for select to anon using (public_page = true);

-- Offerings are part of the page: which categories they work in.
grant select on public.profile_categories to anon;
grant select on public.categories to anon;

drop policy if exists "profile_categories: public pages" on public.profile_categories;
create policy "profile_categories: public pages" on public.profile_categories
  for select to anon using (
    exists (select 1 from public.profiles p
            where p.id = profile_categories.profile_id
              and p.public_page and p.onboarded)
  );

drop policy if exists "categories: readable" on public.categories;
create policy "categories: readable" on public.categories
  for select to anon using (true);
