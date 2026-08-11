-- Admin member search for /admin/supporters (founder 2026-08-11: "a drop
-- down of members that opens a search bar, so we can find certain members").
-- profiles.email is deliberately outside the column-scoped SELECT grant, so
-- an admin needs a SECURITY DEFINER door to find ANY member (not just
-- current supporters) with their email and membership state in one row.

create or replace function public.admin_search_members(p_q text)
returns table (
  profile_id uuid,
  full_name text,
  email text,
  tier text,
  source text,
  status text,
  current_period_end timestamptz
)
language sql
stable
security definer
set search_path = public
as $func$
  select p.id, p.full_name, p.email,
         s.tier, s.source, s.status, s.current_period_end
  from public.profiles p
  left join public.subscriptions s on s.profile_id = p.id
  where (select is_admin from public.profiles where id = auth.uid())
    and (
      p.full_name ilike '%' || p_q || '%'
      or p.email ilike '%' || p_q || '%'
    )
  order by p.full_name nulls last
  limit 12;
$func$;

revoke all on function public.admin_search_members(text) from public, anon;
grant execute on function public.admin_search_members(text) to authenticated;
