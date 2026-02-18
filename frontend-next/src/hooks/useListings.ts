"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { normalizeText } from "@/lib/format/text";

export type ListingsFilters = {
  maxDaysFresh: 7 | 15 | 30;
  neighborhood_normalized?: string;
  minPrice?: number;
  maxPrice?: number;
  minBedrooms?: number;
  minBathrooms?: number;
  minParking?: number;
  minAreaM2?: number;
  propertyType?: "apartment" | "house" | "other" | "land";
  portal?: string;
  sort?: "date_desc" | "date_asc" | "price_asc" | "price_desc";
};

export type Listing = {
  id: string;
  title: string | null;
  price: number | null;
  city: string | null;
  state: string | null;
  neighborhood: string | null;
  neighborhood_normalized: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  area_m2: number | null;
  property_type: "apartment" | "house" | "other" | "land" | null;
  portal: string | null;
  first_seen_at: string | null;
  scraped_at?: string | null;
  last_seen_at?: string | null;
  main_image_url: string | null;
  url: string | null;
};

type UseListingsResult = {
  data: Listing[];
  loading: boolean;
  error: string | null;
  page: number;
  pageSize: number;
  totalCount: number | null;
  hasNextPage: boolean;
  filters: ListingsFilters;
  setFilters: (next: Partial<ListingsFilters>) => void;
  setPage: (next: number) => void;
  refetch: () => void;
};

type UseListingsOptions = {
  organizationId?: string | null;
  organizationReady?: boolean;
};

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}

const parseMinFilter = (value?: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;

export function useListings(
  initialFilters: ListingsFilters = { maxDaysFresh: 15 },
  options: UseListingsOptions = {}
): UseListingsResult {
  const { organizationId = null, organizationReady = true } = options;
  const [filters, setFiltersState] = useState<ListingsFilters>({

    sort: "date_desc",
    ...initialFilters
  });
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Listing[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const pageSize = 12;

  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const debouncedFilters = useDebouncedValue(filters, 400);

  const setFilters = useCallback((next: Partial<ListingsFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...next }));
    setPage(0);
  }, []);

  const refetch = useCallback(() => {
    setRefreshTick((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!organizationReady) {
      setLoading(true);
      setError(null);
      return;
    }

    if (!organizationId) {
      setLoading(false);
      setData([]);
      setTotalCount(0);
      setError("Nenhuma organizacao ativa foi encontrada para este usuario.");
      return;
    }

    let isActive = true;
    let timeoutId: number | null = null;

    const fetchListings = async () => {
      setLoading(true);
      setError(null);

      const cutoffDate = new Date(
        Date.now() - debouncedFilters.maxDaysFresh * 24 * 60 * 60 * 1000
      ).toISOString();

      let query = supabase
        .from("listings")
        .select(
          "id, title, price, city, state, neighborhood, neighborhood_normalized, bedrooms, bathrooms, parking, area_m2, property_type, portal, first_seen_at, scraped_at, last_seen_at, main_image_url, url",
          { count: "exact" }
        )
        .gte("first_seen_at", cutoffDate)
        .range(page * pageSize, page * pageSize + pageSize - 1);

      const neighborhoodValue = normalizeText(
        debouncedFilters.neighborhood_normalized ?? ""
      );
      if (neighborhoodValue) {
        query = query.like("neighborhood_normalized", `${neighborhoodValue}%`);
      }

      if (debouncedFilters.portal) {
        query = query.eq("portal", debouncedFilters.portal);
      }

      if (debouncedFilters.propertyType) {
        query = query.eq("property_type", debouncedFilters.propertyType);
      }

      if (typeof debouncedFilters.minPrice === "number") {
        query = query.gte("price", debouncedFilters.minPrice);
      }

      if (typeof debouncedFilters.maxPrice === "number") {
        query = query.lte("price", debouncedFilters.maxPrice);
      }

      const minBedrooms = parseMinFilter(debouncedFilters.minBedrooms);
      if (minBedrooms !== null) {
        // Regra temporaria: inclui dados zerados para nao perder anuncios.
        query = query.or(`bedrooms.gte.${minBedrooms},bedrooms.eq.0`);
      }

      const minBathrooms = parseMinFilter(debouncedFilters.minBathrooms);
      if (minBathrooms !== null) {
        query = query.or(`bathrooms.gte.${minBathrooms},bathrooms.eq.0`);
      }

      const minParking = parseMinFilter(debouncedFilters.minParking);
      if (minParking !== null) {
        query = query.or(`parking.gte.${minParking},parking.eq.0`);
      }

      const minAreaM2 = parseMinFilter(debouncedFilters.minAreaM2);
      if (minAreaM2 !== null) {
        query = query.or(`area_m2.gte.${minAreaM2},area_m2.eq.0`);
      }

      const sort = debouncedFilters.sort ?? "date_desc";
      if (sort === "date_desc") {
        query = query.order("first_seen_at", { ascending: false });
      } else if (sort === "date_asc") {
        query = query.order("first_seen_at", { ascending: true });
      } else if (sort === "price_asc") {
        query = query.order("price", { ascending: true, nullsFirst: false });
        query = query.order("first_seen_at", { ascending: false });
      } else if (sort === "price_desc") {
        query = query.order("price", { ascending: false, nullsFirst: false });
        query = query.order("first_seen_at", { ascending: false });
      }

      const { data: rows, error: queryError, count } = await query;

      if (!isActive) return;

      if (queryError) {
        setError(queryError.message);
        setData([]);
        setTotalCount(null);
      } else {
        setData((rows as Listing[]) ?? []);
        setTotalCount(count ?? null);
      }

      setLoading(false);
    };

    timeoutId = window.setTimeout(fetchListings, 0);

    return () => {
      isActive = false;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [
    debouncedFilters,
    organizationId,
    organizationReady,
    page,
    pageSize,
    supabase,
    refreshTick
  ]);

  const hasNextPage =
    totalCount !== null ? (page + 1) * pageSize < totalCount : false;

  return {
    data,
    loading,
    error,
    page,
    pageSize,
    totalCount,
    hasNextPage,
    filters,
    setFilters,
    setPage,
    refetch
  };
}
