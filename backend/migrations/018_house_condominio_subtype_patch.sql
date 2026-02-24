-- ============================================================
-- MIGRATION PATCH: house subtype casa_condominio classification
-- ============================================================
-- Extends existing property subtype logic with a house-specific rule:
--   property_type = 'house' AND (
--     condo fee > 0 OR title contains "condominio" (accent-insensitive)
--   ) => property_subtype = 'casa_condominio'
--
-- Keeps existing rules intact:
-- - apartment-special title override (cobertura|kitnet|studio)
-- - subtype classification for property_type='other'

BEGIN;

CREATE EXTENSION IF NOT EXISTS unaccent;

-- Parses numeric-like text safely (used with JSON extraction from trigger/backfill).
CREATE OR REPLACE FUNCTION public.try_parse_numeric(input_value text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN input_value IS NULL THEN NULL
    WHEN btrim(input_value) = '' THEN NULL
    WHEN btrim(input_value) ~ '^-?[0-9]+([.,][0-9]+)?$'
      THEN replace(btrim(input_value), ',', '.')::numeric
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.try_parse_numeric(text)
  IS 'Safely parses simple numeric text into numeric; returns NULL for blank/non-numeric strings.';

-- Reads condo fee from a listings row JSON. Primary field in this schema is "condo_fee".
-- Additional aliases are checked for resilience if some environments drift in naming.
CREATE OR REPLACE FUNCTION public.extract_listing_condo_fee(listing_row jsonb)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    public.try_parse_numeric(listing_row ->> 'condo_fee'),
    public.try_parse_numeric(listing_row ->> 'condominium_fee'),
    public.try_parse_numeric(listing_row ->> 'condominio_fee'),
    public.try_parse_numeric(listing_row ->> 'valor_condominio')
  );
$$;

COMMENT ON FUNCTION public.extract_listing_condo_fee(jsonb)
  IS 'Extracts condo fee from listings row JSON using condo_fee (preferred) and fallback aliases.';

-- Centralized subtype classification wrapper used by trigger/backfill.
CREATE OR REPLACE FUNCTION public.classify_listing_property_subtype(
  property_type_text text,
  title_text text,
  description_text text DEFAULT NULL,
  condo_fee_value numeric DEFAULT NULL
)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  WITH normalized_input AS (
    SELECT public.normalize_text(title_text) AS title_norm
  )
  SELECT CASE
    WHEN property_type_text = 'house'
      AND (
        COALESCE(condo_fee_value, 0) > 0
        OR (title_norm IS NOT NULL AND title_norm ~ '\mcondominio\M')
      )
      THEN 'casa_condominio'

    WHEN property_type_text = 'other'
      THEN public.classify_other_property_subtype(title_text, description_text)

    ELSE NULL
  END
  FROM normalized_input;
$$;

COMMENT ON FUNCTION public.classify_listing_property_subtype(text, text, text, numeric)
  IS 'Classifies property_subtype across house (casa_condominio) and other subtype rules; returns NULL when no subtype applies.';

CREATE OR REPLACE FUNCTION public.trg_set_listing_property_subtype()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_row jsonb;
  v_title_norm text;
  v_description text;
  v_condo_fee numeric;
BEGIN
  v_row := to_jsonb(NEW);
  v_title_norm := public.normalize_text(NEW.title);
  v_description := v_row ->> 'description';
  v_condo_fee := public.extract_listing_condo_fee(v_row);

  -- 1) Apartment special rule (the only rule allowed to override property_type).
  IF v_title_norm IS NOT NULL
     AND v_title_norm ~ '\m(cobertura|kitnet|studio)\M' THEN
    NEW.property_type := 'apartment';
    NEW.property_subtype := NULL;
    RETURN NEW;
  END IF;

  -- 2) House condo subtype rule (preserve property_type='house').
  IF NEW.property_type = 'house' THEN
    IF public.classify_listing_property_subtype(
      NEW.property_type,
      NEW.title,
      v_description,
      v_condo_fee
    ) = 'casa_condominio' THEN
      NEW.property_subtype := 'casa_condominio';
    ELSIF NEW.property_subtype = 'casa_condominio' THEN
      -- Clear stale house condo subtype if rule no longer matches.
      NEW.property_subtype := NULL;
    END IF;

    RETURN NEW;
  END IF;

  -- 3) Existing "other" subtype classification rules.
  IF NEW.property_type = 'other' THEN
    NEW.property_subtype := public.classify_listing_property_subtype(
      NEW.property_type,
      NEW.title,
      v_description,
      v_condo_fee
    );
  ELSE
    -- 4) Fallback: non-house, non-other rows should not carry subtype.
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
    RAISE NOTICE 'public.listings not found; skipping house condo subtype patch.';
    RETURN;
  END IF;

  -- Recreate trigger safely in case it is missing or defined differently.
  DROP TRIGGER IF EXISTS trg_listings_set_property_subtype ON public.listings;
  CREATE TRIGGER trg_listings_set_property_subtype
    BEFORE INSERT OR UPDATE ON public.listings
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_set_listing_property_subtype();

  -- Backfill 1: set house condo subtype where rule matches (no unnecessary rewrites).
  WITH house_eval AS (
    SELECT
      l.id,
      public.classify_listing_property_subtype(
        l.property_type,
        l.title,
        to_jsonb(l) ->> 'description',
        public.extract_listing_condo_fee(to_jsonb(l))
      ) AS computed_subtype
    FROM public.listings l
    WHERE l.property_type = 'house'
  )
  UPDATE public.listings l
  SET property_subtype = 'casa_condominio'
  FROM house_eval h
  WHERE l.id = h.id
    AND h.computed_subtype = 'casa_condominio'
    AND l.property_subtype IS DISTINCT FROM 'casa_condominio';

  -- Backfill 2: clear stale casa_condominio on house rows that no longer match.
  WITH house_eval AS (
    SELECT
      l.id,
      public.classify_listing_property_subtype(
        l.property_type,
        l.title,
        to_jsonb(l) ->> 'description',
        public.extract_listing_condo_fee(to_jsonb(l))
      ) AS computed_subtype
    FROM public.listings l
    WHERE l.property_type = 'house'
  )
  UPDATE public.listings l
  SET property_subtype = NULL
  FROM house_eval h
  WHERE l.id = h.id
    AND l.property_subtype = 'casa_condominio'
    AND h.computed_subtype IS DISTINCT FROM 'casa_condominio';
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
