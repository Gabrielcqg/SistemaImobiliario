-- ============================================================
-- MIGRATION: Backfill neighborhood_normalized on listings
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS unaccent;

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

UPDATE public.listings
SET neighborhood_normalized = public.normalize_text(neighborhood)
WHERE neighborhood IS NOT NULL
  AND btrim(neighborhood) <> ''
  AND (
    neighborhood_normalized IS NULL
    OR btrim(neighborhood_normalized) = ''
  );

CREATE INDEX IF NOT EXISTS idx_listings_neighborhood_normalized_prefix
  ON public.listings (neighborhood_normalized text_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_listings_city_neighborhood_normalized_prefix
  ON public.listings (city, neighborhood_normalized text_pattern_ops);

COMMIT;
