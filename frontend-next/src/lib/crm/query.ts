import { queryOptions } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeText } from "@/lib/format/text";
import {
  isTerrenoListing,
  matchesUnifiedPropertyFilter,
  normalizeUnifiedPropertyCategories
} from "@/lib/listings/unifiedPropertyFilter";

export type PipelineStatus =
  | "novo_match"
  | "contato_feito"
  | "em_conversa"
  | "aguardando_retorno"
  | "visita_agendada"
  | "proposta"
  | "fechado";

export type ClosedOutcome = "won" | "lost" | null;

export type LostReasonValue =
  | "preco"
  | "localizacao"
  | "documentacao"
  | "desistencia"
  | "cliente_sumiu"
  | "comprou_outro_imovel"
  | "condicoes_imovel"
  | "outro";

export type NextActionValue =
  | "ligar"
  | "whatsapp"
  | "enviar_informacoes"
  | "solicitar_documentos"
  | "agendar_visita"
  | "fazer_proposta"
  | "follow_up"
  | "outro";

export type Client = {
  id: string;
  org_id?: string | null;
  owner_user_id?: string | null;
  user_id: string;
  name: string;
  contact_info: { email?: string; phone?: string } | null;
  added_at?: string | null;
  data_retorno?: string | null;
  descricao_contexto?: string | null;
  status_pipeline?: PipelineStatus | string | null;
  closed_outcome?: ClosedOutcome;
  lost_reason?: LostReasonValue | string | null;
  lost_reason_detail?: string | null;
  next_action?: NextActionValue | string | null;
  next_action_at?: string | null;
  next_followup_at?: string | null;
  chase_due_at?: string | null;
  last_contact_at?: string | null;
  last_reply_at?: string | null;
  visit_at?: string | null;
  visit_notes?: string | null;
  proposal_value?: number | null;
  proposal_valid_until?: string | null;
  last_status_change_at?: string | null;
  created_at?: string | null;
};

export type ClientFilter = {
  id?: string;
  org_id?: string | null;
  client_id: string;
  active: boolean;
  min_price: number | null;
  max_price: number | null;
  min_rent?: number | null;
  max_rent?: number | null;
  neighborhoods: string[];
  min_bedrooms: number | null;
  min_bathrooms?: number | null;
  min_parking?: number | null;
  min_area_m2?: number | null;
  max_area_m2?: number | null;
  deal_type?: "venda" | "aluguel" | null;
  max_days_fresh: number | null;
  property_types: string[] | null;
};

export type Listing = {
  id: string;
  title: string | null;
  price: number | null;
  total_cost?: number | null;
  neighborhood: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  area_m2: number | null;
  deal_type: "venda" | "aluguel" | null;
  property_type: "apartment" | "house" | "other" | "land" | null;
  property_subtype?: string | null;
  url: string | null;
  main_image_url: string | null;
  published_at?: string | null;
  first_seen_at?: string | null;
};

export type Match = {
  id: string;
  org_id?: string | null;
  client_id: string;
  listing_id: string;
  seen: boolean;
  is_notified: boolean;
  created_at: string | null;
  listing?: Listing | null;
  _isRealtime?: boolean;
  _isNew?: boolean;
};

export type TimelinePayload = {
  note?: string | null;
  next_action?: NextActionValue | string | null;
  next_action_at?: string | null;
  next_followup_at?: string | null;
  chase_due_at?: string | null;
  last_contact_at?: string | null;
  last_reply_at?: string | null;
  visit_at?: string | null;
  visit_notes?: string | null;
  proposal_value?: number | null;
  proposal_valid_until?: string | null;
  closed_outcome?: ClosedOutcome;
  lost_reason?: LostReasonValue | string | null;
  lost_reason_detail?: string | null;
  final_value?: number | null;
  final_note?: string | null;
  source?: "pipeline" | "card";
};

export type CrmTimelineEvent = {
  id: string;
  org_id?: string | null;
  client_id: string;
  event_type: string;
  from_status: PipelineStatus | string | null;
  to_status: PipelineStatus | string | null;
  actor_user_id?: string | null;
  payload?: TimelinePayload | null;
  created_at: string | null;
};

export type CrmClientsBundle = {
  ownerUserId: string;
  clients: Client[];
  clientAlerts: Record<string, number>;
};

export type CrmClientBundle = {
  filter: ClientFilter | null;
  matches: Match[];
  matchesHasMore: boolean;
  history: Match[];
  historyHasMore: boolean;
  archived: Match[];
  archivedHasMore: boolean;
  timeline: CrmTimelineEvent[];
};

const MATCH_PAGE_SIZE = 6;

const parseDateSafe = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const parseMinFilter = (value?: number | null) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;

const parseFreshDays = (value: number | null | undefined) => {
  if (value === null || value === undefined) return null;
  if (value === 7 || value === 15 || value === 30) return value;
  return null;
};

const passesMinOrZero = (
  listingValue: number | null | undefined,
  minValue: number | null
) => {
  if (minValue === null) return true;
  if (typeof listingValue !== "number" || !Number.isFinite(listingValue)) return false;
  return listingValue >= minValue;
};

const passesMaxOrZero = (
  listingValue: number | null | undefined,
  maxValue: number | null
) => {
  if (maxValue === null) return true;
  if (typeof listingValue !== "number" || !Number.isFinite(listingValue)) return true;
  return listingValue === 0 || listingValue <= maxValue;
};

const isMissingColumnError = (errorMessage?: string) =>
  typeof errorMessage === "string" &&
  /(column .* does not exist|could not find the .* column .* schema cache|pgrst204)/i.test(
    errorMessage
  );

const resolveClientNextActionAt = (client?: Client | null) =>
  client?.next_action_at ?? client?.next_followup_at ?? client?.data_retorno ?? null;

const resolveClientReturnAnchor = (client?: Client | null) =>
  resolveClientNextActionAt(client) ?? client?.chase_due_at ?? null;

const sortClientsForCrm = (rows: Client[]) => {
  const today = new Date();
  return [...rows].sort((a, b) => {
    const dateA = parseDateSafe(resolveClientReturnAnchor(a));
    const dateB = parseDateSafe(resolveClientReturnAnchor(b));

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
};

const isWithinFreshWindow = (
  listing?: Listing | null,
  filter?: ClientFilter | null
) => {
  const maxDaysFresh = parseFreshDays(filter?.max_days_fresh);
  if (maxDaysFresh === null) return true;
  const referenceDate = listing?.published_at ?? listing?.first_seen_at;
  if (!referenceDate) return true;
  const ts = new Date(referenceDate).getTime();
  if (!Number.isFinite(ts)) return true;
  const cutoff = Date.now() - maxDaysFresh * 24 * 60 * 60 * 1000;
  return ts >= cutoff;
};

const getListingComparablePrice = (
  listing: Listing | null | undefined,
  dealType: "venda" | "aluguel"
) => (dealType === "aluguel" ? listing?.total_cost : listing?.price);

const getListingRentPrice = (listing: Listing | null | undefined) => listing?.price;

const isWithinPriceRange = (
  listing?: Listing | null,
  filter?: ClientFilter | null
) => {
  const min = parseMinFilter(filter?.min_price);
  const max = parseMinFilter(filter?.max_price);
  const dealType = filter?.deal_type ?? "venda";
  if (min !== null && max !== null) {
    const price = getListingComparablePrice(listing, dealType);
    if (typeof price !== "number" || price < min || price > max) return false;
  }

  if (dealType === "aluguel") {
    const minRent = parseMinFilter(filter?.min_rent);
    const maxRent = parseMinFilter(filter?.max_rent);
    if (minRent !== null && maxRent !== null) {
      const rentValue = getListingRentPrice(listing);
      if (
        typeof rentValue !== "number" ||
        rentValue < minRent ||
        rentValue > maxRent
      ) {
        return false;
      }
    }
  }

  return true;
};

const isWithinListingRules = (
  listing?: Listing | null,
  filter?: ClientFilter | null
) => {
  if (!listing || !filter) return true;

  const minBedrooms = parseMinFilter(filter.min_bedrooms);
  const minBathrooms = parseMinFilter(filter.min_bathrooms);
  const minParking = parseMinFilter(filter.min_parking);
  const minAreaM2 = parseMinFilter(filter.min_area_m2);
  const maxAreaM2 = parseMinFilter(filter.max_area_m2);
  const propertyTypes =
    Array.isArray(filter.property_types) && filter.property_types.length > 0
      ? normalizeUnifiedPropertyCategories(filter.property_types)
      : [];

  if (propertyTypes.length > 0 && !matchesUnifiedPropertyFilter(listing, propertyTypes)) {
    return false;
  }

  if (filter.deal_type && listing.deal_type && listing.deal_type !== filter.deal_type) return false;

  const isTerreno = isTerrenoListing(listing);
  if (!isTerreno && !passesMinOrZero(listing.bedrooms, minBedrooms)) return false;
  if (!isTerreno && !passesMinOrZero(listing.bathrooms, minBathrooms)) return false;
  if (!isTerreno && !passesMinOrZero(listing.parking, minParking)) return false;
  if (!passesMinOrZero(listing.area_m2, minAreaM2)) return false;
  if (!passesMaxOrZero(listing.area_m2, maxAreaM2)) return false;

  if (Array.isArray(filter.neighborhoods) && filter.neighborhoods.length > 0) {
    const normalizedListingNeighborhood = normalizeText(listing.neighborhood ?? "");
    if (
      normalizedListingNeighborhood &&
      !filter.neighborhoods.some(
        (value) => normalizeText(value) === normalizedListingNeighborhood
      )
    ) {
      return false;
    }
  }

  return true;
};

const filterMatchesByFilter = (rows: Match[], filter?: ClientFilter | null) =>
  rows.filter(
    (row) =>
      isWithinPriceRange(row.listing, filter) &&
      isWithinFreshWindow(row.listing, filter) &&
      isWithinListingRules(row.listing, filter)
  );

const getAuthenticatedUserId = async (supabase: SupabaseClient) => {
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error(error?.message ?? "Usuario nao autenticado.");
  }
  return user.id;
};

const fetchClientAlerts = async (args: {
  supabase: SupabaseClient;
  organizationId: string;
  ownerUserId: string;
}) => {
  const { supabase, organizationId, ownerUserId } = args;

  const ownerScopedClients = await supabase
    .from("clients")
    .select("id")
    .eq("org_id", organizationId)
    .eq("owner_user_id", ownerUserId);

  let ownedClientRows =
    (ownerScopedClients.data as { id: string }[] | null) ?? [];
  let ownerScopedClientsError = ownerScopedClients.error;

  if (
    ownerScopedClientsError &&
    isMissingColumnError(ownerScopedClientsError.message)
  ) {
    const legacyScopedClients = await supabase
      .from("clients")
      .select("id")
      .eq("org_id", organizationId)
      .eq("user_id", ownerUserId);
    ownedClientRows = (legacyScopedClients.data as { id: string }[] | null) ?? [];
    ownerScopedClientsError = legacyScopedClients.error;
  }

  if (ownerScopedClientsError) {
    throw new Error(ownerScopedClientsError.message);
  }

  const ownedClientIds = ownedClientRows.map((row) => row.id);
  if (ownedClientIds.length === 0) return {};

  const { data, error } = await supabase
    .from("automated_matches")
    .select("client_id")
    .eq("org_id", organizationId)
    .in("client_id", ownedClientIds)
    .eq("seen", false);

  if (error) {
    throw new Error(error.message);
  }

  const counts: Record<string, number> = {};
  (data as { client_id: string }[] | null)?.forEach((row) => {
    counts[row.client_id] = (counts[row.client_id] ?? 0) + 1;
  });
  return counts;
};

const fetchClientFilter = async (args: {
  supabase: SupabaseClient;
  organizationId: string;
  clientId: string;
}) => {
  const { supabase, organizationId, clientId } = args;
  const selectVariants = [
    "id, org_id, client_id, active, min_price, max_price, min_rent, max_rent, neighborhoods, min_bedrooms, min_bathrooms, min_parking, min_area_m2, max_area_m2, max_days_fresh, property_types, deal_type",
    "id, org_id, client_id, active, min_price, max_price, neighborhoods, min_bedrooms, min_bathrooms, min_parking, min_area_m2, max_area_m2, max_days_fresh, property_types, deal_type",
    "id, org_id, client_id, active, min_price, max_price, neighborhoods, min_bedrooms, min_bathrooms, min_parking, min_area_m2, max_area_m2, max_days_fresh, property_types",
    "id, org_id, client_id, active, min_price, max_price, neighborhoods, min_bedrooms, min_bathrooms, min_parking, max_days_fresh, property_types",
    "id, org_id, client_id, active, min_price, max_price, neighborhoods, min_bedrooms, min_bathrooms, min_area_m2, max_area_m2, max_days_fresh, property_types",
    "id, org_id, client_id, active, min_price, max_price, neighborhoods, min_bedrooms, min_parking, min_area_m2, max_area_m2, max_days_fresh, property_types",
    "id, org_id, client_id, active, min_price, max_price, neighborhoods, min_bedrooms, min_area_m2, max_area_m2, max_days_fresh, property_types",
    "id, org_id, client_id, active, min_price, max_price, neighborhoods, min_bedrooms, max_days_fresh, property_types"
  ] as const;

  let lastMissingColumnMessage: string | null = null;

  for (const selectClause of selectVariants) {
    const response = await supabase
      .from("client_filters")
      .select(selectClause)
      .eq("org_id", organizationId)
      .eq("client_id", clientId)
      .maybeSingle();

    if (!response.error) {
      return (response.data as ClientFilter | null) ?? null;
    }

    if (!isMissingColumnError(response.error.message)) {
      throw new Error(response.error.message);
    }

    lastMissingColumnMessage = response.error.message;
  }

  if (lastMissingColumnMessage) {
    throw new Error(lastMissingColumnMessage);
  }

  return null;
};

const enrichMatchesWithListings = async (args: {
  supabase: SupabaseClient;
  organizationId: string;
  rows: Match[];
}) => {
  const { supabase, organizationId, rows } = args;
  const missing = rows.filter((row) => !row.listing);
  if (missing.length === 0) return rows;

  const ids = Array.from(new Set(missing.map((row) => row.listing_id)));
  let listingQuery = supabase
    .from("listings")
    .select(
      "id, title, price, total_cost, neighborhood, bedrooms, bathrooms, parking, area_m2, deal_type, property_type, property_subtype, url, main_image_url, published_at, first_seen_at"
    )
    .in("id", ids);

  listingQuery = listingQuery.or(`org_id.is.null,org_id.eq.${organizationId}`);

  const { data, error } = await listingQuery;
  if (error) {
    throw new Error(error.message);
  }

  const map = new Map(
    ((data as Listing[] | null) ?? []).map((listing) => [listing.id, listing])
  );

  return rows.map((row) => ({
    ...row,
    listing: row.listing ?? map.get(row.listing_id) ?? null
  }));
};

const fetchMatchBucket = async (args: {
  supabase: SupabaseClient;
  organizationId: string;
  clientId: string;
  seen: boolean;
  isNotified: boolean;
  filter?: ClientFilter | null;
}) => {
  const { supabase, organizationId, clientId, seen, isNotified, filter } = args;

  const { data, error } = await supabase
    .from("automated_matches")
    .select(
      "id, org_id, client_id, listing_id, seen, is_notified, created_at, listing:listings(id, title, price, total_cost, neighborhood, bedrooms, bathrooms, parking, area_m2, deal_type, property_type, property_subtype, url, main_image_url, published_at, first_seen_at)"
    )
    .eq("org_id", organizationId)
    .eq("client_id", clientId)
    .eq("seen", seen)
    .eq("is_notified", isNotified)
    .order("created_at", { ascending: false })
    .range(0, MATCH_PAGE_SIZE - 1);

  if (error) {
    throw new Error(error.message);
  }

  const rows = await enrichMatchesWithListings({
    supabase,
    organizationId,
    rows: ((data as unknown as Match[] | null) ?? []).map((row) => ({
      ...row,
      listing: Array.isArray((row as { listing?: Listing[] | null }).listing)
        ? ((row as { listing?: Listing[] | null }).listing?.[0] ?? null)
        : (row as { listing?: Listing | null }).listing ?? null
    }))
  });
  const filtered = filterMatchesByFilter(rows, filter);
  return {
    rows: filtered,
    hasMore: filtered.length === MATCH_PAGE_SIZE
  };
};

const fetchTimeline = async (args: {
  supabase: SupabaseClient;
  organizationId: string;
  clientId: string;
}) => {
  const { supabase, organizationId, clientId } = args;
  const { data, error } = await supabase
    .from("crm_timeline")
    .select(
      "id, org_id, client_id, event_type, from_status, to_status, actor_user_id, payload, created_at"
    )
    .eq("org_id", organizationId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    throw new Error(error.message);
  }

  return (data as CrmTimelineEvent[] | null) ?? [];
};

export const crmQueryKeys = {
  root: (organizationId: string) => ["crm", organizationId] as const,
  clients: (organizationId: string) =>
    [...crmQueryKeys.root(organizationId), "clients"] as const,
  clientBundle: (organizationId: string, clientId: string) =>
    [...crmQueryKeys.root(organizationId), "client", clientId] as const
};

export const fetchCrmClientsBundle = async (args: {
  supabase: SupabaseClient;
  organizationId: string;
}): Promise<CrmClientsBundle> => {
  const { supabase, organizationId } = args;
  const ownerUserId = await getAuthenticatedUserId(supabase);

  const selectOwnerScopedWithPipelineMetadata =
    "id, org_id, owner_user_id, user_id, name, contact_info, data_retorno, descricao_contexto, status_pipeline, closed_outcome, lost_reason, lost_reason_detail, next_action, next_action_at, next_followup_at, chase_due_at, last_contact_at, last_reply_at, visit_at, visit_notes, proposal_value, proposal_valid_until, last_status_change_at, created_at";
  const selectOwnerScopedLegacyColumns =
    "id, org_id, owner_user_id, user_id, name, contact_info, data_retorno, descricao_contexto, status_pipeline, created_at";
  const selectLegacyWithoutOwnerColumn =
    "id, org_id, user_id, name, contact_info, data_retorno, descricao_contexto, status_pipeline, created_at";

  const primary = await supabase
    .from("clients")
    .select(selectOwnerScopedWithPipelineMetadata)
    .eq("org_id", organizationId)
    .eq("owner_user_id", ownerUserId);
  let data = (primary.data as Client[] | null) ?? null;
  let error = primary.error;

  if (error && isMissingColumnError(error.message)) {
    const fallback = await supabase
      .from("clients")
      .select(selectOwnerScopedLegacyColumns)
      .eq("org_id", organizationId)
      .eq("owner_user_id", ownerUserId);
    data = (fallback.data as Client[] | null) ?? null;
    error = fallback.error;
  }

  if (error && isMissingColumnError(error.message)) {
    const legacyOwnerFallback = await supabase
      .from("clients")
      .select(selectLegacyWithoutOwnerColumn)
      .eq("org_id", organizationId)
      .eq("user_id", ownerUserId);
    data = (legacyOwnerFallback.data as Client[] | null) ?? null;
    error = legacyOwnerFallback.error;
  }

  if (error) {
    throw new Error(error.message);
  }

  const rows = ((data as Client[]) ?? []).map((client) => ({
    ...client,
    owner_user_id: client.owner_user_id ?? client.user_id
  }));
  const [clients, clientAlerts] = await Promise.all([
    Promise.resolve(sortClientsForCrm(rows)),
    fetchClientAlerts({ supabase, organizationId, ownerUserId })
  ]);

  return {
    ownerUserId,
    clients,
    clientAlerts
  };
};

export const fetchCrmClientBundle = async (args: {
  supabase: SupabaseClient;
  organizationId: string;
  clientId: string;
}): Promise<CrmClientBundle> => {
  const { supabase, organizationId, clientId } = args;

  await getAuthenticatedUserId(supabase);
  const filter = await fetchClientFilter({ supabase, organizationId, clientId });

  const [matches, history, archived, timeline] = await Promise.all([
    fetchMatchBucket({
      supabase,
      organizationId,
      clientId,
      seen: false,
      isNotified: false,
      filter
    }),
    fetchMatchBucket({
      supabase,
      organizationId,
      clientId,
      seen: true,
      isNotified: true,
      filter
    }),
    fetchMatchBucket({
      supabase,
      organizationId,
      clientId,
      seen: true,
      isNotified: false,
      filter
    }),
    fetchTimeline({ supabase, organizationId, clientId })
  ]);

  return {
    filter,
    matches: matches.rows,
    matchesHasMore: matches.hasMore,
    history: history.rows,
    historyHasMore: history.hasMore,
    archived: archived.rows,
    archivedHasMore: archived.hasMore,
    timeline
  };
};

export const createCrmClientsQueryOptions = (args: {
  supabase: SupabaseClient;
  organizationId: string;
}) =>
  queryOptions({
    queryKey: crmQueryKeys.clients(args.organizationId),
    queryFn: () => fetchCrmClientsBundle(args)
  });

export const createCrmClientBundleQueryOptions = (args: {
  supabase: SupabaseClient;
  organizationId: string;
  clientId: string;
}) =>
  queryOptions({
    queryKey: crmQueryKeys.clientBundle(args.organizationId, args.clientId),
    queryFn: () => fetchCrmClientBundle(args)
  });
