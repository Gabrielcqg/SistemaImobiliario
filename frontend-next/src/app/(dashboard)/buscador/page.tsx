"use client";

import dynamic from "next/dynamic";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import SkeletonList from "@/components/ui/SkeletonList";
import NeighborhoodAutocomplete from "@/components/filters/NeighborhoodAutocomplete";
import { useListings, type Listing } from "@/hooks/useListings";
import { formatThousandsBR, parseBRNumber } from "@/lib/format/numberInput";
import { normalizeText } from "@/lib/format/text";
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

const portals = ["", "vivareal", "zap", "imovelweb"] as const;
const sortOptions = [
  { label: "Mais recentes", value: "date_desc" },
  { label: "Mais antigos", value: "date_asc" },
  { label: "Preco: menor -> maior", value: "price_asc" },
  { label: "Preco: maior -> menor", value: "price_desc" }
] as const;

const portalBadges = ["vivareal", "zap", "imovelweb", "outros"] as const;
type PortalBadge = (typeof portalBadges)[number];

const portalFilterByBadge: Record<PortalBadge, string> = {
  vivareal: "vivareal",
  zap: "zap",
  imovelweb: "imovelweb",
  outros: ""
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
    pageSize
  } = useListings({ maxDaysFresh: 15 });

  const [minPriceInput, setMinPriceInput] = useState("");
  const [maxPriceInput, setMaxPriceInput] = useState("");
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
  const [lastRadarSyncAt, setLastRadarSyncAt] = useState<number | null>(null);

  const filtersRef = useRef(filters);
  const pageRef = useRef(page);
  const realtimeQueueRef = useRef<RadarListing[]>([]);
  const realtimeFlushRef = useRef<number | null>(null);

  const debouncedNeighborhood = useDebouncedValue(
    filters.neighborhood_normalized ?? "",
    400
  );

  const emptyState = !loading && displayListings.length === 0;
  const shouldShowListingsSkeleton = loading && displayListings.length === 0;

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    pageRef.current = page;
  }, [page]);

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
    if (!filters.neighborhood_normalized) {
      setNeighborhoodQuery("");
    }
  }, [filters.neighborhood_normalized]);

  useEffect(() => {
    setDisplayListings(data);
  }, [data]);

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
        query = query.like(
          "neighborhood_normalized",
          `${debouncedNeighborhood.trim()}%`
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

    setRadarListings(list.slice(0, 300));
    setLastRadarSyncAt(Date.now());
    setRadarLoading(false);
  }, [supabase, filters.maxDaysFresh, filters.portal, debouncedNeighborhood, radarEnabled]);

  useEffect(() => {
    fetchRadarData();
  }, [fetchRadarData, radarEnabled]);

  useEffect(() => {
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

          if (currentFilters.neighborhood_normalized) {
            const pattern = currentFilters.neighborhood_normalized
              .trim()
              .toLowerCase();
            const candidate = listing.neighborhood_normalized
              ? listing.neighborhood_normalized.toLowerCase()
              : normalizeText(listing.neighborhood ?? "");
            if (!candidate.startsWith(pattern)) return;
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
  }, [supabase, pageSize, radarEnabled]);

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
      imovelweb: false,
      outros: false
    };

    radarListings.forEach((listing) => {
      const portal = (listing.portal || "").toLowerCase();
      if (portal === "vivareal" || portal === "zap" || portal === "imovelweb") {
        presence[portal] = true;
        return;
      }
      presence.outros = true;
    });

    return presence;
  }, [radarListings]);

  const activePortalsCount = useMemo(
    () =>
      portalBadges.filter(
        (portal) => portal !== "imovelweb" && portalPresence[portal]
      ).length,
    [portalPresence]
  );

  const opportunities = useMemo(() => {
    const missingPrice = radarListings.filter(
      (listing) => typeof listing.price !== "number"
    ).length;
    const missingImage = radarListings.filter(
      (listing) => !listing.main_image_url
    ).length;
    const missingNeighborhood = radarListings.filter(
      (listing) => !listing.neighborhood && !listing.neighborhood_normalized
    ).length;

    return {
      missingPrice,
      missingImage,
      missingNeighborhood
    };
  }, [radarListings]);

  const recentListings = useMemo(() => radarListings.slice(0, 6), [radarListings]);

  const lastSyncLabel = useMemo(() => {
    if (!lastRadarSyncAt) return "Aguardando primeira sincronizacao";
    return `Atualizado ${formatRelativeTime(new Date(lastRadarSyncAt))}`;
  }, [lastRadarSyncAt]);

  return (
    <div className="space-y-6">
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
            <NeighborhoodAutocomplete
              label="Bairro"
              placeholder="Digite o bairro"
              city="Campinas"
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
                <label className="text-xs text-zinc-500">Preco min.</label>
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
                <label className="text-xs text-zinc-500">Preco max.</label>
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
              <label className="text-xs text-zinc-500">Quartos min.</label>
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
            onClick={() => {
              setNeighborhoodQuery("");
              setFilters({
                maxDaysFresh: 15,
                neighborhood_normalized: "",
                minPrice: undefined,
                maxPrice: undefined,
                minBedrooms: undefined,
                portal: "",
                sort: "date_desc"
              });
            }}
          >
            Limpar
          </Button>
        </Card>

        <div className="space-y-6">
          <Card className="bg-black/60 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 md:gap-3">
              <span className="rounded-full border border-zinc-700 bg-black/60 px-3 py-1 text-xs text-zinc-100">
                Novos 2h: {new2h}
              </span>
              <span className="rounded-full border border-zinc-700 bg-black/60 px-3 py-1 text-xs text-zinc-100">
                Novos 24h: {new24h}
              </span>

              <div className="flex basis-full flex-wrap items-center gap-2 sm:ml-auto sm:basis-auto">
                {portalBadges.map((portal) => {
                  const isImovelweb = portal === "imovelweb";
                  const isActive = !isImovelweb && radarEnabled && portalPresence[portal];
                  const filterValue = portalFilterByBadge[portal];
                  const isDisabled = isImovelweb;
                  const isSelected = (filters.portal ?? "") === filterValue;

                  return (
                    <button
                      key={portal}
                      type="button"
                      disabled={isDisabled}
                      aria-disabled={isDisabled}
                      aria-pressed={!isDisabled ? isSelected : undefined}
                      onClick={() => {
                        if (isDisabled) return;
                        setFilters({ portal: filterValue });
                        setPage(0);
                      }}
                      className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-1 focus-visible:ring-offset-black ${
                        isDisabled
                          ? "cursor-not-allowed border-zinc-800 bg-zinc-900/60 text-zinc-600"
                          : isActive
                          ? "border-emerald-500/70 bg-emerald-500/10 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.35)]"
                          : "border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                      } ${
                        isSelected && !isDisabled
                          ? "ring-1 ring-emerald-400/60"
                          : ""
                      }`}
                    >
                      {portal.toUpperCase()}
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          </div>

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

          {error ? (
            <Card className="border-red-500/40 bg-red-500/10 text-red-200">
              {error}
            </Card>
          ) : null}

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
            <Suspense fallback={<SkeletonList />}>
              <LazyRadarListingsGrid listings={displayListings} />
            </Suspense>
          )}

          <div className="flex items-center justify-between text-sm text-zinc-500">
            <span>Mostrando pagina {page + 1}</span>
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
                Proxima
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
