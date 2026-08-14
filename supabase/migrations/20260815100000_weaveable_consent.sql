-- WEAVEABLE CONSENT (founder 2026-08-14, the Drive conversation): weaving is
-- ALWAYS by reference — collection_items point at posts, so attribution is
-- structural and revocation is real. This adds the consent layer: whether a
-- post may appear inside OTHER people's collections is the author's call.
--
-- Shape matches content_ai_default/aiExcluded exactly: the profiles column is
-- only a Compose PRESELECTION (read by the owner); the per-post truth lives in
-- posts.details as noWeave, stored only when switched OFF. Absence = weaveable.

alter table public.profiles
  add column weaveable_default boolean not null default true;

comment on column public.profiles.weaveable_default is
  'Compose preselection for the per-post weaveable toggle. The per-post truth is posts.details.noWeave (stored only when switched OFF).';

grant select (weaveable_default) on public.profiles to authenticated;

-- The enforcement: every collection_items INSERT — the client picker, the
-- lesson picker, Organize moves, Compose organize-into, and the SECURITY
-- DEFINER resolve_collection_suggestion (the resolver's uid is the steward,
-- not the author) — all pass through here. Your own posts always weave.
create or replace function public.enforce_weaveable()
returns trigger
language plpgsql security definer set search_path = 'public' as $func$
declare v_author uuid; v_noweave text;
begin
  if new.target_type <> 'post' then return new; end if;
  select p.author_id, p.details->>'noWeave' into v_author, v_noweave
    from posts p where p.id = new.target_id;
  if v_author is null then return new; end if;  -- not a post row; nothing to guard
  if v_author <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
     and v_noweave = 'true' then
    raise exception 'They keep this piece out of others'' collections.';
  end if;
  return new;
end $func$;

drop trigger if exists enforce_weaveable on public.collection_items;
create trigger enforce_weaveable
  before insert on public.collection_items
  for each row execute function public.enforce_weaveable();
