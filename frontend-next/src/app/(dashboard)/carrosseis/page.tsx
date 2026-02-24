"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCcw } from "lucide-react";
import RowCarousel from "@/components/carousels/RowCarousel";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import type { Listing } from "@/hooks/useListings";
import { useOrganizationContext } from "@/lib/auth/useOrganizationContext";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  CAROUSEL_COLUMNS,
  EASY_SELL_RULES,
  type CarouselColumnConfig,
  type CarouselColumnId
} from "./categories.config";

type CarouselListing = Listing & {
  published_at?: string | null;
  below_market_badge?: boolean | null;
  previous_price?: number | null;
  price_changed_at?: string | null;
  badges?: string[] | null;
  price_per_m2?: number | null;
  is_active?: boolean | null;
};

type ColumnState = {
  items: CarouselListing[];
  index: number;
  loading: boolean;
  error: string | null;
};

type MarketStatRow = {
  stat_date: string | null;
  neighborhood_normalized: string | null;
  property_type: string | null;
  bedrooms: number | null;
  price_per_m2_median: number | string | null;
};

const LISTINGS_SELECT_WITH_SIGNALS =
  "id, title, price, city, state, neighborhood, neighborhood_normalized, bedrooms, bathrooms, parking, area_m2, property_type, portal, first_seen_at, main_image_url, url, published_at, below_market_badge, previous_price, price_changed_at, badges, price_per_m2, is_active";
const LISTINGS_SELECT_WITHOUT_BELOW_MARKET =
  "id, title, price, city, state, neighborhood, neighborhood_normalized, bedrooms, bathrooms, parking, area_m2, property_type, portal, first_seen_at, main_image_url, url, published_at, previous_price, price_changed_at, badges, price_per_m2, is_active";
const LISTINGS_SELECT_BASE =
  "id, title, price, city, state, neighborhood, neighborhood_normalized, bedrooms, bathrooms, parking, area_m2, property_type, portal, first_seen_at, main_image_url, url, published_at, is_active";

const PROPERTY_TYPES = new Set(["apartment", "house", "land", "other"]);

const createInitialState = (): Record<CarouselColumnId, ColumnState> => ({
  cheap_region: {
    items: [],
    index: 0,
    loading: true,
    error: null
  },
  price_drop: {
    items: [],
    index: 0,
    loading: true,
    error: null
  },
  easy_sell: {
    items: [],
    index: 0,
    loading: true,
    error: null
  },
  practical_filter: {
    items: [],
    index: 0,
    loading: true,
    error: null
  },
  ai_store: {
    items: [],
    index: 0,
    loading: false,
    error: null
  }
});

const isMissingColumnError = (value?: string) =>
  typeof value === "string" &&
  /(column .* does not exist|could not find the .* column .* schema cache|pgrst204)/i.test(
    value
  );

const toNumberOrNull = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const toIntOrNull = (value: unknown) => {
  const parsed = toNumberOrNull(value);
  return parsed === null ? null : Math.trunc(parsed);
};

const normalizeText = (value?: string | null) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const parseDateSafe = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const toRecencyTs = (listing: CarouselListing) => {
  const publishedTs = parseDateSafe(listing.published_at)?.getTime() ?? null;
  if (publishedTs !== null) return publishedTs;
  return parseDateSafe(listing.first_seen_at)?.getTime() ?? 0;
};

const toPricePerM2 = (listing: CarouselListing) => {
  const persisted = toNumberOrNull(listing.price_per_m2);
  if (persisted && persisted > 0) return persisted;
  const price = toNumberOrNull(listing.price);
  const area = toNumberOrNull(listing.area_m2);
  if (!price || !area || area <= 0) return null;
  return price / area;
};

const hasPriceDropBadge = (listing: CarouselListing) => {
  if (!Array.isArray(listing.badges)) return false;
  const normalized = listing.badges.map((badge) => normalizeText(badge));
  return normalized.some(
    (badge) =>
      badge.includes("price_drop") || badge.includes("queda") || badge.includes("desconto")
  );
};

const normalizeListingRow = (row: Record<string, unknown>): CarouselListing => {
  const propertyTypeCandidate = normalizeText(
    typeof row.property_type === "string" ? row.property_type : null
  );
  const propertyType = PROPERTY_TYPES.has(propertyTypeCandidate)
    ? (propertyTypeCandidate as Listing["property_type"])
    : null;

  return {
    id: String(row.id ?? ""),
    title: typeof row.title === "string" ? row.title : null,
    price: toNumberOrNull(row.price),
    city: typeof row.city === "string" ? row.city : null,
    state: typeof row.state === "string" ? row.state : null,
    neighborhood: typeof row.neighborhood === "string" ? row.neighborhood : null,
    neighborhood_normalized:
      typeof row.neighborhood_normalized === "string" ? row.neighborhood_normalized : null,
    bedrooms: toIntOrNull(row.bedrooms),
    bathrooms: toIntOrNull(row.bathrooms),
    parking: toIntOrNull(row.parking),
    area_m2: toNumberOrNull(row.area_m2),
    deal_type: null,
    property_type: propertyType,
    portal: typeof row.portal === "string" ? row.portal : null,
    first_seen_at: typeof row.first_seen_at === "string" ? row.first_seen_at : null,
    main_image_url: typeof row.main_image_url === "string" ? row.main_image_url : null,
    url: typeof row.url === "string" ? row.url : null,
    published_at: typeof row.published_at === "string" ? row.published_at : null,
    below_market_badge:
      typeof row.below_market_badge === "boolean" ? row.below_market_badge : null,
    previous_price: toNumberOrNull(row.previous_price),
    price_changed_at: typeof row.price_changed_at === "string" ? row.price_changed_at : null,
    badges: Array.isArray(row.badges)
      ? row.badges.filter((value): value is string => typeof value === "string")
      : null,
    price_per_m2: toNumberOrNull(row.price_per_m2),
    is_active: typeof row.is_active === "boolean" ? row.is_active : null
  };
};

const buildMarketKey = (
  neighborhood: string,
  propertyType: string | null,
  bedrooms: number | null
) => `${neighborhood}::${propertyType ?? "*"}::${bedrooms ?? -1}`;

export default function CarrosseisPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const {
    context: organizationContext,
    organizationId,
    loading: organizationLoading,
    needsOrganizationChoice,
    error: organizationError
  } = useOrganizationContext();

  const [refreshTick, setRefreshTick] = useState(0);
  const [columnStates, setColumnStates] = useState<Record<CarouselColumnId, ColumnState>>(
    createInitialState
  );

  const updateColumnState = useCallback(
    (id: CarouselColumnId, patch: Partial<ColumnState>) => {
      setColumnStates((prev) => ({
        ...prev,
        [id]: {
          ...prev[id],
          ...patch
        }
      }));
    },
    []
  );

  const fetchListingsPool = useCallback(
    async (poolSize: number) => {
      const runQuery = async (select: string, withPublishedOrder: boolean) => {
        let query = supabase.from("listings").select(select).limit(poolSize);

        if (withPublishedOrder) {
          query = query.order("published_at", {
            ascending: false,
            nullsFirst: false
          });
        }

        query = query.order("first_seen_at", {
          ascending: false,
          nullsFirst: false
        });

        return query;
      };

      let result = await runQuery(LISTINGS_SELECT_WITH_SIGNALS, true);

      if (result.error && isMissingColumnError(result.error.message)) {
        result = await runQuery(LISTINGS_SELECT_WITHOUT_BELOW_MARKET, true);
      }

      if (result.error && isMissingColumnError(result.error.message)) {
        result = await runQuery(LISTINGS_SELECT_BASE, false);
      }

      if (result.error) {
        throw new Error(result.error.message);
      }

      const rawRows = Array.isArray(result.data) ? (result.data as unknown[]) : [];

      const rows = rawRows
        .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
        .map(normalizeListingRow)
        .filter((row) => row.id.length > 0)
        .filter((row) => row.is_active !== false);

      return rows;
    },
    [supabase]
  );

  const fetchMarketMedianMap = useCallback(
    async (listings: CarouselListing[]) => {
      const neighborhoods = Array.from(
        new Set(
          listings
            .map((listing) => normalizeText(listing.neighborhood_normalized ?? listing.neighborhood))
            .filter(Boolean)
        )
      ).slice(0, 120);

      if (neighborhoods.length === 0) {
        return new Map<string, number>();
      }

      const { data, error } = await supabase
        .from("market_stats_daily")
        .select(
          "stat_date, neighborhood_normalized, property_type, bedrooms, price_per_m2_median"
        )
        .in("neighborhood_normalized", neighborhoods)
        .order("stat_date", { ascending: false })
        .limit(4000);

      if (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[Carrosseis] sem market_stats_daily para score de oportunidade:", error);
        }
        return new Map<string, number>();
      }

      const latestByKey = new Map<string, { ts: number; median: number }>();

      ((data as MarketStatRow[] | null) ?? []).forEach((row) => {
        const neighborhood = normalizeText(row.neighborhood_normalized);
        if (!neighborhood) return;

        const median = toNumberOrNull(row.price_per_m2_median);
        if (!median || median <= 0) return;

        const timestamp = parseDateSafe(row.stat_date)?.getTime() ?? 0;
        const key = buildMarketKey(
          neighborhood,
          normalizeText(row.property_type),
          typeof row.bedrooms === "number" ? row.bedrooms : null
        );

        if (!latestByKey.has(key)) {
          latestByKey.set(key, { ts: timestamp, median });
          return;
        }

        const current = latestByKey.get(key);
        if (!current) return;

        if (timestamp > current.ts) {
          latestByKey.set(key, { ts: timestamp, median });
        }
      });

      const onlyMedian = new Map<string, number>();
      latestByKey.forEach((value, key) => {
        onlyMedian.set(key, value.median);
      });

      return onlyMedian;
    },
    [supabase]
  );

  const getMedianForListing = useCallback(
    (listing: CarouselListing, medianMap: Map<string, number>) => {
      const neighborhood = normalizeText(listing.neighborhood_normalized ?? listing.neighborhood);
      if (!neighborhood) return null;

      const propertyType = normalizeText(listing.property_type);
      const bedrooms = typeof listing.bedrooms === "number" ? listing.bedrooms : null;

      const candidates = [
        buildMarketKey(neighborhood, propertyType || null, bedrooms),
        buildMarketKey(neighborhood, propertyType || null, null),
        buildMarketKey(neighborhood, null, bedrooms),
        buildMarketKey(neighborhood, null, null)
      ];

      for (const key of candidates) {
        const median = medianMap.get(key);
        if (typeof median === "number" && Number.isFinite(median) && median > 0) {
          return median;
        }
      }

      return null;
    },
    []
  );

  const loadCheapRegion = useCallback(
    async (config: CarouselColumnConfig) => {
      const pool = await fetchListingsPool(config.query.poolSize);
      const medianMap = await fetchMarketMedianMap(pool);

      const scored = pool.map((listing) => {
        const pricePerM2 = toPricePerM2(listing);
        const marketMedian = getMedianForListing(listing, medianMap);

        const discountPct =
          pricePerM2 && marketMedian ? (marketMedian - pricePerM2) / marketMedian : null;

        return {
          listing,
          belowMarket: Boolean(listing.below_market_badge),
          discountPct,
          pricePerM2,
          recencyTs: toRecencyTs(listing)
        };
      });

      scored.sort((a, b) => {
        if (a.belowMarket !== b.belowMarket) return a.belowMarket ? -1 : 1;

        const aDiscount = a.discountPct ?? Number.NEGATIVE_INFINITY;
        const bDiscount = b.discountPct ?? Number.NEGATIVE_INFINITY;
        if (aDiscount !== bDiscount) return bDiscount - aDiscount;

        const aPpm2 = a.pricePerM2 ?? Number.POSITIVE_INFINITY;
        const bPpm2 = b.pricePerM2 ?? Number.POSITIVE_INFINITY;
        if (aPpm2 !== bPpm2) return aPpm2 - bPpm2;

        return b.recencyTs - a.recencyTs;
      });

      return scored.slice(0, config.limit).map((entry) => entry.listing);
    },
    [fetchListingsPool, fetchMarketMedianMap, getMedianForListing]
  );

  const loadPriceDrop = useCallback(
    async (config: CarouselColumnConfig) => {
      const pool = await fetchListingsPool(config.query.poolSize);

      const withDrop = pool
        .map((listing) => {
          const currentPrice = toNumberOrNull(listing.price);
          const previousPrice = toNumberOrNull(listing.previous_price);

          const dropPct =
            currentPrice && previousPrice && previousPrice > currentPrice
              ? (previousPrice - currentPrice) / previousPrice
              : 0;

          const hasDropSignal =
            dropPct > 0 || hasPriceDropBadge(listing) || Boolean(listing.price_changed_at);

          return {
            listing,
            dropPct,
            changedTs: parseDateSafe(listing.price_changed_at)?.getTime() ?? 0,
            recencyTs: toRecencyTs(listing),
            hasDropSignal
          };
        })
        .filter((entry) => entry.hasDropSignal);

      withDrop.sort((a, b) => {
        if (a.dropPct !== b.dropPct) return b.dropPct - a.dropPct;
        if (a.changedTs !== b.changedTs) return b.changedTs - a.changedTs;
        return b.recencyTs - a.recencyTs;
      });

      return withDrop.slice(0, config.limit).map((entry) => entry.listing);
    },
    [fetchListingsPool]
  );

  const loadEasySell = useCallback(
    async (config: CarouselColumnConfig) => {
      const pool = await fetchListingsPool(config.query.poolSize);

      const filtered = pool.filter((listing) => {
        const bedrooms = toIntOrNull(listing.bedrooms);
        const price = toNumberOrNull(listing.price);

        if (bedrooms === null || bedrooms < EASY_SELL_RULES.minBedrooms) return false;
        if (price === null) return false;
        if (price < EASY_SELL_RULES.minPrice || price > EASY_SELL_RULES.maxPrice) {
          return false;
        }

        if (!EASY_SELL_RULES.applyAreaRangeWhenPresent) return true;

        const area = toNumberOrNull(listing.area_m2);
        if (area === null) return true;

        return area >= EASY_SELL_RULES.minAreaM2 && area <= EASY_SELL_RULES.maxAreaM2;
      });

      filtered.sort((a, b) => toRecencyTs(b) - toRecencyTs(a));

      return filtered.slice(0, config.limit);
    },
    [fetchListingsPool]
  );

  const loadPracticalFilter = useCallback(
    async (config: CarouselColumnConfig) => {
      const pool = await fetchListingsPool(config.query.poolSize);

      const filtered = pool.filter((listing) => {
        const price = toNumberOrNull(listing.price);
        const bedrooms = toIntOrNull(listing.bedrooms);
        const bathrooms = toIntOrNull(listing.bathrooms);
        const area = toNumberOrNull(listing.area_m2);

        if (price === null) return false;
        if (!listing.url) return false;
        if (!listing.main_image_url) return false;
        if (!listing.neighborhood && !listing.neighborhood_normalized) return false;
        if (bedrooms === null || bedrooms < 1) return false;
        if (bathrooms === null || bathrooms < 1) return false;
        if (area !== null && area <= 30) return false;

        return true;
      });

      filtered.sort((a, b) => toRecencyTs(b) - toRecencyTs(a));

      return filtered.slice(0, config.limit);
    },
    [fetchListingsPool]
  );

  const loadColumnItems = useCallback(
    async (config: CarouselColumnConfig) => {
      if (config.id === "cheap_region") {
        return loadCheapRegion(config);
      }

      if (config.id === "price_drop") {
        return loadPriceDrop(config);
      }

      if (config.id === "easy_sell") {
        return loadEasySell(config);
      }

      if (config.id === "practical_filter") {
        return loadPracticalFilter(config);
      }

      return [];
    },
    [loadCheapRegion, loadEasySell, loadPracticalFilter, loadPriceDrop]
  );

  useEffect(() => {
    if (organizationLoading) return;

    let active = true;

    if (!organizationId) {
      setColumnStates(createInitialState());
      return;
    }

    CAROUSEL_COLUMNS.forEach((config) => {
      if (config.mode === "placeholder") {
        updateColumnState(config.id, {
          items: [],
          index: 0,
          loading: false,
          error: null
        });
        return;
      }

      updateColumnState(config.id, {
        loading: true,
        error: null,
        index: 0
      });

      void loadColumnItems(config)
        .then((items) => {
          if (!active) return;

          updateColumnState(config.id, {
            items,
            index: 0,
            loading: false,
            error: null
          });

          if (process.env.NODE_ENV !== "production") {
            console.info("[Carrosseis] coluna carregada", {
              columnId: config.id,
              total: items.length,
              visibleCount: config.visibleCount
            });
          }
        })
        .catch((error: unknown) => {
          if (!active) return;

          const message =
            error instanceof Error ? error.message : "Falha inesperada ao carregar coluna.";

          updateColumnState(config.id, {
            items: [],
            index: 0,
            loading: false,
            error: message
          });

          console.error("[Carrosseis] erro ao carregar coluna:", {
            columnId: config.id,
            message
          });
        });
    });

    return () => {
      active = false;
    };
  }, [loadColumnItems, organizationId, organizationLoading, refreshTick, updateColumnState]);

  const handlePrevious = useCallback((columnId: CarouselColumnId) => {
    setColumnStates((prev) => {
      const current = prev[columnId];
      const nextIndex = Math.max(current.index - 1, 0);

      if (nextIndex === current.index) return prev;

      return {
        ...prev,
        [columnId]: {
          ...current,
          index: nextIndex
        }
      };
    });
  }, []);

  const handleNext = useCallback((columnId: CarouselColumnId, visibleCount: number) => {
    setColumnStates((prev) => {
      const current = prev[columnId];
      const maxIndex = Math.max(current.items.length - visibleCount, 0);
      const nextIndex = Math.min(current.index + 1, maxIndex);

      if (nextIndex === current.index) return prev;

      return {
        ...prev,
        [columnId]: {
          ...current,
          index: nextIndex
        }
      };
    });
  }, []);

  const loadingColumns = useMemo(
    () =>
      CAROUSEL_COLUMNS.filter((column) => column.mode === "data").filter(
        (column) => columnStates[column.id]?.loading
      ).length,
    [columnStates]
  );

  if (!organizationId && !organizationLoading && !needsOrganizationChoice) {
    return (
      <Card className="border-red-500/40 bg-red-950/40 text-sm text-red-200">
        {organizationError ?? "Nenhuma organização ativa encontrada para carregar os carrosséis."}
      </Card>
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      <Card className="space-y-4 border-zinc-800/90 bg-zinc-950/70">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Carrosséis</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Vitrines por categoria</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Cada seção carrega dados reais.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <span className="rounded-full border border-zinc-700 px-3 py-1">
              {loadingColumns > 0 ? `Atualizando ${loadingColumns} categoria(s)...` : "Atualizado"}
            </span>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRefreshTick((prev) => prev + 1)}
            >
              <RefreshCcw className="mr-2 h-4 w-4" />
              Recarregar
            </Button>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        {CAROUSEL_COLUMNS.map((column) => {
          const state = columnStates[column.id] ?? createInitialState()[column.id];

          return (
            <RowCarousel
              key={column.id}
              title={column.title}
              subtitle={column.subtitle}
              total={state.items.length}
              items={state.items}
              index={state.index}
              visibleCount={column.visibleCount}
              loading={state.loading}
              error={state.error}
              emptyMessage={column.emptyMessage}
              placeholderMessage={column.mode === "placeholder" ? column.emptyMessage : undefined}
              onPrevious={() => handlePrevious(column.id)}
              onNext={() => handleNext(column.id, column.visibleCount)}
            />
          );
        })}
      </div>

      <Card className="border-zinc-800/90 bg-zinc-950/70 text-xs text-zinc-500">
        <p>
          Organização ativa: {organizationContext?.organization.name ?? "—"}. Critérios de fácil de vender:
          {` ${EASY_SELL_RULES.minBedrooms}+ quartos, ${new Intl.NumberFormat("pt-BR", {
            style: "currency",
            currency: "BRL",
            maximumFractionDigits: 0
          }).format(EASY_SELL_RULES.minPrice)} a ${new Intl.NumberFormat("pt-BR", {
            style: "currency",
            currency: "BRL",
            maximumFractionDigits: 0
          }).format(EASY_SELL_RULES.maxPrice)} e área ${EASY_SELL_RULES.minAreaM2}-${EASY_SELL_RULES.maxAreaM2}m² quando disponível.`}
        </p>
      </Card>
    </div>
  );
}
