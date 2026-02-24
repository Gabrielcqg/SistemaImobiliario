-- ============================================================
-- MIGRATION: CRM pipeline clarity + follow-up dates
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_clients_reg regclass;
  v_constraint_name text;
  v_has_status_pipeline boolean := false;
  v_has_owner_user_id boolean := false;
  v_has_data_retorno boolean := false;
BEGIN
  v_clients_reg := to_regclass('public.clients');
  IF v_clients_reg IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.clients
    ADD COLUMN IF NOT EXISTS next_followup_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_contact_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_reply_at timestamptz,
    ADD COLUMN IF NOT EXISTS next_action_at timestamptz,
    ADD COLUMN IF NOT EXISTS chase_due_at timestamptz;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'clients'
      AND column_name = 'status_pipeline'
  )
    INTO v_has_status_pipeline;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'clients'
      AND column_name = 'owner_user_id'
  )
    INTO v_has_owner_user_id;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'clients'
      AND column_name = 'data_retorno'
  )
    INTO v_has_data_retorno;

  -- Legacy compatibility: keep next_action_at aligned with historical follow-up field.
  UPDATE public.clients
  SET next_action_at = coalesce(next_action_at, next_followup_at)
  WHERE next_action_at IS NULL
    AND next_followup_at IS NOT NULL;

  IF v_has_data_retorno THEN
    UPDATE public.clients
    SET next_action_at = coalesce(next_action_at, data_retorno::timestamptz)
    WHERE next_action_at IS NULL
      AND data_retorno IS NOT NULL;
  END IF;

  IF v_has_status_pipeline THEN
    -- Migrate ambiguous legacy status into the new early-pipeline statuses.
    IF v_has_data_retorno THEN
      WITH legacy_map AS (
        SELECT
          c.id,
          CASE
            WHEN lower(coalesce(c.next_action, '')) IN ('enviar_informacoes', 'follow_up')
              OR c.next_action_at IS NOT NULL
              OR c.next_followup_at IS NOT NULL
              OR c.data_retorno IS NOT NULL
            THEN 'aguardando_retorno'
            ELSE 'contato_feito'
          END AS next_status
        FROM public.clients c
        WHERE c.status_pipeline = 'aguardando_resposta'
      )
      UPDATE public.clients c
      SET status_pipeline = lm.next_status
      FROM legacy_map lm
      WHERE c.id = lm.id;
    ELSE
      WITH legacy_map AS (
        SELECT
          c.id,
          CASE
            WHEN lower(coalesce(c.next_action, '')) IN ('enviar_informacoes', 'follow_up')
              OR c.next_action_at IS NOT NULL
              OR c.next_followup_at IS NOT NULL
            THEN 'aguardando_retorno'
            ELSE 'contato_feito'
          END AS next_status
        FROM public.clients c
        WHERE c.status_pipeline = 'aguardando_resposta'
      )
      UPDATE public.clients c
      SET status_pipeline = lm.next_status
      FROM legacy_map lm
      WHERE c.id = lm.id;
    END IF;

    UPDATE public.clients
    SET status_pipeline = 'novo_match'
    WHERE status_pipeline IS NULL
       OR btrim(status_pipeline) = ''
       OR status_pipeline NOT IN (
         'novo_match',
         'contato_feito',
         'em_conversa',
         'aguardando_retorno',
         'visita_agendada',
         'proposta',
         'fechado'
       );

    ALTER TABLE public.clients
      ALTER COLUMN status_pipeline SET DEFAULT 'novo_match';

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
      ADD CONSTRAINT check_status_pipeline
      CHECK (
        status_pipeline IS NULL OR status_pipeline IN (
          'novo_match',
          'contato_feito',
          'em_conversa',
          'aguardando_retorno',
          'visita_agendada',
          'proposta',
          'fechado'
        )
      );
  END IF;

  -- Stage-specific event timestamps and automatic chase date defaults.
  UPDATE public.clients
  SET last_contact_at = coalesce(last_contact_at, last_status_change_at, next_action_at, created_at)
  WHERE status_pipeline IN ('contato_feito', 'aguardando_retorno')
    AND last_contact_at IS NULL;

  UPDATE public.clients
  SET last_reply_at = coalesce(last_reply_at, last_status_change_at, created_at)
  WHERE status_pipeline = 'em_conversa'
    AND last_reply_at IS NULL;

  UPDATE public.clients
  SET chase_due_at = coalesce(
    next_action_at,
    last_contact_at + interval '24 hours',
    last_status_change_at + interval '24 hours',
    created_at + interval '24 hours'
  )
  WHERE status_pipeline = 'contato_feito'
    AND chase_due_at IS NULL;

  UPDATE public.clients
  SET chase_due_at = coalesce(
    next_action_at,
    last_contact_at + interval '48 hours',
    last_status_change_at + interval '48 hours',
    created_at + interval '48 hours'
  )
  WHERE status_pipeline = 'aguardando_retorno'
    AND chase_due_at IS NULL;

  UPDATE public.clients
  SET next_followup_at = next_action_at
  WHERE next_action_at IS NOT NULL
    AND (next_followup_at IS NULL OR next_followup_at <> next_action_at);

  IF v_has_owner_user_id THEN
    CREATE INDEX IF NOT EXISTS idx_clients_owner_next_action_at
      ON public.clients(owner_user_id, next_action_at)
      WHERE next_action_at IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_clients_owner_chase_due_at
      ON public.clients(owner_user_id, chase_due_at)
      WHERE chase_due_at IS NOT NULL;
  ELSE
    CREATE INDEX IF NOT EXISTS idx_clients_next_action_at
      ON public.clients(next_action_at)
      WHERE next_action_at IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_clients_chase_due_at
      ON public.clients(chase_due_at)
      WHERE chase_due_at IS NOT NULL;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
