-- ============================================================
-- MIGRATION: Allow owner/admin to list organization members
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_org_admin_or_owner(
  p_org_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  IF p_org_id IS NULL OR p_user_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.organization_id = p_org_id
      AND m.user_id = p_user_id
      AND coalesce(m.status::text, 'active') = 'active'
      AND m.role IN ('owner', 'admin')
  )
  OR EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_org_id
      AND o.owner_user_id = p_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_org_admin_or_owner(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_admin_or_owner(uuid, uuid) TO authenticated, service_role;

DO $$
BEGIN
  IF to_regclass('public.organization_members') IS NULL THEN
    RETURN;
  END IF;

  DROP POLICY IF EXISTS organization_members_select_own_or_owner_policy ON public.organization_members;

  CREATE POLICY organization_members_select_own_or_owner_policy
  ON public.organization_members
  FOR SELECT
  TO authenticated
  USING (
    organization_members.user_id = auth.uid()
    OR public.is_org_admin_or_owner(organization_members.organization_id)
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
