"use client";

import dynamic from "next/dynamic";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import SkeletonList from "@/components/ui/SkeletonList";
import NeighborhoodAutocomplete from "@/components/filters/NeighborhoodAutocomplete";
import PropertyCategoryMultiSelect from "@/components/filters/PropertyCategoryMultiSelect";
import { useListings, type Listing } from "@/hooks/useListings";
import { useOrganizationContext } from "@/lib/auth/useOrganizationContext";
import { formatThousandsBR, parseBRNumber } from "@/lib/format/numberInput";
import { normalizeText } from "@/lib/format/text";
import {
  buildUnifiedPropertySupabaseOrFilter,
  matchesUnifiedPropertyFilter,
  normalizeUnifiedPropertyCategories
} from "@/lib/listings/unifiedPropertyFilter";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const LazyRadarListingsGrid = dynamic(
  () => import("@/components/radar/RadarListingsGrid"),
  {
    ssr: false,
    loading: () => <SkeletonList />
  }
);

const dayOptions = [
  { label: "7 dias", value: 7 },
  { label: "15 dias", value: 15 },
  { label: "30 dias", value: 30 }
] as const;

const portals = ["vivareal", "zap", "quintoandar"] as const;
const portalLabels: Record<(typeof portals)[number], string> = {
  vivareal: "VivaReal",
  zap: "ZAP",
  quintoandar: "QuintoAndar"
};
const sortOptions = [
  { label: "Mais recentes", value: "date_desc" },
  { label: "Mais antigos", value: "date_asc" },
  { label: "Preco: menor -> maior", value: "price_asc" },
  { label: "Preco: maior -> menor", value: "price_desc" }
] as const;

const dealTypeOptions = [
  { label: "Venda", value: "venda" },
  { label: "Aluguel", value: "aluguel" }
] as const;

const portalBadges = ["vivareal", "zap", "quintoandar", "outros"] as const;
type PortalBadge = (typeof portalBadges)[number];

const portalFilterByBadge: Record<PortalBadge, string> = {
  vivareal: "vivareal",
  zap: "zap",
  quintoandar: "quintoandar",
  outros: ""
};
const portalBadgeLabel: Record<PortalBadge, string> = {
  vivareal: "VIVAREAL",
  zap: "ZAP",
  quintoandar: "QUINTOANDAR",
  outros: "TODOS"
};

type RadarListing = Listing & {
  latitude?: number | null;
  longitude?: number | null;
  scraped_at?: string | null;
  last_seen_at?: string | null;
};

type PortalActivity = {
  count: number;
  until: number;
};

type RadarEvent = {
  id: string;
  message: string;
  at: number;
};

const REALTIME_FLUSH_MS = 400;
const GENERAL_LIST_POLL_MS = 300000;
const AUTO_REFRESH_FEEDBACK_MS = 5000;

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}

const getListingFirstSeen = (listing: RadarListing) =>
  listing.first_seen_at ?? null;

const parseDateSafe = (value?: string | null): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getTimeSafe = (value?: string | null): number | null => {
  const date = parseDateSafe(value);
  return date ? date.getTime() : null;
};

const formatRelativeTime = (date: Date) => {
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
};

const parseMinFilter = (value?: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;

const parseNumberInput = (value: string) => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const matchesMinOrZero = (value: number | null | undefined, min?: number) => {
  const minValue = parseMinFilter(min);
  if (minValue === null) return true;
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  return value >= minValue;
};

const getListingComparablePrice = (
  listing: Pick<RadarListing, "price" | "total_cost">,
  dealType: "venda" | "aluguel"
) => (dealType === "aluguel" ? listing.total_cost : listing.price);

export default function BuscadorPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const {
    organizationId,
    loading: organizationLoading,
    needsOrganizationChoice,
    error: organizationError
  } = useOrganizationContext();
  const {
    data,
    loading,
    error,
    page,
    hasNextPage,
    filters,
    setFilters,
    setPage,
    pageSize,
    refetch
  } = useListings(
    { maxDaysFresh: 15 },
    {
      organizationId,
      organizationReady: !organizationLoading
    }
  );

  const [minPriceInput, setMinPriceInput] = useState("");
  const [maxPriceInput, setMaxPriceInput] = useState("");
  const [minRentInput, setMinRentInput] = useState("");
  const [maxRentInput, setMaxRentInput] = useState("");
  const [neighborhoodQuery, setNeighborhoodQuery] = useState("");

  const [displayListings, setDisplayListings] = useState<Listing[]>([]);
  const [radarListings, setRadarListings] = useState<RadarListing[]>([]);
  const [radarLoading, setRadarLoading] = useState(false);
  const [radarError, setRadarError] = useState<string | null>(null);
  const [portalActivity, setPortalActivity] = useState<
    Record<string, PortalActivity>
  >({});
  const [eventFeed, setEventFeed] = useState<RadarEvent[]>([]);
  const [realtimeHealthy, setRealtimeHealthy] = useState(true);
  const [radarEnabled, setRadarEnabled] = useState(true);
  const [autoRefreshFeedback, setAutoRefreshFeedback] = useState<string | null>(
    null
  );
  const [, setLastRadarSyncAt] = useState<number | null>(null);

  const filtersRef = useRef(filters);
  const pageRef = useRef(page);
  const listingsTopRef = useRef<HTMLDivElement | null>(null);
  const pendingPaginationScrollRef = useRef(false);
  const realtimeQueueRef = useRef<RadarListing[]>([]);
  const realtimeFlushRef = useRef<number | null>(null);
  const lastSignalTsRef = useRef<string | null>(null);
  const lastSignalIdRef = useRef<string | null>(null);
  const currentListingIdsRef = useRef<Set<string>>(new Set());
  const pendingGeneralRefreshIdsRef = useRef<Set<string> | null>(null);
  const autoRefreshFeedbackTimerRef = useRef<number | null>(null);

  const debouncedNeighborhood = useDebouncedValue(
    filters.neighborhood_normalized ?? "",
    400
  );
  const activeDealType = filters.dealType || "venda";
  const isRentalDealType = activeDealType === "aluguel";
  const priceFilterLabel = isRentalDealType ? "Custo total" : "Preco";
  const selectedUnifiedPropertyTypes = useMemo(
    () => normalizeUnifiedPropertyCategories(filters.propertyTypes),
    [filters.propertyTypes]
  );
  const isGeneralListMode = useMemo(() => {
    const neighborhoodFilter = (filters.neighborhood_normalized ?? "").trim();
    const portalFilter = (filters.portal ?? "").trim();
    const sortValue = filters.sort ?? "date_desc";
    return (
      filters.maxDaysFresh === 15 &&
      sortValue === "date_desc" &&
      !portalFilter &&
      !neighborhoodFilter &&
      typeof filters.minPrice !== "number" &&
      typeof filters.maxPrice !== "number" &&
      typeof filters.minRent !== "number" &&
      typeof filters.maxRent !== "number" &&
      typeof filters.minBedrooms !== "number" &&
      typeof filters.minBathrooms !== "number" &&
      typeof filters.minParking !== "number" &&
      typeof filters.minAreaM2 !== "number" &&
      typeof filters.maxAreaM2 !== "number" &&
      normalizeUnifiedPropertyCategories(filters.propertyTypes).length === 0 &&
      filters.dealType === "venda"
    );
  }, [
    filters.minAreaM2,
    filters.maxAreaM2,
    filters.minBathrooms,
    filters.minBedrooms,
    filters.minParking,
    filters.maxDaysFresh,
    filters.dealType,
    filters.maxPrice,
    filters.maxRent,
    filters.minPrice,
    filters.minRent,
    filters.neighborhood_normalized,
    filters.portal,
    filters.propertyTypes,
    filters.sort
  ]);

  const emptyState = !loading && displayListings.length === 0;
  const shouldShowListingsSkeleton = loading && displayListings.length === 0;

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  const scrollToListingsTop = useCallback(() => {
    const container = listingsTopRef.current;
    if (container) {
      container.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (!pendingPaginationScrollRef.current) return;
    if (loading) return;

    pendingPaginationScrollRef.current = false;
    const rafId = window.requestAnimationFrame(() => {
      scrollToListingsTop();
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [page, loading, displayListings.length, scrollToListingsTop]);

  useEffect(() => {
    if (radarEnabled) return;
    setEventFeed([]);
    setPortalActivity({});
    setRealtimeHealthy(true);
  }, [radarEnabled]);

  useEffect(() => {
    setMinPriceInput(
      typeof filters.minPrice === "number"
        ? formatThousandsBR(String(filters.minPrice))
        : ""
    );
  }, [filters.minPrice]);

  useEffect(() => {
    setMaxPriceInput(
      typeof filters.maxPrice === "number"
        ? formatThousandsBR(String(filters.maxPrice))
        : ""
    );
  }, [filters.maxPrice]);

  useEffect(() => {
    setMinRentInput(
      typeof filters.minRent === "number"
        ? formatThousandsBR(String(filters.minRent))
        : ""
    );
  }, [filters.minRent]);

  useEffect(() => {
    setMaxRentInput(
      typeof filters.maxRent === "number"
        ? formatThousandsBR(String(filters.maxRent))
        : ""
    );
  }, [filters.maxRent]);

  useEffect(() => {
    if (!filters.neighborhood_normalized) {
      setNeighborhoodQuery("");
    }
  }, [filters.neighborhood_normalized]);

  useEffect(() => {
    setDisplayListings(data);
  }, [data]);

  useEffect(() => {
    currentListingIdsRef.current = new Set(data.map((listing) => listing.id));
  }, [data]);

  const showAutoRefreshFeedback = useCallback((message: string) => {
    setAutoRefreshFeedback(message);
    if (autoRefreshFeedbackTimerRef.current !== null) {
      window.clearTimeout(autoRefreshFeedbackTimerRef.current);
    }
    autoRefreshFeedbackTimerRef.current = window.setTimeout(() => {
      setAutoRefreshFeedback(null);
      autoRefreshFeedbackTimerRef.current = null;
    }, AUTO_REFRESH_FEEDBACK_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (autoRefreshFeedbackTimerRef.current !== null) {
        window.clearTimeout(autoRefreshFeedbackTimerRef.current);
      }
    };
  }, []);

  const fetchLatestSignal = useCallback(async () => {
    if (!organizationId) {
      return { id: null, ts: null };
    }

    const createdSignal = await supabase
      .from("listings")
      .select("id, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!createdSignal.error) {
      const row = createdSignal.data as
        | { id?: string | null; created_at?: string | null }
        | null;
      return {
        id: row?.id ?? null,
        ts: row?.created_at ?? null
      };
    }

    const missingCreatedAt = /created_at|does not exist|PGRST204/i.test(
      createdSignal.error.message ?? ""
    );
    if (!missingCreatedAt) {
      if (process.env.NODE_ENV === "development") {
        console.error("[general-polling] latest signal error", createdSignal.error);
      }
      return { id: null, ts: null };
    }

    const firstSeenSignal = await supabase
      .from("listings")
      .select("id, first_seen_at")
      .order("first_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (firstSeenSignal.error) {
      if (process.env.NODE_ENV === "development") {
        console.error(
          "[general-polling] fallback first_seen_at signal error",
          firstSeenSignal.error
        );
      }
      return { id: null, ts: null };
    }

    const row = firstSeenSignal.data as
      | { id?: string | null; first_seen_at?: string | null }
      | null;

    return {
      id: row?.id ?? null,
      ts: row?.first_seen_at ?? null
    };
  }, [organizationId, supabase]);

  useEffect(() => {
    if (!organizationId) {
      pendingGeneralRefreshIdsRef.current = null;
      lastSignalTsRef.current = null;
      lastSignalIdRef.current = null;
      setAutoRefreshFeedback(null);
      return;
    }

    if (!isGeneralListMode) {
      pendingGeneralRefreshIdsRef.current = null;
      lastSignalTsRef.current = null;
      lastSignalIdRef.current = null;
      setAutoRefreshFeedback(null);
      return;
    }

    let stopped = false;
    let intervalId: number | null = null;

    const clearIntervalIfNeeded = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    const checkLatestSignal = async () => {
      if (stopped || document.visibilityState === "hidden") return;

      const latest = await fetchLatestSignal();
      if (stopped || !latest.id) return;

      const latestSignal = latest.ts ?? latest.id;
      const currentSignal = lastSignalTsRef.current ?? lastSignalIdRef.current;

      if (!latestSignal) return;

      if (!currentSignal) {
        lastSignalTsRef.current = latest.ts;
        lastSignalIdRef.current = latest.id;
        return;
      }

      if (currentSignal === latestSignal) return;

      lastSignalTsRef.current = latest.ts;
      lastSignalIdRef.current = latest.id;
      pendingGeneralRefreshIdsRef.current = new Set(currentListingIdsRef.current);
      refetch();
    };

    const startPolling = () => {
      if (intervalId !== null) return;
      intervalId = window.setInterval(() => {
        void checkLatestSignal();
      }, GENERAL_LIST_POLL_MS);
    };

    void checkLatestSignal();
    startPolling();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clearIntervalIfNeeded();
        return;
      }
      void checkLatestSignal();
      startPolling();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopped = true;
      clearIntervalIfNeeded();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchLatestSignal, isGeneralListMode, organizationId, refetch]);

  useEffect(() => {
    if (!pendingGeneralRefreshIdsRef.current) return;
    if (loading || error) return;

    const previousIds = pendingGeneralRefreshIdsRef.current;
    const currentIds = new Set(data.map((listing) => listing.id));
    let newCount = 0;

    currentIds.forEach((id) => {
      if (!previousIds.has(id)) {
        newCount += 1;
      }
    });

    pendingGeneralRefreshIdsRef.current = null;
    showAutoRefreshFeedback(
      newCount > 0 ? `+${newCount} novos imoveis` : "Nada novo"
    );
  }, [data, error, loading, showAutoRefreshFeedback]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setPortalActivity((prev) => {
        const next: Record<string, PortalActivity> = {};
        Object.entries(prev).forEach(([portal, activity]) => {
          if (activity.until > now) {
            next[portal] = activity;
          }
        });

        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(next);
        if (prevKeys.length !== nextKeys.length) {
          return next;
        }

        const changed = prevKeys.some((key) => {
          const prevActivity = prev[key];
          const nextActivity = next[key];
          if (!prevActivity || !nextActivity) return true;
          return (
            prevActivity.count !== nextActivity.count ||
            prevActivity.until !== nextActivity.until
          );
        });

        return changed ? next : prev;
      });
    }, 500);

    return () => clearInterval(interval);
  }, []);

  const fetchRadarData = useCallback(async () => {
    if (!organizationId) {
      setRadarListings([]);
      setRadarLoading(false);
      return;
    }

    if (!radarEnabled) {
      setRadarLoading(false);
      return;
    }

    setRadarLoading(true);
    setRadarError(null);

    const cutoffDate = new Date(
      Date.now() - filters.maxDaysFresh * 24 * 60 * 60 * 1000
    ).toISOString();

    const selectBase =
      "id, title, price, total_cost, condo_fee, iptu, city, state, neighborhood, neighborhood_normalized, bedrooms, bathrooms, parking, area_m2, deal_type, property_type, property_subtype, portal, published_at, first_seen_at, scraped_at, last_seen_at, main_image_url, url";
    const selectWithGeo = `${selectBase}, latitude, longitude`;

    const buildQuery = (select: string) => {
      const queryDealType = filters.dealType || "venda";
      const totalPriceColumn = queryDealType === "aluguel" ? "total_cost" : "price";
      let query = supabase
        .from("listings")
        .select(select)
        .eq("city", "Campinas")
        .eq("deal_type", queryDealType)
        .gte("first_seen_at", cutoffDate)
        .order("first_seen_at", { ascending: false })
        .limit(240);

      if (filters.portal) {
        query = query.eq("portal", filters.portal);
      }

      if (debouncedNeighborhood) {
        query = query.like(
          "neighborhood_normalized",
          `${debouncedNeighborhood.trim()}%`
        );
      }

      const propertyFilterOr = buildUnifiedPropertySupabaseOrFilter(filters.propertyTypes);
      if (propertyFilterOr) {
        query = query.or(propertyFilterOr);
      }

      if (typeof filters.minPrice === "number") {
        query = query.gte(totalPriceColumn, filters.minPrice);
      }

      if (typeof filters.maxPrice === "number") {
        query = query.lte(totalPriceColumn, filters.maxPrice);
      }

      if (queryDealType === "aluguel") {
        if (typeof filters.minRent === "number") {
          query = query.gte("price", filters.minRent);
        }

        if (typeof filters.maxRent === "number") {
          query = query.lte("price", filters.maxRent);
        }
      }

      const minBedrooms = parseMinFilter(filters.minBedrooms);
      if (minBedrooms !== null) {
        query = query.gte("bedrooms", minBedrooms);
      }

      const minBathrooms = parseMinFilter(filters.minBathrooms);
      if (minBathrooms !== null) {
        query = query.gte("bathrooms", minBathrooms);
      }

      const minParking = parseMinFilter(filters.minParking);
      if (minParking !== null) {
        query = query.gte("parking", minParking);
      }

      const minAreaM2 = parseMinFilter(filters.minAreaM2);
      if (minAreaM2 !== null) {
        query = query.gte("area_m2", minAreaM2);
      }

      return query;
    };

    let { data: rows, error: queryError } = await buildQuery(selectWithGeo);

    if (
      queryError &&
      /column.*(latitude|longitude)/i.test(queryError.message)
    ) {
      const fallback = await buildQuery(selectBase);
      rows = fallback.data;
      queryError = fallback.error;
    }

    if (queryError) {
      setRadarError(queryError.message);
      setRadarListings([]);
      setRadarLoading(false);
      return;
    }

    const rawRows = Array.isArray(rows) ? (rows as unknown[]) : [];
    const list: RadarListing[] = rawRows.filter(
      (item): item is RadarListing =>
        !!item && typeof item === "object" && "id" in item
    );

    setRadarListings(list.slice(0, 300));
    setLastRadarSyncAt(Date.now());
    setRadarLoading(false);
  }, [
    supabase,
    filters.maxDaysFresh,
    filters.dealType,
    filters.portal,
    filters.propertyTypes,
    filters.minPrice,
    filters.maxPrice,
    filters.minRent,
    filters.maxRent,
    filters.minBedrooms,
    filters.minBathrooms,
    filters.minParking,
    filters.minAreaM2,
    debouncedNeighborhood,
    organizationId,
    radarEnabled
  ]);

  useEffect(() => {
    fetchRadarData();
  }, [fetchRadarData, radarEnabled]);

  useEffect(() => {
    if (!organizationId) {
      return;
    }

    if (!radarEnabled) {
      setRealtimeHealthy(true);
      return;
    }

    const flushQueue = () => {
      realtimeFlushRef.current = null;
      const queue = realtimeQueueRef.current.splice(0);
      if (queue.length === 0) return;

      const now = Date.now();
      const newEvents: RadarEvent[] = [];
      const portalCounts: Record<string, number> = {};

      queue.forEach((listing) => {
        const listingId = listing.id;
        const timestamp = getListingFirstSeen(listing);
        const timestampDate = parseDateSafe(timestamp);
        if (!timestampDate) return;

        const neighborhoodLabel =
          listing.neighborhood ||
          listing.neighborhood_normalized ||
          "Bairro desconhecido";

        newEvents.push({
          id: `${listingId}-${now}`,
          message: `Novo imovel em ${neighborhoodLabel} · ${formatRelativeTime(timestampDate)}`,
          at: now
        });

        const portalKey = portalBadges.includes(
          (listing.portal || "").toLowerCase() as PortalBadge
        )
          ? (listing.portal || "").toLowerCase()
          : "outros";

        portalCounts[portalKey] = (portalCounts[portalKey] ?? 0) + 1;
      });

      if (pageRef.current === 0) {
        setDisplayListings((prev) => {
          const next = [
            ...queue,
            ...prev.filter((item) => !queue.some((entry) => entry.id === item.id))
          ];
          return next.slice(0, pageSize);
        });
      }

      setRadarListings((prev) => {
        const next = [
          ...queue,
          ...prev.filter((item) => !queue.some((entry) => entry.id === item.id))
        ];
        return next.slice(0, 300);
      });
      setLastRadarSyncAt(Date.now());

      setPortalActivity((prev) => {
        const next = { ...prev };
        Object.entries(portalCounts).forEach(([portal, count]) => {
          const current = next[portal] ?? { count: 0, until: 0 };
          next[portal] = {
            count: current.count + count,
            until: Date.now() + 2400
          };
        });
        return next;
      });

      setEventFeed((prev) => {
        const merged = [...newEvents, ...prev];
        return merged.slice(0, 6);
      });
    };

    const channel = supabase
      .channel("radar-listings")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "listings",
          filter: "city=eq.Campinas"
        },
        (payload) => {
          const listing = payload.new as RadarListing;
          if (!listing) return;

          const currentFilters = filtersRef.current;
          const timestamp = getListingFirstSeen(listing);
          if (!timestamp) return;

          const timestampMs = getTimeSafe(timestamp);
          if (!timestampMs) return;

          const isWithinPeriod =
            timestampMs >=
            Date.now() - currentFilters.maxDaysFresh * 24 * 60 * 60 * 1000;

          if (!isWithinPeriod) return;

          if (currentFilters.portal && listing.portal !== currentFilters.portal) {
            return;
          }

          const currentDealType = currentFilters.dealType || "venda";
          if (listing.deal_type && listing.deal_type !== currentDealType) {
            return;
          }

          if (!matchesUnifiedPropertyFilter(listing, currentFilters.propertyTypes)) {
            return;
          }

          if (currentFilters.neighborhood_normalized) {
            const pattern = currentFilters.neighborhood_normalized
              .trim()
              .toLowerCase();
            const candidate = listing.neighborhood_normalized
              ? listing.neighborhood_normalized.toLowerCase()
              : normalizeText(listing.neighborhood ?? "");
            if (!candidate.startsWith(pattern)) return;
          }

          const listingComparablePrice = getListingComparablePrice(
            listing,
            currentDealType
          );
          const listingRentPrice = listing.price;

          if (
            typeof currentFilters.minPrice === "number" &&
            typeof listingComparablePrice === "number" &&
            listingComparablePrice < currentFilters.minPrice
          ) {
            return;
          }

          if (
            typeof currentFilters.maxPrice === "number" &&
            typeof listingComparablePrice === "number" &&
            listingComparablePrice > currentFilters.maxPrice
          ) {
            return;
          }

          if (
            currentDealType === "aluguel" &&
            typeof currentFilters.minRent === "number" &&
            typeof listingRentPrice === "number" &&
            listingRentPrice < currentFilters.minRent
          ) {
            return;
          }

          if (
            currentDealType === "aluguel" &&
            typeof currentFilters.maxRent === "number" &&
            typeof listingRentPrice === "number" &&
            listingRentPrice > currentFilters.maxRent
          ) {
            return;
          }

          if (!matchesMinOrZero(listing.bedrooms, currentFilters.minBedrooms)) {
            return;
          }

          if (
            !matchesMinOrZero(listing.bathrooms, currentFilters.minBathrooms)
          ) {
            return;
          }

          if (!matchesMinOrZero(listing.parking, currentFilters.minParking)) {
            return;
          }

          if (!matchesMinOrZero(listing.area_m2, currentFilters.minAreaM2)) {
            return;
          }

          realtimeQueueRef.current.push(listing);
          if (realtimeFlushRef.current === null) {
            realtimeFlushRef.current = window.setTimeout(
              flushQueue,
              REALTIME_FLUSH_MS
            );
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setRealtimeHealthy(true);
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setRealtimeHealthy(false);
        }
      });

    return () => {
      channel.unsubscribe();
      if (realtimeFlushRef.current) {
        window.clearTimeout(realtimeFlushRef.current);
        realtimeFlushRef.current = null;
      }
      realtimeQueueRef.current = [];
    };
  }, [organizationId, pageSize, radarEnabled, supabase]);

  useEffect(() => {
    if (!radarEnabled) return;
    if (realtimeHealthy) return;

    const poll = setInterval(() => {
      fetchRadarData();
    }, 60000);

    return () => clearInterval(poll);
  }, [realtimeHealthy, fetchRadarData, radarEnabled]);

  const new2h = useMemo(() => {
    const now = Date.now();
    return radarListings.filter((listing) => {
      const timestamp = getListingFirstSeen(listing);
      const timestampMs = getTimeSafe(timestamp);
      return (
        typeof timestampMs === "number" &&
        now - timestampMs <= 2 * 60 * 60 * 1000
      );
    }).length;
  }, [radarListings]);

  const new24h = useMemo(() => {
    const now = Date.now();
    return radarListings.filter((listing) => {
      const timestamp = getListingFirstSeen(listing);
      const timestampMs = getTimeSafe(timestamp);
      return (
        typeof timestampMs === "number" &&
        now - timestampMs <= 24 * 60 * 60 * 1000
      );
    }).length;
  }, [radarListings]);

  const portalPresence = useMemo<Record<PortalBadge, boolean>>(() => {
    const presence: Record<PortalBadge, boolean> = {
      vivareal: false,
      zap: false,
      quintoandar: false,
      outros: false
    };

    radarListings.forEach((listing) => {
      const portal = (listing.portal || "").toLowerCase();
      if (
        portal === "vivareal" ||
        portal === "zap" ||
        portal === "quintoandar"
      ) {
        presence[portal] = true;
        return;
      }
      presence.outros = true;
    });

    return presence;
  }, [radarListings]);

  if (!organizationId && !organizationLoading && !needsOrganizationChoice) {
    return (
      <div className="space-y-6">
        <Card className="border-red-500/40 bg-red-500/10 text-sm text-red-200">
          {organizationError ??
            "Nao encontramos uma organizacao ativa para esta conta."}
        </Card>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="grid min-w-0 gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="space-y-4 p-5 sm:p-6">
          <div>
            <p className="text-[10px] uppercase tracking-[0.4em] text-zinc-500">
              Filtros
            </p>
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-zinc-800/90 bg-black/20 p-3.5">
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-400">
                  Dias frescos
                </label>
                <div className="grid grid-cols-3 gap-1 rounded-xl border border-zinc-800 bg-black/30 p-1">
                  {dayOptions.map((option) => {
                    const active = filters.maxDaysFresh === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() =>
                          setFilters({ maxDaysFresh: option.value as 7 | 15 | 30 })
                        }
                        className={`rounded-lg px-2 py-2 text-xs font-semibold transition ${active
                          ? "is-active-fixed bg-surface-lifted text-white shadow-[0_0_0_1px_rgba(255,255,255,0.06)]"
                          : "text-zinc-400 hover:bg-white/5 hover:text-white"
                          }`}
                        aria-pressed={active}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800/90 bg-black/20 p-3.5">
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-400">
                  Tipo de negocio
                </label>
                <div className="rounded-xl border border-zinc-800 bg-black/30 p-1">
                  <div className="grid grid-cols-2 gap-1">
                    {dealTypeOptions.map((option) => {
                      const active = (filters.dealType || "venda") === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() =>
                            setFilters({
                              dealType: option.value as "venda" | "aluguel"
                            })
                          }
                          className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${active
                            ? "is-active-fixed bg-surface-lifted text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
                            : "text-zinc-400 hover:bg-white/5 hover:text-white"
                            }`}
                          aria-pressed={active}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800/90 bg-black/20 p-3.5">
              <NeighborhoodAutocomplete
                label="Bairro"
                placeholder="Digite o bairro"
                city="Campinas"
                organizationId={organizationId}
                value={neighborhoodQuery}
                onChange={(nextValue) => {
                  setNeighborhoodQuery(nextValue);
                  setFilters({
                    neighborhood_normalized: normalizeText(nextValue)
                  });
                }}
                onSelect={(item) => {
                  setNeighborhoodQuery(item.name);
                  setFilters({
                    neighborhood_normalized: item.name_normalized
                  });
                }}
                onClear={() => {
                  setNeighborhoodQuery("");
                  setFilters({ neighborhood_normalized: "" });
                }}
              />
            </div>

            <div className="rounded-2xl border border-zinc-800/90 bg-black/20 p-4">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-zinc-400">Tipo de imóvel</p>
                <PropertyCategoryMultiSelect
                  value={selectedUnifiedPropertyTypes}
                  onChange={(next) => setFilters({ propertyTypes: next })}
                  placeholder="Tipo de imóvel"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800/90 bg-black/20 p-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="sort-filter"
                  className="text-xs font-medium text-zinc-400"
                >
                  Ordenar por
                </label>
                <select
                  id="sort-filter"
                  aria-label="Ordenar resultados"
                  value={filters.sort ?? "date_desc"}
                  onChange={(event) =>
                    setFilters({
                      sort: event.target.value as
                        | "date_desc"
                        | "date_asc"
                        | "price_asc"
                        | "price_desc"
                    })
                  }
                  className="w-full appearance-none rounded-xl px-3.5 py-2.5 text-sm text-zinc-100 accent-focus accent-control focus:outline-none"
                >
                  {sortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800/90 bg-black/20 p-4 space-y-3">
              <p className="text-xs font-medium text-zinc-400">
                {isRentalDealType ? "Valores de aluguel" : "Faixa de preco"}
              </p>

              {isRentalDealType ? (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="text-xs text-zinc-500">Aluguel minimo</label>
                      <Input
                        type="text"
                        placeholder="Aluguel minimo"
                        value={minRentInput}
                        onChange={(event) => {
                          const formatted = formatThousandsBR(event.target.value);
                          setMinRentInput(formatted);
                          const parsed = parseBRNumber(formatted);
                          setFilters({
                            minRent: parsed ?? undefined
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-zinc-500">Aluguel maximo</label>
                      <Input
                        type="text"
                        placeholder="Aluguel maximo"
                        value={maxRentInput}
                        onChange={(event) => {
                          const formatted = formatThousandsBR(event.target.value);
                          setMaxRentInput(formatted);
                          const parsed = parseBRNumber(formatted);
                          setFilters({
                            maxRent: parsed ?? undefined
                          });
                        }}
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="text-xs text-zinc-500">
                        Preco total minimo
                      </label>
                      <Input
                        type="text"
                        placeholder="Preco total minimo"
                        value={minPriceInput}
                        onChange={(event) => {
                          const formatted = formatThousandsBR(event.target.value);
                          setMinPriceInput(formatted);
                          const parsed = parseBRNumber(formatted);
                          setFilters({
                            minPrice: parsed ?? undefined
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-zinc-500">
                        Preco total maximo
                      </label>
                      <Input
                        type="text"
                        placeholder="Preco total maximo"
                        value={maxPriceInput}
                        onChange={(event) => {
                          const formatted = formatThousandsBR(event.target.value);
                          setMaxPriceInput(formatted);
                          const parsed = parseBRNumber(formatted);
                          setFilters({
                            maxPrice: parsed ?? undefined
                          });
                        }}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs text-zinc-500">Preco minimo</label>
                    <Input
                      type="text"
                      placeholder="Preco minimo"
                      value={minPriceInput}
                      onChange={(event) => {
                        const formatted = formatThousandsBR(event.target.value);
                        setMinPriceInput(formatted);
                        const parsed = parseBRNumber(formatted);
                        setFilters({
                          minPrice: parsed ?? undefined
                        });
                      }}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs text-zinc-500">Preco maximo</label>
                    <Input
                      type="text"
                      placeholder="Preco maximo"
                      value={maxPriceInput}
                      onChange={(event) => {
                        const formatted = formatThousandsBR(event.target.value);
                        setMaxPriceInput(formatted);
                        const parsed = parseBRNumber(formatted);
                        setFilters({
                          maxPrice: parsed ?? undefined
                        });
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-zinc-800/90 bg-black/20 p-4 space-y-4">
              <p className="text-xs font-medium text-zinc-400">Caracteristicas</p>

              <div className="grid gap-4">
                <div className="grid grid-cols-3 gap-x-3 gap-y-4">
                  <div className="grid content-start gap-2">
                    <label className="min-h-8 text-xs leading-4 text-zinc-500">
                      Quartos min.
                    </label>
                    <Input
                      className="h-10 px-3.5"
                      type="number"
                      min={0}
                      placeholder="Minimo"
                      value={filters.minBedrooms ?? ""}
                      onChange={(event) =>
                        setFilters({
                          minBedrooms: parseNumberInput(event.target.value)
                        })
                      }
                    />
                  </div>

                  <div className="grid content-start gap-2">
                    <label className="min-h-8 text-xs leading-4 text-zinc-500">
                      Banheiros min.
                    </label>
                    <Input
                      className="h-10 px-3.5"
                      type="number"
                      min={0}
                      placeholder="Minimo"
                      value={filters.minBathrooms ?? ""}
                      onChange={(event) =>
                        setFilters({
                          minBathrooms: parseNumberInput(event.target.value)
                        })
                      }
                    />
                  </div>

                  <div className="grid content-start gap-2">
                    <label className="min-h-8 text-xs leading-4 text-zinc-500">
                      Vagas min.
                    </label>
                    <Input
                      className="h-10 px-3.5"
                      type="number"
                      min={0}
                      placeholder="Minimo"
                      value={filters.minParking ?? ""}
                      onChange={(event) =>
                        setFilters({
                          minParking: parseNumberInput(event.target.value)
                        })
                      }
                    />
                  </div>
                </div>

                <div className="grid gap-x-3 gap-y-4 sm:grid-cols-2">
                  <div className="grid content-start gap-2">
                    <label className="text-xs leading-4 text-zinc-500">
                      Area minima (m2)
                    </label>
                    <Input
                      className="h-10 px-3.5"
                      type="number"
                      min={0}
                      placeholder="Area minima"
                      value={filters.minAreaM2 ?? ""}
                      onChange={(event) =>
                        setFilters({
                          minAreaM2: parseNumberInput(event.target.value)
                        })
                      }
                    />
                  </div>

                  <div className="grid content-start gap-2">
                    <label className="text-xs leading-4 text-zinc-500">
                      Area maxima (m2)
                    </label>
                    <Input
                      className="h-10 px-3.5"
                      type="number"
                      min={0}
                      placeholder="Area maxima"
                      value={filters.maxAreaM2 ?? ""}
                      onChange={(event) =>
                        setFilters({
                          maxAreaM2: parseNumberInput(event.target.value)
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            </div>

            <Button
              variant="ghost"
              className="h-9 w-full justify-center rounded-xl text-xs uppercase tracking-[0.25em]"
              onClick={() => {
                setNeighborhoodQuery("");
                setFilters({
                  maxDaysFresh: 15,
                  neighborhood_normalized: "",
                  minPrice: undefined,
                  maxPrice: undefined,
                  minRent: undefined,
                  maxRent: undefined,
                  minBedrooms: undefined,
                  minBathrooms: undefined,
                  minParking: undefined,
                  minAreaM2: undefined,
                  maxAreaM2: undefined,
                  propertyTypes: [],
                  dealType: "venda",
                  portal: "",
                  sort: "date_desc"
                });
              }}
            >
              Limpar filtros
            </Button>
          </div>
        </Card>

        <div className="min-w-0 space-y-6">
          <Card className="accent-surface px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 md:gap-3">
              <span className="accent-badge rounded-full px-3 py-1 text-xs text-zinc-100">
                Novos 2h: {new2h}
              </span>
              <span className="accent-badge rounded-full px-3 py-1 text-xs text-zinc-100">
                Novos 24h: {new24h}
              </span>

              <div className="flex basis-full flex-wrap items-center gap-2 sm:ml-auto sm:basis-auto">
                {portalBadges.map((portal) => {
                  const isActive = radarEnabled && portalPresence[portal];
                  const filterValue = portalFilterByBadge[portal];
                  const isSelected = (filters.portal ?? "") === filterValue;

                  return (
                    <button
                      key={portal}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => {
                        setFilters({ portal: filterValue });
                        setPage(0);
                      }}
                      className={`btn btn-sm btn-led-interaction rounded-full px-3 text-[10px] font-semibold uppercase tracking-[0.3em] border border-transparent ${isActive
                        ? "bg-surface-lifted text-white"
                        : "btn-ghost text-zinc-500 hover:text-zinc-300"
                        } ${isSelected ? "is-active-fixed bg-surface-lifted text-white" : ""
                        }`}
                    >
                      {portalBadgeLabel[portal]}
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>

          {radarError ? (
            <Card className="border-red-500/40 bg-red-500/10 text-sm text-red-200">
              {radarError}
            </Card>
          ) : null}

          {!realtimeHealthy ? (
            <Card className="border-yellow-500/40 bg-yellow-500/10 text-sm text-yellow-200">
              Realtime desativado. O radar continua com polling a cada 60 segundos.
            </Card>
          ) : null}

          {autoRefreshFeedback ? (
            <Card
              role="status"
              aria-live="polite"
              className="accent-alert text-sm"
            >
              {autoRefreshFeedback}
            </Card>
          ) : null}

          {error ? (
            <Card className="border-red-500/40 bg-red-500/10 text-red-200">
              {error}
            </Card>
          ) : null}

          <div ref={listingsTopRef} />

          {emptyState ? (
            <Card className="text-center">
              <p className="text-lg font-semibold">Sem resultados</p>
              <p className="mt-2 text-sm text-zinc-400">
                Ajuste os filtros ou aguarde novos listings entrarem.
              </p>
            </Card>
          ) : shouldShowListingsSkeleton ? (
            <SkeletonList />
          ) : (
            <div className="w-full min-w-0">
              <Suspense fallback={<SkeletonList />}>
                <LazyRadarListingsGrid listings={displayListings} />
              </Suspense>
            </div>
          )}

          <div className="flex items-center justify-between text-sm text-zinc-500">
            <span>Mostrando pagina {page + 1}</span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  pendingPaginationScrollRef.current = true;
                  setPage(Math.max(0, page - 1));
                }}
                disabled={page === 0 || loading}
              >
                Anterior
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  pendingPaginationScrollRef.current = true;
                  setPage(page + 1);
                }}
                disabled={!hasNextPage || loading}
              >
                Proxima
              </Button>
            </div>
          </div>
        </div>
      </div >
    </div >
  );
}
