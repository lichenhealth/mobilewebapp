-- AN EVENT'S LINK NAME IS AN ALIAS OF ITS SHAREABLE LINK (founder 2026-11-09:
-- "you should be able to copy the link URL… so you can copy it and send it via
-- text"). Once the host mints the event's shareable link, the friendly address
-- answers for anyone — on or off Lichen — by landing on that link's /e/ page,
-- whose tier rules (open / members / invite list + approval) still decide who
-- gets in. Without a minted link, non-public events stay dark to the open web.
create or replace function public.resolve_post_vanity(p_handle text, p_slug text default null::text)
 returns table(host_kind text, host_id uuid, post_id uuid, areas text[], open_link text)
 language plpgsql security definer set search_path to 'public'
as $func$
declare v_kind text; v_id uuid; v_post uuid; v_areas text[]; v_open text;
begin
  if p_handle is null or btrim(p_handle) = '' then return; end if;
  select s.id into v_id from spaces s
   where lower(s.handle) = lower(btrim(p_handle)) and public.space_alive(s.id) limit 1;
  if v_id is not null then v_kind := 'space';
  else
    select p.id into v_id from profiles p where lower(p.handle) = lower(btrim(p_handle)) limit 1;
    if v_id is not null then v_kind := 'profile'; end if;
  end if;
  if v_id is null then return; end if;
  if p_slug is null or btrim(p_slug) = '' then
    return query select v_kind, v_id, null::uuid, null::text[], null::text;
    return;
  end if;
  select po.id, po.service_areas, ev.guest_link_token
    into v_post, v_areas, v_open
    from posts po
    left join events ev on ev.id = po.linked_event_id
   where lower(po.slug) = lower(btrim(p_slug))
     and ((v_kind = 'space'   and po.author_space_id = v_id)
       or (v_kind = 'profile' and po.author_id = v_id and po.author_space_id is null))
     and (auth.uid() is not null or po.visibility = 'public' or ev.guest_link_token is not null)
   limit 1;
  if v_post is null then return; end if;
  return query select v_kind, v_id, v_post, v_areas, v_open;
end;
$func$;
