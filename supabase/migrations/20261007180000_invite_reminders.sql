-- INVITE REMINDERS (founder 2026-10-07: "send reminder for invited people
-- who haven't joined and have their invites buried in their email or
-- texts"). The ledger anticipated this: a DECLINED address must never get
-- a reminder (the 2026-08-17 decline rule — send-invite's remind branch
-- checks declined_at), and reminders re-send the SAME token rather than
-- minting a second invitation (a token claims once; two rows would read
-- as two invites on the ledger).
--
-- reminded_at / remind_count are stamped by the send-invite edge function
-- (service role) AFTER Resend accepts the send — a stamp always means a
-- reminder actually went out, the send-invite un-mint rule's sibling.

alter table public.invite_tokens
  add column if not exists reminded_at timestamptz,
  add column if not exists remind_count integer not null default 0;
