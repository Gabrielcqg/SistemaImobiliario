"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import NeighborhoodAutocomplete from "@/components/filters/NeighborhoodAutocomplete";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatThousandsBR, parseBRNumber } from "@/lib/format/numberInput";
import { normalizeText } from "@/lib/format/text";

type Client = {
  id: string;
  user_id: string;
  name: string;
  contact_info: { email?: string; phone?: string } | null;
  data_retorno?: string | null;
  descricao_contexto?: string | null;
  status_pipeline?: string | null;
  created_at?: string | null;
};

type ClientFilter = {
  id?: string;
  client_id: string;
  active: boolean;
  min_price: number | null;
  max_price: number | null;
  neighborhoods: string[];
  min_bedrooms: number | null;
  min_bathrooms?: number | null;
  min_parking?: number | null;
  min_area_m2?: number | null;
  max_days_fresh: number | null;
  property_types: string[];
};

type Listing = {
  id: string;
  title: string | null;
  price: number | null;
  neighborhood: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  area_m2: number | null;
  property_type: "apartment" | "house" | "other" | "land" | null;
  url: string | null;
  main_image_url: string | null;
};

type Match = {
  id: string;
  client_id: string;
  listing_id: string;
  seen: boolean;
  is_notified: boolean;
  created_at: string | null;
  listing?: Listing | null;
  _isRealtime?: boolean;
  _isNew?: boolean;
};

type ListingRuleFn = (
  listing?: Listing | null,
  override?: ClientFilter | null
) => boolean;

type ListingRules = {
  isWithinPriceRange: ListingRuleFn;
  isWithinListingRules: ListingRuleFn;
};

const LAST_VIEWED_KEY = "crm:lastViewedAtByClient";
const PIPELINE_STEPS = [
  { value: "novo_match", label: "Novo Match" },
  { value: "em_conversa", label: "Em Conversa" },
  { value: "visita_agendada", label: "Visita Agendada" },
  { value: "proposta", label: "Proposta" },
  { value: "fechado", label: "Fechado" }
] as const;
const PROPERTY_TYPE_OPTIONS = [
  { value: "apartment", label: "apartment" },
  { value: "house", label: "house" },
  { value: "other", label: "other" },
  { value: "land", label: "land" }
] as const;
type PropertyTypeValue = (typeof PROPERTY_TYPE_OPTIONS)[number]["value"];
const PROPERTY_TYPE_SET = new Set<PropertyTypeValue>(
  PROPERTY_TYPE_OPTIONS.map((option) => option.value)
);

const formatCurrency = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0
  }).format(value);
};

const parseDateSafe = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const toDateInputValue = (value?: string | null) => {
  const date = parseDateSafe(value);
  if (!date) return "";
  return date.toISOString().slice(0, 10);
};

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const toArray = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const toPropertyTypeValues = (value: string) => {
  const unique = new Set<PropertyTypeValue>();
  toArray(value).forEach((item) => {
    const candidate = item.toLowerCase() as PropertyTypeValue;
    if (PROPERTY_TYPE_SET.has(candidate)) {
      unique.add(candidate);
    }
  });
  return Array.from(unique);
};

const parseMinFilter = (value?: number | null) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;

const parseMinInput = (value: string) => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const passesMinOrZero = (
  listingValue: number | null | undefined,
  minValue: number | null
) => {
  if (minValue === null) return true;
  if (typeof listingValue !== "number" || !Number.isFinite(listingValue)) {
    return true;
  }
  return listingValue === 0 || listingValue >= minValue;
};

const isMissingColumnError = (errorMessage?: string) =>
  typeof errorMessage === "string" && /column .* does not exist/i.test(errorMessage);

const truncateWords = (value: string, maxWords: number) => {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return value.trim();
  return `${words.slice(0, maxWords).join(" ")}…`;
};

const loadLastViewedMap = () => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LAST_VIEWED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, string>;
    return {};
  } catch (error) {
    console.error("Erro ao ler lastViewedAt do localStorage:", error);
    return {};
  }
};

const saveLastViewedMap = (next: Record<string, string>) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_VIEWED_KEY, JSON.stringify(next));
  } catch (error) {
    console.error("Erro ao salvar lastViewedAt no localStorage:", error);
  }
};

export default function CrmPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [clientDraft, setClientDraft] = useState({
    name: "",
    email: "",
    phone: "",
    data_retorno: "",
    descricao_contexto: "",
    status_pipeline: PIPELINE_STEPS[0].value as string
  });
  const [isCreatingClient, setIsCreatingClient] = useState(false);
  const [clientSaving, setClientSaving] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  const [filterDraft, setFilterDraft] = useState({
    active: true,
    min_price: "",
    max_price: "",
    neighborhoods: "",
    min_bedrooms: "",
    min_bathrooms: "",
    min_parking: "",
    min_area_m2: "",
    max_days_fresh: "7",
    property_types: ""
  });
  const [neighborhoodInput, setNeighborhoodInput] = useState("");
  const [filterSaving, setFilterSaving] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [matchesError, setMatchesError] = useState<string | null>(null);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [clientAlerts, setClientAlerts] = useState<Record<string, number>>({});
  const [lastViewedAtByClient, setLastViewedAtByClient] = useState<
    Record<string, string>
  >({});

  const [matches, setMatches] = useState<Match[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [matchesPage, setMatchesPage] = useState(0);
  const [matchesHasMore, setMatchesHasMore] = useState(false);

  const [history, setHistory] = useState<Match[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(false);

  const [archived, setArchived] = useState<Match[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedPage, setArchivedPage] = useState(0);
  const [archivedHasMore, setArchivedHasMore] = useState(false);
  const [likedMatchIds, setLikedMatchIds] = useState<Record<string, boolean>>(
    {}
  );
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);

  const realtimeRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const queueRef = useRef<Match[]>([]);
  const queueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processingQueueRef = useRef(false);
  const lastViewedAtRef = useRef<Record<string, string>>({});
  const matchIdsRef = useRef<Set<string>>(new Set());
  const fetchClientsRef = useRef<(nextSelectedId?: string) => Promise<void>>(
    async () => {}
  );
  const fetchClientAlertsRef = useRef<() => Promise<void>>(async () => {});
  const fetchFilterRef = useRef<(clientId: string) => Promise<ClientFilter | null>>(
    async () => null
  );
  const fetchMatchesRef = useRef<
    (
      clientId: string,
      page: number,
      filterOverride?: ClientFilter | null
    ) => Promise<void>
  >(async () => {});
  const fetchHistoryRef = useRef<
    (
      clientId: string,
      page: number,
      filterOverride?: ClientFilter | null
    ) => Promise<void>
  >(async () => {});
  const fetchArchivedRef = useRef<
    (
      clientId: string,
      page: number,
      filterOverride?: ClientFilter | null
    ) => Promise<void>
  >(async () => {});
  const acknowledgeClientViewRef = useRef<(clientId: string) => void>(() => {});
  const listingRulesRef = useRef<ListingRules | null>(null);

  const selectedClient =
    clients.find((client) => client.id === selectedClientId) ?? null;
  const selectedNeighborhoods = useMemo(
    () => toArray(filterDraft.neighborhoods),
    [filterDraft.neighborhoods]
  );
  const selectedPropertyTypes = useMemo(
    () => toPropertyTypeValues(filterDraft.property_types),
    [filterDraft.property_types]
  );

  const setNeighborhoodList = (nextValues: string[]) => {
    setFilterDraft((prev) => ({
      ...prev,
      neighborhoods: nextValues.join(", ")
    }));
  };

  const addNeighborhood = (name: string) => {
    const normalizedName = normalizeText(name);
    if (!normalizedName) return;

    const exists = selectedNeighborhoods.some(
      (item) => normalizeText(item) === normalizedName
    );
    if (exists) return;

    setNeighborhoodList([...selectedNeighborhoods, name.trim()]);
  };

  const removeNeighborhood = (name: string) => {
    const normalizedName = normalizeText(name);
    setNeighborhoodList(
      selectedNeighborhoods.filter(
        (item) => normalizeText(item) !== normalizedName
      )
    );
  };

  const setPropertyTypeList = (nextValues: PropertyTypeValue[]) => {
    setFilterDraft((prev) => ({
      ...prev,
      property_types: nextValues.join(", ")
    }));
  };

  const togglePropertyType = (value: PropertyTypeValue) => {
    if (selectedPropertyTypes.includes(value)) {
      setPropertyTypeList(selectedPropertyTypes.filter((item) => item !== value));
      return;
    }
    setPropertyTypeList([...selectedPropertyTypes, value]);
  };

  const resetDraftFromClient = (client: Client | null) => {
    setClientDraft({
      name: client?.name ?? "",
      email: client?.contact_info?.email ?? "",
      phone: client?.contact_info?.phone ?? "",
      data_retorno: toDateInputValue(client?.data_retorno ?? null),
      descricao_contexto: client?.descricao_contexto ?? "",
      status_pipeline: client?.status_pipeline ?? PIPELINE_STEPS[0].value
    });
  };

  const getNeighborhood = (listing?: Listing | null) =>
    listing?.neighborhood ?? "Bairro não informado";

  const isAfterLastViewed = (createdAt: string | null, clientId: string) => {
    if (!createdAt) return false;
    const createdTs = new Date(createdAt).getTime();
    if (!Number.isFinite(createdTs)) return false;
    const lastViewed = lastViewedAtRef.current[clientId];
    if (!lastViewed) return true;
    const lastViewedTs = new Date(lastViewed).getTime();
    if (!Number.isFinite(lastViewedTs)) return true;
    return createdTs > lastViewedTs;
  };

  const getPriceRange = (override?: ClientFilter | null) => {
    const min =
      typeof override?.min_price === "number"
        ? override.min_price
        : parseBRNumber(filterDraft.min_price);
    const max =
      typeof override?.max_price === "number"
        ? override.max_price
        : parseBRNumber(filterDraft.max_price);
    return { min, max };
  };

  const getListingFilters = (override?: ClientFilter | null) => {
    const minBedrooms =
      typeof override?.min_bedrooms === "number"
        ? parseMinFilter(override.min_bedrooms)
        : parseMinInput(filterDraft.min_bedrooms);
    const minBathrooms =
      typeof override?.min_bathrooms === "number"
        ? parseMinFilter(override.min_bathrooms)
        : parseMinInput(filterDraft.min_bathrooms);
    const minParking =
      typeof override?.min_parking === "number"
        ? parseMinFilter(override.min_parking)
        : parseMinInput(filterDraft.min_parking);
    const minAreaM2 =
      typeof override?.min_area_m2 === "number"
        ? parseMinFilter(override.min_area_m2)
        : parseMinInput(filterDraft.min_area_m2);
    const propertyTypes = Array.isArray(override?.property_types)
      ? override.property_types.filter(
          (item): item is PropertyTypeValue =>
            PROPERTY_TYPE_SET.has(item as PropertyTypeValue)
        )
      : selectedPropertyTypes;

    return {
      minBedrooms,
      minBathrooms,
      minParking,
      minAreaM2,
      propertyTypes
    };
  };

  const isWithinPriceRange = (
    listing?: Listing | null,
    override?: ClientFilter | null
  ): boolean => {
    const { min, max } = getPriceRange(override);
    if (typeof min !== "number" || typeof max !== "number") return true;
    const price = listing?.price;
    if (typeof price !== "number") return false;
    return price >= min && price <= max;
  };

  const filterByPriceRange = (rows: Match[], override?: ClientFilter | null) => {
    const { min, max } = getPriceRange(override);
    if (typeof min !== "number" || typeof max !== "number") return rows;
    return rows.filter((row) => {
      const price = row.listing?.price;
      return typeof price === "number" && price >= min && price <= max;
    });
  };

  const isWithinListingRules = (
    listing?: Listing | null,
    override?: ClientFilter | null
  ): boolean => {
    if (!listing) return true;

    const { minBedrooms, minBathrooms, minParking, minAreaM2, propertyTypes } =
      getListingFilters(override);

    if (propertyTypes.length > 0) {
      const listingType = listing.property_type ?? "";
      if (!propertyTypes.includes(listingType as PropertyTypeValue)) {
        return false;
      }
    }

    const isLand = listing.property_type === "land";
    if (!isLand && !passesMinOrZero(listing.bedrooms, minBedrooms)) return false;
    if (!isLand && !passesMinOrZero(listing.bathrooms, minBathrooms)) return false;
    if (!isLand && !passesMinOrZero(listing.parking, minParking)) return false;
    if (!passesMinOrZero(listing.area_m2, minAreaM2)) return false;

    return true;
  };

  const filterMatchesByDraft = (rows: Match[], override?: ClientFilter | null) =>
    filterByPriceRange(rows, override).filter((row) =>
      isWithinListingRules(row.listing, override)
    );
  listingRulesRef.current = {
    isWithinPriceRange,
    isWithinListingRules
  };

  const updateClientAlert = (clientId: string, delta: number) => {
    setClientAlerts((prev) => {
      const next = { ...prev };
      const nextValue = (next[clientId] ?? 0) + delta;
      if (nextValue <= 0) {
        delete next[clientId];
      } else {
        next[clientId] = nextValue;
      }
      return next;
    });
  };

  const fetchClientAlerts = async () => {
    setAlertsError(null);
    const { data, error } = await supabase
      .from("automated_matches")
      .select("client_id")
      .eq("seen", false);

    if (error) {
      setAlertsError(error.message);
      console.error("Erro ao carregar alertas de matches:", error);
      return;
    }

    const counts: Record<string, number> = {};
    (data as { client_id: string }[] | null)?.forEach((row) => {
      counts[row.client_id] = (counts[row.client_id] ?? 0) + 1;
    });
    setClientAlerts(counts);
  };
  fetchClientAlertsRef.current = fetchClientAlerts;

  const acknowledgeClientView = (clientId: string) => {
    const now = new Date().toISOString();
    lastViewedAtRef.current = {
      ...lastViewedAtRef.current,
      [clientId]: now
    };
    setLastViewedAtByClient((prev) => {
      const next = { ...prev, [clientId]: now };
      saveLastViewedMap(next);
      return next;
    });
    setClientAlerts((prev) => {
      const next = { ...prev };
      delete next[clientId];
      return next;
    });
  };
  acknowledgeClientViewRef.current = acknowledgeClientView;

  const enrichMatchesWithListings = async (
    rows: Match[],
    context: string
  ) => {
    const missing = rows.filter((row) => !row.listing);
    if (missing.length === 0) return rows;

    console.warn(
      `[CRM] Listing null no join (${context}). Possível RLS em listings.`,
      missing.map((row) => row.listing_id)
    );

    const ids = Array.from(new Set(missing.map((row) => row.listing_id)));
    const { data, error } = await supabase
      .from("listings")
      .select(
        "id, title, price, neighborhood, bedrooms, bathrooms, parking, area_m2, property_type, url, main_image_url"
      )
      .in("id", ids);

    if (error) {
      setMatchesError(error.message);
      console.error("Erro ao buscar listings (fallback):", error);
      return rows;
    }

    const map = new Map(
      ((data as Listing[] | null) ?? []).map((listing) => [listing.id, listing])
    );

    return rows.map((row) => ({
      ...row,
      listing: row.listing ?? map.get(row.listing_id) ?? null
    }));
  };

  const enqueueMatch = (match: Match) => {
    queueRef.current.push(match);
    if (processingQueueRef.current) return;
    processingQueueRef.current = true;

    const process = () => {
      const next = queueRef.current.shift();
      if (!next) {
        processingQueueRef.current = false;
        return;
      }
      setMatches((prev) => {
        if (prev.some((item) => item.id === next.id)) {
          return prev;
        }
        return [{ ...next, _isRealtime: true, _isNew: true }, ...prev];
      });
      queueTimerRef.current = setTimeout(process, 500);
    };

    process();
  };

  const fetchClients = async (nextSelectedId?: string) => {
    setClientError(null);
    const { data, error } = await supabase
      .from("clients")
      .select(
        "id, user_id, name, contact_info, data_retorno, descricao_contexto, status_pipeline, created_at"
      );

    if (error) {
      setClientError(error.message);
      console.error("Erro ao buscar clients:", error);
      return;
    }

    const rows = (data as Client[]) ?? [];
    const today = new Date();
    const sorted = [...rows].sort((a, b) => {
      const dateA = parseDateSafe(a.data_retorno);
      const dateB = parseDateSafe(b.data_retorno);

      if (dateA && dateB) {
        const isPastA =
          isSameDay(dateA, today) || dateA.getTime() < today.getTime();
        const isPastB =
          isSameDay(dateB, today) || dateB.getTime() < today.getTime();
        if (isPastA !== isPastB) return isPastA ? -1 : 1;
        return dateA.getTime() - dateB.getTime();
      }
      if (dateA) return -1;
      if (dateB) return 1;
      return (b.created_at || "").localeCompare(a.created_at || "");
    });

    setClients(sorted);
    fetchClientAlerts();

    if (sorted.length === 0) {
      setIsCreatingClient(true);
      setSelectedClientId(null);
    }

    if (nextSelectedId) {
      setSelectedClientId(nextSelectedId);
      const found = sorted.find((client) => client.id === nextSelectedId) ?? null;
      resetDraftFromClient(found);
      return;
    }

    if (!selectedClientId && sorted.length > 0) {
      setSelectedClientId(sorted[0].id);
      resetDraftFromClient(sorted[0]);
    }
  };
  fetchClientsRef.current = fetchClients;

  const handlePipelineChange = async (nextStatus: string) => {
    if (!selectedClientId) {
      setClientDraft((prev) => ({ ...prev, status_pipeline: nextStatus }));
      return;
    }
    const { error } = await supabase
      .from("clients")
      .update({ status_pipeline: nextStatus })
      .eq("id", selectedClientId);

    if (error) {
      setClientError(error.message);
      console.error("Erro ao atualizar pipeline:", error);
      return;
    }

    setClientDraft((prev) => ({ ...prev, status_pipeline: nextStatus }));
    setClients((prev) =>
      prev.map((client) =>
        client.id === selectedClientId
          ? { ...client, status_pipeline: nextStatus }
          : client
      )
    );
  };

  const fetchFilter = async (clientId: string) => {
    setFilterError(null);
    const selectWithExtendedColumns =
      "id, client_id, active, min_price, max_price, neighborhoods, min_bedrooms, min_bathrooms, min_parking, min_area_m2, max_days_fresh, property_types";
    const selectBaseColumns =
      "id, client_id, active, min_price, max_price, neighborhoods, min_bedrooms, max_days_fresh, property_types";

    const primary = await supabase
      .from("client_filters")
      .select(selectWithExtendedColumns)
      .eq("client_id", clientId)
      .maybeSingle();
    let filterData = (primary.data as ClientFilter | null) ?? null;
    let filterError = primary.error;

    if (filterError && isMissingColumnError(filterError.message)) {
      const fallback = await supabase
        .from("client_filters")
        .select(selectBaseColumns)
        .eq("client_id", clientId)
        .maybeSingle();
      filterData = (fallback.data as ClientFilter | null) ?? null;
      filterError = fallback.error;
    }

    if (filterError) {
      setFilterError(filterError.message);
      return null;
    }

    const filter = filterData;

    setFilterDraft({
      active: filter?.active ?? true,
      min_price:
        typeof filter?.min_price === "number"
          ? formatThousandsBR(String(filter.min_price))
          : "",
      max_price:
        typeof filter?.max_price === "number"
          ? formatThousandsBR(String(filter.max_price))
          : "",
      neighborhoods: Array.isArray(filter?.neighborhoods)
        ? filter?.neighborhoods.join(", ")
        : "",
      min_bedrooms: filter?.min_bedrooms?.toString() ?? "",
      min_bathrooms: filter?.min_bathrooms?.toString() ?? "",
      min_parking: filter?.min_parking?.toString() ?? "",
      min_area_m2: filter?.min_area_m2?.toString() ?? "",
      max_days_fresh: filter?.max_days_fresh?.toString() ?? "7",
      property_types: Array.isArray(filter?.property_types)
        ? filter?.property_types
            .filter((item) => PROPERTY_TYPE_SET.has(item as PropertyTypeValue))
            .join(", ")
        : ""
    });
    setNeighborhoodInput("");

    return filter;
  };
  fetchFilterRef.current = fetchFilter;

  const fetchMatches = async (
    clientId: string,
    page: number,
    filterOverride?: ClientFilter | null
  ) => {
    setMatchesLoading(true);
    setMatchesError(null);
    const pageSize = 8;
    const { data, error } = await supabase
      .from("automated_matches")
      .select(
        "id, client_id, listing_id, seen, is_notified, created_at, listing:listing_id (id, title, price, neighborhood, bedrooms, bathrooms, parking, area_m2, property_type, url, main_image_url)"
      )
      .eq("client_id", clientId)
      .eq("seen", false)
      .order("created_at", { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1);

    if (error) {
      setMatchesError(error.message);
      console.error("Erro ao buscar matches:", error);
    } else {
      const rows = await enrichMatchesWithListings(
        ((data as unknown as Match[]) ?? []).map((row) => ({ ...row })),
        "pendentes"
      );
      const filtered = filterMatchesByDraft(rows, filterOverride);
      setMatches((prev) => (page === 0 ? filtered : [...prev, ...filtered]));
      setMatchesHasMore(filtered.length === pageSize);
    }

    setMatchesLoading(false);
  };
  fetchMatchesRef.current = fetchMatches;

  const fetchHistory = async (
    clientId: string,
    page: number,
    filterOverride?: ClientFilter | null
  ) => {
    setHistoryLoading(true);
    setMatchesError(null);
    const pageSize = 8;
    const { data, error } = await supabase
      .from("automated_matches")
      .select(
        "id, client_id, listing_id, seen, is_notified, created_at, listing:listing_id (id, title, price, neighborhood, bedrooms, bathrooms, parking, area_m2, property_type, url, main_image_url)"
      )
      .eq("client_id", clientId)
      .eq("seen", true)
      .eq("is_notified", true)
      .order("created_at", { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1);

    if (error) {
      setMatchesError(error.message);
      console.error("Erro ao buscar curadoria:", error);
    } else {
      const rows = await enrichMatchesWithListings(
        ((data as unknown as Match[]) ?? []).map((row) => ({ ...row })),
        "curadoria"
      );
      const filtered = filterMatchesByDraft(rows, filterOverride);
      setHistory((prev) => (page === 0 ? filtered : [...prev, ...filtered]));
      setHistoryHasMore(filtered.length === pageSize);
    }

    setHistoryLoading(false);
  };
  fetchHistoryRef.current = fetchHistory;

  const fetchArchived = async (
    clientId: string,
    page: number,
    filterOverride?: ClientFilter | null
  ) => {
    setArchivedLoading(true);
    setMatchesError(null);
    const pageSize = 8;
    const { data, error } = await supabase
      .from("automated_matches")
      .select(
        "id, client_id, listing_id, seen, is_notified, created_at, listing:listing_id (id, title, price, neighborhood, bedrooms, bathrooms, parking, area_m2, property_type, url, main_image_url)"
      )
      .eq("client_id", clientId)
      .eq("seen", true)
      .eq("is_notified", false)
      .order("created_at", { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1);

    if (error) {
      setMatchesError(error.message);
      console.error("Erro ao buscar arquivados:", error);
    } else {
      const rows = await enrichMatchesWithListings(
        ((data as unknown as Match[]) ?? []).map((row) => ({ ...row })),
        "arquivados"
      );
      const filtered = filterMatchesByDraft(rows, filterOverride);
      setArchived((prev) => (page === 0 ? filtered : [...prev, ...filtered]));
      setArchivedHasMore(filtered.length === pageSize);
    }

    setArchivedLoading(false);
  };
  fetchArchivedRef.current = fetchArchived;

  useEffect(() => {
    setLastViewedAtByClient(loadLastViewedMap());
  }, []);

  useEffect(() => {
    fetchClientsRef.current();
  }, []);

  useEffect(() => {
    lastViewedAtRef.current = lastViewedAtByClient;
    fetchClientAlertsRef.current();
  }, [lastViewedAtByClient]);

  useEffect(() => {
    matchIdsRef.current = new Set(
      [...matches, ...history, ...archived].map((match) => match.id)
    );
  }, [matches, history, archived]);

  useEffect(() => {
    if (!selectedClientId) return;
    setMatches([]);
    setMatchesPage(0);
    setHistory([]);
    setHistoryPage(0);
    setArchived([]);
    setArchivedPage(0);
    let cancelled = false;

    const loadClientData = async () => {
      const filter = await fetchFilterRef.current(selectedClientId);
      await Promise.all([
        fetchMatchesRef.current(selectedClientId, 0, filter),
        fetchHistoryRef.current(selectedClientId, 0, filter),
        fetchArchivedRef.current(selectedClientId, 0, filter)
      ]);
      if (!cancelled) {
        acknowledgeClientViewRef.current(selectedClientId);
      }
    };

    loadClientData();

    return () => {
      cancelled = true;
    };
  }, [selectedClientId]);

  useEffect(() => {
    if (!selectedClientId) return;

    realtimeRef.current?.unsubscribe();

    const channel = supabase
      .channel(`matches:${selectedClientId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "automated_matches",
          filter: `client_id=eq.${selectedClientId}`
        },
        async (payload) => {
          const newMatch = payload.new as Match;
          if (newMatch.seen) return;

          // Realtime payload não traz join, então fazemos fetch do listing.
          const { data: listing, error: listingError } = await supabase
            .from("listings")
            .select(
              "id, title, price, neighborhood, bedrooms, bathrooms, parking, area_m2, property_type, url, main_image_url"
            )
            .eq("id", newMatch.listing_id)
            .maybeSingle();

          if (listingError) {
            console.error("Erro ao buscar listing (realtime):", listingError);
          }

          const enriched: Match = {
            ...newMatch,
            listing: (listing as Listing | null) ?? null
          };

          const rules = listingRulesRef.current;
          if (!rules) return;

          if (
            !rules.isWithinPriceRange(enriched.listing) ||
            !rules.isWithinListingRules(enriched.listing)
          ) {
            return;
          }

          if (!enriched.listing) {
            console.warn(
              "[CRM] Listing null no realtime. Possível RLS em listings.",
              enriched.listing_id
            );
          }

          const isNewId = !matchIdsRef.current.has(enriched.id);

          enqueueMatch(enriched);
          if (isNewId) {
            updateClientAlert(enriched.client_id, 1);
          }
        }
      )
      .subscribe();

    realtimeRef.current = channel;

    return () => {
      if (queueTimerRef.current) {
        clearTimeout(queueTimerRef.current);
      }
      channel.unsubscribe();
    };
  }, [selectedClientId, supabase]);

  const handleSaveClient = async () => {
    setClientSaving(true);
    setClientError(null);
    const trimmedName = clientDraft.name.trim();

    if (!trimmedName) {
      setClientError("Nome é obrigatório.");
      setClientSaving(false);
      return;
    }

    if (isCreatingClient) {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser();

      if (userError || !user) {
        const message = userError?.message ?? "Usuário não autenticado.";
        setClientError(message);
        console.error("Erro ao obter usuário:", userError);
        setClientSaving(false);
        return;
      }

      const { data, error } = await supabase
        .from("clients")
        .insert({
          user_id: user.id,
          name: trimmedName,
          contact_info: {
            email: clientDraft.email?.trim() || null,
            phone: clientDraft.phone?.trim() || null
          },
          data_retorno: clientDraft.data_retorno || null,
          descricao_contexto: clientDraft.descricao_contexto || null,
          status_pipeline: clientDraft.status_pipeline || null
        })
        .select(
          "id, user_id, name, contact_info, data_retorno, descricao_contexto, status_pipeline, created_at"
        )
        .single();

      if (error) {
        setClientError(error.message);
        console.error("Erro ao criar client:", error);
        setClientSaving(false);
        return;
      }

      if (data) {
        setSelectedClientId((data as Client).id);
        setIsCreatingClient(false);
        await fetchClients((data as Client).id);
      }
    } else if (selectedClientId) {
      const { error } = await supabase
        .from("clients")
        .update({
          name: trimmedName,
          contact_info: {
            email: clientDraft.email?.trim() || null,
            phone: clientDraft.phone?.trim() || null
          },
          data_retorno: clientDraft.data_retorno || null,
          descricao_contexto: clientDraft.descricao_contexto || null,
          status_pipeline: clientDraft.status_pipeline || null
        })
        .eq("id", selectedClientId);

      if (error) {
        setClientError(error.message);
        console.error("Erro ao atualizar client:", error);
      } else {
        await fetchClients(selectedClientId);
      }
    } else {
      setClientError("Selecione um client para editar.");
    }

    setClientSaving(false);
  };

  const handleSaveFilters = async () => {
    if (!selectedClientId) return;
    setFilterSaving(true);
    setFilterError(null);

    const neighborhoods = selectedNeighborhoods;
    const propertyTypes = selectedPropertyTypes;
    const minBedrooms = parseMinInput(filterDraft.min_bedrooms);
    const minBathrooms = parseMinInput(filterDraft.min_bathrooms);
    const minParking = parseMinInput(filterDraft.min_parking);
    const minAreaM2 = parseMinInput(filterDraft.min_area_m2);

    const basePayload: ClientFilter = {
      client_id: selectedClientId,
      active: filterDraft.active,
      min_price: parseBRNumber(filterDraft.min_price),
      max_price: parseBRNumber(filterDraft.max_price),
      neighborhoods,
      min_bedrooms: minBedrooms,
      max_days_fresh: filterDraft.max_days_fresh
        ? Number(filterDraft.max_days_fresh)
        : null,
      property_types: propertyTypes
    };
    const extendedPayload: ClientFilter = {
      ...basePayload,
      min_bathrooms: minBathrooms,
      min_parking: minParking,
      min_area_m2: minAreaM2
    };

    let { error } = await supabase
      .from("client_filters")
      .upsert(extendedPayload, { onConflict: "client_id" });

    if (error && isMissingColumnError(error.message)) {
      const fallback = await supabase
        .from("client_filters")
        .upsert(basePayload, { onConflict: "client_id" });
      error = fallback.error;
    }

    if (error) {
      setFilterError(error.message);
    } else if (selectedClientId) {
      await Promise.all([
        fetchMatches(selectedClientId, 0),
        fetchHistory(selectedClientId, 0),
        fetchArchived(selectedClientId, 0)
      ]);
    }

    setFilterSaving(false);
  };

  const handleMatchAction = async (
    match: Match,
    action: "curate" | "archive" | "delete"
  ) => {
    setMatchesError(null);
    setMatches((prev) => prev.filter((item) => item.id !== match.id));

    if (action === "delete") {
      const { error } = await supabase
        .from("automated_matches")
        .delete()
        .eq("id", match.id);

      if (error) {
        setMatchesError(error.message);
        console.error("Erro ao excluir match:", error);
        setMatches((prev) => [match, ...prev]);
        return;
      }
    } else {
      const isNotified = action === "curate";
      const { error } = await supabase
        .from("automated_matches")
        .update({
          seen: true,
          is_notified: isNotified
        })
        .eq("id", match.id);

      if (error) {
        setMatchesError(error.message);
        console.error(`Erro ao atualizar match (${action}):`, error);
        setMatches((prev) => [match, ...prev]);
        return;
      }

      if (isNotified) {
        setHistory((prev) => [{ ...match, seen: true, is_notified: true }, ...prev]);
      } else {
        setArchived((prev) => [{ ...match, seen: true, is_notified: false }, ...prev]);
      }
    }

    updateClientAlert(match.client_id, -1);
    fetchClientAlerts();
  };

  const handleCuradoriaAction = async (
    match: Match,
    action: "archive" | "delete"
  ) => {
    setMatchesError(null);
    setHistory((prev) => prev.filter((item) => item.id !== match.id));

    if (action === "delete") {
      const { error } = await supabase
        .from("automated_matches")
        .delete()
        .eq("id", match.id);

      if (error) {
        setMatchesError(error.message);
        console.error("Erro ao excluir match:", error);
        setHistory((prev) => [match, ...prev]);
        return;
      }
    } else {
      const { error } = await supabase
        .from("automated_matches")
        .update({ seen: true, is_notified: false })
        .eq("id", match.id);

      if (error) {
        setMatchesError(error.message);
        console.error("Erro ao arquivar match:", error);
        setHistory((prev) => [match, ...prev]);
        return;
      }

      setArchived((prev) => [{ ...match, seen: true, is_notified: false }, ...prev]);
    }

    updateClientAlert(match.client_id, -1);
    fetchClientAlerts();
  };

  const handleSwipe = async (match: Match, direction: "left" | "right") => {
    await handleMatchAction(
      match,
      direction === "right" ? "curate" : "archive"
    );
  };

  const handleRemoveClient = async () => {
    if (!selectedClientId) return;
    const confirmDelete = window.confirm(
      "Tem certeza que deseja remover este client? Essa ação não pode ser desfeita."
    );
    if (!confirmDelete) return;
    const { error } = await supabase
      .from("clients")
      .delete()
      .eq("id", selectedClientId);

    if (error) {
      setClientError(error.message);
      console.error("Erro ao remover client:", error);
      return;
    }

    setSelectedClientId(null);
    setIsCreatingClient(false);
    await fetchClients();
  };

  const handleGenerateShare = async () => {
    if (!selectedClient) return;
    const links = history
      .map((match) => match.listing?.url)
      .filter((url): url is string => !!url);
    const message = `Olá, ${selectedClient.name}! Selecionei aqui os melhores imóveis para o seu perfil:\n${links.length ? links.join("\n") : "Sem links disponíveis no momento."}`;
    setShareMessage(message);

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(message);
        setShareFeedback("Mensagem copiada para a área de transferência.");
      } else {
        setShareFeedback("Copie manualmente a mensagem abaixo.");
      }
    } catch (error) {
      console.error("Erro ao copiar mensagem:", error);
      setShareFeedback("Não foi possível copiar automaticamente.");
    }
  };

  const topMatches = matches.slice(0, 3);
  const returnsTodayCount = useMemo(() => {
    const today = new Date();
    return clients.filter((client) => {
      const date = parseDateSafe(client.data_retorno);
      return date ? isSameDay(date, today) : false;
    }).length;
  }, [clients]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">CRM</h2>
          <p className="text-sm text-zinc-400">
            Gerencie clientes, filtros e matches em tempo real.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
              Clientes
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                setIsCreatingClient(true);
                setSelectedClientId(null);
                setClientError(null);
                setClientDraft({
                  name: "",
                  email: "",
                  phone: "",
                  data_retorno: "",
                  descricao_contexto: "",
                  status_pipeline: PIPELINE_STEPS[0].value
                });
              }}
            >
              Novo
            </Button>
          </div>
          {clientError ? (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {clientError}
            </p>
          ) : null}
          {alertsError ? (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {alertsError}
            </p>
          ) : null}
          <p className="text-xs text-zinc-400">
            Você tem{" "}
            <span className="text-white">{returnsTodayCount}</span> retornos
            previstos para hoje
          </p>
          <div className="space-y-2">
            {clients.length === 0 ? (
              <p className="text-sm text-zinc-500">Nenhum client ainda.</p>
            ) : (
              clients.map((client) => {
                const alertCount = clientAlerts[client.id] ?? 0;
                return (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => {
                      setIsCreatingClient(false);
                      setSelectedClientId(client.id);
                      resetDraftFromClient(client);
                    }}
                    className={`w-full rounded-lg border px-4 py-3 text-left text-sm transition ${selectedClientId === client.id && !isCreatingClient
                      ? "border-white bg-white text-black"
                      : "border-zinc-800 text-zinc-300 hover:bg-white/10"
                      }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold">{client.name}</p>
                        <p className="text-xs text-zinc-500">
                          {client.contact_info?.email ||
                            client.contact_info?.phone ||
                            "Sem contato"}
                        </p>
                      </div>
                      {alertCount > 0 ? (
                        <span className="relative flex h-2.5 w-2.5 items-center justify-center">
                          <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-white/50 shadow-[0_0_12px_rgba(255,255,255,0.6)]" />
                          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="space-y-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                {isCreatingClient ? "Novo client" : "Detalhes do client"}
              </p>
              <h3 className="mt-2 text-lg font-semibold">
                {isCreatingClient
                  ? "Cadastrar client"
                  : selectedClient?.name || "Selecione um client"}
              </h3>
            </div>

            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                Pipeline
              </p>
              <div className="flex flex-wrap gap-2">
                {PIPELINE_STEPS.map((step) => {
                  const active = clientDraft.status_pipeline === step.value;
                  return (
                    <button
                      key={step.value}
                      type="button"
                      onClick={() => handlePipelineChange(step.value)}
                      className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.3em] transition ${active
                        ? "border-white bg-white text-black"
                        : "border-zinc-800 text-zinc-400 hover:text-white"
                        }`}
                    >
                      {step.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <Input
                placeholder="Nome"
                value={clientDraft.name}
                onChange={(event) =>
                  setClientDraft((prev) => ({
                    ...prev,
                    name: event.target.value
                  }))
                }
              />
              <Input
                placeholder="Email"
                type="email"
                value={clientDraft.email}
                onChange={(event) =>
                  setClientDraft((prev) => ({
                    ...prev,
                    email: event.target.value
                  }))
                }
              />
              <Input
                placeholder="Telefone"
                value={clientDraft.phone}
                onChange={(event) =>
                  setClientDraft((prev) => ({
                    ...prev,
                    phone: event.target.value
                  }))
                }
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Input
                type="date"
                placeholder="Data retorno"
                value={clientDraft.data_retorno}
                onChange={(event) =>
                  setClientDraft((prev) => ({
                    ...prev,
                    data_retorno: event.target.value
                  }))
                }
              />
              <textarea
                placeholder="Descrição / contexto do cliente"
                value={clientDraft.descricao_contexto}
                onChange={(event) =>
                  setClientDraft((prev) => ({
                    ...prev,
                    descricao_contexto: event.target.value
                  }))
                }
                className="min-h-[44px] rounded-lg border border-zinc-800 bg-black/60 px-4 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-white/60 focus:outline-none"
              />
            </div>

            {clientError ? (
              <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {clientError}
              </p>
            ) : null}

            <div className="flex items-center gap-2">
              <Button
                onClick={handleSaveClient}
                disabled={clientSaving}
                variant="secondary"
              >
                {clientSaving ? "Salvando..." : "Salvar client"}
              </Button>
              {!isCreatingClient && selectedClient ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => resetDraftFromClient(selectedClient)}
                >
                  Descartar
                </Button>
              ) : null}
              {!isCreatingClient && selectedClient ? (
                <Button type="button" variant="ghost" onClick={handleRemoveClient}>
                  Remover Cliente
                </Button>
              ) : null}
            </div>
          </Card>

          {selectedClientId ? (
            <Card className="space-y-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                  Filtros
                </p>
                <h3 className="mt-2 text-lg font-semibold">Preferências</h3>
              </div>

              {filterError ? (
                <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {filterError}
                </p>
              ) : null}

              <div className="flex items-center gap-3 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={filterDraft.active}
                  onChange={(event) =>
                    setFilterDraft((prev) => ({
                      ...prev,
                      active: event.target.checked
                    }))
                  }
                />
                <span>Filtro ativo</span>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  type="text"
                  placeholder="Preço mín."
                  value={filterDraft.min_price}
                  onChange={(event) => {
                    const formatted = formatThousandsBR(event.target.value);
                    setFilterDraft((prev) => ({
                      ...prev,
                      min_price: formatted
                    }));
                  }}
                />
                <Input
                  type="text"
                  placeholder="Preço máx."
                  value={filterDraft.max_price}
                  onChange={(event) => {
                    const formatted = formatThousandsBR(event.target.value);
                    setFilterDraft((prev) => ({
                      ...prev,
                      max_price: formatted
                    }));
                  }}
                />
              </div>

              <div className="space-y-2">
                <NeighborhoodAutocomplete
                  label="Bairro"
                  placeholder="Digite para buscar bairros"
                  city="Campinas"
                  value={neighborhoodInput}
                  onChange={setNeighborhoodInput}
                  onSelect={(item) => {
                    addNeighborhood(item.name);
                    setNeighborhoodInput("");
                  }}
                  onClear={() => {
                    setNeighborhoodInput("");
                    setNeighborhoodList([]);
                  }}
                />

                {selectedNeighborhoods.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {selectedNeighborhoods.map((item) => (
                      <span
                        key={item}
                        className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-black/60 px-3 py-1 text-xs text-zinc-200"
                      >
                        {item}
                        <button
                          type="button"
                          onClick={() => removeNeighborhood(item)}
                          className="rounded-full p-0.5 text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                          aria-label={`Remover bairro ${item}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">
                    Nenhum bairro selecionado.
                  </p>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  type="number"
                  min={0}
                  placeholder="Quartos mín."
                  value={filterDraft.min_bedrooms}
                  onChange={(event) =>
                    setFilterDraft((prev) => ({
                      ...prev,
                      min_bedrooms: event.target.value
                    }))
                  }
                />
                <Input
                  type="number"
                  min={0}
                  placeholder="Banheiros mín."
                  value={filterDraft.min_bathrooms}
                  onChange={(event) =>
                    setFilterDraft((prev) => ({
                      ...prev,
                      min_bathrooms: event.target.value
                    }))
                  }
                />
                <Input
                  type="number"
                  min={0}
                  placeholder="Vagas mín."
                  value={filterDraft.min_parking}
                  onChange={(event) =>
                    setFilterDraft((prev) => ({
                      ...prev,
                      min_parking: event.target.value
                    }))
                  }
                />
                <Input
                  type="number"
                  min={0}
                  placeholder="Área mín. (m2)"
                  value={filterDraft.min_area_m2}
                  onChange={(event) =>
                    setFilterDraft((prev) => ({
                      ...prev,
                      min_area_m2: event.target.value
                    }))
                  }
                />
                <Input
                  type="number"
                  min={1}
                  placeholder="Dias frescos"
                  value={filterDraft.max_days_fresh}
                  onChange={(event) =>
                    setFilterDraft((prev) => ({
                      ...prev,
                      max_days_fresh: event.target.value
                    }))
                  }
                />
              </div>

              <div className="space-y-2">
                <p className="text-xs text-zinc-500">Tipo de imóvel</p>
                <div className="flex flex-wrap gap-2">
                  {PROPERTY_TYPE_OPTIONS.map((option) => {
                    const selected = selectedPropertyTypes.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => togglePropertyType(option.value)}
                        className={`rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                          selected
                            ? "border-zinc-200 bg-zinc-100 text-zinc-900"
                            : "border-zinc-700 bg-zinc-900/60 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <Button
                onClick={handleSaveFilters}
                disabled={filterSaving}
                variant="secondary"
              >
                {filterSaving ? "Salvando..." : "Salvar filtros"}
              </Button>
            </Card>
          ) : null}

          {selectedClientId ? (
            <Card className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                    Matches
                  </p>
                  <h3 className="mt-2 text-lg font-semibold">
                    Stack em tempo real
                  </h3>
                </div>
                <div className="text-xs text-zinc-500">
                  Swipe direita seleciona · esquerda arquiva
                </div>
              </div>

              <div className="relative h-[560px] overflow-hidden">
                <AnimatePresence>
                  {topMatches.map((match, index) => {
                    const listing = match.listing;
                    const title = listing?.title ?? "Listing indisponível";
                    const shortTitle = title
                      .trim()
                      .split(/\s+/)
                      .slice(0, 7)
                      .join(" ");
                    const offset = index === 0 ? 0 : 10 + (index - 1) * 8;
                    const scale = 1 - index * 0.02;
                    const isTop = index === 0;
                    const isNewLabel =
                      match._isNew ||
                      (selectedClientId
                        ? isAfterLastViewed(match.created_at, selectedClientId)
                        : false);

                    return (
                      <motion.div
                        key={match.id}
                        initial={
                          match._isRealtime
                            ? { opacity: 0, y: -20, scale: 0.98 }
                            : { opacity: 0, y: -30, scale: 0.98 }
                        }
                        animate={{ opacity: 1, y: offset, scale }}
                        exit={{ opacity: 0, y: 40, scale: 0.95 }}
                        transition={{ type: "spring", stiffness: 140, damping: 18 }}
                        drag={isTop ? "x" : false}
                        dragConstraints={{ left: 0, right: 0 }}
                        onDragEnd={(event, info) => {
                          if (!isTop) return;
                          if (info.offset.x > 120) {
                            handleSwipe(match, "right");
                          } else if (info.offset.x < -120) {
                            handleSwipe(match, "left");
                          }
                        }}
                        className={`absolute inset-0 rounded-2xl border border-zinc-800 bg-black/60 p-6 shadow-glow backdrop-blur-md overflow-hidden ${isTop ? "pointer-events-auto" : "pointer-events-none"
                          }`}
                        style={{ zIndex: 10 - index }}
                      >
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-white/5 to-transparent" />
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/80 to-transparent" />

                        <div className="relative flex h-full flex-col gap-4">
                          <div className="flex items-start justify-between gap-4 text-xs text-zinc-400">
                            <div className="space-y-1">
                              <span className="block text-sm text-white">
                                {getNeighborhood(listing)}
                              </span>
                              <span className="block text-[11px] text-zinc-500">
                                Match
                              </span>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              {isNewLabel ? (
                                <span className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-white">
                                  Novo
                                </span>
                              ) : null}
                              <span className="text-sm font-semibold text-white">
                                {formatCurrency(listing?.price ?? null)}
                              </span>
                            </div>
                          </div>

                          <div className="relative h-[280px] overflow-hidden rounded-xl border border-zinc-800 bg-black/50">
                            {listing?.main_image_url ? (
                              <Image
                                src={listing.main_image_url}
                                alt={title}
                                fill
                                sizes="(max-width: 768px) 100vw, (max-width: 1280px) 60vw, 40vw"
                                className="object-cover"
                              />
                            ) : (
                              <div className="flex h-full items-center justify-center text-xs uppercase tracking-[0.35em] text-zinc-600">
                                Listing indisponível
                              </div>
                            )}
                          </div>

                          <div className="space-y-2">
                            <h4
                              className="text-lg font-semibold leading-tight"
                              title={title}
                              style={{
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden"
                              }}
                            >
                              {shortTitle}
                              {title.split(/\s+/).length > 7 ? "…" : ""}
                            </h4>
                            <p
                              className="text-sm text-zinc-400"
                              style={{
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden"
                              }}
                            >
                              {getNeighborhood(listing)}
                            </p>
                            <div className="flex flex-wrap gap-2 text-xs text-zinc-400">
                              <span className="rounded-full border border-zinc-800 bg-black/60 px-3 py-1">
                                {listing?.bedrooms
                                  ? `${listing.bedrooms} quartos`
                                  : "Quartos n/d"}
                              </span>
                            </div>
                          </div>

                          <div
                            className="mt-auto space-y-3 text-xs text-zinc-500"
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="secondary"
                                onClick={() => handleMatchAction(match, "curate")}
                              >
                                Selecionar ✓
                              </Button>
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  handleMatchAction(match, "archive")
                                }
                              >
                                Arquivar 📁
                              </Button>
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  handleMatchAction(match, "delete")
                                }
                              >
                                Excluir 🗑
                              </Button>
                            </div>
                            <div className="flex items-center justify-between">
                              {listing?.url ? (
                                <a
                                  href={listing.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline underline-offset-4"
                                >
                                  Abrir anúncio
                                </a>
                              ) : (
                                <span>Sem link</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>

                {matchesLoading && matches.length === 0 ? (
                  <div className="absolute inset-0 rounded-2xl border border-zinc-800 bg-white/5 animate-pulse" />
                ) : null}

                {!matchesLoading && matches.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center rounded-2xl border border-dashed border-zinc-800 text-sm text-zinc-500">
                    Sem matches pendentes.
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-between text-sm text-zinc-500">
                <span>{matches.length} pendentes</span>
                <Button
                  variant="ghost"
                  disabled={!matchesHasMore || matchesLoading}
                  onClick={() => {
                    const nextPage = matchesPage + 1;
                    setMatchesPage(nextPage);
                    fetchMatches(selectedClientId, nextPage);
                  }}
                >
                  Carregar mais
                </Button>
              </div>
            </Card>
          ) : null}

          {selectedClientId ? (
            <Card className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                    Curadoria
                  </p>
                  <h3 className="mt-2 text-lg font-semibold">
                    Selecionados para o cliente
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    onClick={handleGenerateShare}
                    disabled={history.length === 0}
                  >
                    Gerar link de envio
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!historyHasMore || historyLoading}
                    onClick={() => {
                      const nextPage = historyPage + 1;
                      setHistoryPage(nextPage);
                      fetchHistory(selectedClientId, nextPage);
                    }}
                  >
                    Carregar mais
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                {matchesError ? (
                  <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                    {matchesError}
                  </p>
                ) : null}
                {historyLoading && history.length === 0 ? (
                  <div className="h-24 rounded-xl border border-zinc-800 bg-white/5 animate-pulse" />
                ) : null}
                {history.length === 0 && !historyLoading ? (
                  <p className="text-sm text-zinc-500">Nada na curadoria ainda.</p>
                ) : null}
                {history.map((match) => {
                  const historyTitle = truncateWords(
                    match.listing?.title || "Listing",
                    10
                  );
                  return (
                    <div
                      key={match.id}
                      className="flex items-center justify-between rounded-xl border border-zinc-800 bg-black/50 px-4 py-3"
                    >
                      <div>
                        <p
                          className="text-sm font-medium"
                          title={match.listing?.title || "Listing"}
                        >
                          {historyTitle}
                        </p>
                        <p className="text-xs text-zinc-500">
                          {getNeighborhood(match.listing)}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2 text-xs text-zinc-500">
                        <span>
                          {formatCurrency(match.listing?.price ?? null)}
                        </span>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            onClick={() =>
                              setLikedMatchIds((prev) => ({
                                ...prev,
                                [match.id]: !prev[match.id]
                              }))
                            }
                          >
                            {likedMatchIds[match.id] ? "♥" : "♡"}
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => handleCuradoriaAction(match, "archive")}
                          >
                            ✕
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => handlePipelineChange("visita_agendada")}
                          >
                            📅
                          </Button>
                        </div>
                        {match.listing?.url ? (
                          <a
                            href={match.listing.url}
                            target="_blank"
                            rel="noreferrer"
                            className="underline underline-offset-4"
                          >
                            Abrir anúncio
                          </a>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                {shareMessage ? (
                  <div className="rounded-xl border border-zinc-800 bg-black/60 p-3 text-xs text-zinc-300">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">
                      Mensagem para envio
                    </p>
                    <p className="mt-2 whitespace-pre-line">{shareMessage}</p>
                    {shareFeedback ? (
                      <p className="mt-2 text-[10px] text-zinc-500">
                        {shareFeedback}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </Card>
          ) : null}

          {selectedClientId ? (
            <Card className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                    Arquivados
                  </p>
                  <h3 className="mt-2 text-lg font-semibold">
                    Imóveis guardados
                  </h3>
                </div>
                <Button
                  variant="ghost"
                  disabled={!archivedHasMore || archivedLoading}
                  onClick={() => {
                    const nextPage = archivedPage + 1;
                    setArchivedPage(nextPage);
                    fetchArchived(selectedClientId, nextPage);
                  }}
                >
                  Carregar mais
                </Button>
              </div>

              <div className="space-y-3">
                {matchesError ? (
                  <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                    {matchesError}
                  </p>
                ) : null}
                {archivedLoading && archived.length === 0 ? (
                  <div className="h-24 rounded-xl border border-zinc-800 bg-white/5 animate-pulse" />
                ) : null}
                {archived.length === 0 && !archivedLoading ? (
                  <p className="text-sm text-zinc-500">
                    Nenhum imóvel arquivado.
                  </p>
                ) : null}
                {archived.map((match) => {
                  const archivedTitle = truncateWords(
                    match.listing?.title || "Listing",
                    10
                  );
                  return (
                    <div
                      key={match.id}
                      className="flex items-center justify-between rounded-xl border border-zinc-800 bg-black/50 px-4 py-3"
                    >
                      <div>
                        <p
                          className="text-sm font-medium"
                          title={match.listing?.title || "Listing"}
                        >
                          {archivedTitle}
                        </p>
                        <p className="text-xs text-zinc-500">
                          {getNeighborhood(match.listing)}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2 text-xs text-zinc-500">
                        <span>
                          {formatCurrency(match.listing?.price ?? null)}
                        </span>
                        {match.listing?.url ? (
                          <a
                            href={match.listing.url}
                            target="_blank"
                            rel="noreferrer"
                            className="underline underline-offset-4"
                          >
                            Abrir anúncio
                          </a>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
