-- PLATFORM-WIDE VANITY LINKS (founder 2026-11-04: "vanity url structure should
-- be deployed across platform, so you can share a link for anything, a product
-- on marketplace a travel review, etc" — lichen.health/<section>/<handle>/<link-name>,
-- the /book/<handle>/<slug> grammar generalized to posts).
--
-- One column serves every section: marketplace products, travel reviews,
-- events, library pieces — they are all posts rows. The slug is unique per
-- OWNER (the space when authored in a space's voice, else the author), so
-- two members can both own /travel/<their-handle>/review-zion.

alter table public.posts add column if not exists slug text
  check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{0,47}$');

create unique index if not exists posts_slug_per_owner
  on public.posts (coalesce(author_space_id::text, author_id::text), lower(slug))
  where slug is not null;

-- The resolver: handle (spaces before people — the platform's standing order,
-- SpaceByHandle's own) → optionally one post by slug. SECURITY DEFINER so an
-- unfindable member's public share still answers; it returns only ids —
-- a signed-in caller's actual read then goes through RLS (an unreadable post
-- reads as not-available), and anon only ever gets a PUBLIC post's id.
-- open_link (the event's shareable guest URL) rides out only on a public
-- event post, for the signed-out landing — a deliberate, bounded exposure:
-- the host chose a public link name, and the approval gate (requested rows)
-- still protects attendance.
create or replace function public.resolve_post_vanity(p_handle text, p_slug text default null)
returns table(host_kind text, host_id uuid, post_id uuid, areas text[], open_link text)
language plpgsql
security definer
set search_path = public
as $vanity$
declare
  v_kind text;
  v_id uuid;
  v_post uuid;
  v_areas text[];
  v_open text;
begin
  if p_handle is null or btrim(p_handle) = '' then return; end if;

  select s.id into v_id
    from spaces s
   where lower(s.handle) = lower(btrim(p_handle))
     and public.space_alive(s.id)
   limit 1;
  if v_id is not null then
    v_kind := 'space';
  else
    select p.id into v_id
      from profiles p
     where lower(p.handle) = lower(btrim(p_handle))
     limit 1;
    if v_id is not null then v_kind := 'profile'; end if;
  end if;
  if v_id is null then return; end if;

  if p_slug is null or btrim(p_slug) = '' then
    return query select v_kind, v_id, null::uuid, null::text[], null::text;
    return;
  end if;

  select po.id, po.service_areas,
         case when po.visibility = 'public' then ev.guest_link_token end
    into v_post, v_areas, v_open
    from posts po
    left join events ev on ev.id = po.linked_event_id
   where lower(po.slug) = lower(btrim(p_slug))
     and ((v_kind = 'space'   and po.author_space_id = v_id)
       or (v_kind = 'profile' and po.author_id = v_id and po.author_space_id is null))
     and (auth.uid() is not null or po.visibility = 'public')
   limit 1;
  if v_post is null then return; end if;

  return query select v_kind, v_id, v_post, v_areas, v_open;
end;
$vanity$;

revoke all on function public.resolve_post_vanity(text, text) from public;
grant execute on function public.resolve_post_vanity(text, text) to anon, authenticated;
