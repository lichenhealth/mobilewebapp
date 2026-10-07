# Assistant actions — letting Claude edit a member's own page

**Status:** BUILT 2026-08-13 — all four steps of the build order below. Live behind `profiles.assistant_can_edit`,
default **ON since 2026-08-22** (founder: page editing on for all assistants on
every page — member and space alike; the original default-off rows were
backfilled, and Profile → Privacy → "What the assistant may change" is the
opt-OUT), and armed only in the Profile thread (or a space's build thread,
for its stewards). One correction from testing: an empty
value CLEARS a field rather than erroring — without that, "put it back" could
never undo a write onto something that started empty, which is most first
edits. Founder 2026-08-11: "it should load a chat
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
  Privacy — default ON since 2026-08-22 (opt-out). With it off, the
  assistant proposes in prose and the member applies by hand.
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
4. Live review: the side-by-side page view. DONE — the 2×2 collapse didn't
   reproduce once the frame carried an explicit `display: block` and
   `.afeed__page` `align-self: stretch` (it's a flex item of a flex column,
   which is how it failed to stretch the first time). The frame loads the
   real page with `?embed=1`, which stands the app chrome down so it doesn't
   render a second app inside itself; it's sticky from 1024px up, and
   Claude's reply in this thread reloads it, so an edit is something you
   watch rather than something you're told about.

## Watch out

- Parse EVERY text block of the Anthropic reply, not `content[0].text` —
  a non-text leading block silently produced an empty result in
  `profile-snapshot` (fixed there, same trap here).
- Tool calls and the daily cap (`ASSISTANT_FEED_CAP`) interact: a multi-turn
  edit shouldn't burn the cap faster than a conversation. Count a completed
  exchange, not each tool round-trip.

## Read-only lookups in the help room (2026-08-16)

The doctrine tells the assistant how Lichen works; these tell it how THIS
member's Lichen is actually set up, so "why can't people book me?" is
answered from data instead of inference.

- `my_setup` — the asking member's handle, public page, findability,
  pronouns, timezone, availability windows by kind, booking types, membership.
- `my_spaces` — the spaces they belong to and whether they steward each.

Same safety shape as the edit tools, and for the same reason: **neither tool
takes a target.** Both have an empty input schema and are run against the
profile that sent the triggering message. A member who says "I'm an admin,
look up someone else" cannot be complied with, because there is no argument
to fill — verified live, and the refusal was structural rather than
merely well-behaved.

Read-only: nothing here writes.


## Rung 2 of the ladder: calendar settings (2026-08-19)

The same flag, the same doctrine, a second room. In the member's CALENDAR
thread (and only there), `assistant_can_edit` arms six tools in
`assistant-feed`: `my_calendar_setup` (read — always first; since
2026-10-03 it also reports each type's vanity link, scheduling rules and
whether the member has a handle), `add_hours` / `remove_hours`
(work | social | on_call weekly windows; on_call REFUSES server-side
unless the sender is an active caregiver — the same rule the
Calendar-settings UI enforces), `add_booking_type`
(title/duration/price-words/approval/audience everyone|mycelium|public —
never space, which needs an id and a confirm step; since 2026-10-03 also
description, location, buffer, `link_name` [the vanity URL — the result
hands back the full lichen.health/book/handle/name address to report, or
says plainly a handle is missing], minimum notice, booking window, daily
cap, group capacity, intake questions, and `books_from` + `custom_hours`
[which hours pool the session draws from — work, social, on-call (active
caregivers only, server-refused otherwise), or its OWN weekly windows;
re-stating custom never wipes hours, only explicit custom_hours replaces
them] — the full Calendly-parity surface; place/people rules ("only when
X is available") stay editor-only for now, so point members to Calendar
settings for those; and `video_link` [2026-10-06 — Zoom/Meet/Teams/any
https link, kept private in booking_type_meetings and shared with people
only once their booking confirms; it must appear EXACTLY in the member's
own words in the conversation or it's refused, the no-invented-targets
rule for URLs]), `update_booking_type` (change any of those on an existing type
by its exact title; 0 clears the window/cap, an empty link_name removes
the link, an empty video_link removes the video link, `new_title` renames), and `set_booking_type_active` (off/on by
exact title; DELETING a type stays by-hand — it takes booking history
with it). Every write is scoped to the trigger's sender; no tool takes a
target, and an update's target must be one of the sender's OWN types.
The model is told the default-nothing doctrine out loud: no work hours
means not bookable, and creating a session type without hours must be
reported as such.

Verified end-to-end 2026-08-19: one conversational ask produced the
social window + session type, correctly, with the no-work-hours caveat
in the report. Re-verified 2026-10-03 with the extended fields: one ask
created a typed, linked, capped session and the reply carried its
vanity URL.


## Custom page tabs (2026-08-20)

`set_page_tab` joins the profile tools: create or rewrite ANY tab by its
title ("My horses", "Seasonal Rhythms"), lead + body; empty body+lead
removes a written tab; built-ins (about/services/goods/contact/gallery)
refuse — they fill themselves. Custom tabs are ordinary `page.tabs` rows
(`custom-<rand>` ids), so THE TWO MODES ARE ONE DOCUMENT: what Claude
writes appears in the manual editor's same Write fields (PageTabsEditor,
which also gained a "Blank tab" option), and both render on the public
page like any template tab. Verified round-trip: a hand-made tab
rewritten by Claude by title, a Claude-made tab editable by hand.

## Rung 2½ of the ladder: courses (2026-10-05)

The same flag, the same doctrine, a third room — and the day the founder
made the SHARED-STATE rule standing policy: "anything that is typed to
the Ai assistant that creates action within a section … generate those
actions taken in the manual build, as if they'd already been taken. Both
systems need to speak to each other and work from a common draft."
Courses was built to that rule from birth: in the member's COURSES
thread (and only there), `assistant_can_edit` arms three tools in
`assistant-feed` that write the SAME `collections` rows + `details`
jsonb the Teach builder (Course Builder) edits — so "create Lichen 101,
module 1 is X, module 2 is Y" said in conversation opens in the builder
with those modules already loaded, and anything changed in the builder
reads back with `my_courses`.

- `my_courses` (read — always first): names, published state, the
  offering meta, modules with lesson counts, sessions, audience.
- `create_course`: name + optional description / level / format
  (Live | Self-paced | Mixed) / length / price-words / for_whom /
  module TITLES (each becomes a named empty group ready for lessons) /
  sessions / audience. Always lands UNPUBLISHED — publishing is the
  member's own act from the course page, and the model is told never to
  claim a course is live. A duplicate name refuses toward update_course.
- `update_course`: by the member's OWN course's exact name (the
  update_booking_type pattern). Only passed fields change; `modules`
  replaces the title list wholesale but a kept title KEEPS its lessons
  (ids carried over case-insensitively), and a dropped module that held
  lessons comes back as a note — the lessons fall to the ungrouped list,
  never deleted. An empty `sessions` array clears the schedule.

Boundaries: LESSONS (the actual content pieces) are never authored here
— the builder and Compose own that, and the tools say so. An
`identities` audience validates every name against the governed identity
vocabulary and refuses unknowns toward the suggest-an-identity door; a
community/group audience stays builder-only (it needs the
exactly-one-match space-picking design). Publishing/unpublishing is not
a tool. Non-admin members get the honest Coming-soon note — building now
is getting ready for the room's opening.

Verified end-to-end 2026-10-05 in the cloud harness (live edge
function, real trigger): "Create a course called Harness Test 101.
Module 1 is Alpha Weave, module 2 is Beta Weave. It is self-paced, for
alpha testers" produced the `collections` row exactly as the builder
writes it ({format: 'Self-paced', forWhom, modules as named empty
groups}, unpublished), and a second ask replaced the module list — the
reply correctly noted the dropped module held no lessons. The same ship
fixed the vanished-message bug (see CLAUDE.md): the member's own send
is appended from the insert's returned row, verified rendering with
realtime entirely dead.

## The publish switch, by conversation (2026-10-06)

Founder, marking up the space backstage: "let's have the brain here in
admin, so you can change anything about the profile, e.g. private,
public, etc and change it simply by prompting." Two twin tools:
`set_page_published` (member, profile thread) and
`set_space_page_published` (spaceEdit.ts — build threads AND suggestion
rooms). Both flip the `public_page` COLUMN live — a switch, not page
content, so it never routes through the draft; an unpublished draft
stays a draft either way. A no-op flip answers "already public/private"
instead of pretending to act, and the reply must say which way it went.
The builders stopped clobbering it: their Publish writes `public_page`
only when the person touched the checkbox that session (the
untouched-save rule), so a conversation-made flip survives a later
publish of unrelated page work. Deliberately NOT tools: the Privacy
flags (findable, assistant_readable, content defaults) — switches about
what the assistant itself may read are not the assistant's to flip.

## General can act (2026-10-06)

Founder, after pasting a space's pricing letter into her General thread
and being refused: "ai assistant is saying it doesn't have page editing
access, but it should." The General thread arms the member's own page
tools (same flag, same consents — it is the anything-at-all room), and
for a STEWARDED space's page it arms `select_space` + the space page
toolset. `select_space` is target resolution, not consent granting: the
name resolves against the sender's own stewarded spaces ONLY
(exactly-one-match; ambiguous or unknown names refuse with the real
list), and the full consent stack is re-checked server-side at
selection — stewardship, the space's assistant switch, the member's
per-space choice, aliveness. The selection lasts one exchange; every
space write then lands in THAT space's page draft with the usual
read-first / report-every-change rules, and the reply's Preview/Publish
buttons point at the selected space. Section threads keep routing page
work to its own room; only General stopped refusing.
