-- GROWTH-PHASE AUTO-GIFT (founder 2026-07-23): while we populate the platform,
-- every member gets 3 months of Community free — granted the first time they'd
-- otherwise hit the paywall (the App gate calls this before redirecting to
-- /membership). Reuses the gift lifecycle: the "gifted by Lichen · through
-- {date}" card, the ending-soon bell (notice_gift_ending), and convert-to-paid.
--
-- ONE-TIME per member: it inserts only when NO subscription row exists, so after
-- the 3 months lapse the (now-expired) row remains and it never re-grants — they
-- land on /membership to pay. To end the growth phase later, stop calling this
-- from the gate; already-granted members keep their runway.

create or replace function public.grant_growth_gift()
returns boolean language plpgsql security definer set search_path = public as $fn$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then return false; end if;
  insert into public.subscriptions (profile_id, tier, source, status, current_period_end, granted_at)
  values (uid, 'community', 'gift', 'active', now() + interval '3 months', now())
  on conflict (profile_id) do nothing;   -- never clobbers a paid/existing sub
  get diagnostics n = row_count;
  return n > 0;
end $fn$;

grant execute on function public.grant_growth_gift() to authenticated;
