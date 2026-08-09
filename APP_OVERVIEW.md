# Lichen — Application Overview

*Ground-truth snapshot for cross-surface handoffs (proposals, partner briefs).
Everything under "Live" is shipped to production at lichen.health as of
2026-08-09. Do not pitch "In progress" or "Vision" items as existing
capabilities. Maintained by Claude Code; refresh after major ships.*

## What Lichen is

A membership-based platform for holistic care and a conscious economy, run by
a nonprofit. Members join a gated community (paid or gifted membership) where
care coordination, a trust-based social web, a multi-modal marketplace, a
parallel internal currency, events, and learning resources live in one PWA
(installable web app, mobile-first).

## Live in production

### Membership & access
- **Paid membership via Stripe** — Community ($29/mo) and Concierge ($99/mo,
  adds the dedicated care layer). Self-serve checkout, upgrades, billing portal.
- **Membership gate**: the platform requires an active membership (paid or
  gifted). Admins bypass; signed-out visitors can see public content only.
- **Every new member gets 3 months of Concierge free** (a one-time growth
  gift), landing on the plan-picker only once it lapses.
- **Gift-carrying invitations**: an admin's invite can include a gifted
  membership with any duration. Gifts are claimed automatically at signup,
  show their end date, warn before expiring, and convert to paid seamlessly.
- **Invite-only signup**: new accounts need a valid invite link or must knock
  (a short "who are you, why Lichen" form that emails the founder). Existing
  members can see their own invitation ledger — who they invited, who joined.

### Care (the Concierge layer)
- **Care teams** with mutual consent (either party initiates, the other
  approves); email invitations for people not yet on Lichen that connect
  automatically at signup.
- **Care boards**: Wheel of Wellness (0–100 scores → a wellness radar chart)
  and Kindnesses of Care (scheduled, recurring), authored by patient + team.
- **On-call roster**: caregivers publish on-call windows with phone numbers;
  an Urgent tab shows who's reachable right now (call/text one tap away).
- **Financial position**: a private income-band + circumstances note a member
  can share with their active care team only — never a score, never public.
- **Caregiver dashboard** for practitioners caring for multiple people; the
  patient always controls who joins.

### Community structure
- **Spaces**: organizations, communities, groups, places — each with profiles,
  member rosters, chat rooms, content walls, and (for orgs/places) an optional
  public web page reachable at a chosen handle (`lichen.health/<handle>`).
- Groups can nest under communities/orgs **only by mutual consent**.
- **Joining is request + approval**; admins invite; members can suggest people
  to admins. Scoped admin duties (library/courses/members) let a space share
  moderation without handing over full admin rights.
- **Cohorts**: a course can spin up real, chat-and-calendar-enabled groups for
  each running of it (e.g. "Fall 2026").

### Trust web ("mycelium")
- Each member curates a **private network** (their web) and, separately,
  **private trust** (vouching) — never public, never counted, never gamified.
- **Trust is person-to-person only**; **Recommend** is the amplify signal and
  works on anything — people, organizations, places, posts.
- Everywhere on the platform, content shows whether **someone you trust**
  endorses it — a personal lens, not a global score. A marketplace "who
  you'll do business with" filter and mutual-connection lines make this the
  platform's actual answer to marketplace-safety fear (not star ratings).

### Content & marketplace
- **One unified post stream** with a social/actionable split, browsable by
  area: Marketplace, Events, Work, Courses, Library, Art, Food, Places, Travel.
  Photos, video (self-hosted adaptive streaming), audio, link previews.
- **Marketplace modes** (multi-select on one listing): gift, trade, rent,
  lend, borrow, sliding-scale, sale, plus **ISO ("in search of")** demand-side
  listings, deterministically matched against new offers.
- **"Entrusted offerings"**: a giver can hand a gift to Lichen's discretion;
  a steward routes it to the best-matched open need.
- **Collections**: private folders for saved content, publishable as curated
  playlists/anthologies, or structured into multi-lesson **courses**.
- AI helpers (opt-in per section, never ambient): auto-tagged photo style,
  suggested listing details from your own words, narrated search results,
  and a per-section "here's what's waiting" briefing.
- Save, hide, edit, delete — full member control over their feed.

### The conscious economy
- **Current-cy**: an internal, dollar-pegged ledger currency. Donations mint
  95% of their value as Current-cy granted to a member or cause (5% funds
  operations); admins can mint directly. Balances are private — no
  leaderboards, by design. No blockchain — a transparent append-only
  Postgres ledger, Stripe Connect payouts are a later phase.
- **Donations**: real Stripe checkout, tax receipts auto-emailed, a donor-only
  giving history with the year's deductible total, and a "Give" flow for
  donor-directed (non-deductible, IRS-conduit) support of a specific member.
  In-kind (non-cash) donations get a proper acknowledgment, not a valuation.

### Events & calendar
- Full calendar: timed/all-day/multi-day/recurring events, invitations,
  RSVP (going/maybe/can't), availability hours, group find-a-time,
  granular visibility rules per audience, external ICS calendar import.
- **Event pages** with about/updates/chat/RSVP; event chat rooms include the
  host and everyone going or tentative. Free/trade/paid (incl. sliding scale).
- **Bookable resources** — rooms or things (owned by a person or a space) with
  their own calendar and an approval or instant-book flow.
- Private reminders (distinct from events — never busy, can be shared with
  named recipients) fire as web push even when the app is closed.

### Chat
- Signal-grade messaging: DMs, space rooms, care-team rooms, event rooms,
  a private **support room with the Lichen help desk** for every member.
- Reactions, replies, photo/video/audio, realtime delivery, per-conversation
  unread badges, search across conversation titles *and* message history.

### Search & discovery
- **Smart search**: type a plain sentence ("massage trade within 10 miles,
  someone I trust") — a deterministic interpreter (no AI call) parses trust
  degree, price, mode, time, place, category, and person names. Full manual
  criteria panel too; near-miss results surface below exact matches.
- **Maps** (Mapbox): events, spaces, and people — with member-controlled
  location privacy (hidden / state / county / town-level / exact, per
  audience, with excludes).
- Every section carries its own scoped search and compose entry points.

### Platform
- Installable PWA with automatic update detection; realtime notifications
  with a sectioned bell; presence-aware home greeting (opt-out, with a
  standing "present" candle); transactional email (Resend); Supabase/Postgres
  with row-level security on every table; privacy-critical columns (email,
  phone, home location, presence, financial position) unreadable even to
  other members without an explicit consent path.
- A static marketing shell (separate Astro build) serves the canonical
  domain's signed-out home page and a handful of public pages; the React PWA
  handles everything past sign-in.

## In progress (do not pitch as live)
- Google Calendar OAuth connect is built and deployed but toggled off pending
  Google's app-verification review (the secret-URL ICS import works today).
- Broader RLS/privacy review of the remaining tables before public launch.
- Scheduled email reminders for expiring gifts (an in-app warning is live).

## Vision (architected, not built)
- **Entities & stewardship**: members beyond humans — a therapy horse, a
  grove, a *place* — each a first-class entity stewarded by a human, accruing
  contribution and value in its own name. The Current-cy ledger's polymorphic
  party design was built to absorb this without a schema change; the
  `profiles` table itself hasn't been generalized yet.
- **Per-entity AI Partner fabric**: today there's one Claude member account
  answering as itself; the vision is entity-scoped assistants (an org's own
  AI Partner, eventually a non-human entity's, via its steward).
- Live location sharing (opt-in "last seen near X while using Lichen") and
  proximity ("near me") feed lenses.

## Team & operations reality
- Built and operated by a non-technical founder pairing with Claude Code;
  well over 100 PRs shipped. Production deploys are continuous (Vercel).
  Single Supabase project. Stripe is live (real money, both memberships and
  donations). Email domain verified.
- Video transcoding runs on a Mac in the founder's home (`worker/`, Node +
  ffmpeg) — Lichen's first always-on server, ahead of any managed hosting.
