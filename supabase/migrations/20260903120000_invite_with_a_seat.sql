-- Invite-with-a-seat (founder 2026-09-03): joining Lichen and joining a
-- space often go together — a business owner invited to steward the page
-- built for them. A platform invite may now carry a space and a role; the
-- seat is granted by a TRIGGER on the claim itself, so BOTH claim paths
-- (handle_new_user's email match and claim_invite's token path) are covered
-- by code neither has to remember — the rule this codebase keeps relearning.

alter table public.invite_tokens
  add column if not exists space_id uuid references public.spaces(id) on delete set null,
  add column if not exists space_role text check (space_role in ('member','admin'));

create or replace function public.seat_from_invite() returns trigger
language plpgsql security definer set search_path to 'public'
as $func$
declare
  v_role public.space_member_role;
begin
  -- Only a live space seats anyone.
  if new.space_id is null or not public.space_alive(new.space_id) then return new; end if;

  -- Authority is re-checked at CLAIM time, mirroring set_member_role's
  -- rules: an admin-carrying invite needs its minter to still be the space's
  -- super admin; a member invite needs them to still be an admin. A stale
  -- token can never seat someone in a space whose stewardship has changed.
  if coalesce(new.space_role, 'member') = 'admin' then
    if not exists (select 1 from public.space_members m
                   where m.space_id = new.space_id
                     and m.profile_id = new.created_by
                     and m.role = 'super_admin') then
      return new;
    end if;
    v_role := 'admin';
  else
    if not public.is_space_admin(new.space_id, new.created_by) then
      return new;
    end if;
    v_role := 'member';
  end if;

  -- Seat them (the chat-sync trigger follows the insert). An existing plain
  -- member is raised by an admin-carrying invite; an existing admin or the
  -- super admin is never touched, and nothing ever downgrades.
  insert into public.space_members (space_id, profile_id, role)
  values (new.space_id, new.claimed_by, v_role)
  on conflict (space_id, profile_id) do update
    set role = 'admin'::public.space_member_role
    where space_members.role = 'member'::public.space_member_role
      and excluded.role = 'admin'::public.space_member_role;

  return new;
end;
$func$;

drop trigger if exists on_invite_claimed_seat on public.invite_tokens;
create trigger on_invite_claimed_seat
  after update on public.invite_tokens
  for each row
  when (old.claimed_by is null and new.claimed_by is not null and new.space_id is not null)
  execute function public.seat_from_invite();
