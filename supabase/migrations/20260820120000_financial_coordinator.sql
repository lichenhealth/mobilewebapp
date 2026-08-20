-- A FINANCIAL COORDINATOR JOINS YOUR CARE TEAM (founder 2026-08-20): the
-- Web-of-Wellbeing self-assessment now offers "in need of subsidies within
-- the network? create a financial health profile", and the profile promises
-- a coordinator — someone whose job is exactly that piece.
--
-- A promise needs a keeper. Creating the profile bells the platform admins,
-- who offer care the ordinary consensual way (offerCareFor → the member
-- approves). No automatic seat: a care team is people you agreed to, and
-- nothing may add itself to yours.
--
-- Caller-scoped by construction: it announces the SENDER, takes no target.
create or replace function public.request_financial_coordinator()
returns void language plpgsql security definer set search_path to 'public' as $func$
declare v_me uuid := auth.uid(); v_name text;
begin
  if v_me is null then raise exception 'not signed in'; end if;
  select coalesce(nullif(full_name, ''), email, 'A member') into v_name
    from public.profiles where id = v_me;
  insert into public.notifications (recipient_id, section, type, title, body, link, actor_id)
  select p.id, 'home', 'financial_coordinator_wanted',
         v_name || ' created a financial health profile',
         'They''re asking the network for subsidy help — offer to join their care team as their financial coordinator.',
         '/members/' || v_me::text, v_me
    from public.profiles p where p.is_admin;
end;
$func$;
revoke all on function public.request_financial_coordinator() from public;
grant execute on function public.request_financial_coordinator() to authenticated;
