-- THE PAGE TEMPLATE (founder 2026-07-28): every Lichen site shares one
-- structure — hero, story, offerings, practical, presence, join — so visitors
-- learn to navigate them all at once, and members never face a blank canvas.
-- One jsonb per entity: adding a block later costs no migration.
--
--   page = { tagline, story, cover, coverStyle, accent, action:{kind,label,href},
--            practical:{bring,parking,access}, showPosts }

alter table public.profiles add column if not exists page jsonb;
alter table public.spaces   add column if not exists page jsonb;

grant select (page) on public.profiles to anon, authenticated;
grant select (page) on public.spaces   to anon, authenticated;
