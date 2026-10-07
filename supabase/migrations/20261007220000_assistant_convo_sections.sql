-- MULTI-SECTION CONVERSATIONS (founder 2026-10-07: "have the conversations
-- be smart enough that they can have multiple icons attached to them, just
-- like a post. So, let's say a convo involved maps and marketplace, both
-- icons will show up and it will populate in the Maps filtered Brain chat").
-- A conversation lives in ONE thread (where it was filed) but may TOUCH
-- several sections: the client stamps the originating brief's section on the
-- member's first message (a Maps-brain conversation is tagged 'maps' even
-- though it files into the general thread), and assistant-feed stamps the
-- sections its tools actually touched onto each reply. The convo's icon set
-- and the section-filtered "Earlier conversations" lists are the union.
alter table public.assistant_feed_posts
  add column if not exists sections text[];

comment on column public.assistant_feed_posts.sections is
  'Platform sections this entry pertains to beyond its thread (founder 2026-10-07). Client stamps the originating brief section; assistant-feed stamps tool-touched sections on replies. Null = just its thread.';
