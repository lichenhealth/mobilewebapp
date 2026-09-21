-- Invite by phone (founder 2026-09-21: "invite people via email and phone,
-- with a comma"). A texted invitation's token records WHO it was for the
-- same way an emailed one does — the /invite ledger names the number
-- instead of "a shared link". No SMS provider exists (deliberate — see
-- CLAUDE.md open threads), so the inviter sends the text themselves; this
-- column is the record, not a delivery channel.
alter table public.invite_tokens add column if not exists invitee_phone text;
