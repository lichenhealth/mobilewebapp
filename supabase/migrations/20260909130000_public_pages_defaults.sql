-- WHICH SPACES ARE WEBSITES BY DEFAULT (founder 2026-07-28, same day):
-- organizations and places want to be found — a stable, a retreat center, a
-- farm. Communities and groups are membership-shaped, and a COHORT is not a
-- website. So only org/place default public; the rest opt in, same as people.
alter table public.spaces alter column public_page set default false;

update public.spaces set public_page = (kind in ('organization', 'place'));
