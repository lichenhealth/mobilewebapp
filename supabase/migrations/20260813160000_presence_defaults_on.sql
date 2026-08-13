-- PRESENT BY DEFAULT, SNUFF IF YOU'D RATHER NOT (founder 2026-08-13: "default
-- to presence when you're on the Platform, as going to Facebook, for example,
-- means you're on the network").
--
-- This was already the intent on 2026-08-07 — it's quoted verbatim in
-- PresencePrompt.tsx's own header ("the default is to be present but you can
-- just turn out your light if you want to engage with the platform but you're
-- not feeling open to connecting") — it just never reached the column, which
-- has defaulted to false all along. Retiring the "around" signal this morning
-- made that gap visible: presence became opt-in, and the counts fell to almost
-- nobody.
--
-- WHAT PRESENT MEANS NOW. Still the candle, unchanged. But default-on shifts
-- it from "online AND deliberately lit" to "online AND hasn't snuffed" — a
-- weaker claim, and an honest one only if people actually learn they can blow
-- it out. That's what the first-few-visits prompt is for, and why its cadence
-- (member_prompts.times_seen, below) is part of this change rather than a
-- nicety alongside it.
--
-- ⚠ THE BACKFILL RE-LIGHTS ANYONE WHO HAD SNUFFED. Snuffing and never having
-- chosen both read as false, so they cannot be told apart — 4 members are
-- already true; the other 20 flip here. Defensible only because the signal is
-- one day old, nobody has been taught the gesture yet, and the prompt now
-- offers the way out on their next visit. Founder-approved 2026-08-13.

alter table public.profiles
  alter column presence_always_present set default true;

update public.profiles
   set presence_always_present = true
 where presence_always_present = false;

-- ASKED A FEW TIMES, THEN NEVER AGAIN. The prompt has been firing once a day
-- FOREVER, which is precisely the prompt-you-learn-to-dismiss-without-reading
-- problem its own comment warns about. A count lets it teach and then stop:
-- member_prompts is keyed (profile_id, topic) and upserted, so there was no
-- way to know how many times someone had met it.
alter table public.member_prompts
  add column if not exists times_seen integer not null default 1;

comment on column public.member_prompts.times_seen is
  'How many times this member has met this prompt. Lets a teaching prompt run for the first few visits and then fall silent, instead of asking forever.';
