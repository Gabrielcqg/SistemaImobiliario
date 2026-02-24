-- ============================================================
-- MIGRATION: Allow org owner/admin to read CRM data for Analytics
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_has_org_members boolean := to_regclass('public.organization_members') IS NOT NULL;
  v_has_organizations boolean := to_regclass('public.organizations') IS NOT NULL;
BEGIN
  IF to_regclass('public.clients') IS NOT NULL THEN
    DROP POLICY IF EXISTS clients_select_owner_policy ON public.clients;
    DROP POLICY IF EXISTS clients_select_owner_or_org_admin_policy ON public.clients;

    IF v_has_org_members AND v_has_organizations THEN
      CREATE POLICY clients_select_owner_or_org_admin_policy
      ON public.clients
      FOR SELECT
      TO authenticated
      USING (
        clients.owner_user_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.organization_members m
          WHERE m.organization_id = clients.org_id
            AND m.user_id = auth.uid()
            AND coalesce(m.status::text, 'active') = 'active'
            AND m.role IN ('owner', 'admin')
        )
        OR EXISTS (
          SELECT 1
          FROM public.organizations o
          WHERE o.id = clients.org_id
            AND o.owner_user_id = auth.uid()
        )
      );
    ELSE
      CREATE POLICY clients_select_owner_policy
      ON public.clients
      FOR SELECT
      TO authenticated
      USING (clients.owner_user_id = auth.uid());
    END IF;
  END IF;

  IF to_regclass('public.crm_timeline') IS NOT NULL THEN
    DROP POLICY IF EXISTS crm_timeline_select_owner_policy ON public.crm_timeline;
    DROP POLICY IF EXISTS crm_timeline_select_owner_or_org_admin_policy ON public.crm_timeline;

    IF v_has_org_members AND v_has_organizations THEN
      CREATE POLICY crm_timeline_select_owner_or_org_admin_policy
      ON public.crm_timeline
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = crm_timeline.client_id
            AND c.owner_user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.organization_members m
          WHERE m.organization_id = crm_timeline.org_id
            AND m.user_id = auth.uid()
            AND coalesce(m.status::text, 'active') = 'active'
            AND m.role IN ('owner', 'admin')
        )
        OR EXISTS (
          SELECT 1
          FROM public.organizations o
          WHERE o.id = crm_timeline.org_id
            AND o.owner_user_id = auth.uid()
        )
      );
    ELSE
      CREATE POLICY crm_timeline_select_owner_policy
      ON public.crm_timeline
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = crm_timeline.client_id
            AND c.owner_user_id = auth.uid()
        )
      );
    END IF;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
