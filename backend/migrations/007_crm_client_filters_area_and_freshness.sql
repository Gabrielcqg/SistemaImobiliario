-- ============================================================
-- MIGRATION: CRM filters (optional area fields) + schema cache reload
-- ============================================================

ALTER TABLE IF EXISTS public.client_filters
  ADD COLUMN IF NOT EXISTS min_area_m2 numeric,
  ADD COLUMN IF NOT EXISTS max_area_m2 numeric,
  ADD COLUMN IF NOT EXISTS max_days_fresh integer;

-- Optional performance indexes for CRM match queries.
CREATE INDEX IF NOT EXISTS idx_listings_published_at
  ON public.listings(published_at DESC);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'listings'
      AND column_name = 'first_seen_at'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_listings_first_seen_at
      ON public.listings(first_seen_at DESC);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_listings_neighborhood_price_published
  ON public.listings(neighborhood_normalized, price, published_at DESC);

-- Required after schema changes in some Supabase/PostgREST environments.
NOTIFY pgrst, 'reload schema';
