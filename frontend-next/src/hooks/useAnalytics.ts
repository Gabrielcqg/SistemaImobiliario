"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type AnalyticsFilters = {
  maxDaysFresh: 7 | 15 | 30;
  neighborhood_normalized?: string;
  portal?: string;
};

export type PortalStat = {
  portal: string;
  count: number;
  avgPrice: number | null;
  avgPricePerM2: number | null;
};

export type AnalyticsMetrics = {
  totalCount: number;
  avgPrice: number | null;
  avgPricePerM2: number | null;
  portalStats: PortalStat[];
};

export type UseAnalyticsResult = {
  filters: AnalyticsFilters;
  setFilters: (next: Partial<AnalyticsFilters>) => void;
  loading: boolean;
  error: string | null;
  metrics: AnalyticsMetrics;
};

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}

const emptyMetrics: AnalyticsMetrics = {
  totalCount: 0,
  avgPrice: null,
  avgPricePerM2: null,
  portalStats: []
};

type AnalyticsRpcResponse = {
  total_count: number | null;
  avg_price: number | null;
  avg_price_per_m2: number | null;
  portal_stats: PortalStat[] | null;
};

export function useAnalytics(
  initialFilters: AnalyticsFilters = { maxDaysFresh: 15 }
): UseAnalyticsResult {
  const [filters, setFiltersState] = useState<AnalyticsFilters>(initialFilters);
  const [metrics, setMetrics] = useState<AnalyticsMetrics>(emptyMetrics);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const debouncedFilters = useDebouncedValue(filters, 400);

  const setFilters = useCallback((next: Partial<AnalyticsFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...next }));
  }, []);

  useEffect(() => {
    let active = true;

    const fetchAnalytics = async () => {
      setLoading(true);
      setError(null);

      const neighborhoodValue =
        debouncedFilters.neighborhood_normalized?.trim() || null;

      const { data, error: rpcError } = await supabase.rpc(
        "rpc_listings_analytics",
        {
          p_max_days: debouncedFilters.maxDaysFresh,
          p_neighborhood: neighborhoodValue,
          p_portal: debouncedFilters.portal || null
        }
      );

      if (!active) return;

      if (rpcError) {
        setError(rpcError.message);
        setMetrics(emptyMetrics);
        setLoading(false);
        return;
      }

      const row = (data as AnalyticsRpcResponse[] | null)?.[0];
      const rawPortalStats = row?.portal_stats;
      let portalStats: PortalStat[] = [];

      if (Array.isArray(rawPortalStats)) {
        portalStats = rawPortalStats;
      } else if (typeof rawPortalStats === "string") {
        try {
          const parsed = JSON.parse(rawPortalStats);
          if (Array.isArray(parsed)) {
            portalStats = parsed;
          }
        } catch {
          portalStats = [];
        }
      }
      setMetrics({
        totalCount: row?.total_count ?? 0,
        avgPrice: row?.avg_price ?? null,
        avgPricePerM2: row?.avg_price_per_m2 ?? null,
        portalStats
      });
      setLoading(false);
    };

    fetchAnalytics();

    return () => {
      active = false;
    };
  }, [debouncedFilters, supabase]);

  return {
    filters,
    setFilters,
    loading,
    error,
    metrics
  };
}
