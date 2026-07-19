-- DONATIONS → CURRENT-CY (founder + E.D. design, 2026-07-18): donors give
-- dollars (optionally DIRECTED — "this goes to Melanie Bright to subsidize
-- care"); the admin translates each gift into the ledger. THE SPLIT: 95% is
-- minted as Current to the resolved recipient (fully backed by the float);
-- 5% stays as DOLLARS — Lichen central's operating revenue, deliberately
-- never minted (operations run on dollars; the ledger holds only backed,
-- granted value).
--
-- Rows are written by the stripe-webhook (service role) on
-- checkout.session.completed; admins read + translate. No client writes.

create table public.donations (
  id uuid primary key default gen_random_uuid(),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd',
  donor_email text,
  donor_profile_id uuid references public.profiles(id) on delete set null,
  designation text not null default '',           -- donor's own words, resolved by the admin
  frequency text not null default 'one-time',
  stripe_session_id text not null unique,
  status text not null default 'received' check (status in ('received', 'translated')),
  translated_at timestamptz,
  ledger_entry_id uuid references public.ledger_entries(id),
  central_cents integer,                          -- the 5% kept as operating dollars
  created_at timestamptz not null default now()
);

alter table public.donations enable row level security;
create policy donations_admin_read on public.donations for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
-- no insert/update policies: webhook writes with the service role; translation
-- happens through the RPC below.

create index donations_status_idx on public.donations (status, created_at desc);

-- Translate a received donation into the ledger: mints 95% as Current to the
-- recipient the admin resolved from the donor's designation; records the 5%
-- kept as operating dollars. One translation per donation, ever.
create or replace function public.translate_donation(
  p_donation uuid, p_to_type text, p_to_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  d record; v_grant numeric; v_central integer; v_ledger uuid; v_memo text;
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only admins can translate donations.';
  end if;

  select * into d from donations where id = p_donation for update;
  if not found then raise exception 'No such donation.'; end if;
  if d.status <> 'received' then raise exception 'Already translated.'; end if;

  if p_to_type = 'profile' then
    if not exists (select 1 from profiles where id = p_to_id) then raise exception 'No such member.'; end if;
  elsif p_to_type = 'space' then
    if not exists (select 1 from spaces where id = p_to_id) then raise exception 'No such group.'; end if;
  else
    raise exception 'Unknown recipient kind.';
  end if;

  -- 95% minted (in Current, dollar-pegged); 5% stays as operating dollars.
  v_grant := round((d.amount_cents * 0.95) / 100.0, 2);
  v_central := d.amount_cents - round(d.amount_cents * 0.95)::integer;
  if v_grant <= 0 then raise exception 'Donation too small to translate.'; end if;

  v_memo := 'Donor-directed gift · 95%% of $' || trim(to_char(d.amount_cents / 100.0, 'FM999999990.00'));
  v_memo := replace(v_memo, '%%', '%');
  if coalesce(d.designation, '') <> '' then
    v_memo := v_memo || ' · "' || d.designation || '"';
  end if;

  insert into ledger_entries (from_type, from_id, to_type, to_id, amount, context, memo, ref_type, ref_id, created_by)
  values (null, null, p_to_type, p_to_id, v_grant, 'grant', v_memo, 'donation', d.id, auth.uid())
  returning id into v_ledger;

  update donations
     set status = 'translated', translated_at = now(),
         ledger_entry_id = v_ledger, central_cents = v_central
   where id = p_donation;

  if p_to_type = 'profile' then
    perform public.notify(p_to_id, 'home', null, 'currentcy',
      'A donor directed ' || trim(to_char(v_grant, 'FM999999990.##')) || ' Current to you',
      nullif(d.designation, ''), '/profile', auth.uid());
  end if;
  return v_ledger;
end $$;
