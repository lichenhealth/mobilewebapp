# Assistant actions — letting Claude edit a member's own page

**Status:** specified, not built. Founder 2026-08-11: "it should load a chat
with Claude that shows the user the context Claude already has on the
subject, with the opportunity to add more before pressing send… then Claude
lets you know when they're done so you can review it live and continue to
make dialogue-based edits."

This is the Claude Code loop, on-platform, scoped to a member's own
subsection. Today the assistant can only *talk*: Snapshot hands over a
proposal to confirm, the Home summary button writes into a text box. Nothing
lets Claude say "done — I rewrote your tagline," because it has no way to
write. This closes that.

## The loop

1. **Context card** — opening the Profile management thread, Claude leads
   with a receipt of what it's working from: current tagline, story length,
   categories picked, which contact fields are filled and which are empty.
   Not a description of the member — a statement of its own inputs, so
   there's no mystery about what it knows.
2. **Editable ask** — the door's intent lands in the composer (the existing
   `?ask=` prefill), unsent, so "write my home summary" can become "…and keep
   it under 100 words, mention the pasture" before it goes.
3. **Action** — Claude calls one of the allowed operations below.
4. **Report** — it says plainly what changed and what it left alone.
5. **Review and iterate** — the member looks at the page and says "warmer",
   "too long", and it goes again.

## The allowed operations (the whole list)

Anthropic tool-use in `assistant-feed`. The assistant may call ONLY these,
and only against the caller's own profile (`profile_id` from the trigger —
never an id the model supplies):

| tool | writes | notes |
| --- | --- | --- |
| `set_tagline` | `profiles.page.tagline` | ≤ 90 chars |
| `set_home_summary` | `profiles.page.homeSummary` | the Home welcome |
| `set_story` | `profiles.page.story` | full replace; keep the old value in the report so it can be undone by asking |
| `set_contact_field` | `profiles.contact.<field>` | field must be one of ContactFields' keys |
| `add_categories` / `remove_categories` | `profile_categories` | ids must exist in `categories`; capabilities follow, as `applySnapshot` already does |

Deliberately NOT in v1: publishing the page, posting to the feed, anything
touching other members, anything in `space_*`. Those are consequential in a
way that wants a confirm step, not a chat message.

## Boundary rules

- **Own profile only.** The service-role client already knows who triggered
  the row; the model never supplies a target.
- **A member switch.** "Let Claude edit my page directly" in Profile →
  Privacy, default OFF for now. With it off, the assistant proposes in prose
  and the member applies by hand — exactly today's behavior.
- **Every write is announced.** No silent edits: the reply must name what
  changed. A write with no report is a bug.
- **Reversible by conversation.** The report carries the previous value so
  "put it back" works without an undo stack.
- **Public-page fields only.** Nothing here can reach `financial_positions`,
  location, care, or anything else private — those aren't in the table above
  and must not be added without their own consent conversation.

## Build order

1. Tool definitions + the allowed-ops executor in `assistant-feed`, behind
   the (default-off) member switch.
2. The context card at the top of the Profile management thread.
3. Point "Fill out with Claude" / "Have Claude write this from the full
   story" at the thread with an editable prefill instead of acting directly.
4. Live review: the side-by-side page view (see the open thread in
   CLAUDE.md — the embed collapsed to 2×2 and needs a devtools pass).

## Watch out

- Parse EVERY text block of the Anthropic reply, not `content[0].text` —
  a non-text leading block silently produced an empty result in
  `profile-snapshot` (fixed there, same trap here).
- Tool calls and the daily cap (`ASSISTANT_FEED_CAP`) interact: a multi-turn
  edit shouldn't burn the cap faster than a conversation. Count a completed
  exchange, not each tool round-trip.
