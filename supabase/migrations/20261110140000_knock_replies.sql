-- Each knock is a THREAD (founder 2026-11-10: "I would like to have each knock
-- be a thread and expandable"). Every reply a steward sends through
-- knock-reply is kept here — join_requests.last_reply only ever held one.
-- Read by whoever may read the knock (the subquery rides join_requests' own
-- RLS: admins + that space's stewards); written only by the edge fn
-- (service role) after Resend accepts — a row always means a send.
create table if not exists public.knock_replies (
  id uuid primary key default gen_random_uuid(),
  knock_id uuid not null references public.join_requests(id) on delete cascade,
  body text not null check (length(body) between 1 and 4000),
  sent_by uuid references public.profiles(id) on delete set null,
  sent_at timestamptz not null default now()
);
create index if not exists knock_replies_knock_idx on public.knock_replies(knock_id, sent_at);
alter table public.knock_replies enable row level security;

drop policy if exists "knock replies: readers of the knock" on public.knock_replies;
create policy "knock replies: readers of the knock" on public.knock_replies
  for select to authenticated
  using (exists (select 1 from public.join_requests j where j.id = knock_id));

revoke insert, update, delete on public.knock_replies from anon, authenticated;
grant select on public.knock_replies to authenticated;

-- Carry any reply already stamped on a knock into its thread.
insert into public.knock_replies (knock_id, body, sent_by, sent_at)
select j.id, j.last_reply, j.replied_by, j.replied_at
from public.join_requests j
where j.last_reply is not null and j.replied_at is not null
  and not exists (select 1 from public.knock_replies r where r.knock_id = j.id);
