-- Page editing by the assistant is ON for everyone (founder 2026-08-22:
-- "Turn on page editing for all AI assistants on all page profiles,
-- members, groups, places, etc"), reversing the 2026-08-13 default-off.
-- This matches the platform's AI-consent doctrine (default on, opt out):
-- the tools still only run when a member ASKS in their own thread, only on
-- their own page or a space they steward — this flag was the extra gate,
-- and it becomes opt-out in Profile → Privacy instead of opt-in.
-- Every row was false (nobody had ever flipped it on), so the backfill
-- erases no deliberate choice.
alter table public.profiles alter column assistant_can_edit set default true;
update public.profiles set assistant_can_edit = true where assistant_can_edit = false;
