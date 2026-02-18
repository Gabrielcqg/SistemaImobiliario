-- ============================================================
-- MIGRATION: Fix legacy clients.status_pipeline check constraint
-- ============================================================

DO $$
DECLARE
  v_clients_reg regclass;
  v_has_status_pipeline boolean := false;
  v_constraint_name text;
BEGIN
  v_clients_reg := to_regclass('public.clients');
  IF v_clients_reg IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'clients'
      AND column_name = 'status_pipeline'
  )
    INTO v_has_status_pipeline;

  IF NOT v_has_status_pipeline THEN
    RETURN;
  END IF;

  -- Drop known legacy constraints that block new pipeline statuses.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = v_clients_reg
      AND conname = 'check_status_pipeline'
  ) THEN
    ALTER TABLE public.clients DROP CONSTRAINT check_status_pipeline;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = v_clients_reg
      AND conname = 'clients_status_pipeline_check'
  ) THEN
    ALTER TABLE public.clients DROP CONSTRAINT clients_status_pipeline_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = v_clients_reg
      AND conname = 'clients_status_pipeline_check_v2'
  ) THEN
    ALTER TABLE public.clients DROP CONSTRAINT clients_status_pipeline_check_v2;
  END IF;

  -- Catch any additional custom status check, but keep cross-field checks.
  FOR v_constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = v_clients_reg
      AND contype = 'c'
      AND conname NOT IN ('clients_closed_outcome_when_closed_check')
      AND pg_get_constraintdef(oid) ILIKE '%status_pipeline%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.clients DROP CONSTRAINT %I',
      v_constraint_name
    );
  END LOOP;

  ALTER TABLE public.clients
    ALTER COLUMN status_pipeline SET DEFAULT 'novo_match';

  UPDATE public.clients
  SET status_pipeline = 'novo_match'
  WHERE status_pipeline = ''
     OR (
       status_pipeline IS NOT NULL
       AND status_pipeline NOT IN (
         'novo_match',
         'em_conversa',
         'aguardando_resposta',
         'visita_agendada',
         'proposta',
         'fechado'
       )
     );

  ALTER TABLE public.clients
    ADD CONSTRAINT check_status_pipeline
    CHECK (
      status_pipeline IS NULL OR status_pipeline IN (
        'novo_match',
        'em_conversa',
        'aguardando_resposta',
        'visita_agendada',
        'proposta',
        'fechado'
      )
    );
END;
$$;

NOTIFY pgrst, 'reload schema';
