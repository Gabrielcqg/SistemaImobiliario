-- ============================================================
-- MIGRATION: DB-Driven Architecture Evolution
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. SCRAPE_RUNS (evolui search_runs)
-- ============================================================

-- Primeiro, dropar a foreign key de scrape_logs se existir
ALTER TABLE IF EXISTS scrape_logs DROP CONSTRAINT IF EXISTS scrape_logs_run_id_fkey;

-- Dropar a foreign key de offer_cards se existir
ALTER TABLE IF EXISTS offer_cards DROP CONSTRAINT IF EXISTS offer_cards_run_id_fkey;

-- Renomear search_runs para scrape_runs
ALTER TABLE IF EXISTS search_runs RENAME TO scrape_runs;

-- Remover colunas antigas e adicionar novas
ALTER TABLE scrape_runs
  DROP COLUMN IF EXISTS filters_hash,
  DROP COLUMN IF EXISTS filters_json;

ALTER TABLE scrape_runs
  ADD COLUMN IF NOT EXISTS city TEXT DEFAULT 'campinas',
  ADD COLUMN IF NOT EXISTS state TEXT DEFAULT 'sp',
  ADD COLUMN IF NOT EXISTS portals TEXT[] DEFAULT ARRAY['imovelweb', 'zap', 'vivareal'],
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS total_cards_found INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_upserted INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_inactivated INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_summary JSONB;

-- Drop old index if exists
DROP INDEX IF EXISTS idx_search_runs_hash;

-- Create new indexes
CREATE INDEX IF NOT EXISTS idx_scrape_runs_city ON scrape_runs(city);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_started ON scrape_runs(started_at DESC);


-- 2. LISTINGS (evolui offer_cards)
-- ============================================================

-- Renomear offer_cards para listings
ALTER TABLE IF EXISTS offer_cards RENAME TO listings;

-- Remover coluna run_id (não mais vinculado a uma run específica)
ALTER TABLE listings DROP COLUMN IF EXISTS run_id;

-- Renomear last_seen para last_seen_at
ALTER TABLE listings RENAME COLUMN last_seen TO last_seen_at;

-- Adicionar novas colunas
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT DEFAULT 'Campinas',
  ADD COLUMN IF NOT EXISTS state TEXT DEFAULT 'SP',
  ADD COLUMN IF NOT EXISTS neighborhood TEXT,
  ADD COLUMN IF NOT EXISTS neighborhood_normalized TEXT,
  ADD COLUMN IF NOT EXISTS street TEXT,
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS property_type TEXT,
  ADD COLUMN IF NOT EXISTS area_m2 NUMERIC,
  ADD COLUMN IF NOT EXISTS bedrooms INT,
  ADD COLUMN IF NOT EXISTS bathrooms INT,
  ADD COLUMN IF NOT EXISTS parking INT,
  ADD COLUMN IF NOT EXISTS condo_fee NUMERIC,
  ADD COLUMN IF NOT EXISTS iptu NUMERIC,
  ADD COLUMN IF NOT EXISTS main_image_url TEXT,
  ADD COLUMN IF NOT EXISTS images TEXT[],
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at_portal TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS scraped_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS inactive_reason TEXT,
  ADD COLUMN IF NOT EXISTS badges TEXT[],
  ADD COLUMN IF NOT EXISTS below_market_badge BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS has_virtual_tour BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS view_count INT,
  ADD COLUMN IF NOT EXISTS previous_price NUMERIC,
  ADD COLUMN IF NOT EXISTS price_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completeness_score INT,
  ADD COLUMN IF NOT EXISTS missing_fields TEXT[],
  ADD COLUMN IF NOT EXISTS property_group_id UUID;

-- Add constraint for property_type
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_property_type_check;
ALTER TABLE listings ADD CONSTRAINT listings_property_type_check
  CHECK (property_type IS NULL OR property_type IN ('apartment', 'house', 'land', 'commercial', 'other'));

-- Criar coluna gerada para price_per_m2
-- Nota: Postgres não permite ALTER para adicionar generated column, então usamos trigger
CREATE OR REPLACE FUNCTION update_price_per_m2()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.area_m2 > 0 AND NEW.price IS NOT NULL THEN
    NEW.price_per_m2 := ROUND(NEW.price / NEW.area_m2, 2);
  ELSE
    NEW.price_per_m2 := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Adicionar coluna price_per_m2 se não existir
ALTER TABLE listings ADD COLUMN IF NOT EXISTS price_per_m2 NUMERIC;

-- Criar trigger
DROP TRIGGER IF EXISTS trg_update_price_per_m2 ON listings;
CREATE TRIGGER trg_update_price_per_m2
  BEFORE INSERT OR UPDATE ON listings
  FOR EACH ROW
  EXECUTE FUNCTION update_price_per_m2();

-- Índices críticos
CREATE INDEX IF NOT EXISTS idx_listings_active ON listings(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_listings_city_neighborhood ON listings(city, neighborhood_normalized);
CREATE INDEX IF NOT EXISTS idx_listings_property_type ON listings(property_type);
CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price);
CREATE INDEX IF NOT EXISTS idx_listings_bedrooms ON listings(bedrooms);
CREATE INDEX IF NOT EXISTS idx_listings_first_seen ON listings(first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_price_per_m2 ON listings(price_per_m2);
CREATE INDEX IF NOT EXISTS idx_listings_badges ON listings USING GIN(badges);

-- Fulltext para busca
CREATE INDEX IF NOT EXISTS idx_listings_title_fts ON listings USING GIN(to_tsvector('portuguese', COALESCE(title, '')));

-- 3. MARKET_STATS_DAILY
-- ============================================================

CREATE TABLE IF NOT EXISTS market_stats_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stat_date DATE NOT NULL,
  city TEXT NOT NULL,
  neighborhood_normalized TEXT,
  property_type TEXT,
  bedrooms INT,

  count_active INT,
  price_median NUMERIC,
  price_p25 NUMERIC,
  price_p75 NUMERIC,
  price_per_m2_median NUMERIC,
  price_per_m2_p25 NUMERIC,
  price_per_m2_p75 NUMERIC,

  new_listings_24h INT,
  new_listings_7d INT,
  inactivated_7d INT,
  below_market_count INT,

  price_median_vs_yesterday NUMERIC,
  price_median_vs_week NUMERIC,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unicidade tratando NULL como '' / 0 (Postgres permite via UNIQUE INDEX com expressão)
CREATE UNIQUE INDEX IF NOT EXISTS uq_market_stats_daily_cluster
ON market_stats_daily (
  stat_date,
  city,
  COALESCE(neighborhood_normalized, ''),
  COALESCE(property_type, ''),
  COALESCE(bedrooms, 0)
);

CREATE INDEX IF NOT EXISTS idx_market_stats_date
  ON market_stats_daily(stat_date DESC);

CREATE INDEX IF NOT EXISTS idx_market_stats_cluster
  ON market_stats_daily(city, neighborhood_normalized, property_type, bedrooms);


-- 4. OPPORTUNITIES_DAILY (Radar)
-- ============================================================

CREATE TABLE IF NOT EXISTS opportunities_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID REFERENCES listings(id) ON DELETE CASCADE,
  opportunity_date DATE NOT NULL,
  
  score INT CHECK (score BETWEEN 0 AND 100),
  reasons TEXT[],
  
  price_vs_median_pct NUMERIC,
  days_since_published INT,
  has_portal_badge BOOLEAN,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(listing_id, opportunity_date)
);

CREATE INDEX IF NOT EXISTS idx_opportunities_date ON opportunities_daily(opportunity_date DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_score ON opportunities_daily(score DESC);


-- 5. PROPERTY_GROUPS (Dedupe Avançado - Fase 3)
-- ============================================================

CREATE TABLE IF NOT EXISTS property_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_address TEXT,
  city TEXT NOT NULL,
  neighborhood_normalized TEXT,
  property_type TEXT,
  bedrooms INT,
  area_m2_avg NUMERIC,
  price_avg NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  listing_count INT DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_property_groups_cluster ON property_groups(city, neighborhood_normalized, property_type, bedrooms);

-- Add foreign key for property_group_id
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_property_group_id_fkey;
ALTER TABLE listings ADD CONSTRAINT listings_property_group_id_fkey 
  FOREIGN KEY (property_group_id) REFERENCES property_groups(id) ON DELETE SET NULL;


-- 6. UPDATE SCRAPE_LOGS
-- ============================================================

ALTER TABLE scrape_logs
  ADD COLUMN IF NOT EXISTS cards_collected INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cards_upserted INT DEFAULT 0;

-- Re-add foreign key to scrape_runs
ALTER TABLE scrape_logs DROP CONSTRAINT IF EXISTS scrape_logs_run_id_fkey;
ALTER TABLE scrape_logs ADD CONSTRAINT scrape_logs_run_id_fkey 
  FOREIGN KEY (run_id) REFERENCES scrape_runs(id) ON DELETE CASCADE;


-- 7. MIGRATE EXISTING DATA
-- ============================================================

-- Set first_seen_at from last_seen_at for existing records
UPDATE listings 
SET first_seen_at = last_seen_at 
WHERE first_seen_at IS NULL;

-- Extract neighborhood from location JSONB
UPDATE listings 
SET neighborhood = location->>'neighborhood',
    city = COALESCE(location->>'city', 'Campinas'),
    state = COALESCE(location->>'state', 'SP')
WHERE neighborhood IS NULL AND location IS NOT NULL;

-- Extract specs from JSONB
UPDATE listings
SET 
  area_m2 = (specs->>'area')::NUMERIC,
  bedrooms = (specs->>'bedrooms')::INT,
  bathrooms = (specs->>'bathrooms')::INT,
  parking = (specs->>'parking')::INT
WHERE specs IS NOT NULL;

-- Normalize neighborhoods
UPDATE listings
SET neighborhood_normalized = LOWER(TRIM(neighborhood))
WHERE neighborhood IS NOT NULL AND neighborhood_normalized IS NULL;

-- Set property_type based on title
UPDATE listings
SET property_type = 
  CASE 
    WHEN LOWER(title) LIKE '%apartamento%' OR LOWER(title) LIKE '%apto%' THEN 'apartment'
    WHEN LOWER(title) LIKE '%casa%' OR LOWER(title) LIKE '%sobrado%' THEN 'house'
    WHEN LOWER(title) LIKE '%terreno%' OR LOWER(title) LIKE '%lote%' THEN 'land'
    WHEN LOWER(title) LIKE '%sala%' OR LOWER(title) LIKE '%loja%' THEN 'commercial'
    ELSE 'other'
  END
WHERE property_type IS NULL;


-- ============================================================
-- DONE! Schema migrated successfully.
-- ============================================================
