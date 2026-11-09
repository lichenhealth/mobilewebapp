-- THE DRAFT HOLDS ITS ZOOM ROOM (founder 2026-11-09: "why can't we generate a
-- zoom room for a draft post? and just delete it if the event never goes
-- live?"). A draft event's calendar hold (events.is_draft, draft_id → cascade)
-- carries zoom_unique, so the standing poke mints its room; deleting the draft
-- cascades the hold and the BEFORE DELETE poke deletes the room in Zoom.
-- On Post, the room MOVES to the live event (one link from preview to party):
-- the client creates the event with zoom_unique off, adopts the hold's room,
-- then switches zoom_unique on — the reconcile finds the room and only re-times.
create or replace function public.adopt_draft_meeting(p_draft uuid, p_event uuid)
returns boolean language plpgsql security definer set search_path = public
as $f$
declare v_hold uuid;
begin
  if auth.uid() is null then return false; end if;
  select id into v_hold from public.events
   where draft_id = p_draft and creator_id = auth.uid() and is_draft;
  if v_hold is null then return false; end if;
  if not exists (select 1 from public.events where id = p_event and creator_id = auth.uid() and not is_draft) then
    return false;
  end if;
  if exists (select 1 from public.event_meetings where event_id = p_event) then return false; end if;
  update public.event_meetings set event_id = p_event where event_id = v_hold;
  return found;
end $f$;
revoke all on function public.adopt_draft_meeting(uuid, uuid) from public, anon;
grant execute on function public.adopt_draft_meeting(uuid, uuid) to authenticated;
