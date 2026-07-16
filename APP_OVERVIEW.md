# Lichen — Application Overview

*Ground-truth snapshot for cross-surface handoffs (proposals, partner briefs).
Everything under "Live" is shipped to production at lichen.healthcare as of
2026-07-16. Do not pitch "In progress" or "Vision" items as existing
capabilities. Maintained by Claude Code; refresh after major ships.*

## What Lichen is

A membership-based platform for holistic care and a conscious economy, run by
a nonprofit. Members join a gated community (paid or gifted membership) where
care coordination, a trust-based social web, a multi-modal marketplace, events,
and learning resources live in one PWA (installable web app, mobile-first).

## Live in production

### Membership & access
- **Paid membership via Stripe** — Community ($29/mo) and Concierge ($99/mo,
  adds the dedicated care layer). Self-serve checkout, upgrades, billing portal.
- **Membership gate**: the platform requires an active membership (paid or
  gifted). Admins bypass; signed-out visitors can see public content only.
- **Gift-carrying invitations**: an admin's invite can include a gifted
  membership with any duration (1 month–2 years, or open-ended). The gift is
  claimed automatically at signup — invitees never see a paywall. Gifts
  announce themselves (in-app + email), show their end date, warn before
  expiring, and convert to paid seamlessly. Admins can edit or revoke any gift.

### Care (the Concierge layer)
- **Care teams** with mutual consent (either party initiates, the other
  approves); email invitations for people not yet on Lichen that connect
  automatically at signup.
- **Care boards**: Wheel of Wellness (0–100 scores → a wellness radar chart)
  and Kindnesses of Care (scheduled, recurring), authored by patient + team.
- **On-call roster**: caregivers publish on-call windows with phone numbers;
  an Urgent tab shows who's reachable right now (call/text one tap away).
- **Caregiver dashboard** for practitioners caring for multiple people; the
  patient always controls who joins.

### Community structure
- **Spaces**: organizations, communities, groups, places — each with profiles,
  member rosters, chat rooms, and content walls. Groups can nest under
  communities/orgs **only by mutual consent** (proposal + approval both ways).
- **Joining is request + approval**; admins invite; members can suggest people
  to admins. Every space membership is deliberate.

### Trust web ("mycelium")
- Each member curates a **private network** (their web) and, separately,
  **private trust** (vouching) — never public, never counted, never gamified.
- Trust attaches to *relationships* (people, organizations); recommendations
  attach to *things* (posts, events, offerings, places).
- Everywhere on the platform, content shows whether **someone you trust**
  endorses it — a personal lens, not a global score.

### Content & marketplace
- **One unified post stream** filtered by type (social/creative/educational/
  actionable/Q&A) and area: Marketplace, Events, Work, Courses, Library, Art,
  Food, Places. Photos, video, audio, link previews.
- **Marketplace modes**: gift, trade, rent, lend, borrow, sliding-scale, sale —
  plus **ISO ("in search of")** demand-side listings.
- **Collections**: private folders for saved content, publishable as curated
  playlists/anthologies in the community Library.
- Save, hide, edit, delete — full member control over their feed.

### Events & calendar
- Full calendar: timed/all-day/multi-day/recurring events, invitations,
  RSVP (going/maybe/can't), availability hours, group find-a-time,
  granular visibility rules per audience.
- **Event pages** with about/updates/chat/RSVP; event chat rooms include the
  host and everyone going or tentative. Free/trade/paid (incl. sliding scale).

### Chat
- Signal-grade messaging: DMs, space rooms, care-team rooms, event rooms,
  a private **support room with the Lichen help desk** for every member.
- Reactions, replies, photo/video/audio, realtime delivery, per-conversation
  unread badges, read-state that clears notifications automatically.

### Search & discovery
- **Smart search**: type a plain sentence ("massage trade within 10 miles,
  someone I trust") — a deterministic interpreter (no AI call) parses trust
  degree, price, mode, time, place, category. Full manual criteria panel too.
- **Maps** (Mapbox): events, spaces, and people — with member-controlled
  location privacy (hidden / town-level / exact, per audience, with excludes).
- Every section carries its own scoped search and compose entry points.

### Platform
- Installable PWA; realtime notifications with a sectioned bell; presence-aware
  home greeting; transactional email (Resend); Supabase/Postgres with
  row-level security on every table; privacy-critical columns (email, phone,
  home location, presence) unreadable even to other members.

## In progress (do not pitch as live)
- Alpha member invitations (mechanics live; cohort not yet invited).
- **Deterministic ISO matcher**: new listings auto-checked against open
  "in search of" posts, notifying both sides on a match. Next build.
- Email reminders for expiring gifts (in-app warnings are live).

## Vision (architected, not built)
- **Entities & stewardship**: members beyond humans — a therapy horse, a
  grove, a *place* — each a first-class entity stewarded by a human, accruing
  contribution and value in its own name. (The data model was designed for
  this from day one; profiles generalize into entities.)
- **Value ledger**: the conscious-economy accounting layer across all entity
  kinds.
- **Per-member AI assistant**: staged — deterministic matching first, then
  AI-narrated search results, then a full assistant with memory and agency.
- Second domain consolidation (lichen.health marketing ↔ lichen.healthcare app).

## Team & operations reality
- Built and operated by a non-technical founder pairing with Claude Code;
  ~70 PRs shipped. Production deploys are continuous (Vercel). Single
  Supabase project. Stripe is live (real money). Email domain verified.
