# Lichen — PWA project guide

Lichen is a holistic-healing nonprofit + conscious-economy platform. This repo
(`lichenhealth/mobilewebapp`, package `lichen-pwa`) is the member-facing PWA.
The founder is non-technical; explain reasoning briefly and prefer small,
reviewable changes. Keep Plan Mode on for anything touching the database or auth.

## Stack & deploy
- React 18 + Vite + TypeScript. Build: `tsc -b && vite build` (it type-checks — always run before considering a change done).
- No package-lock; Vercel runs `npm install`. Vercel auto-deploys `main` on push.
- Backend: Supabase (project `mjqnaevertyzgjlpwynr`). Anon key is hardcoded in `src/lib/supabase.ts` (public by design; RLS protects data).
- DB schema is version-controlled in `supabase/migrations/00000000000000_init.sql` — a `pg_dump --schema-only --schema=public` baseline of the live DB (captured 2026-06-29) plus a manually-appended `auth.users` signup trigger. It's a record/backup, not auto-applied. The live schema is still edited in the Supabase dashboard, so this file can drift — refresh it after DB changes. Tooling: Supabase CLI is linked (`supabase/config.toml`); `pg_dump` lives at `/opt/homebrew/opt/libpq/bin/pg_dump` (no Docker). `supabase db dump`/`db pull` need Docker, which isn't installed — use the direct `pg_dump` against the session pooler instead.
- Marketing site is a separate repo (`lichenhealth/lichen-health`, Astro) — not this one.
- Run `tsc -b` and `vite build` locally before committing; fix all type errors (the project builds clean today).

## Conventions
- Design tokens live in `src/styles/tokens.css` (peach accent `--peach`, bone canvas, Archivo body, display serif). Reuse token vars; match existing BEM-ish class names (`.onb__`, `.prof__`, `.cat__`, `.adminc__`, `.conv-row`, `.thread__`).
- Logo: `src/components/LichenMark.tsx`. Icons: `src/components/Icon.tsx` (`<Icon name=... size=... />`).
- Avoid the word "spaces" in member-facing UI — say organizations / communities / groups / places.
- Supabase embeds: when a table has >1 FK to another, disambiguate with the explicit hint, e.g. `profiles!subscriptions_profile_id_fkey(full_name)`.
- New enum values can't be USED in the same migration that adds them — add in a separate step that's committed first.
- Only 3 columns use real Postgres enums (`account_capability`, `space_kind`, `space_member_role`). The other "enum-like" fields below (care `status`, subscription `tier`/`source`, category `domain`, suggestion `status`) are actually `text` columns with CHECK constraints — to add a value, change the CHECK, not an enum type.

## Data model (all RLS-enabled)
- `profiles` (id→auth.users; full_name, headline, bio, email, onboarded, is_admin). Trigger creates a profile on signup.
- `profile_capabilities` (service_provider / goods_provider).
- `categories` (63 seeded; text slug id, domain good|service, name, sort) + `profile_categories`. Member-suggested categories via `category_suggestions` + admin approval RPCs `approve_category_suggestion` / `reject_category_suggestion`.
- `spaces` (kind enum: organization|community|group|place; created_by) + `space_members` (role enum: super_admin|admin|member). Creator becomes super_admin via trigger `handle_new_space`. One super_admin per space.
- `chats` (one per space — all kinds — and one per care team) + `chat_members` (synced to space_members via trigger) + `chat_messages` (realtime enabled). RLS uses `is_chat_member()` helper to avoid recursion.
- `care_team_members` (patient_id, caregiver_id, status pending|active, initiated_by). Either party initiates; the OTHER approves. Activation trigger creates/join the care-team chat.
- `care_invitations` (invite non-members by email; `claim_care_invitations()` RPC converts them to pending care links on signup).
- `subscriptions` (tier community|concierge, source gift|stripe). Admin RPCs `gift_subscription` / `revoke_subscription`. Stripe columns exist but Stripe is NOT wired yet.

## Admin
- `profiles.is_admin = true` gates the admin screens (Review categories `/admin/categories`, Gift access `/admin/supporters`). Admin links live in `SideMenu` in `.side-menu__admin` so they show on mobile too (the primary block is hidden on mobile).

## Key screens
- `Onboarding.tsx` — four space-kind sections + provider category pickers (`CategoryPicker.tsx`, searchable, fuzzy-match suggest-new flow).
- `Profile.tsx` — about, capabilities + category editing, per-kind space sections, care-team management (invite/approve/remove, non-member email invites), tier badge.
- `Chat.tsx` / `ChatThread.tsx` — real Supabase chats + messages + realtime (`src/lib/chatApi.ts`). No reactions/replies (no schema for them yet).
- `Concierge.tsx` — STILL mock data (`src/data/concierge.ts`): WOW / KOC / Chat / Urgent tabs. Not yet wired to real data.
- Edge function `supabase/functions/send-care-invite` (Resend) — sends care invites; reads `RESEND_API_KEY` secret.

## Secrets — never hardcode
RESEND_API_KEY, any Stripe keys, Supabase service-role key live in Supabase secrets / env, never in the repo.

## Open threads / next up
1. Stripe: monthly, invite-only supporter tier. Need checkout function + webhook (sets `source='stripe'`) + gift→paid conversion. Schema is ready in `subscriptions`.
2. Resend email: verify `lichen.health` domain, set `RESEND_API_KEY`, deploy the edge function.
3. Concierge: wire the roster ("people whose care team you're on") + WOW/KOC to real data (currently mock).
4. Advanced search panel (Figma mockup exists).
5. ~~Privacy hardening: tighten `profiles` email visibility~~ — DONE (2026-06-29). `profiles` SELECT for `authenticated` is now column-scoped to every column EXCEPT `email`. Own email comes from the auth session; care-invite lookup uses `find_member_by_email()` and the admin supporter list uses `admin_list_supporters()` (both SECURITY DEFINER). Migrations `20260629120000_add_member_email_rpcs.sql` + `20260629120100_restrict_profile_email.sql`. Still open: broader privacy review of other tables before public launch.

## Housekeeping
- Downloads folder has accumulated many `lichen-*` zip duplicates from the old manual deploy flow — irrelevant to the repo, but the source-of-truth is always `main` on GitHub.
- There may be stray leftover files under `src/data/` (old zips, nested dirs) from earlier bad copies — safe to clean up if found.
