"use client";

import { AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import ListingCard from "@/components/radar/ListingCard";
import RadarGlobe2D from "@/components/radar/RadarGlobe2D";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useListings, type Listing } from "@/hooks/useListings";
import { formatThousandsBR, parseBRNumber } from "@/lib/format/numberInput";

const dayOptions = [
  { label: "7 dias", value: 7 },
  { label: "15 dias", value: 15 },
  { label: "30 dias", value: 30 }
] as const;

const portals = ["", "vivareal", "zap", "imovelweb"] as const;
const sortOptions = [
  { label: "Mais recentes", value: "date_desc" },
  { label: "Mais antigos", value: "date_asc" },
  { label: "Preço: menor → maior", value: "price_asc" },
  { label: "Preço: maior → menor", value: "price_desc" }
] as const;

const portalBadges = ["vivareal", "zap", "imovelweb", "outros"] as const;

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

type PerfSnapshot = {
  fps: number;
  globeDrawMs: number;
  globeFrames: number;
  staticDrawMs: number;
  staticDraws: number;
  listUpdateMs: number;
  listUpdates: number;
  reactRenders: number;
  resizeEvents: number;
  realtimeEventsPerMin: number;
  realtimeEvents: number;
};

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

export default function BuscadorPage() {
  const isDev = process.env.NODE_ENV !== "production";
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const {
    data,
    loading,
    error,
    page,
    hasNextPage,
    filters,
    setFilters,
    setPage,
    totalCount,
    pageSize
  } = useListings({ maxDaysFresh: 15 });

  const [minPriceInput, setMinPriceInput] = useState("");
  const [maxPriceInput, setMaxPriceInput] = useState("");

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
  const [globeVisible, setGlobeVisible] = useState(true);
  const [perfSnapshot, setPerfSnapshot] = useState<PerfSnapshot | null>(null);
  const [debugFlags, setDebugFlags] = useState({
    disableGlobe: false,
    disableRealtime: false,
    disableCards: false,
    disableLandmask: false
  });

  const listingIdsRef = useRef<Set<string>>(new Set());
  const filtersRef = useRef(filters);
  const pageRef = useRef(page);
  const globeRef = useRef<HTMLDivElement | null>(null);
  const perfRef = useRef({
    frames: 0,
    drawMs: 0,
    staticDraws: 0,
    staticDrawMs: 0,
    listUpdates: 0,
    listUpdateMs: 0,
    resizeEvents: 0,
    realtimeEvents: 0,
    renders: 0,
    realtimeWindow: Array.from({ length: 60 }, () => 0),
    realtimeIndex: 0
  });
  const perfIntervalRef = useRef<number | null>(null);
  const realtimeQueueRef = useRef<RadarListing[]>([]);
  const realtimeFlushRef = useRef<number | null>(null);

  perfRef.current.renders += 1;

  const debouncedNeighborhood = useDebouncedValue(
    filters.neighborhood_normalized ?? "",
    400
  );

  const emptyState = !loading && displayListings.length === 0;

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    if (!globeRef.current || typeof IntersectionObserver === "undefined") {
      setGlobeVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setGlobeVisible(entry?.isIntersecting ?? true);
      },
      { threshold: 0.15 }
    );
    observer.observe(globeRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.log("[Buscador] radarEnabled:", radarEnabled);
    }
  }, [radarEnabled]);

  useEffect(() => {
    if (!isDev) return;
    if (perfIntervalRef.current !== null) return;
    perfIntervalRef.current = window.setInterval(() => {
      const perf = perfRef.current;
      const frames = perf.frames;
      const globeDrawMs = frames ? perf.drawMs / frames : 0;
      const staticDrawMs = perf.staticDraws
        ? perf.staticDrawMs / perf.staticDraws
        : 0;
      const realtimeWindow = perf.realtimeWindow;
      realtimeWindow[perf.realtimeIndex] = perf.realtimeEvents;
      perf.realtimeIndex = (perf.realtimeIndex + 1) % realtimeWindow.length;
      const realtimeEventsPerMin = realtimeWindow.reduce((sum, value) => sum + value, 0);
      const listUpdateMs = perf.listUpdates
        ? perf.listUpdateMs / perf.listUpdates
        : 0;

      const snapshot: PerfSnapshot = {
        fps: frames,
        globeDrawMs,
        globeFrames: frames,
        staticDrawMs,
        staticDraws: perf.staticDraws,
        listUpdateMs,
        listUpdates: perf.listUpdates,
        reactRenders: perf.renders,
        resizeEvents: perf.resizeEvents,
        realtimeEventsPerMin,
        realtimeEvents: perf.realtimeEvents
      };

      setPerfSnapshot(snapshot);
      console.log("[Perf]", snapshot);

      perf.frames = 0;
      perf.drawMs = 0;
      perf.staticDraws = 0;
      perf.staticDrawMs = 0;
      perf.listUpdates = 0;
      perf.listUpdateMs = 0;
      perf.resizeEvents = 0;
      perf.realtimeEvents = 0;
      perf.renders = 0;
    }, 1000);
    return () => {
      if (perfIntervalRef.current) window.clearInterval(perfIntervalRef.current);
      perfIntervalRef.current = null;
    };
  }, [isDev]);

  useEffect(() => {
    pageRef.current = page;
  }, [page]);

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
    if (debugFlags.disableCards) return;
    const start = performance.now();
    setDisplayListings(data);
    perfRef.current.listUpdates += 1;
    perfRef.current.listUpdateMs += performance.now() - start;
  }, [data, debugFlags.disableCards]);

  useEffect(() => {
    listingIdsRef.current = new Set(displayListings.map((item) => item.id));
  }, [displayListings]);

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
        return next;
      });
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const totalLabel = useMemo(() => {
    if (typeof totalCount !== "number") return "--";
    return totalCount.toString();
  }, [totalCount]);


  const fetchRadarData = useCallback(async () => {
    setRadarLoading(true);
    setRadarError(null);

    const cutoffDate = new Date(
      Date.now() - filters.maxDaysFresh * 24 * 60 * 60 * 1000
    ).toISOString();

    const selectBase =
      "id, title, price, city, neighborhood, neighborhood_normalized, portal, first_seen_at, scraped_at, last_seen_at, main_image_url, url";
    const selectWithGeo = `${selectBase}, latitude, longitude`;

    const buildQuery = (select: string) => {
      let query = supabase
        .from("listings")
        .select(select)
        .eq("city", "Campinas")
        .gte("first_seen_at", cutoffDate)
        .order("first_seen_at", { ascending: false })
        .limit(240);

      if (filters.portal) {
        query = query.eq("portal", filters.portal);
      }

      if (debouncedNeighborhood) {
        const pattern = `%${debouncedNeighborhood.trim()}%`;
        query = query.or(
          `neighborhood.ilike.${pattern},neighborhood_normalized.ilike.${pattern}`
        );
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
    const limited = list.slice(0, 300);
    setRadarListings(limited);
    setRadarLoading(false);

    console.info("[Radar] período selecionado:", filters.maxDaysFresh);
    console.info("[Radar] listings carregados:", limited.length);
  }, [supabase, filters.maxDaysFresh, filters.portal, debouncedNeighborhood]);

  useEffect(() => {
    fetchRadarData();
  }, [fetchRadarData, filters.maxDaysFresh]);

  useEffect(() => {
    if (debugFlags.disableRealtime) {
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
        const eventId = `${listingId}-${now}`;
        newEvents.push({
          id: eventId,
          message: `Novo imóvel em ${neighborhoodLabel} · ${formatRelativeTime(
            timestampDate
          )}`,
          at: now
        });

        const portalKey = portalBadges.includes(
          (listing.portal || "").toLowerCase() as (typeof portalBadges)[number]
        )
          ? (listing.portal || "").toLowerCase()
          : "outros";
        portalCounts[portalKey] = (portalCounts[portalKey] ?? 0) + 1;
      });

      if (!debugFlags.disableCards && pageRef.current === 0) {
        const start = performance.now();
        setDisplayListings((prev) => {
          const next = [
            ...queue,
            ...prev.filter((item) => !queue.some((entry) => entry.id === item.id))
          ];
          return next.slice(0, pageSize);
        });
        perfRef.current.listUpdates += 1;
        perfRef.current.listUpdateMs += performance.now() - start;
      }

      const radarStart = performance.now();
      setRadarListings((prev) => {
        const next = [
          ...queue,
          ...prev.filter((item) => !queue.some((entry) => entry.id === item.id))
        ];
        return next.slice(0, 300);
      });
      perfRef.current.listUpdates += 1;
      perfRef.current.listUpdateMs += performance.now() - radarStart;

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
        return merged.slice(0, 5);
      });

      console.info(
        "[Radar] realtime batch:",
        queue.map((listing) => ({
          portal: listing.portal,
          neighborhood: listing.neighborhood,
          first_seen_at: listing.first_seen_at
        }))
      );
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
          if (!timestamp) {
            console.warn("[Radar] listing sem first_seen_at (ignorado):", listing.id);
            return;
          }

          const timestampMs = getTimeSafe(timestamp);
          if (!timestampMs) {
            console.warn("[Radar] timestamp inválido (ignorado):", listing.id);
            return;
          }

          const isWithinPeriod =
            timestampMs >=
            Date.now() -
              currentFilters.maxDaysFresh * 24 * 60 * 60 * 1000;

          if (!isWithinPeriod) return;

          if (currentFilters.portal && listing.portal !== currentFilters.portal) {
            return;
          }

          if (currentFilters.neighborhood_normalized) {
            const pattern = currentFilters.neighborhood_normalized
              .trim()
              .toLowerCase();
            const candidate =
              listing.neighborhood_normalized?.toLowerCase() ||
              listing.neighborhood?.toLowerCase() ||
              "";
            if (!candidate.includes(pattern)) return;
          }

          if (
            typeof currentFilters.minPrice === "number" &&
            typeof listing.price === "number" &&
            listing.price < currentFilters.minPrice
          ) {
            return;
          }

          if (
            typeof currentFilters.maxPrice === "number" &&
            typeof listing.price === "number" &&
            listing.price > currentFilters.maxPrice
          ) {
            return;
          }

          if (
            typeof currentFilters.minBedrooms === "number" &&
            typeof listing.bedrooms === "number" &&
            listing.bedrooms < currentFilters.minBedrooms
          ) {
            return;
          }

          perfRef.current.realtimeEvents += 1;
          realtimeQueueRef.current.push(listing);
          if (realtimeFlushRef.current === null) {
            realtimeFlushRef.current = window.setTimeout(flushQueue, 300);
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setRealtimeHealthy(true);
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn(
            "Realtime não habilitado para listings. Habilite em Supabase Dashboard > Replication / Realtime."
          );
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
  }, [supabase, pageSize, debugFlags.disableRealtime, debugFlags.disableCards]);

  useEffect(() => {
    if (debugFlags.disableRealtime) return;
    if (realtimeHealthy) return;
    const poll = setInterval(() => {
      console.warn("[Radar] Polling fallback ativo.");
      fetchRadarData();
    }, 60000);
    return () => clearInterval(poll);
  }, [realtimeHealthy, fetchRadarData, debugFlags.disableRealtime]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.log("[Buscador] RadarGlobe2D props", {
        dimmed: true,
        className: "globe-card",
        listings: radarEnabled ? radarListings.length : 0
      });
    }
  }, [radarEnabled, radarListings.length]);

  const handleGlobeDraw = useCallback((ms: number) => {
    perfRef.current.frames += 1;
    perfRef.current.drawMs += ms;
  }, []);

  const handleGlobeStaticDraw = useCallback((ms: number) => {
    perfRef.current.staticDraws += 1;
    perfRef.current.staticDrawMs += ms;
  }, []);

  const handleGlobeResize = useCallback(() => {
    perfRef.current.resizeEvents += 1;
  }, []);

  // Globo 2D não depende de clusters; mantemos apenas o feedback textual.

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

  useEffect(() => {
    console.info("[Radar] cards carregados:", displayListings.length);
  }, [displayListings.length]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Radar</h2>
          <p className="text-sm text-zinc-400">
            Imóveis frescos detectados nos últimos dias.
          </p>
        </div>
        <div className="text-xs uppercase tracking-[0.35em] text-zinc-500">
          Total {totalLabel}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <Card className="space-y-6">
          <div>
            <p className="text-[10px] uppercase tracking-[0.4em] text-zinc-500">
              Filtros
            </p>
            <h3 className="mt-2 text-lg font-semibold">Ajuste o radar</h3>
          </div>

          <div className="space-y-2">
            <label className="text-xs text-zinc-500">Dias frescos</label>
            <div className="flex rounded-full border border-zinc-800 bg-black/60 p-1">
              {dayOptions.map((option) => {
                const active = filters.maxDaysFresh === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() =>
                      setFilters({ maxDaysFresh: option.value as 7 | 15 | 30 })
                    }
                    className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                      active
                        ? "bg-white text-black"
                        : "text-zinc-400 hover:text-white"
                    }`}
                    aria-pressed={active}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4">
            <div className="space-y-2">
              <label className="text-xs text-zinc-500">
                Bairro normalizado
              </label>
              <Input
                placeholder="ex: cambuí"
                value={filters.neighborhood_normalized ?? ""}
                onChange={(event) =>
                  setFilters({
                    neighborhood_normalized: event.target.value || ""
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-zinc-500">Portal</label>
              <select
                value={filters.portal ?? ""}
                onChange={(event) =>
                  setFilters({ portal: event.target.value || "" })
                }
                className="w-full rounded-lg border border-zinc-800 bg-black/60 px-4 py-2 text-sm text-white"
              >
                <option value="">Todos</option>
                {portals
                  .filter((portal) => portal)
                  .map((portal) => (
                    <option key={portal} value={portal}>
                      {portal}
                    </option>
                  ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-zinc-500">Ordenar por</label>
              <select
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
                className="w-full rounded-lg border border-zinc-800 bg-black/60 px-4 py-2 text-sm text-white"
              >
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs text-zinc-500">Preço mín.</label>
                <Input
                  type="text"
                  placeholder="100.000"
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
              <div className="space-y-2">
                <label className="text-xs text-zinc-500">Preço máx.</label>
                <Input
                  type="text"
                  placeholder="900.000"
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

            <div className="space-y-2">
              <label className="text-xs text-zinc-500">Quartos mín.</label>
              <Input
                type="number"
                placeholder="2"
                value={filters.minBedrooms ?? ""}
                onChange={(event) =>
                  setFilters({
                    minBedrooms: event.target.value
                      ? Number(event.target.value)
                      : undefined
                  })
                }
              />
            </div>
          </div>

          <Button
            variant="ghost"
            className="h-8 px-3 text-xs uppercase tracking-[0.3em]"
            onClick={() =>
              setFilters({
                maxDaysFresh: 15,
                neighborhood_normalized: "",
                minPrice: undefined,
                maxPrice: undefined,
                minBedrooms: undefined,
                portal: "",
                sort: "date_desc"
              })
            }
          >
            Limpar
          </Button>
        </Card>

        <div className="relative">
          <div className="relative z-20 space-y-6">
            <Card className="relative space-y-4 overflow-hidden bg-black/60 backdrop-blur-md">
              <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-start">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.4em] text-zinc-500">
                        Radar ativo
                      </p>
                      <h3 className="mt-2 text-lg font-semibold">
                        Campinas · {filters.maxDaysFresh} dias
                      </h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        className="h-8 px-3 text-xs uppercase tracking-[0.3em]"
                        onClick={() => setRadarEnabled((prev) => !prev)}
                      >
                        Radar: {radarEnabled ? "on" : "off"}
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                    <span className="rounded-full border border-zinc-800 bg-black/60 px-3 py-1">
                      Novos 2h: {new2h}
                    </span>
                    <span className="rounded-full border border-zinc-800 bg-black/60 px-3 py-1">
                      Novos 24h: {new24h}
                    </span>
                    {radarLoading ? (
                      <span className="text-zinc-500">Carregando radar...</span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {portalBadges.map((portal) => {
                      const active = portalActivity[portal];
                      const isGlowing = active && active.until > Date.now();
                      return (
                        <div
                          key={portal}
                          className={`flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.3em] ${
                            isGlowing
                              ? "border-white/60 bg-white/10 text-white shadow-[0_0_16px_rgba(255,255,255,0.4)] animate-pulse"
                              : "border-zinc-800 bg-black/60 text-zinc-400"
                          }`}
                        >
                          <span>{portal}</span>
                          {active?.count ? (
                            <span className="rounded-full border border-white/20 px-1.5 py-0.5 text-[9px] text-white/80">
                              +{active.count}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  {radarError ? (
                    <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                      {radarError}
                    </p>
                  ) : null}

                  <div className="space-y-1 text-xs text-zinc-500">
                    {eventFeed.length === 0 ? (
                      <span>Eventos em tempo real aparecerão aqui.</span>
                    ) : (
                      eventFeed.map((event) => (
                        <span key={event.id} className="block">
                          {event.message}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                <div
                  ref={globeRef}
                  className="relative h-[260px] overflow-hidden rounded-2xl border border-zinc-800 bg-black/70 md:h-[320px]"
                  style={{ touchAction: "none" }}
                >
                  {debugFlags.disableGlobe ? (
                    <div className="flex h-full items-center justify-center text-xs uppercase tracking-[0.3em] text-zinc-500">
                      Globo OFF (debug)
                    </div>
                  ) : (
                    <RadarGlobe2D
                      visible={globeVisible && radarEnabled}
                      useLandmask={!debugFlags.disableLandmask}
                      onDrawFrame={handleGlobeDraw}
                      onStaticDraw={handleGlobeStaticDraw}
                      onResize={handleGlobeResize}
                    />
                  )}
                </div>
              </div>
            </Card>

            {!debugFlags.disableRealtime && !realtimeHealthy ? (
              <Card className="border-yellow-500/40 bg-yellow-500/10 text-yellow-200 text-sm">
                Realtime desativado. Radar continua mostrando histórico via
                fetch; eventos ao vivo dependem de habilitar Realtime para
                public.listings (Database → Replication → Realtime).
              </Card>
            ) : null}

            {error ? (
              <Card className="border-red-500/40 bg-red-500/10 text-red-200">
                {error}
              </Card>
            ) : null}

            {debugFlags.disableCards ? (
              <Card className="text-center text-sm text-zinc-500">
                Lista de cards desligada (debug).
              </Card>
            ) : emptyState ? (
              <Card className="text-center">
                <p className="text-lg font-semibold">Sem resultados</p>
                <p className="mt-2 text-sm text-zinc-400">
                  Ajuste os filtros ou aguarde novos listings entrarem.
                </p>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <AnimatePresence mode="popLayout">
                  {displayListings.map((listing, index) => (
                    <ListingCard
                      key={listing.id ?? `${index}`}
                      listing={listing}
                      index={index}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}

            <div className="flex items-center justify-between text-sm text-zinc-500">
              <span>Mostrando página {page + 1}</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0 || loading}
                >
                  Anterior
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setPage(page + 1)}
                  disabled={!hasNextPage || loading}
                >
                  Próxima
                </Button>
              </div>
            </div>

            {isDev ? (
              <Card className="space-y-4 border-white/10 bg-black/50 text-xs text-zinc-400">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="text-[10px] uppercase tracking-[0.4em] text-zinc-500">
                    Perf overlay
                  </span>
                  <span>FPS: {perfSnapshot?.fps ?? "--"}</span>
                  <span>
                    Draw ms: {perfSnapshot ? perfSnapshot.globeDrawMs.toFixed(2) : "--"}
                  </span>
                  <span>
                    Static draw ms: {" "}
                    {perfSnapshot ? perfSnapshot.staticDrawMs.toFixed(2) : "--"}
                  </span>
                  <span>Static draws/s: {perfSnapshot?.staticDraws ?? "--"}</span>
                  <span>
                    List update ms: {" "}
                    {perfSnapshot ? perfSnapshot.listUpdateMs.toFixed(2) : "--"}
                  </span>
                  <span>List updates/s: {perfSnapshot?.listUpdates ?? "--"}</span>
                  <span>Renders/s: {perfSnapshot?.reactRenders ?? "--"}</span>
                  <span>Resize/s: {perfSnapshot?.resizeEvents ?? "--"}</span>
                  <span>
                    Realtime/min: {perfSnapshot?.realtimeEventsPerMin ?? "--"}
                  </span>
                  <span>
                    Realtime/s: {perfSnapshot?.realtimeEvents ?? "--"}
                  </span>
                </div>

                <div className="flex flex-wrap gap-3">
                  {(
                    [
                      ["disableGlobe", "Desligar globo"],
                      ["disableRealtime", "Desligar realtime"],
                      ["disableCards", "Desligar cards"],
                      ["disableLandmask", "Desligar landmask"]
                    ] as const
                  ).map(([key, label]) => (
                    <label
                      key={key}
                      className="flex items-center gap-2 rounded-full border border-zinc-800 px-3 py-1 text-[10px] uppercase tracking-[0.25em]"
                    >
                      <input
                        type="checkbox"
                        checked={debugFlags[key]}
                        onChange={(event) =>
                          setDebugFlags((prev) => ({
                            ...prev,
                            [key]: event.target.checked
                          }))
                        }
                        className="h-3 w-3 accent-white"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
