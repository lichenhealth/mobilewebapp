-- EDIT WITH AI HANDS OFF AS CLAUDE (founder 2026-11-02: "the briefing of
-- whats been done manually should be a sent message to claude, not a
-- composed one. just have the summary itself be clearly a hand off text -
-- maybe have it look a little different visually - how about its from
-- claude to claude?"): the manual-mode summary lands in the thread as a
-- DELIVERED Claude note — the _currentcy_claude_note templated shape, but
-- owner-invoked from the client. The client's own INSERT policy stays
-- author='member' (nobody free-writes Claude's voice); this RPC is the ONE
-- door to a client-triggered claude-authored row: own thread only,
-- handoff-marked, body capped. It deliberately does NOT fire the reply
-- trigger (that fires on author='member') — the note just stands, and the
-- member's next message carries it as conversation context.

create or replace function public.post_assistant_handoff(p_thread text, p_body text)
returns table(id uuid, convo_id uuid)
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_profile uuid := auth.uid();
  v_convo uuid := gen_random_uuid();
  v_body text := trim(coalesce(p_body, ''));
  v_id uuid;
begin
  if v_profile is null then
    raise exception 'Sign in first.';
  end if;
  -- Personal threads only — a plain word, never a space:<uuid> stream.
  if p_thread is null or p_thread !~ '^[a-z][a-z-]{0,39}$' then
    raise exception 'Hand-offs land in a personal thread.';
  end if;
  if v_body = '' then
    raise exception 'Nothing to hand off.';
  end if;

  insert into assistant_feed_posts (profile_id, author, body, thread, convo_id, attachments)
  values (v_profile, 'claude', left(v_body, 2000), p_thread, v_convo,
          '[{"type":"handoff"}]'::jsonb)
  returning assistant_feed_posts.id into v_id;

  return query select v_id, v_convo;
end;
$func$;

revoke all on function public.post_assistant_handoff(text, text) from public, anon;
grant execute on function public.post_assistant_handoff(text, text) to authenticated;
