-- TRUST AN ORG (founder 2026-10-26: "Yes, I like the ability to trust an org.
-- You can take that trust away, too. I think building orgs that people trust
-- is important and you can always take it away") — superseding the 2026-08-07
-- "trust is person-to-person only" doctrine on the TARGET side: a PERSON may
-- now vouch (trust) a space — organization, community, group or place — and
-- withdraw it, exactly like trusting a member.
--
-- What does NOT change:
--   * mycelium_space_cannot_vouch stays — a space still HOLDS no trust
--     (truster side): its web is membership only, by the 2026-08-13 call.
--   * trust_edges_for_targets() already matches on (type, id) generically,
--     so space-target edges surface through the same RPC with no change.
--   * Trust stays private — no counts, surfaced only through people in the
--     viewer's own web.

alter table public.mycelium
  drop constraint if exists mycelium_no_space_trust;
