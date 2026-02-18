-- ============================================================
-- MIGRATION: Member directory RPC for organizer analytics
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_org_member_directory(p_org_id uuid)
RETURNS TABLE (
  user_id uuid,
  role text,
  status text,
  member_email text,
  member_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
SET row_security = off
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'org_id_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.organization_id = p_org_id
      AND m.user_id = v_user_id
      AND coalesce(m.status::text, 'active') = 'active'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    m.user_id,
    m.role::text,
    coalesce(m.status::text, 'active') AS status,
    nullif(lower(coalesce(u.email, '')), '') AS member_email,
    nullif(
      trim(
        coalesce(
          u.raw_user_meta_data ->> 'full_name',
          u.raw_user_meta_data ->> 'onboarding_full_name',
          split_part(lower(coalesce(u.email, '')), '@', 1)
        )
      ),
      ''
    ) AS member_name
  FROM public.organization_members m
  LEFT JOIN auth.users u
    ON u.id = m.user_id
  WHERE m.organization_id = p_org_id
  ORDER BY
    CASE m.role
      WHEN 'owner' THEN 0
      WHEN 'admin' THEN 1
      ELSE 2
    END,
    m.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_org_member_directory(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_org_member_directory(uuid)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
