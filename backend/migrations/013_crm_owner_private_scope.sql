-- ============================================================
-- MIGRATION: CRM owner-private scope (per-member CRM)
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_policy record;
BEGIN
  IF to_regclass('public.clients') IS NOT NULL THEN
    ALTER TABLE public.clients
      ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

    UPDATE public.clients c
    SET owner_user_id = coalesce(c.owner_user_id, c.user_id, c.created_by, o.owner_user_id)
    FROM public.organizations o
    WHERE c.owner_user_id IS NULL
      AND c.org_id = o.id;

    WITH first_active_member AS (
      SELECT DISTINCT ON (m.organization_id)
        m.organization_id,
        m.user_id
      FROM public.organization_members m
      WHERE m.status = 'active'
      ORDER BY m.organization_id, m.created_at ASC
    )
    UPDATE public.clients c
    SET owner_user_id = fam.user_id
    FROM first_active_member fam
    WHERE c.owner_user_id IS NULL
      AND c.org_id = fam.organization_id;

    UPDATE public.clients c
    SET owner_user_id = c.user_id
    WHERE c.owner_user_id IS NULL
      AND c.user_id IS NOT NULL;

    UPDATE public.clients c
    SET owner_user_id = c.created_by
    WHERE c.owner_user_id IS NULL
      AND c.created_by IS NOT NULL;

    IF EXISTS (
      SELECT 1
      FROM public.clients c
      WHERE c.owner_user_id IS NULL
    ) THEN
      RAISE EXCEPTION
        'clients.owner_user_id backfill failed; NULL owners still exist.';
    END IF;

    ALTER TABLE public.clients
      ALTER COLUMN owner_user_id SET DEFAULT auth.uid();

    ALTER TABLE public.clients
      ALTER COLUMN owner_user_id SET NOT NULL;

    UPDATE public.clients c
    SET user_id = c.owner_user_id
    WHERE c.user_id IS NULL
       OR c.user_id <> c.owner_user_id;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'clients'
        AND column_name = 'created_at'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_clients_owner_user_created_at
        ON public.clients(owner_user_id, created_at DESC);
    ELSE
      CREATE INDEX IF NOT EXISTS idx_clients_owner_user_id
        ON public.clients(owner_user_id);
    END IF;
  END IF;

  -- Replace trigger function so owner is always set on clients.
  CREATE OR REPLACE FUNCTION public.set_default_org_and_audit_fields()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $function$
  DECLARE
    v_actor uuid := auth.uid();
  BEGIN
    IF TG_TABLE_NAME = 'clients' THEN
      IF NEW.org_id IS NULL THEN
        NEW.org_id := public.current_user_org_id();
      END IF;

      IF NEW.owner_user_id IS NULL THEN
        NEW.owner_user_id := coalesce(NEW.user_id, NEW.created_by, v_actor);
      END IF;

      IF NEW.owner_user_id IS NULL THEN
        RAISE EXCEPTION 'owner_user_id_required';
      END IF;

      IF NEW.user_id IS NULL OR NEW.user_id <> NEW.owner_user_id THEN
        NEW.user_id := NEW.owner_user_id;
      END IF;
    ELSIF TG_TABLE_NAME = 'client_filters' THEN
      IF NEW.org_id IS NULL THEN
        SELECT c.org_id
          INTO NEW.org_id
        FROM public.clients c
        WHERE c.id = NEW.client_id;
      END IF;
    ELSIF TG_TABLE_NAME = 'automated_matches' THEN
      IF NEW.org_id IS NULL THEN
        SELECT c.org_id
          INTO NEW.org_id
        FROM public.clients c
        WHERE c.id = NEW.client_id;
      END IF;
    END IF;

    IF TG_OP = 'INSERT' AND NEW.created_by IS NULL THEN
      NEW.created_by := v_actor;
    END IF;

    IF v_actor IS NOT NULL THEN
      NEW.updated_by := v_actor;
    END IF;

    RETURN NEW;
  END;
  $function$;

  -- clients: strictly private per owner.
  IF to_regclass('public.clients') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY';

    FOR v_policy IN
      SELECT p.policyname
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = 'clients'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.clients', v_policy.policyname);
    END LOOP;

    EXECUTE $policy$
      CREATE POLICY clients_select_owner_policy
      ON public.clients
      FOR SELECT
      TO authenticated
      USING (clients.owner_user_id = auth.uid())
    $policy$;

    EXECUTE $policy$
      CREATE POLICY clients_insert_owner_policy
      ON public.clients
      FOR INSERT
      TO authenticated
      WITH CHECK (clients.owner_user_id = auth.uid())
    $policy$;

    EXECUTE $policy$
      CREATE POLICY clients_update_owner_policy
      ON public.clients
      FOR UPDATE
      TO authenticated
      USING (clients.owner_user_id = auth.uid())
      WITH CHECK (clients.owner_user_id = auth.uid())
    $policy$;

    EXECUTE $policy$
      CREATE POLICY clients_delete_owner_policy
      ON public.clients
      FOR DELETE
      TO authenticated
      USING (clients.owner_user_id = auth.uid())
    $policy$;
  END IF;

  -- client_filters: access only if owner owns referenced client.
  IF to_regclass('public.client_filters') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.client_filters ENABLE ROW LEVEL SECURITY';

    FOR v_policy IN
      SELECT p.policyname
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = 'client_filters'
    LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.client_filters',
        v_policy.policyname
      );
    END LOOP;

    EXECUTE $policy$
      CREATE POLICY client_filters_select_owner_policy
      ON public.client_filters
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = client_filters.client_id
            AND c.owner_user_id = auth.uid()
        )
      )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY client_filters_insert_owner_policy
      ON public.client_filters
      FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = client_filters.client_id
            AND c.owner_user_id = auth.uid()
        )
      )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY client_filters_update_owner_policy
      ON public.client_filters
      FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = client_filters.client_id
            AND c.owner_user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = client_filters.client_id
            AND c.owner_user_id = auth.uid()
        )
      )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY client_filters_delete_owner_policy
      ON public.client_filters
      FOR DELETE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = client_filters.client_id
            AND c.owner_user_id = auth.uid()
        )
      )
    $policy$;
  END IF;

  -- automated_matches: access only if owner owns referenced client.
  IF to_regclass('public.automated_matches') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.automated_matches ENABLE ROW LEVEL SECURITY';

    FOR v_policy IN
      SELECT p.policyname
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = 'automated_matches'
    LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.automated_matches',
        v_policy.policyname
      );
    END LOOP;

    EXECUTE $policy$
      CREATE POLICY automated_matches_select_owner_policy
      ON public.automated_matches
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = automated_matches.client_id
            AND c.owner_user_id = auth.uid()
        )
      )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY automated_matches_insert_owner_policy
      ON public.automated_matches
      FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = automated_matches.client_id
            AND c.owner_user_id = auth.uid()
        )
      )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY automated_matches_update_owner_policy
      ON public.automated_matches
      FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = automated_matches.client_id
            AND c.owner_user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = automated_matches.client_id
            AND c.owner_user_id = auth.uid()
        )
      )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY automated_matches_delete_owner_policy
      ON public.automated_matches
      FOR DELETE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = automated_matches.client_id
            AND c.owner_user_id = auth.uid()
        )
      )
    $policy$;
  END IF;

  -- crm_timeline: access only if owner owns referenced client.
  IF to_regclass('public.crm_timeline') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.crm_timeline ENABLE ROW LEVEL SECURITY';

    FOR v_policy IN
      SELECT p.policyname
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = 'crm_timeline'
    LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.crm_timeline',
        v_policy.policyname
      );
    END LOOP;

    EXECUTE $policy$
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
      )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY crm_timeline_insert_owner_policy
      ON public.crm_timeline
      FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = crm_timeline.client_id
            AND c.owner_user_id = auth.uid()
        )
      )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY crm_timeline_update_owner_policy
      ON public.crm_timeline
      FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = crm_timeline.client_id
            AND c.owner_user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = crm_timeline.client_id
            AND c.owner_user_id = auth.uid()
        )
      )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY crm_timeline_delete_owner_policy
      ON public.crm_timeline
      FOR DELETE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = crm_timeline.client_id
            AND c.owner_user_id = auth.uid()
        )
      )
    $policy$;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
