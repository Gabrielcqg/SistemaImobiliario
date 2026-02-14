"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { normalizeText } from "@/lib/format/text";

export type NeighborhoodSuggestion = {
  id: string;
  name: string;
  name_normalized: string;
  city: string;
  state: string;
};

type NeighborhoodAutocompleteProps = {
  label: string;
  value: string;
  onChange: (next: string) => void;
  onSelect?: (item: NeighborhoodSuggestion) => void;
  onClear?: () => void;
  placeholder?: string;
  city?: string;
  disabled?: boolean;
  minChars?: number;
  debounceMs?: number;
  limit?: number;
};

const isDev = process.env.NODE_ENV === "development";
const clampLimit = (value: number) => Math.min(Math.max(value, 8), 12);

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

const devLog = (message: string, payload?: unknown) => {
  if (!isDev) return;
  if (payload === undefined) {
    console.info(`[NeighborhoodAutocomplete] ${message}`);
    return;
  }
  console.info(`[NeighborhoodAutocomplete] ${message}`, payload);
};

const devError = (message: string, payload?: unknown) => {
  if (!isDev) return;
  if (payload === undefined) {
    console.error(`[NeighborhoodAutocomplete] ${message}`);
    return;
  }
  console.error(`[NeighborhoodAutocomplete] ${message}`, payload);
};

const mapNeighborhoodRows = (
  rows: Array<{
    id?: string | null;
    name?: string | null;
    name_normalized?: string | null;
    city?: string | null;
    state?: string | null;
  }> | null,
  limit: number
): NeighborhoodSuggestion[] => {
  if (!rows) return [];

  const seen = new Set<string>();
  const items: NeighborhoodSuggestion[] = [];

  rows.forEach((row) => {
    const name = row.name?.trim();
    const nameNormalized = row.name_normalized?.trim();
    const city = (row.city ?? "Campinas").trim();
    const state = (row.state ?? "SP").trim().toUpperCase();

    if (!name || !nameNormalized) return;

    const key = `${nameNormalized}|${normalizeText(city)}|${normalizeText(state)}`;
    if (seen.has(key)) return;
    seen.add(key);

    items.push({
      id: row.id ?? key,
      name,
      name_normalized: nameNormalized,
      city,
      state
    });
  });

  return items.slice(0, limit);
};

const mapFallbackRows = (
  rows: Array<{
    neighborhood: string | null;
    neighborhood_normalized: string | null;
    city: string | null;
    state: string | null;
  }> | null,
  limit: number
): NeighborhoodSuggestion[] => {
  if (!rows) return [];

  const normalizedRows = rows.map((row) => ({
    id: null,
    name: row.neighborhood,
    name_normalized: row.neighborhood_normalized,
    city: row.city,
    state: row.state
  }));

  return mapNeighborhoodRows(normalizedRows, limit);
};

export default function NeighborhoodAutocomplete({
  label,
  value,
  onChange,
  onSelect,
  onClear,
  placeholder = "Digite o bairro",
  city,
  disabled,
  minChars = 2,
  debounceMs = 200,
  limit = 10
}: NeighborhoodAutocompleteProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const uid = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef(0);

  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<NeighborhoodSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);

  const debouncedValue = useDebouncedValue(value, debounceMs);
  const normalizedQuery = normalizeText(debouncedValue);
  const minLengthReached = normalizedQuery.length >= minChars;
  const cityFilter = city?.trim() || null;
  const hasValue = value.trim().length > 0;

  const listId = `${uid}-listbox`;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!minLengthReached || disabled) {
      setItems([]);
      setError(null);
      setLoading(false);
      setActiveIndex(-1);
      setIsOpen(false);
      return;
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const controller = new AbortController();
    const limitValue = clampLimit(limit);

    const fetchSuggestions = async () => {
      setLoading(true);
      setError(null);
      setIsOpen(true);

      const rpcPayload = {
        q: debouncedValue,
        p_city: cityFilter ?? null,
        p_limit: limitValue
      };

      devLog("query digitada", {
        raw: debouncedValue,
        normalized: normalizedQuery,
        minChars
      });
      devLog("payload rpc", rpcPayload);

      try {
        let suggestions: NeighborhoodSuggestion[] = [];

        const { data: rpcData, error: rpcError } = await supabase
          .rpc("search_neighborhoods", rpcPayload)
          .abortSignal(controller.signal);

        if (requestRef.current !== requestId) return;

        if (rpcError) {
          devError("rpc error", rpcError);
        } else if (Array.isArray(rpcData)) {
          suggestions = mapNeighborhoodRows(
            rpcData as Array<{
              id?: string | null;
              name?: string | null;
              name_normalized?: string | null;
              city?: string | null;
              state?: string | null;
            }>,
            limitValue
          );
          devLog("rpc resultados", { count: suggestions.length });
        }

        if (suggestions.length === 0) {
          let neighborhoodsQuery = supabase
            .from("neighborhoods")
            .select("id, name, name_normalized, city, state")
            .like("name_normalized", `${normalizedQuery}%`)
            .limit(limitValue)
            .abortSignal(controller.signal);

          if (cityFilter) {
            neighborhoodsQuery = neighborhoodsQuery.ilike("city", cityFilter);
          }

          const {
            data: neighborhoodsData,
            error: neighborhoodsError
          } = await neighborhoodsQuery;

          if (requestRef.current !== requestId) return;

          if (neighborhoodsError) {
            devError("fallback neighborhoods error", neighborhoodsError);
          } else {
            suggestions = mapNeighborhoodRows(
              neighborhoodsData as Array<{
                id?: string | null;
                name?: string | null;
                name_normalized?: string | null;
                city?: string | null;
                state?: string | null;
              }>,
              limitValue
            );
            devLog("fallback neighborhoods resultados", {
              count: suggestions.length
            });
          }
        }

        if (suggestions.length === 0) {
          let listingsQuery = supabase
            .from("listings")
            .select("neighborhood, neighborhood_normalized, city, state")
            .like("neighborhood_normalized", `${normalizedQuery}%`)
            .limit(limitValue * 3)
            .abortSignal(controller.signal);

          if (cityFilter) {
            listingsQuery = listingsQuery.ilike("city", cityFilter);
          }

          const { data: fallbackData, error: fallbackError } = await listingsQuery;

          if (requestRef.current !== requestId) return;

          if (fallbackError) {
            devError("fallback listings error", fallbackError);
            setError("Nao foi possivel carregar bairros.");
            setItems([]);
            setActiveIndex(-1);
            setLoading(false);
            return;
          }

          suggestions = mapFallbackRows(
            fallbackData as Array<{
              neighborhood: string | null;
              neighborhood_normalized: string | null;
              city: string | null;
              state: string | null;
            }>,
            limitValue
          );
          devLog("fallback listings resultados", { count: suggestions.length });
        }

        setItems(suggestions);
        setActiveIndex(suggestions.length > 0 ? 0 : -1);
        setError(null);
        setLoading(false);
      } catch (caughtError) {
        if (requestRef.current !== requestId) return;
        devError("unexpected autocomplete error", caughtError);
        setItems([]);
        setActiveIndex(-1);
        setError("Nao foi possivel carregar bairros.");
        setLoading(false);
      }
    };

    fetchSuggestions();

    return () => {
      controller.abort();
    };
  }, [
    cityFilter,
    debouncedValue,
    disabled,
    limit,
    minChars,
    minLengthReached,
    normalizedQuery,
    supabase
  ]);

  const selectItem = (item: NeighborhoodSuggestion) => {
    onChange(item.name);
    onSelect?.(item);
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || items.length === 0) {
      if (event.key === "ArrowDown" && minLengthReached) {
        setIsOpen(true);
      }
      if (event.key === "Escape") {
        setIsOpen(false);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, items.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      if (activeIndex >= 0 && activeIndex < items.length) {
        event.preventDefault();
        selectItem(items[activeIndex]);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative z-40 space-y-2">
      <label className="text-xs text-zinc-500">{label}</label>

      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">
          <svg
            aria-hidden="true"
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
        </span>

        <input
          type="text"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => {
            onChange(event.target.value);
            if (!isOpen && normalizeText(event.target.value).length >= minChars) {
              setIsOpen(true);
            }
          }}
          onFocus={() => {
            if (minLengthReached || loading || items.length > 0) {
              setIsOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 ? `${uid}-option-${activeIndex}` : undefined
          }
          className="w-full rounded-xl border border-zinc-800 bg-black/60 py-2.5 pl-10 pr-10 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-white/30"
        />

        {hasValue ? (
          <button
            type="button"
            onClick={() => {
              onChange("");
              onClear?.();
              setIsOpen(false);
              setItems([]);
              setError(null);
              setActiveIndex(-1);
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            aria-label="Limpar bairro"
          >
            <svg
              aria-hidden="true"
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        ) : null}

        {isOpen && (minLengthReached || loading || items.length > 0 || !!error) ? (
          <div
            id={listId}
            role="listbox"
            className="absolute z-[120] mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/95 shadow-[0_16px_40px_rgba(0,0,0,0.4)] backdrop-blur-md"
          >
            {loading ? (
              <div className="px-4 py-3 text-sm text-zinc-400">Carregando bairros...</div>
            ) : error ? (
              <div className="px-4 py-3 text-sm text-red-300">{error}</div>
            ) : items.length === 0 ? (
              <div className="px-4 py-3 text-sm text-zinc-400">Nenhum bairro encontrado.</div>
            ) : (
              <ul>
                {items.map((item, index) => {
                  const isActive = index === activeIndex;
                  return (
                    <li key={item.id}>
                      <button
                        id={`${uid}-option-${index}`}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        onMouseEnter={() => setActiveIndex(index)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectItem(item)}
                        className={`w-full border-b border-zinc-800/70 px-4 py-3 text-left transition last:border-b-0 ${
                          isActive ? "bg-white/10" : "hover:bg-white/5"
                        }`}
                      >
                        <p className="text-sm font-semibold text-white">{item.name}</p>
                        <p className="mt-0.5 text-xs text-zinc-400">
                          {item.name}, {item.city} - {item.state}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
