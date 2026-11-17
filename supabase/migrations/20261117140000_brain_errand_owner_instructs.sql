-- THE OWNER CAN TALK TO THEIR BRAIN IN THE CHAT (founder 2026-11-17: she
-- wrote "Please have Gabe's Ai assistant add the cal for him" in her chat
-- with Gabe, and nothing happened — writing by hand had silently closed the
-- errand). A message from the owner that is ADDRESSED to the Brain (brain /
-- assistant / AI / Claude) keeps the errand alive (reopening one closed in
-- the last 7 days) and hands the message to the Brain as an instruction.
-- Any other message from the owner still means "I've got it" and closes it.
create or replace function public.brain_errand_owner_spoke()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_secret text; v_errand uuid;
begin
  if new.via_brain then return new; end if;
  if new.body ~* '\m(brain|assistant|ai|claude)\M' then
    select id into v_errand from public.brain_errands
     where chat_id = new.chat_id and owner_id = new.sender_id
       and (status in ('open','flagged') or (status = 'closed' and updated_at > now() - interval '7 days'))
       and expires_at > now() - interval '7 days'
     order by created_at desc limit 1;
    if v_errand is not null then
      update public.brain_errands
         set status = 'open', updated_at = now(),
             expires_at = greatest(expires_at, now() + interval '7 days'),
             last_note = 'You asked your Brain to help'
       where id = v_errand;
      begin
        select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_hook_secret';
        perform net.http_post(
          url := 'https://mjqnaevertyzgjlpwynr.supabase.co/functions/v1/brain-errand',
          headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', coalesce(v_secret,'')),
          body := jsonb_build_object('mode','reply','errand_id', v_errand, 'message_id', new.id)
        );
      exception when others then null;
      end;
      return new;
    end if;
  end if;
  update public.brain_errands set status = 'closed', updated_at = now(), last_note = 'You stepped in'
   where chat_id = new.chat_id and owner_id = new.sender_id and status in ('open','flagged');
  return new;
end $fn$;
