-- SUBSCRIPTIONS IN THE BUDGET (founder 2026-11-24: "I want to be able to
-- manage subscriptions better… there is a lot of wasted money with auto
-- renews"). A subscription is an ordinary expense line on the Budget (the
-- shared-state rule — the money plan and the subscription list are ONE store)
-- that also knows when it renews, where to manage it, and how it's billed.
-- The brain finds them in the member's receipts; a bell rings a few days
-- before each renewal; cancelling removes the line.

alter table public.budget_items
  add column if not exists is_subscription boolean not null default false,
  add column if not exists renews_on date,
  add column if not exists manage_url text check (manage_url is null or (manage_url ~ '^https://' and char_length(manage_url) <= 600)),
  add column if not exists billed_via text check (billed_via is null or char_length(billed_via) <= 120),
  add column if not exists renew_nudged_for date;

create index if not exists budget_items_renewals_idx on public.budget_items (renews_on) where is_subscription;

-- A few days before each renewal: one currentcy bell, then roll the date on.
create or replace function public.tick_subscription_renewals()
returns void language plpgsql security definer set search_path = public as $func$
declare r record; v_when text; v_amt text;
begin
  -- Roll forward renewals that have passed (monthly / yearly).
  update budget_items
     set renews_on = case cadence when 'yearly' then (renews_on + interval '1 year')::date else (renews_on + interval '1 month')::date end
   where is_subscription and renews_on is not null and renews_on < current_date and cadence in ('monthly', 'yearly');

  for r in
    select b.* from budget_items b
     where b.is_subscription and b.renews_on is not null
       and b.renews_on between current_date and current_date + 3
       and b.renew_nudged_for is distinct from b.renews_on
  loop
    v_when := case when r.renews_on = current_date then 'today'
                   when r.renews_on = current_date + 1 then 'tomorrow'
                   else to_char(r.renews_on, 'FMDay, Mon FMDD') end;
    v_amt := case when r.amount_cents is null or r.amount_cents = 0 then ''
                  else ' for $' || regexp_replace(to_char(r.amount_cents / 100.0, 'FM999990.00'), '\.00$', '') end;
    perform notify(r.profile_id, 'currentcy', null, 'subscription_renewal',
      left(coalesce(r.label, 'A subscription') || ' renews ' || v_when || v_amt, 200),
      'Keep it, or cancel before it charges? Your Budget has the manage link.',
      '/currentcy#subscriptions', null);
    update budget_items set renew_nudged_for = r.renews_on where id = r.id;
  end loop;
end $func$;
revoke all on function public.tick_subscription_renewals() from public, anon, authenticated;

select cron.unschedule('tick-subscription-renewals') where exists (select 1 from cron.job where jobname = 'tick-subscription-renewals');
select cron.schedule('tick-subscription-renewals', '17 15 * * *', $cron$select public.tick_subscription_renewals()$cron$);
