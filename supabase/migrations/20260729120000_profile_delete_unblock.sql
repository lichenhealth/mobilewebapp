-- Deleting a member should never brick on early "who did this" links
-- (found 2026-07-16 deleting a test account: 8 FKs to profiles had no ON
-- DELETE action). Attribution links go SET NULL (the record survives, the
-- who is forgotten); authored care content goes CASCADE (author_id is NOT
-- NULL there, and care rows already cascade with the patient anyway).

-- Attribution → SET NULL
alter table public.care_invitations
  drop constraint care_invitations_accepted_profile_id_fkey,
  add constraint care_invitations_accepted_profile_id_fkey
    foreign key (accepted_profile_id) references public.profiles(id) on delete set null;

alter table public.category_suggestions
  drop constraint category_suggestions_decided_by_fkey,
  add constraint category_suggestions_decided_by_fkey
    foreign key (decided_by) references public.profiles(id) on delete set null;

alter table public.subscriptions
  drop constraint subscriptions_granted_by_fkey,
  add constraint subscriptions_granted_by_fkey
    foreign key (granted_by) references public.profiles(id) on delete set null;

alter table public.membership_gifts
  drop constraint membership_gifts_claimed_profile_id_fkey,
  add constraint membership_gifts_claimed_profile_id_fkey
    foreign key (claimed_profile_id) references public.profiles(id) on delete set null;

-- Authored care content → CASCADE (author_id NOT NULL; dies with the author)
alter table public.care_posts
  drop constraint care_posts_author_id_fkey,
  add constraint care_posts_author_id_fkey
    foreign key (author_id) references public.profiles(id) on delete cascade;

alter table public.care_plans
  drop constraint care_plans_author_id_fkey,
  add constraint care_plans_author_id_fkey
    foreign key (author_id) references public.profiles(id) on delete cascade;

alter table public.health_snapshots
  drop constraint health_snapshots_author_id_fkey,
  add constraint health_snapshots_author_id_fkey
    foreign key (author_id) references public.profiles(id) on delete cascade;

-- Care links: the initiator is always one of the two parties (whose own
-- FKs cascade), so cascade here just removes the theoretical block.
alter table public.care_team_members
  drop constraint care_team_members_initiated_by_fkey,
  add constraint care_team_members_initiated_by_fkey
    foreign key (initiated_by) references public.profiles(id) on delete cascade;
