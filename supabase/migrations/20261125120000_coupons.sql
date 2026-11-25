-- COUPONS (founder 2026-11-25: "take pics of things and organize them for me
-- to coupons! And then when they expire, delete them… step 1 is just
-- organizing coupons so we don't have to keep paper").
--
-- One private row per coupon: who it's from, the offer, the code, the
-- minimum spend, when it expires, the fine print, and the photo (kept in the
-- member's private `drive` bucket). Owner-only, like budget_items.
--
-- tick_coupons() runs daily: one bell three days before a coupon expires
-- ("Use it or lose it"), then the day after it expires the row is deleted
-- and its photo path is queued in coupon_photo_purge — storage objects can't
-- be deleted from SQL, so the `coupons` edge fn (poked here with the webhook
-- secret) removes the files and clears the queue.

create table if not exists public.coupons (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  merchant      text not null check (char_length(merchant) between 1 and 120),
  offer         text not null check (char_length(offer) between 1 and 240),
  code          text check (code is null or char_length(code) <= 80),
  min_spend_cents integer check (min_spend_cents is null or min_spend_cents >= 0),
  expires_on    date,
  terms         text check (terms is null or char_length(terms) <= 2000),
  url           text check (url is null or (url ~ '^https://\S+$' and char_length(url) <= 600)),
  where_valid   text check (where_valid is null or where_valid in ('online','in_store','both')),
  category      text check (category is null or char_length(category) <= 40),
  photo_path    text check (photo_path is null or char_length(photo_path) <= 300),
  nudged_at     timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists coupons_owner_idx on public.coupons (profile_id, expires_on);

alter table public.coupons enable row level security;
drop policy if exists "coupons: owner" on public.coupons;
create policy "coupons: owner" on public.coupons for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
revoke all on public.coupons from anon;

-- A changed expiry earns a fresh reminder.
create or replace function public.coupons_reset_nudge() returns trigger
language plpgsql as $func$
begin
  if new.expires_on is distinct from old.expires_on then new.nudged_at := null; end if;
  return new;
end $func$;
drop trigger if exists coupons_reset_nudge on public.coupons;
create trigger coupons_reset_nudge before update on public.coupons
  for each row execute function public.coupons_reset_nudge();

-- Photo files waiting to be removed from storage (service role only).
create table if not exists public.coupon_photo_purge (
  path       text primary key,
  queued_at  timestamptz not null default now()
);
alter table public.coupon_photo_purge enable row level security;
revoke all on public.coupon_photo_purge from anon, authenticated;

create or replace function public.tick_coupons() returns void
language plpgsql security definer set search_path to 'public' as $func$
declare r record; v_secret text; v_today date; v_purged int := 0;
begin
  -- 1) Three days out: one bell per coupon.
  for r in
    select c.*, coalesce(p.timezone, 'America/Denver') as tz
      from coupons c join profiles p on p.id = c.profile_id
     where c.expires_on is not null and c.nudged_at is null
  loop
    v_today := (now() at time zone r.tz)::date;
    if r.expires_on >= v_today and r.expires_on <= v_today + 3 then
      perform notify(r.profile_id, 'currentcy', null, 'coupon_expiring',
        left(r.merchant || ' coupon expires ' ||
          case when r.expires_on = v_today then 'today'
               when r.expires_on = v_today + 1 then 'tomorrow'
               else to_char(r.expires_on, 'FMDay') end, 200),
        left(r.offer || coalesce(' · code ' || r.code, ''), 300),
        '/currentcy#coupons', null);
      update coupons set nudged_at = now() where id = r.id;
    end if;
  end loop;

  -- 2) Expired yesterday or earlier: gone, photo queued for removal.
  with gone as (
    delete from coupons c using profiles p
     where p.id = c.profile_id and c.expires_on is not null
       and c.expires_on < (now() at time zone coalesce(p.timezone, 'America/Denver'))::date
    returning c.photo_path
  )
  insert into coupon_photo_purge(path)
  select photo_path from gone where photo_path is not null
  on conflict do nothing;
  get diagnostics v_purged = row_count;

  if exists (select 1 from coupon_photo_purge) then
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_hook_secret';
    begin
      perform net.http_post(
        url := 'https://mjqnaevertyzgjlpwynr.supabase.co/functions/v1/coupons',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', coalesce(v_secret, '')),
        body := '{"purge":true}'::jsonb);
    exception when others then null;
    end;
  end if;
end $func$;
revoke all on function public.tick_coupons() from public, anon, authenticated;

select cron.unschedule('tick-coupons') where exists (select 1 from cron.job where jobname = 'tick-coupons');
select cron.schedule('tick-coupons', '13 14 * * *', $cron$select public.tick_coupons()$cron$);
