"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type ListingsFilters = {
  maxDaysFresh: 7 | 15 | 30;
  neighborhood_normalized?: string;
  minPrice?: number;
  maxPrice?: number;
  minBedrooms?: number;
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
};

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}

export function useListings(
  initialFilters: ListingsFilters = { maxDaysFresh: 15 }
): UseListingsResult {
  const [filters, setFiltersState] = useState<ListingsFilters>({

    sort: "date_desc",
    ...initialFilters
  });
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Listing[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 12;

  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const debouncedFilters = useDebouncedValue(filters, 400);

  const setFilters = useCallback((next: Partial<ListingsFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...next }));
    setPage(0);
  }, []);

  useEffect(() => {
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
          "id, title, price, city, state, neighborhood, neighborhood_normalized, bedrooms, bathrooms, parking, area_m2, portal, first_seen_at, scraped_at, last_seen_at, main_image_url, url",
          { count: "exact" }
        )
        .gte("first_seen_at", cutoffDate)
        .range(page * pageSize, page * pageSize + pageSize - 1);

      const neighborhoodValue =
        debouncedFilters.neighborhood_normalized?.trim();
      if (neighborhoodValue) {
        const pattern = `%${neighborhoodValue}%`;
        query = query.or(
          `neighborhood_normalized.ilike.${pattern},neighborhood.ilike.${pattern}`
        );
      }

      if (debouncedFilters.portal) {
        query = query.eq("portal", debouncedFilters.portal);
      }

      if (typeof debouncedFilters.minPrice === "number") {
        query = query.gte("price", debouncedFilters.minPrice);
      }

      if (typeof debouncedFilters.maxPrice === "number") {
        query = query.lte("price", debouncedFilters.maxPrice);
      }

      if (typeof debouncedFilters.minBedrooms === "number") {
        query = query.gte("bedrooms", debouncedFilters.minBedrooms);
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
  }, [debouncedFilters, page, pageSize, supabase]);

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
    setPage
  };
}
