-- DONATION TAX FLOWS (founder, 2026-07-21): encode the IRS conduit rule into
-- the flow itself. Two doors:
--   * kind='donation'    — tax-deductible; designations are PREFERENCES and
--                          Lichen retains discretion (the receipt says so).
--   * kind='sponsorship' — the donor chooses who benefits (a personal gift,
--                          NOT deductible; gets a gift acknowledgment, never
--                          a contribution receipt).
-- Plus the operations bucket: a general donation an admin keeps as 100%
-- operating dollars (no Current minted), and a float summary so the bank
-- ritual is "read one number, make one transfer".

alter table public.donations
  add column kind text not null default 'donation'
    check (kind in ('donation', 'sponsorship'));

-- status gains 'operations' (kept whole as operating dollars, nothing minted)
alter table public.donations drop constraint donations_status_check;
alter table public.donations add constraint donations_status_check
  check (status in ('received', 'translated', 'operations'));

-- Keep a donation entirely as operating dollars — for general/operations
-- gifts that shouldn't mint Current to anyone. One-way, like translation.
create or replace function public.keep_donation_for_operations(p_donation uuid)
returns void language plpgsql security definer set search_path = public as $$
declare d record;
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only admins can do this.';
  end if;
  select * into d from donations where id = p_donation for update;
  if not found then raise exception 'No such donation.'; end if;
  if d.status <> 'received' then raise exception 'Already resolved.'; end if;
  update donations
     set status = 'operations', translated_at = now(), central_cents = amount_cents
   where id = p_donation;
end $$;

-- The one number for the bank ritual. Circulation = every Current ever
-- minted (nothing exits until cash-out ships) — the Float account must hold
-- at least this many dollars. Operating cents = the 5% cuts + whole
-- donations kept for operations; that money is spendable.
create or replace function public.currentcy_float_summary()
returns json language plpgsql stable security definer set search_path = public as $$
declare v_circulation numeric; v_operating bigint;
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Admins only.';
  end if;
  select coalesce(sum(amount), 0) into v_circulation
    from ledger_entries where from_type is null;
  select coalesce(sum(central_cents), 0) into v_operating
    from donations where central_cents is not null;
  return json_build_object(
    'circulation', v_circulation,
    'operating_cents', v_operating
  );
end $$;
