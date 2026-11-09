-- UNIQUE ZOOM MEETINGS FOR EVENTS (founder 2026-11-09: "so do you need to
-- build unique zoom links for events still and push it? if so, please do!").
-- The booking machinery (_shared/zoomMeeting.ts, Lichen's one Zoom account,
-- the platform_settings.zoom_providers gate) extended to events:
--   events.zoom_unique — the host's ask (Compose's checkbox)
--   event_meetings     — the minted meeting, OWNER-SIDE ONLY: readable by the
--                        event's hosts and its attendees, never by everyone
--                        who can merely read the event (a public event must
--                        not hand its room to the open web — the
--                        booking_type_meetings doctrine).
-- A poke trigger reconciles on create, on any time change, on switching it
-- off, and on delete (the meeting is deleted in Zoom — the door closes).

alter table public.events add column if not exists zoom_unique boolean not null default false;

create table if not exists public.event_meetings (
  event_id uuid primary key references public.events(id) on delete cascade,
  zoom_meeting_id text not null,
  join_url text not null check (join_url ~ '^https://'),
  created_at timestamptz not null default now()
);
alter table public.event_meetings enable row level security;
drop policy if exists "event meetings read" on public.event_meetings;
create policy "event meetings read" on public.event_meetings for select to authenticated
  using (public.is_event_host(event_id, auth.uid()) or public.is_event_attendee(event_id, auth.uid()));
-- No client writes: only the zoom-meeting edge fn (service role) stamps rows.

-- An off-Lichen guest reads the room by their own token, once they're in
-- (never while their ask is still with the host).
create or replace function public.guest_event_meeting(p_token text)
returns text language sql stable security definer set search_path = public
as $f$
  select m.join_url
  from public.event_guests g
  join public.event_meetings m on m.event_id = g.event_id
  where g.token = p_token and g.status in ('invited', 'going', 'tentative');
$f$;
revoke all on function public.guest_event_meeting(text) from public;
grant execute on function public.guest_event_meeting(text) to anon, authenticated;

create or replace function public.poke_event_zoom()
returns trigger language plpgsql security definer set search_path = public
as $f$
declare v_secret text; v_body jsonb; v_zid text;
begin
  if tg_op = 'DELETE' then
    select zoom_meeting_id into v_zid from public.event_meetings where event_id = old.id;
    if v_zid is null then return old; end if;
    v_body := jsonb_build_object('delete_zoom_id', v_zid);
  elsif tg_op = 'INSERT' then
    if not new.zoom_unique then return new; end if;
    v_body := jsonb_build_object('event_id', new.id);
  else
    if not (new.zoom_unique or old.zoom_unique) then return new; end if;
    if new.zoom_unique = old.zoom_unique and new.start_date = old.start_date
       and new.start_min is not distinct from old.start_min and new.end_min is not distinct from old.end_min
       and new.end_date = old.end_date and new.all_day = old.all_day and new.title = old.title
       and new.timezone is not distinct from old.timezone then
      return new;
    end if;
    v_body := jsonb_build_object('event_id', new.id);
  end if;
  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_hook_secret';
    perform net.http_post(
      url := 'https://mjqnaevertyzgjlpwynr.supabase.co/functions/v1/zoom-meeting',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', coalesce(v_secret, '')),
      body := v_body);
  exception when others then null;   -- a Zoom hiccup never blocks saving an event
  end;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $f$;
revoke all on function public.poke_event_zoom() from public, anon, authenticated;

drop trigger if exists event_zoom_poke on public.events;
create trigger event_zoom_poke after insert or update on public.events
  for each row execute function public.poke_event_zoom();
drop trigger if exists event_zoom_poke_delete on public.events;
create trigger event_zoom_poke_delete before delete on public.events
  for each row execute function public.poke_event_zoom();
