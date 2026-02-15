-- ============================================================
-- MIGRATION: Neighborhood Autocomplete (Prefix + Accent-insensitive)
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

CREATE TABLE IF NOT EXISTS public.neighborhoods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  name_normalized text NOT NULL,
  city text NOT NULL,
  state text NOT NULL DEFAULT 'SP',
  city_normalized text NOT NULL,
  state_normalized text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_neighborhoods_name_city_state
  ON public.neighborhoods (name_normalized, city_normalized, state_normalized);

CREATE INDEX IF NOT EXISTS idx_neighborhoods_name_prefix
  ON public.neighborhoods (name_normalized text_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_neighborhoods_city_name_prefix
  ON public.neighborhoods (city_normalized, name_normalized text_pattern_ops);

CREATE OR REPLACE FUNCTION public.touch_neighborhoods_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_neighborhoods_updated_at ON public.neighborhoods;
CREATE TRIGGER trg_touch_neighborhoods_updated_at
  BEFORE UPDATE ON public.neighborhoods
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_neighborhoods_updated_at();

INSERT INTO public.neighborhoods (
  name,
  name_normalized,
  city,
  state,
  city_normalized,
  state_normalized
)
SELECT DISTINCT
  btrim(l.neighborhood) AS name,
  public.normalize_text(l.neighborhood) AS name_normalized,
  coalesce(nullif(btrim(l.city), ''), 'Campinas') AS city,
  upper(coalesce(nullif(btrim(l.state), ''), 'SP')) AS state,
  public.normalize_text(coalesce(nullif(btrim(l.city), ''), 'Campinas')) AS city_normalized,
  public.normalize_text(upper(coalesce(nullif(btrim(l.state), ''), 'SP'))) AS state_normalized
FROM public.listings l
WHERE l.neighborhood IS NOT NULL
  AND btrim(l.neighborhood) <> ''
  AND public.normalize_text(l.neighborhood) IS NOT NULL
ON CONFLICT (name_normalized, city_normalized, state_normalized)
DO UPDATE SET
  name = EXCLUDED.name,
  city = EXCLUDED.city,
  state = EXCLUDED.state,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.sync_neighborhoods_from_listings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_name_normalized text;
  v_city text;
  v_city_normalized text;
  v_state text;
  v_state_normalized text;
BEGIN
  v_name := nullif(btrim(coalesce(NEW.neighborhood, '')), '');
  IF v_name IS NULL THEN
    RETURN NEW;
  END IF;

  v_name_normalized := public.normalize_text(v_name);
  IF v_name_normalized IS NULL THEN
    RETURN NEW;
  END IF;

  v_city := coalesce(nullif(btrim(NEW.city), ''), 'Campinas');
  v_city_normalized := public.normalize_text(v_city);

  v_state := upper(coalesce(nullif(btrim(NEW.state), ''), 'SP'));
  v_state_normalized := public.normalize_text(v_state);

  INSERT INTO public.neighborhoods (
    name,
    name_normalized,
    city,
    state,
    city_normalized,
    state_normalized
  )
  VALUES (
    v_name,
    v_name_normalized,
    v_city,
    v_state,
    v_city_normalized,
    v_state_normalized
  )
  ON CONFLICT (name_normalized, city_normalized, state_normalized)
  DO UPDATE SET
    name = EXCLUDED.name,
    city = EXCLUDED.city,
    state = EXCLUDED.state,
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_neighborhoods_from_listings ON public.listings;
CREATE TRIGGER trg_sync_neighborhoods_from_listings
  AFTER INSERT OR UPDATE OF neighborhood, city, state ON public.listings
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_neighborhoods_from_listings();

CREATE OR REPLACE FUNCTION public.search_neighborhoods(
  q text,
  p_city text DEFAULT NULL,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  name text,
  name_normalized text,
  city text,
  state text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  query_normalized text := public.normalize_text(q);
  city_normalized text := public.normalize_text(p_city);
  result_limit integer := least(greatest(coalesce(p_limit, 10), 8), 12);
BEGIN
  IF query_normalized IS NULL OR length(query_normalized) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    n.id,
    n.name,
    n.name_normalized,
    n.city,
    n.state
  FROM public.neighborhoods n
  WHERE n.name_normalized LIKE query_normalized || '%'
    AND (
      city_normalized IS NULL
      OR n.city_normalized = city_normalized
    )
  ORDER BY
    CASE
      WHEN n.name_normalized = query_normalized THEN 0
      WHEN n.name_normalized LIKE query_normalized || ' %' THEN 1
      ELSE 2
    END,
    n.name ASC
  LIMIT result_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.search_neighborhoods(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_neighborhoods(text, text, integer)
  TO anon, authenticated, service_role;

COMMIT;
