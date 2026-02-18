-- ============================================================
-- MIGRATION: CRM pipeline tracking (status metadata + timeline)
-- ============================================================

ALTER TABLE IF EXISTS public.clients
  ADD COLUMN IF NOT EXISTS closed_outcome text,
  ADD COLUMN IF NOT EXISTS lost_reason text,
  ADD COLUMN IF NOT EXISTS lost_reason_detail text,
  ADD COLUMN IF NOT EXISTS next_action text,
  ADD COLUMN IF NOT EXISTS next_followup_at timestamptz,
  ADD COLUMN IF NOT EXISTS visit_at timestamptz,
  ADD COLUMN IF NOT EXISTS visit_notes text,
  ADD COLUMN IF NOT EXISTS proposal_value numeric,
  ADD COLUMN IF NOT EXISTS proposal_valid_until timestamptz,
  ADD COLUMN IF NOT EXISTS last_status_change_at timestamptz;

DO $$
DECLARE
  v_has_status_pipeline boolean;
BEGIN
  IF to_regclass('public.clients') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'clients'
        AND column_name = 'status_pipeline'
    )
      INTO v_has_status_pipeline;

    IF v_has_status_pipeline THEN
      ALTER TABLE public.clients
        ALTER COLUMN status_pipeline SET DEFAULT 'novo_match';

      UPDATE public.clients
      SET status_pipeline = 'novo_match'
      WHERE status_pipeline IS NULL
         OR status_pipeline NOT IN (
           'novo_match',
           'em_conversa',
           'aguardando_resposta',
           'visita_agendada',
           'proposta',
           'fechado'
         );

      UPDATE public.clients
      SET closed_outcome = 'won'
      WHERE status_pipeline = 'fechado'
        AND closed_outcome IS NULL;
    END IF;

    UPDATE public.clients
    SET lost_reason = NULL
    WHERE lost_reason IS NOT NULL
      AND lost_reason NOT IN (
        'preco',
        'localizacao',
        'documentacao',
        'desistencia',
        'cliente_sumiu',
        'comprou_outro_imovel',
        'condicoes_imovel',
        'outro'
      );

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'clients_status_pipeline_check_v2'
        AND conrelid = 'public.clients'::regclass
    ) AND v_has_status_pipeline THEN
      ALTER TABLE public.clients
        ADD CONSTRAINT clients_status_pipeline_check_v2
        CHECK (
          status_pipeline IN (
            'novo_match',
            'em_conversa',
            'aguardando_resposta',
            'visita_agendada',
            'proposta',
            'fechado'
          )
        );
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'clients_closed_outcome_check'
        AND conrelid = 'public.clients'::regclass
    ) THEN
      ALTER TABLE public.clients
        ADD CONSTRAINT clients_closed_outcome_check
        CHECK (closed_outcome IS NULL OR closed_outcome IN ('won', 'lost'));
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'clients_lost_reason_check'
        AND conrelid = 'public.clients'::regclass
    ) THEN
      ALTER TABLE public.clients
        ADD CONSTRAINT clients_lost_reason_check
        CHECK (
          lost_reason IS NULL OR lost_reason IN (
            'preco',
            'localizacao',
            'documentacao',
            'desistencia',
            'cliente_sumiu',
            'comprou_outro_imovel',
            'condicoes_imovel',
            'outro'
          )
        );
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'clients_closed_outcome_when_closed_check'
        AND conrelid = 'public.clients'::regclass
    ) AND v_has_status_pipeline THEN
      ALTER TABLE public.clients
        ADD CONSTRAINT clients_closed_outcome_when_closed_check
        CHECK (
          status_pipeline <> 'fechado'
          OR closed_outcome IN ('won', 'lost')
        );
    END IF;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'clients'
      AND column_name = 'status_pipeline'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_clients_status_pipeline
      ON public.clients(status_pipeline);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'clients'
      AND column_name = 'next_followup_at'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_clients_next_followup_at
      ON public.clients(next_followup_at)
      WHERE next_followup_at IS NOT NULL;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.crm_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  event_type text NOT NULL DEFAULT 'STATUS_CHANGE',
  from_status text,
  to_status text,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_timeline_org_created
  ON public.crm_timeline(org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_timeline_client_created
  ON public.crm_timeline(client_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.crm_timeline_set_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_client_org uuid;
  v_actor uuid := auth.uid();
BEGIN
  SELECT c.org_id
    INTO v_client_org
  FROM public.clients c
  WHERE c.id = NEW.client_id
  LIMIT 1;

  IF v_client_org IS NULL THEN
    RAISE EXCEPTION 'Invalid client reference for CRM timeline.';
  END IF;

  IF NEW.org_id IS NULL THEN
    NEW.org_id := v_client_org;
  ELSIF NEW.org_id <> v_client_org THEN
    RAISE EXCEPTION 'Organization mismatch for CRM timeline event.';
  END IF;

  IF NEW.actor_user_id IS NULL THEN
    NEW.actor_user_id := v_actor;
  END IF;

  IF NEW.event_type IS NULL OR btrim(NEW.event_type) = '' THEN
    NEW.event_type := 'STATUS_CHANGE';
  END IF;

  IF NEW.payload IS NULL THEN
    NEW.payload := '{}'::jsonb;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_timeline_set_defaults ON public.crm_timeline;
CREATE TRIGGER trg_crm_timeline_set_defaults
  BEFORE INSERT OR UPDATE ON public.crm_timeline
  FOR EACH ROW
  EXECUTE FUNCTION public.crm_timeline_set_defaults();

ALTER TABLE public.crm_timeline ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_timeline_select_org_policy ON public.crm_timeline;
CREATE POLICY crm_timeline_select_org_policy
ON public.crm_timeline
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.organization_id = crm_timeline.org_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'
  )
);

DROP POLICY IF EXISTS crm_timeline_insert_org_policy ON public.crm_timeline;
CREATE POLICY crm_timeline_insert_org_policy
ON public.crm_timeline
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.organization_id = crm_timeline.org_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'
  )
);

DROP POLICY IF EXISTS crm_timeline_update_org_policy ON public.crm_timeline;
CREATE POLICY crm_timeline_update_org_policy
ON public.crm_timeline
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.organization_id = crm_timeline.org_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.organization_id = crm_timeline.org_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'
  )
);

DROP POLICY IF EXISTS crm_timeline_delete_org_policy ON public.crm_timeline;
CREATE POLICY crm_timeline_delete_org_policy
ON public.crm_timeline
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.organization_id = crm_timeline.org_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_timeline TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
