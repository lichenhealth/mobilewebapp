-- BUDGET (founder 2026-10-02: "like a bank account, but also like budgeting
-- software… how much current-cy you have, versus what you need to procure
-- the things you want on the platform, which can auto-pull in the price…
-- but you can also manually input stuff from outside lichen, like your
-- mortgage… balance, energy in and energy out for each month or year").
--
-- budget_items is the member's PRIVATE planning list — strictly owner-only,
-- the saved_items doctrine: no counts or signals visible to anyone, listing
-- authors included. A row is EITHER a platform want (post_id — the price is
-- pulled LIVE from the listing at render, by reference, so it can't go
-- stale) OR a manual line (label + amount, in|out, once|monthly|yearly).
-- Planning only: nothing here ever moves a Current.

create table if not exists public.budget_items (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  post_id      uuid references public.posts(id) on delete cascade,
  label        text,
  amount_cents integer check (amount_cents >= 0),
  direction    text not null default 'out' check (direction in ('in', 'out')),
  cadence      text not null default 'once' check (cadence in ('once', 'monthly', 'yearly')),
  created_at   timestamptz not null default now(),
  constraint budget_items_shape check (
    post_id is not null
    or (coalesce(btrim(label), '') <> '' and amount_cents is not null)
  )
);

alter table public.budget_items enable row level security;
drop policy if exists "budget: own" on public.budget_items;
create policy "budget: own" on public.budget_items
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
grant select, insert, update, delete on public.budget_items to authenticated;

-- A listing sits on a member's budget once (a partial unique index can't be
-- inferred by ON CONFLICT — the mycelium lesson — so the client does
-- insert-and-ignore-duplicate rather than upsert).
create unique index if not exists budget_items_one_post
  on public.budget_items (profile_id, post_id) where post_id is not null;
