-- ============================================================
-- MIGRATION: refine listings property subtype + apartment title override
-- ============================================================
--
-- Keeps:
-- - public.listings.property_type as high-level category
-- - public.listings.property_subtype as detail for property_type='other'
--
-- New business rules:
-- - If title contains cobertura|kitnet|studio => force property_type='apartment'
-- - Classify subtypes for property_type='other' using normalized title regexes

BEGIN;

CREATE EXTENSION IF NOT EXISTS unaccent;

-- Reuse canonical normalization helper (accent-insensitive, lowercase, collapsed spaces).
CREATE OR REPLACE FUNCTION public.normalize_text(input_value text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
    btrim(
      regexp_replace(
        lower(unaccent(coalesce(input_value, ''))),
        '\s+',
        ' ',
        'g'
      )
    ),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.classify_other_property_subtype(
  title_text text,
  description_text text DEFAULT NULL
)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  WITH normalized_input AS (
    -- Classification is title-driven by business rule; description is accepted for API
    -- compatibility but intentionally not used for subtype decisions here.
    SELECT public.normalize_text(title_text) AS title_norm
  )
  SELECT CASE
    WHEN title_norm IS NULL THEN 'other'

    -- 2) casa comercial (highest commercial precedence)
    WHEN title_norm ~ '\mcasa\s+comercial\M' THEN 'casa_comercial'

    -- 3) ponto comercial
    WHEN title_norm ~ '\mponto\s+comercial\M' THEN 'ponto_comercial'

    -- 4) predio comercial / predio (intentional dataset behavior)
    WHEN title_norm ~ '\mpredio(\s+comercial)?\M' THEN 'predio_comercial'

    -- 5) loja
    WHEN title_norm ~ '\mloja\M' THEN 'loja'

    -- 6) laje
    WHEN title_norm ~ '\mlaje\M' THEN 'laje'

    -- 7) sala comercial (maps to subtype "sala")
    WHEN title_norm ~ '\msala\s+comercial\M' THEN 'sala'

    -- 8) salao (must be before generic "sala")
    WHEN title_norm ~ '\msalao\M' THEN 'salao'

    -- 9) galpao (with barracao alias)
    WHEN title_norm ~ '\m(galpao|barracao)\M' THEN 'galpao'

    -- 10) chacara
    WHEN title_norm ~ '\mchacara\M' THEN 'chacara'

    -- 11) sitio
    WHEN title_norm ~ '\msitio\M' THEN 'sitio'

    -- 12) terreno (with lote alias)
    WHEN title_norm ~ '\m(terreno|lote)\M' THEN 'terreno'

    -- Generic "sala" after more specific subtypes to reduce false positives
    -- (still after "salao" so "sala" does not override "salao")
    WHEN title_norm ~ '\msala\M' THEN 'sala'

    -- 13) Special dataset rule: generic "casa" under property_type='other'
    -- becomes casa_comercial for current UX expectations.
    WHEN title_norm ~ '\mcasa\M' THEN 'casa_comercial'

    -- 14) fallback
    ELSE 'other'
  END
  FROM normalized_input;
$$;

COMMENT ON FUNCTION public.classify_other_property_subtype(text, text)
  IS 'Classifies detailed subtype for listings with property_type=other using normalized title regex priority.';

CREATE OR REPLACE FUNCTION public.trg_set_listing_property_subtype()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_title_norm text;
  v_description text;
BEGIN
  v_title_norm := public.normalize_text(NEW.title);

  -- Apartment special rule (case/accent-insensitive via normalize_text).
  -- Intentionally the only rule that may override property_type.
  IF v_title_norm IS NOT NULL
     AND v_title_norm ~ '\m(cobertura|kitnet|studio)\M' THEN
    NEW.property_type := 'apartment';
    NEW.property_subtype := NULL;
    RETURN NEW;
  END IF;

  IF NEW.property_type = 'other' THEN
    -- Safe even when "description" is absent in some environments.
    v_description := to_jsonb(NEW) ->> 'description';
    NEW.property_subtype :=
      public.classify_other_property_subtype(NEW.title, v_description);
  ELSE
    NEW.property_subtype := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_listings_reg regclass;
BEGIN
  v_listings_reg := to_regclass('public.listings');
  IF v_listings_reg IS NULL THEN
    RAISE NOTICE 'public.listings not found; skipping migration.';
    RETURN;
  END IF;

  ALTER TABLE public.listings
    ADD COLUMN IF NOT EXISTS property_subtype text;

  DROP TRIGGER IF EXISTS trg_listings_set_property_subtype ON public.listings;
  CREATE TRIGGER trg_listings_set_property_subtype
    BEFORE INSERT OR UPDATE ON public.listings
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_set_listing_property_subtype();

  -- Backfill 1: apply apartment-special override (the only rule allowed to change property_type).
  WITH apartment_override AS (
    SELECT
      l.id
    FROM public.listings l
    WHERE public.normalize_text(l.title) ~ '\m(cobertura|kitnet|studio)\M'
  )
  UPDATE public.listings l
  SET
    property_type = 'apartment',
    property_subtype = NULL
  FROM apartment_override ao
  WHERE l.id = ao.id
    AND (
      l.property_type IS DISTINCT FROM 'apartment'
      OR l.property_subtype IS NOT NULL
    );

  -- Backfill 2: classify remaining rows with property_type='other'.
  WITH classified_rows AS (
    SELECT
      l.id,
      public.classify_other_property_subtype(
        l.title,
        to_jsonb(l) ->> 'description'
      ) AS computed_subtype
    FROM public.listings l
    WHERE l.property_type = 'other'
  )
  UPDATE public.listings l
  SET property_subtype = c.computed_subtype
  FROM classified_rows c
  WHERE l.id = c.id
    AND l.property_subtype IS DISTINCT FROM c.computed_subtype;

  -- Backfill 3: ensure non-"other" rows never carry subtype.
  UPDATE public.listings
  SET property_subtype = NULL
  WHERE property_type IS DISTINCT FROM 'other'
    AND property_subtype IS NOT NULL;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
