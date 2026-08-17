-- PER-IDENTITY AI CONSENT — the table and the resolver (founder 2026-08-17).
--
-- "One group may want to be in the Ai fabric of lichen while another doesn't...
-- Or I may want Ai to be involved for me in community, but not concierge... So
-- it has to be per room, member type, etc. As well as at the member level. You
-- can say 'all on' or you can de-select certain aspects of your identity."
--
-- THE DEFAULT IS ON. This is the one place Lichen's "unknown is never yes" rule
-- deliberately does NOT apply: collaboration between carbon and silicon is the
-- premise of the platform, not a permission granted to it. So "all on" is the
-- absence of rows, and every de-selection is exactly one row. A member who has
-- never thought about this has no rows and full participation, which is what
-- they came for.
--
-- Why a table at all, when there are already switches: the switches that exist
-- are in the WRONG LAYER. `spaces.assistant_enabled` hides a brain icon in the
-- browser; the `ai-door-<section>` keys live in localStorage, so a new phone
-- silently resets every choice a member made — the exact mistake member_prompts
-- was created to avoid. Consent has to be a fact in the database that the edge
-- functions themselves check, or any new surface that forgets the check leaks
-- silently.
--
-- This migration is step 1 and 2 of the build brief in CLAUDE.md: the table and
-- the resolvers. The localStorage migration, the server-side enforcement in the
-- four assistant functions, and the UI all come after — deliberately in that
-- order, so nothing can depend on a check that doesn't exist yet.

create table if not exists public.assistant_consent (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- 'section' = a room of the platform ('concierge', 'marketplace', 'chat'…).
  -- 'space'   = one organization/community/group/place, by uuid.
  -- 'aspect'  = an aspect of who you are that isn't a room or a space (a being
  --             you steward, a role you wear) — reserved, nothing writes it yet.
  scope_type text not null check (scope_type in ('section', 'space', 'aspect')),
  -- Text so a section name and a space uuid can share one column.
  scope_id text not null,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (profile_id, scope_type, scope_id)
);
alter table public.assistant_consent enable row level security;

-- Yours alone to read and write. Where another party legitimately needs to know
-- your answer — a caregiver being told their client works without an assistant —
-- it arrives through the SECURITY DEFINER resolver below, which returns the
-- decision and never the rest of your rows.
create policy "assistant_consent: own read" on public.assistant_consent
  for select to authenticated using (profile_id = auth.uid());
create policy "assistant_consent: own write" on public.assistant_consent
  for insert to authenticated with check (profile_id = auth.uid());
create policy "assistant_consent: own update" on public.assistant_consent
  for update to authenticated using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
create policy "assistant_consent: own delete" on public.assistant_consent
  for delete to authenticated using (profile_id = auth.uid());

grant select, insert, update, delete on public.assistant_consent to authenticated;

-- ── The resolver ────────────────────────────────────────────────────────────
-- One row is the whole answer: there is no inheritance to compute, because a
-- section and a space are different questions, not a hierarchy. A caller that
-- wants "the marketplace, inside this barn" asks BOTH and takes the stricter
-- one — which is what assistant_consent_all() below does for them.
create or replace function public.assistant_consent_for(
  p_profile uuid, p_scope_type text, p_scope_id text)
returns boolean language sql stable security definer set search_path to 'public' as $func$
  select coalesce(
    (select c.enabled from public.assistant_consent c
      where c.profile_id = p_profile
        and c.scope_type = p_scope_type
        and c.scope_id = p_scope_id),
    true);
$func$;

-- The stricter of several scopes at once — "the assistant may act here" is only
-- true when every scope in play says yes. Pass the section and, where there is
-- one, the space it's being read inside.
create or replace function public.assistant_consent_all(
  p_profile uuid, p_section text, p_space uuid default null)
returns boolean language sql stable security definer set search_path to 'public' as $func$
  select public.assistant_consent_for(p_profile, 'section', coalesce(p_section, 'general'))
     and (p_space is null
          or public.assistant_consent_for(p_profile, 'space', p_space::text));
$func$;

-- ── Care: consent is mutual, and mutually VISIBLE (founder 2026-08-17) ───────
-- "If a client has AI disabled at the Concierge level... it is worth notifying
-- the care team member that their client has Ai disabled at the Concierge
-- level" — and the reverse, "the client will be informed of that, too".
--
-- So this returns three things, not one: the effective answer (the more
-- restrictive of the two), plus WHICH side said what, because silence in either
-- direction is the failure mode. A caregiver assuming their assistant sees a
-- chart it can't, or a client assuming an assistant is helping when the
-- caregiver works without one, are the same bug wearing different faces.
--
-- Gated to the two parties themselves: nobody else learns either answer.
create or replace function public.assistant_consent_care(
  p_patient uuid, p_caregiver uuid)
returns table (effective boolean, patient_enabled boolean, caregiver_enabled boolean)
language plpgsql stable security definer set search_path to 'public' as $func$
declare v_p boolean; v_c boolean;
begin
  if auth.uid() is null
     or auth.uid() not in (p_patient, p_caregiver)
     or not (p_patient = p_caregiver
             or public.is_on_care_team(p_patient, p_caregiver)) then
    raise exception 'not a party to this care relationship';
  end if;

  v_p := public.assistant_consent_for(p_patient, 'section', 'concierge');
  v_c := public.assistant_consent_for(p_caregiver, 'section', 'concierge');
  return query select (v_p and v_c), v_p, v_c;
end;
$func$;

revoke all on function public.assistant_consent_for(uuid, text, text) from public;
revoke all on function public.assistant_consent_all(uuid, text, uuid) from public;
revoke all on function public.assistant_consent_care(uuid, uuid) from public;
grant execute on function public.assistant_consent_for(uuid, text, text) to authenticated;
grant execute on function public.assistant_consent_all(uuid, text, uuid) to authenticated;
grant execute on function public.assistant_consent_care(uuid, uuid) to authenticated;
