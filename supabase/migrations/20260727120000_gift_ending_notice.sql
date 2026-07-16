-- Gift endings warn ahead (founder, 2026-07-15): members whose gifted
-- membership ends within 14 days get one bell notification (membership
-- section) prompting them to choose a plan. Called for SELF from the app's
-- membership gate — an in-app notification can only be seen by someone using
-- the app anyway. Email reminders would need a scheduled job (later).

create or replace function public.notice_gift_ending() returns integer
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  s record;
begin
  if v_uid is null then return 0; end if;
  select * into s from public.subscriptions
    where profile_id = v_uid and source = 'gift' and status = 'active'
      and current_period_end is not null
      and current_period_end > now()
      and current_period_end <= now() + interval '14 days';
  if s.profile_id is null then return 0; end if;
  -- one warning per gift window (a re-gift restarts the window)
  if exists (
    select 1 from public.notifications
    where recipient_id = v_uid and type = 'membership_ending'
      and created_at > s.current_period_end - interval '14 days'
  ) then return 0; end if;
  perform public.notify(
    v_uid, 'membership', null, 'membership_ending',
    'Your gifted membership ends ' || to_char(s.current_period_end, 'FMMonth FMDD'),
    'Choose a plan to keep your access uninterrupted.',
    '/membership', null
  );
  return 1;
end;
$$;

grant execute on function public.notice_gift_ending() to authenticated;
