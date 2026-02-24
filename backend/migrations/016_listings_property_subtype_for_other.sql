-- ============================================================
-- MIGRATION: listings.property_subtype for detailed "other" classification
-- ============================================================
--
-- Goal:
-- - Keep public.listings.property_type unchanged for compatibility
-- - Add public.listings.property_subtype to classify "other" listings into:
--   terreno | galpao | salao | sala | other
--
-- Notes:
-- - Classification is centralized in Postgres (function + trigger)
-- - Trigger reads description safely via to_jsonb(NEW) so it works even if
--   the table schema differs across environments

BEGIN;

CREATE EXTENSION IF NOT EXISTS unaccent;

-- Reuse the canonical text normalization helper used in other migrations.
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

-- Classify only the detailed subtype for listings that already belong to
-- property_type = 'other'. Accents are normalized before regex matching.
CREATE OR REPLACE FUNCTION public.classify_other_property_subtype(
  title_text text,
  description_text text DEFAULT NULL
)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  WITH normalized_input AS (
    SELECT public.normalize_text(
      concat_ws(
        ' ',
        nullif(coalesce(title_text, ''), ''),
        nullif(coalesce(description_text, ''), '')
      )
    ) AS haystack
  )
  SELECT CASE
    WHEN haystack IS NULL THEN 'other'

    -- Priority 1: galpao (including barracao / barracão after normalization)
    WHEN haystack ~ '\m(galpao|barracao)\M' THEN 'galpao'

    -- Priority 2: salao (must be before "sala")
    WHEN haystack ~ '\msalao\M' THEN 'salao'

    -- Priority 3: terreno (including lote)
    WHEN haystack ~ '\m(terreno|lote)\M' THEN 'terreno'

    -- Priority 4: sala (commercial room/office style listings)
    -- "salao" does not match here because of word boundaries and earlier priority.
    WHEN haystack ~ '\msala\s+comercial\M'
      OR haystack ~ '\msala\M'
    THEN 'sala'

    ELSE 'other'
  END
  FROM normalized_input;
$$;

COMMENT ON FUNCTION public.classify_other_property_subtype(text, text)
  IS 'Classifies detailed subtype for listings with property_type = other using normalized title/description.';

CREATE OR REPLACE FUNCTION public.trg_set_listing_property_subtype()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_description text;
BEGIN
  IF NEW.property_type = 'other' THEN
    -- Works even if "description" column is absent in some environments.
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
    RAISE NOTICE 'public.listings not found; skipping property_subtype schema/trigger/backfill.';
    RETURN;
  END IF;

  ALTER TABLE public.listings
    ADD COLUMN IF NOT EXISTS property_subtype text;

  DROP TRIGGER IF EXISTS trg_listings_set_property_subtype ON public.listings;

  CREATE TRIGGER trg_listings_set_property_subtype
    BEFORE INSERT OR UPDATE ON public.listings
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_set_listing_property_subtype();

  -- Backfill "other" rows only, avoiding unnecessary writes when the computed
  -- subtype is unchanged.
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

  -- Defensive cleanup in case legacy/manual data stored a subtype on rows
  -- outside property_type = 'other'.
  UPDATE public.listings
  SET property_subtype = NULL
  WHERE property_type IS DISTINCT FROM 'other'
    AND property_subtype IS NOT NULL;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
