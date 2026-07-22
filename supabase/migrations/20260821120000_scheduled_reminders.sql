-- SCHEDULED REMINDERS (2026-07-22): fire timed reminders on the phone even when
-- Lichen is closed. pg_cron pings the fire-reminders edge function every minute;
-- it expands recurrence, checks each member's LOCAL time, and calls notify() for
-- anything due — which fans out to Web Push (send-push webhook). Completes the
-- "phase 2" ReminderAlerts always pointed at.
--
-- PREREQUISITES (enable once in Dashboard → Database → Extensions):
--   • pg_cron   (the minute scheduler)
--   • pg_net    (net.http_post — already on if Database Webhooks work)
-- AND a Vault secret holding the webhook secret (see runbook):
--   select vault.create_secret('<NOTIFICATION_WEBHOOK_SECRET value>', 'notification_webhook_secret');

-- Each member's timezone, stamped by the client heartbeat. Not sensitive; the
-- edge function reads it with the service role to compute local fire times.
alter table public.profiles add column if not exists timezone text;

-- Fire ledger: one row per (reminder, person, day) once it has fired — the
-- atomic guard against double buzzes across overlapping cron runs. Service-role
-- only (deny-all RLS: no policies).
create table public.reminder_fired (
  reminder_id uuid not null references public.reminders(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  on_date date not null,
  fired_at timestamptz not null default now(),
  primary key (reminder_id, profile_id, on_date)
);
alter table public.reminder_fired enable row level security;

-- Cron entrypoint: ping the edge function with the shared secret from Vault.
-- SECURITY DEFINER so cron (running as postgres) can read the vault + call net.
create or replace function public.tick_reminders()
returns void language plpgsql security definer set search_path = public as $fn$
declare v_secret text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'notification_webhook_secret';
  perform net.http_post(
    url := 'https://mjqnaevertyzgjlpwynr.supabase.co/functions/v1/fire-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', coalesce(v_secret, '')),
    body := '{}'::jsonb
  );
end $fn$;

-- Every minute. (Re-running this file? unschedule first: select cron.unschedule('fire-reminders');)
select cron.schedule('fire-reminders', '* * * * *', $$select public.tick_reminders();$$);
