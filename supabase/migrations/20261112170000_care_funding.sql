-- HOW EACH PART OF A CARE PLAN IS PAID (founder 2026-11-12).
-- EITHER SIDE MAY SUBMIT, THE OTHER CONFIRMS (founder, same day: "either the
-- person can pay the delta over their coverage… or, if they can't, the
-- practitioner can submit the subsidy request to the well"). The client
-- answers for their own money; the provider whose work it is (the entry's
-- author) may submit for them — and whoever didn't submit confirms or
-- questions it, the anti-gaming check from both sides. Lichen never learns
-- HOW something is covered — only that it is, and for how much.
-- ⚠ A provider who bills Medi-Cal/insurance THROUGH LICHEN'S EIN submitting
-- "covered elsewhere" moves protected health information onto the platform
-- (attorney question, BUSINESS.md); and topping up a Medi-Cal-COVERED
-- service is likely prohibited outright. The client-declared door stays the
-- clean one for covered programs.
--   pay_covered_cents  paid some other way (insurance, Medi-Cal, a contract)
--   pay_subsidy_cents  what the client asks the subsidy fund for
--   pay_self_cents     what the client pays themselves
-- A part present with no amount = "this part, amount unknown" (0 is stored).
-- Split example: $80 covered elsewhere + $40 subsidy needed.
-- The provider whose work it is (the entry's author, when that isn't the
-- client) is asked to CONFIRM or QUESTION a subsidy ask — the anti-gaming
-- check. A question carries no reason field on purpose (no payer detail
-- ever crosses onto the platform); it bells the coordinators to talk it
-- through. Changing a confirmed ask resets the review.

alter table public.care_posts
  add column if not exists pay_parts text[],
  add column if not exists pay_covered_cents integer,
  add column if not exists pay_subsidy_cents integer,
  add column if not exists pay_self_cents integer,
  add column if not exists pay_provider_id uuid references public.profiles(id) on delete set null,
  add column if not exists subsidy_review text,
  add column if not exists subsidy_reviewed_at timestamptz,
  add column if not exists pay_set_at timestamptz,
  add column if not exists pay_set_by uuid references public.profiles(id) on delete set null;

alter table public.care_posts drop constraint if exists care_posts_pay_parts_check;
alter table public.care_posts add constraint care_posts_pay_parts_check check (
  pay_parts is null or (pay_parts <@ array['covered','subsidy','self']::text[] and cardinality(pay_parts) between 1 and 3)
);
alter table public.care_posts drop constraint if exists care_posts_pay_amounts_check;
alter table public.care_posts add constraint care_posts_pay_amounts_check check (
  coalesce(pay_covered_cents, 0) between 0 and 10000000
  and coalesce(pay_subsidy_cents, 0) between 0 and 10000000
  and coalesce(pay_self_cents, 0) between 0 and 10000000
);
alter table public.care_posts drop constraint if exists care_posts_subsidy_review_check;
alter table public.care_posts add constraint care_posts_subsidy_review_check check (
  subsidy_review is null or subsidy_review in ('pending','confirmed','questioned')
);

-- Only the two doors below may touch these columns (a plain UPDATE by a
-- caregiver editing their own entry must never be able to change the
-- client's money answer, nor the client their provider's review).
create or replace function public.care_posts_guard_pay()
returns trigger language plpgsql as $func$
begin
  if coalesce(current_setting('lichen.care_pay', true), '') = 'on' then
    return new;
  end if;
  if (new.pay_parts, new.pay_covered_cents, new.pay_subsidy_cents, new.pay_self_cents,
      new.pay_provider_id, new.subsidy_review, new.subsidy_reviewed_at, new.pay_set_at, new.pay_set_by)
     is distinct from
     (old.pay_parts, old.pay_covered_cents, old.pay_subsidy_cents, old.pay_self_cents,
      old.pay_provider_id, old.subsidy_review, old.subsidy_reviewed_at, old.pay_set_at, old.pay_set_by) then
    raise exception 'How a care-plan entry is paid is set only through its own controls (the client, or the provider whose work it is).';
  end if;
  return new;
end;
$func$;
drop trigger if exists care_posts_guard_pay on public.care_posts;
create trigger care_posts_guard_pay before update on public.care_posts
  for each row execute function public.care_posts_guard_pay();

create or replace function public._set_care_funding(
  p_actor uuid, p_post uuid, p_parts text[],
  p_covered integer, p_subsidy integer, p_self integer
) returns jsonb language plpgsql security definer set search_path to 'public' as $func$
declare
  r public.care_posts%rowtype;
  v_parts text[];
  v_provider uuid;
  v_review text;
  v_name text;
  v_changed boolean;
  v_other uuid;
begin
  select * into r from public.care_posts where id = p_post;
  if not found then raise exception 'That care-plan entry was not found.'; end if;
  if r.kind <> 'koc' then raise exception 'Only care-plan entries carry how they are paid.'; end if;
  v_provider := case when r.author_id <> r.patient_id then r.author_id else null end;
  if p_actor is null or not (
       p_actor = r.patient_id
       or (v_provider is not null and p_actor = v_provider and public.is_active_caregiver(r.patient_id, p_actor))
     ) then
    raise exception 'Only the client, or the provider whose work this is, can say how it is paid.';
  end if;
  v_other := case when p_actor = r.patient_id then v_provider else r.patient_id end;

  select array_agg(distinct x order by x) into v_parts
    from unnest(coalesce(p_parts, '{}'::text[])) x where x in ('covered','subsidy','self');
  if v_parts is null or cardinality(v_parts) = 0 then v_parts := null; end if;

  v_changed := (v_parts, case when 'covered' = any(v_parts) then greatest(coalesce(p_covered,0),0) end,
                case when 'subsidy' = any(v_parts) then greatest(coalesce(p_subsidy,0),0) end,
                case when 'self' = any(v_parts) then greatest(coalesce(p_self,0),0) end)
               is distinct from
               (r.pay_parts, r.pay_covered_cents, r.pay_subsidy_cents, r.pay_self_cents);

  v_review := case
    when v_parts is null or not ('subsidy' = any(v_parts)) then null
    when v_changed or r.subsidy_review is null then 'pending'
    else r.subsidy_review end;

  perform set_config('lichen.care_pay', 'on', true);
  update public.care_posts set
    pay_parts = v_parts,
    pay_covered_cents = case when 'covered' = any(v_parts) then greatest(coalesce(p_covered,0),0) end,
    pay_subsidy_cents = case when 'subsidy' = any(v_parts) then greatest(coalesce(p_subsidy,0),0) end,
    pay_self_cents    = case when 'self'    = any(v_parts) then greatest(coalesce(p_self,0),0) end,
    pay_provider_id = case when v_parts is null then null else v_provider end,
    subsidy_review = v_review,
    subsidy_reviewed_at = case when v_review = 'pending' and v_changed then null else r.subsidy_reviewed_at end,
    pay_set_at = case when v_parts is null then null else now() end,
    pay_set_by = case when v_parts is null then null when v_changed then p_actor else r.pay_set_by end
  where id = p_post;
  perform set_config('lichen.care_pay', '', true);

  -- A NEW or CHANGED subsidy ask goes to the OTHER party to confirm.
  if v_review = 'pending' and v_changed and v_other is not null then
    select coalesce(nullif(full_name,''), 'Someone') into v_name from public.profiles where id = p_actor;
    perform public.notify(v_other, 'home', null, 'care_subsidy_review',
      v_name || case when p_actor = r.patient_id then ' asked for subsidy help' else ' submitted a subsidy request for you' end,
      'On «' || coalesce(nullif(r.title,''), left(r.body, 60), 'a care-plan entry') ||
        case when p_actor = r.patient_id
          then '». Confirm it, or question it if this is already paid for some other way.'
          else '». Confirm it if it''s right, or question it.' end,
      case when v_other = r.patient_id then '/concierge/koc'
           else '/concierge/client/' || r.patient_id::text || '/koc' end, p_actor);
  end if;

  return jsonb_build_object('ok', true, 'parts', v_parts, 'review', v_review, 'provider', v_provider);
end;
$func$;
revoke all on function public._set_care_funding(uuid, uuid, text[], integer, integer, integer) from public, anon, authenticated;

create or replace function public.set_care_funding(
  p_post uuid, p_parts text[], p_covered integer default null,
  p_subsidy integer default null, p_self integer default null
) returns jsonb language sql security definer set search_path to 'public' as $func$
  select public._set_care_funding(auth.uid(), p_post, p_parts, p_covered, p_subsidy, p_self);
$func$;
revoke all on function public.set_care_funding(uuid, text[], integer, integer, integer) from public, anon;
grant execute on function public.set_care_funding(uuid, text[], integer, integer, integer) to authenticated;

create or replace function public.review_care_subsidy(p_post uuid, p_ok boolean)
returns void language plpgsql security definer set search_path to 'public' as $func$
declare r public.care_posts%rowtype; v_me uuid := auth.uid(); v_name text;
begin
  select * into r from public.care_posts where id = p_post;
  if not found then raise exception 'That care-plan entry was not found.'; end if;
  if v_me is null
     or v_me is not distinct from r.pay_set_by
     or not (v_me = r.patient_id or v_me is not distinct from r.pay_provider_id) then
    raise exception 'Only the other party — the client or the provider, whoever didn''t submit it — can review this subsidy ask.';
  end if;
  if r.subsidy_review is null then raise exception 'There is no subsidy ask on this entry.'; end if;
  perform set_config('lichen.care_pay', 'on', true);
  update public.care_posts set
    subsidy_review = case when p_ok then 'confirmed' else 'questioned' end,
    subsidy_reviewed_at = now()
  where id = p_post;
  perform set_config('lichen.care_pay', '', true);
  if not p_ok then
    select coalesce(nullif(full_name,''), 'Someone') into v_name from public.profiles where id = v_me;
    insert into public.notifications (recipient_id, section, type, title, body, link, actor_id)
    select p.id, 'home', 'care_subsidy_questioned',
      v_name || ' questioned a subsidy ask',
      'A care-plan subsidy request needs a conversation before any money moves.',
      '/concierge/client/' || r.patient_id::text || '/koc', v_me
    from public.profiles p where p.is_admin;
  end if;
end;
$func$;
revoke all on function public.review_care_subsidy(uuid, boolean) from public, anon;
grant execute on function public.review_care_subsidy(uuid, boolean) to authenticated;
