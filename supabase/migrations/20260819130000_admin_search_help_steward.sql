-- admin_search_members also reports the help-steward grant, so the toolbox
-- toggle shows current state (2026-08-19).
drop function public.admin_search_members(text);
create function public.admin_search_members(p_q text)
returns table(profile_id uuid, full_name text, email text, tier text, source text, status text, current_period_end timestamptz, help_steward boolean)
language sql stable security definer set search_path to 'public' as $func$
  select p.id, p.full_name, p.email,
         s.tier, s.source, s.status, s.current_period_end, p.help_steward
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
revoke all on function public.admin_search_members(text) from public;
grant execute on function public.admin_search_members(text) to authenticated;
