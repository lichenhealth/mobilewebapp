-- HOW THEY SIGNED UP, SHOWN MASKED (founder 2026-11-13, typing "Gabe" into a
-- calendar invite: "it should be how he signed up for lichen - so we should
-- have either a phone number or email (or both) for all users"). Every member
-- has a signup email (and many a phone); a calendar invitation to a member
-- already goes to that address server-side (send-calendar-invite). This tells
-- the host WHERE it will land — masked ("g•••@gmail.com", "•••4321") — so the
-- address itself never crosses to another member (contact_shares stays the
-- only door to the real value). Authenticated only, and only for members the
-- caller can already see.
create or replace function public.member_contact_hints(p_ids uuid[])
returns table (id uuid, email_hint text, phone_hint text)
language sql stable security definer set search_path = public, auth as $fn$
  select p.id,
         case when u.email is not null and position('@' in u.email) > 1
              then left(u.email, 1) || '•••@' || split_part(u.email, '@', 2) end,
         case when coalesce(p.phone, u.phone) is not null
                   and length(regexp_replace(coalesce(p.phone, u.phone), '\D', '', 'g')) >= 4
              then '•••' || right(regexp_replace(coalesce(p.phone, u.phone), '\D', '', 'g'), 4) end
  from public.profiles p
  join auth.users u on u.id = p.id
  where auth.uid() is not null
    and p.id = any(p_ids[1:60])
    and coalesce(p.kind, 'person') = 'person'
    and public.can_see_profile(p.id);
$fn$;
revoke all on function public.member_contact_hints(uuid[]) from public, anon;
grant execute on function public.member_contact_hints(uuid[]) to authenticated;
