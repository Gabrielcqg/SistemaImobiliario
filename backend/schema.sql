-- Search Runs (Cache Table)
create table search_runs (
  id uuid primary key default gen_random_uuid(),
  filters_hash text not null, -- normalized hash of query params
  filters_json jsonb not null,
  created_at timestamptz default now(),
  status text check (status in ('running', 'completed', 'failed')),
  unique(filters_hash)
);

-- Offer Cards (Data Table)
create table offer_cards (
  id uuid primary key default gen_random_uuid(),
  external_id text not null,
  portal text not null check (portal in ('imovelweb', 'zap', 'vivareal')),
  url text not null,
  title text,
  price numeric,
  specs jsonb, -- {area, bedrooms, bathrooms, parking}
  location jsonb, -- {neighborhood, city, state}
  last_seen timestamptz default now(),
  full_data jsonb, -- Raw scraped data
  run_id uuid references search_runs(id),
  unique(portal, external_id)
);

-- Scrape Logs (Observability Table)
create table scrape_logs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references search_runs(id),
  portal text,
  status_code int,
  duration_ms int,
  bytes_received int,
  render_used boolean,
  cost_estimate numeric,
  error_msg text,
  created_at timestamptz default now()
);

-- Indexes for performance
create index idx_search_runs_hash on search_runs(filters_hash);
create index idx_offer_cards_price on offer_cards(price);
create index idx_offer_cards_location on offer_cards using gin (location);
