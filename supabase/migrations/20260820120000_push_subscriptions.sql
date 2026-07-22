-- WEB PUSH (2026-07-22): phone lock-screen notifications, even when Lichen is
-- closed. A device subscribes once; its subscription lands here. A Database
-- Webhook on notifications INSERT calls the send-push edge function, which fans
-- each new bell out to the recipient's subscribed devices. So push rides the
-- existing notify() — every bell (nudges, DMs, care, gifts) reaches the phone.
--
-- Mirrors the send-notification-email webhook pattern exactly (same table, same
-- INSERT event) — this migration is just the storage; the webhook + secrets are
-- configured out-of-band (see the runbook).

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,           -- the push service URL; unique per device
  p256dh text not null,                    -- subscription public key (payload encryption)
  auth text not null,                      -- subscription auth secret
  user_agent text,                         -- which device, for the member's own reference
  created_at timestamptz not null default now()
);
create index push_subscriptions_profile on public.push_subscriptions (profile_id);

alter table public.push_subscriptions enable row level security;

-- Owner-only: a member manages their own devices. The edge function reads with
-- the service role (bypasses RLS), so no broad read policy is needed.
create policy push_subs_own on public.push_subscriptions for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- Fan each new notification out to the recipient's subscribed devices. Uses the
-- same pg_net + Vault secret as the scheduled-reminders cron (rather than a
-- dashboard Database Webhook) so push and the clock share one mechanism.
-- PREREQUISITES: pg_net enabled + Vault secret 'notification_webhook_secret'
-- (see 20260821120000_scheduled_reminders.sql).
create or replace function public.push_on_notification()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_secret text;
begin
  -- Skip the round-trip when the recipient has no subscribed device.
  if not exists (select 1 from public.push_subscriptions where profile_id = new.recipient_id) then
    return new;
  end if;
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'notification_webhook_secret';
    perform net.http_post(
      url := 'https://mjqnaevertyzgjlpwynr.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', coalesce(v_secret, '')),
      body := jsonb_build_object(
        'type', 'INSERT',
        'record', jsonb_build_object(
          'recipient_id', new.recipient_id, 'type', new.type,
          'title', new.title, 'body', new.body, 'link', new.link
        )
      )
    );
  exception when others then
    null;  -- a push hiccup must NEVER block the in-app bell
  end;
  return new;
end $fn$;

create trigger push_on_notification
  after insert on public.notifications
  for each row execute function public.push_on_notification();
