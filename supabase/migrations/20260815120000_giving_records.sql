-- GIVING RECORDS (founder, 2026-07-21): the Goodwill move, done right.
-- (1) Donors can read their OWN rows in `donations` — powering the private
--     "My giving" dashboard (money donations + gifts).
-- (2) `inkind_donations` — goods DONATED TO LICHEN (title passes; that's
--     what makes a Goodwill-style receipt legal). Flow: giver offers while
--     listing (entrusted + "donate to Lichen"); a steward ACCEPTS on the
--     routing desk → acknowledgment email (edge fn) + dashboard record.
--     Lichen never states a value — the donor determines FMV (IRS rule).

create policy donations_donor_read on public.donations for select to authenticated
  using (donor_profile_id = auth.uid());

create table public.inkind_donations (
  id uuid primary key default gen_random_uuid(),
  donor_profile_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete set null,
  description text not null,
  status text not null default 'offered' check (status in ('offered', 'accepted', 'declined')),
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id),
  receipt_sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.inkind_donations enable row level security;

create policy inkind_own_read on public.inkind_donations for select to authenticated
  using (donor_profile_id = auth.uid()
     or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
create policy inkind_own_insert on public.inkind_donations for insert to authenticated
  with check (donor_profile_id = auth.uid());
-- no update/delete policies: state moves through the RPCs below (and the
-- receipt edge function's service role).

create index inkind_status_idx on public.inkind_donations (status, created_at desc);

create or replace function public.accept_inkind_donation(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
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

create or replace function public.decline_inkind_donation(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only admins can decline donations.';
  end if;
  update inkind_donations set status = 'declined'
   where id = p_id and status = 'offered';
end $$;
