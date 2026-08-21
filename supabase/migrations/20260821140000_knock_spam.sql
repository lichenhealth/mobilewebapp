-- SPAM IS A CATEGORY, NOT JUST A DISMISSAL (founder 2026-08-21: "add 'spam'
-- as an option, versus just 'not now', so you can learn how to identify
-- spam"). A knock marked spam: steps out of every queue and count like a
-- declined one; quietly bars that address from ever re-entering the queue
-- (the join-request edge fn checks before inserting — the sender learns
-- nothing); and stays in join_requests as LABELED DATA — the training set
-- any future spam heuristic or model learns from. Never delete spam rows.
alter table public.join_requests drop constraint join_requests_status_check;
alter table public.join_requests add constraint join_requests_status_check
  check (status = any (array['new'::text, 'invited'::text, 'declined'::text, 'spam'::text]));
