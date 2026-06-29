-- =============================================================================
-- Privacy hardening, part 1 of 2 — ADDITIVE (safe to apply first, breaks nothing)
--
-- Adds two SECURITY DEFINER helper functions so that the few features which
-- legitimately need email keep working AFTER we stop exposing the email column
-- to regular members (see part 2: ..._restrict_profile_email.sql).
--
-- Apply this BEFORE deploying the matching frontend and BEFORE part 2.
-- =============================================================================

-- 1) Care-team invite lookup.
-- Lets a member find another member by exact email (to add them to a care team)
-- WITHOUT being able to browse emails: it returns id + name only, never the
-- email itself. Runs as the function owner so it can read the email column even
-- after that column is locked from the `authenticated` role in part 2.
-- (This preserves today's behavior, where members can already look up by email.)
CREATE OR REPLACE FUNCTION public.find_member_by_email(p_email text)
RETURNS TABLE (id uuid, full_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name
  FROM public.profiles p
  WHERE lower(p.email) = lower(trim(p_email))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_member_by_email(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.find_member_by_email(text) TO authenticated;

-- 2) Admin supporters list.
-- The "Gift access" admin screen needs to show member emails. Regular members
-- won't be able to read emails after part 2, so admins read them through this
-- function, which checks is_admin and refuses everyone else.
CREATE OR REPLACE FUNCTION public.admin_list_supporters()
RETURNS TABLE (
  profile_id uuid,
  tier       text,
  source     text,
  status     text,
  full_name  text,
  email      text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
    SELECT s.profile_id, s.tier, s.source, s.status, p.full_name, p.email
    FROM public.subscriptions s
    LEFT JOIN public.profiles p ON p.id = s.profile_id
    ORDER BY s.granted_at DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_supporters() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_supporters() TO authenticated;
