import type { SupabaseClient, User } from "@supabase/supabase-js";
import { buildMessageForLead, MESSAGE_TEMPLATES } from "@/lib/ai/messageTemplates";
import { rankLeadsByScore } from "@/lib/ai/scoring";
import type {
  AIContextPayload,
  BaseLead,
  CaptureCandidate,
  LeadFilter,
  LeadWithMessages,
  PipelineStatus
} from "@/lib/ai/types";

const DEFAULT_TIMEZONE = "America/Sao_Paulo";
const WAITING_RETURN_WINDOW_DAYS = 3;
const CAPTURE_POOL_SIZE = 260;

const LISTINGS_SELECT_WITH_SIGNALS =
  "id, title, price, city, state, neighborhood, neighborhood_normalized, bedrooms, bathrooms, parking, area_m2, property_type, portal, first_seen_at, main_image_url, url, published_at, below_market_badge, previous_price, price_changed_at, badges, price_per_m2, is_active, org_id";
const LISTINGS_SELECT_WITHOUT_BELOW_MARKET =
  "id, title, price, city, state, neighborhood, neighborhood_normalized, bedrooms, bathrooms, parking, area_m2, property_type, portal, first_seen_at, main_image_url, url, published_at, previous_price, price_changed_at, badges, price_per_m2, is_active, org_id";
const LISTINGS_SELECT_BASE =
  "id, title, price, city, state, neighborhood, neighborhood_normalized, bedrooms, bathrooms, parking, area_m2, property_type, portal, first_seen_at, main_image_url, url, published_at, is_active, org_id";

const PROPERTY_TYPES = new Set(["apartment", "house", "land", "other"]);

type LeadRow = {
  id?: string | null;
  name?: string | null;
  status_pipeline?: string | null;
  closed_outcome?: string | null;
  lost_reason?: string | null;
  contact_info?: unknown;
  added_at?: string | null;
  created_at?: string | null;
  next_action_at?: string | null;
  next_followup_at?: string | null;
  data_retorno?: string | null;
  chase_due_at?: string | null;
  last_contact_at?: string | null;
  last_reply_at?: string | null;
  last_status_change_at?: string | null;
  descricao_contexto?: string | null;
  owner_user_id?: string | null;
  user_id?: string | null;
};

type LeadFilterRow = {
  client_id?: string | null;
  active?: boolean | null;
  min_price?: number | string | null;
  max_price?: number | string | null;
  neighborhoods?: unknown;
  min_bedrooms?: number | string | null;
  min_bathrooms?: number | string | null;
  min_parking?: number | string | null;
  min_area_m2?: number | string | null;
  max_area_m2?: number | string | null;
  property_types?: unknown;
};

type ListingRow = Record<string, unknown>;

type CaptureListing = {
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
  published_at: string | null;
  main_image_url: string | null;
  url: string | null;
  below_market_badge: boolean | null;
  previous_price: number | null;
  price_changed_at: string | null;
  badges: string[] | null;
  price_per_m2: number | null;
  is_active: boolean | null;
};

type BuildContextOptions = {
  timezone?: string;
  scoreLimit?: number;
  captureLimit?: number;
};

type SupabaseLikeError = {
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
} | null | undefined;

const errorToText = (error: SupabaseLikeError | string) => {
  if (typeof error === "string") return error;
  if (!error) return "";
  return [error.message, error.details, error.hint, error.code]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" | ");
};

const isMissingColumnError = (value: SupabaseLikeError | string) =>
  /(column .* does not exist|could not find the .* column .* schema cache|pgrst204|42703)/i.test(
    errorToText(value)
  );

const parseDateSafe = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

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

const normalizePipelineStatus = (value?: string | null): PipelineStatus => {
  if (value === "novo_match") return "novo_match";
  if (value === "contato_feito") return "contato_feito";
  if (value === "em_conversa") return "em_conversa";
  if (value === "aguardando_retorno") return "aguardando_retorno";
  if (value === "aguardando_resposta") return "aguardando_retorno";
  if (value === "visita_agendada") return "visita_agendada";
  if (value === "proposta") return "proposta";
  if (value === "fechado") return "fechado";
  return "novo_match";
};

const normalizeContactInfo = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const email = typeof record.email === "string" ? record.email : undefined;
  const phone = typeof record.phone === "string" ? record.phone : undefined;
  if (!email && !phone) return null;
  return { email, phone };
};

const arrayFromUnknown = (value: unknown) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const getDayFormatter = (timezone: string) => {
  if (!formatterCache.has(timezone)) {
    formatterCache.set(
      timezone,
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      })
    );
  }
  return formatterCache.get(timezone) as Intl.DateTimeFormat;
};

const toDateKey = (value: string | null, timezone: string) => {
  if (!value) return null;
  const parsed = parseDateSafe(value);
  if (!parsed) return null;
  return getDayFormatter(timezone).format(parsed);
};

const formatDateTime = (value: string | null) => {
  const parsed = parseDateSafe(value);
  if (!parsed) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
};

const statusLabel = (status: PipelineStatus) => {
  if (status === "novo_match") return "Novo Match";
  if (status === "contato_feito") return "Contato feito";
  if (status === "em_conversa") return "Em conversa";
  if (status === "aguardando_retorno") return "Aguardando retorno";
  if (status === "visita_agendada") return "Visita agendada";
  if (status === "proposta") return "Proposta";
  return "Fechado";
};

const toRecencyTs = (listing: CaptureListing) => {
  const published = parseDateSafe(listing.published_at)?.getTime();
  if (typeof published === "number") return published;
  return parseDateSafe(listing.first_seen_at)?.getTime() ?? 0;
};

const toPricePerM2 = (listing: CaptureListing) => {
  const persisted = toNumberOrNull(listing.price_per_m2);
  if (persisted && persisted > 0) return persisted;
  const price = toNumberOrNull(listing.price);
  const area = toNumberOrNull(listing.area_m2);
  if (!price || !area || area <= 0) return null;
  return price / area;
};

const hasPriceDropBadge = (listing: CaptureListing) => {
  if (!Array.isArray(listing.badges)) return false;
  const normalized = listing.badges.map((badge) => normalizeText(badge));
  return normalized.some(
    (badge) =>
      badge.includes("price_drop") || badge.includes("queda") || badge.includes("desconto")
  );
};

const normalizeListingRow = (row: ListingRow): CaptureListing => {
  const propertyTypeCandidate = normalizeText(
    typeof row.property_type === "string" ? row.property_type : null
  );
  const propertyType = PROPERTY_TYPES.has(propertyTypeCandidate)
    ? (propertyTypeCandidate as CaptureListing["property_type"])
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

const mapLeadRow = (row: LeadRow): BaseLead | null => {
  const id = typeof row.id === "string" ? row.id : "";
  const name = typeof row.name === "string" && row.name.trim().length > 0 ? row.name.trim() : "Cliente";
  if (!id) return null;
  const dataRetorno = typeof row.data_retorno === "string" ? row.data_retorno : null;

  return {
    id,
    name,
    status_pipeline: normalizePipelineStatus(row.status_pipeline),
    closed_outcome:
      row.closed_outcome === "won" || row.closed_outcome === "lost"
        ? row.closed_outcome
        : null,
    lost_reason: typeof row.lost_reason === "string" ? row.lost_reason : null,
    contact_info: normalizeContactInfo(row.contact_info),
    added_at: typeof row.added_at === "string" ? row.added_at : null,
    created_at: typeof row.created_at === "string" ? row.created_at : null,
    next_action_at: typeof row.next_action_at === "string" ? row.next_action_at : dataRetorno,
    chase_due_at: typeof row.chase_due_at === "string" ? row.chase_due_at : null,
    next_followup_at:
      typeof row.next_followup_at === "string" ? row.next_followup_at : dataRetorno,
    last_contact_at: typeof row.last_contact_at === "string" ? row.last_contact_at : null,
    last_reply_at: typeof row.last_reply_at === "string" ? row.last_reply_at : null,
    last_status_change_at:
      typeof row.last_status_change_at === "string" ? row.last_status_change_at : null,
    descricao_contexto:
      typeof row.descricao_contexto === "string" ? row.descricao_contexto : null
  };
};

async function resolveActiveOrganizationId(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const bootstrap = await supabase.rpc("get_bootstrap_context").maybeSingle();
  if (!bootstrap.error) {
    const row = (bootstrap.data as { active_org_id?: string | null } | null) ?? null;
    if (typeof row?.active_org_id === "string" && row.active_org_id.length > 0) {
      return row.active_org_id;
    }
  }

  const fromProfile = await supabase
    .from("profiles")
    .select("active_organization_id")
    .eq("id", userId)
    .maybeSingle();

  if (!fromProfile.error) {
    const row = (fromProfile.data as { active_organization_id?: string | null } | null) ?? null;
    if (
      typeof row?.active_organization_id === "string" &&
      row.active_organization_id.length > 0
    ) {
      return row.active_organization_id;
    }
  }

  const fallback = await supabase.rpc("current_user_org_id");
  if (!fallback.error && typeof fallback.data === "string" && fallback.data.length > 0) {
    return fallback.data;
  }

  const membership = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership.error) {
    const row = (membership.data as { organization_id?: string | null } | null) ?? null;
    if (typeof row?.organization_id === "string" && row.organization_id.length > 0) {
      return row.organization_id;
    }
  }

  return null;
}

async function fetchLeadsForUser(args: {
  supabase: SupabaseClient;
  userId: string;
  organizationId: string | null;
}) {
  const { supabase, userId, organizationId } = args;

  const runScopedQuery = async (scope: "owner" | "legacy", withOrgFilter: boolean) => {
    let query = supabase.from("clients").select("*");
    query = scope === "owner" ? query.eq("owner_user_id", userId) : query.eq("user_id", userId);
    if (withOrgFilter && organizationId) {
      query = query.eq("org_id", organizationId);
    }
    return query;
  };

  let result = await runScopedQuery("owner", true);
  if (result.error && organizationId && isMissingColumnError(result.error)) {
    result = await runScopedQuery("owner", false);
  }

  if (result.error && isMissingColumnError(result.error)) {
    result = await runScopedQuery("legacy", true);
    if (result.error && organizationId && isMissingColumnError(result.error)) {
      result = await runScopedQuery("legacy", false);
    }
  }

  if (result.error) {
    const errorText = errorToText(result.error) || "Falha ao carregar leads do CRM.";
    if (isMissingColumnError(result.error)) {
      console.error("[IA][context] clients schema drift, returning empty leads", {
        userId,
        organizationId,
        error: errorText
      });
      return [];
    }
    throw new Error(errorText);
  }

  const rows = ((result.data as LeadRow[] | null) ?? [])
    .map(mapLeadRow)
    .filter((lead): lead is BaseLead => Boolean(lead));

  return rows;
}

async function fetchLeadFiltersByClient(args: {
  supabase: SupabaseClient;
  clientIds: string[];
  organizationId: string | null;
}) {
  const { supabase, clientIds, organizationId } = args;
  if (clientIds.length === 0) return new Map<string, LeadFilter>();

  const selectFull =
    "client_id, active, min_price, max_price, neighborhoods, min_bedrooms, min_bathrooms, min_parking, min_area_m2, max_area_m2, property_types";
  const selectFallback = "client_id, active, min_price, max_price, neighborhoods, min_bedrooms, property_types";

  const runQuery = async (select: string) => {
    let query = supabase.from("client_filters").select(select).in("client_id", clientIds);
    if (organizationId) {
      query = query.eq("org_id", organizationId);
    }
    return query;
  };

  let result = await runQuery(selectFull);

  if (result.error && isMissingColumnError(result.error)) {
    result = await runQuery(selectFallback);
  }

  if (result.error) {
    return new Map<string, LeadFilter>();
  }

  const map = new Map<string, LeadFilter>();

  ((result.data as LeadFilterRow[] | null) ?? []).forEach((row) => {
    const clientId = typeof row.client_id === "string" ? row.client_id : "";
    if (!clientId) return;

    const parsed: LeadFilter = {
      client_id: clientId,
      active: row.active !== false,
      min_price: toNumberOrNull(row.min_price),
      max_price: toNumberOrNull(row.max_price),
      neighborhoods: arrayFromUnknown(row.neighborhoods),
      min_bedrooms: toIntOrNull(row.min_bedrooms),
      min_bathrooms: toIntOrNull(row.min_bathrooms),
      min_parking: toIntOrNull(row.min_parking),
      min_area_m2: toNumberOrNull(row.min_area_m2),
      max_area_m2: toNumberOrNull(row.max_area_m2),
      property_types: arrayFromUnknown(row.property_types).map((item) => item.toLowerCase())
    };

    const previous = map.get(clientId);
    if (!previous || (parsed.active && !previous.active)) {
      map.set(clientId, parsed);
    }
  });

  return map;
}

async function fetchCaptureCandidates(args: {
  supabase: SupabaseClient;
  organizationId: string | null;
  limit: number;
}) {
  const { supabase, organizationId, limit } = args;

  const runQuery = async (select: string, withPublishedOrder: boolean) => {
    let query = supabase.from("listings").select(select).limit(CAPTURE_POOL_SIZE);

    if (organizationId) {
      query = query.or(`org_id.is.null,org_id.eq.${organizationId}`);
    }

    if (withPublishedOrder) {
      query = query.order("published_at", { ascending: false, nullsFirst: false });
    }

    query = query.order("first_seen_at", { ascending: false, nullsFirst: false });

    return query;
  };

  let result = await runQuery(LISTINGS_SELECT_WITH_SIGNALS, true);

  if (result.error && isMissingColumnError(result.error)) {
    result = await runQuery(LISTINGS_SELECT_WITHOUT_BELOW_MARKET, true);
  }

  if (result.error && isMissingColumnError(result.error)) {
    result = await runQuery(LISTINGS_SELECT_BASE, false);
  }

  if (result.error) {
    return [] as CaptureCandidate[];
  }

  const listings = (Array.isArray(result.data) ? (result.data as unknown[]) : [])
    .filter((row): row is ListingRow => typeof row === "object" && row !== null)
    .map(normalizeListingRow)
    .filter((row) => row.id.length > 0)
    .filter((row) => row.is_active !== false)
    .filter((row) => Boolean(row.url));

  const belowMarket = listings
    .map((listing) => ({
      listing,
      below: Boolean(listing.below_market_badge),
      recencyTs: toRecencyTs(listing),
      ppm2: toPricePerM2(listing)
    }))
    .sort((a, b) => {
      if (a.below !== b.below) return a.below ? -1 : 1;
      const aPpm2 = a.ppm2 ?? Number.POSITIVE_INFINITY;
      const bPpm2 = b.ppm2 ?? Number.POSITIVE_INFINITY;
      if (aPpm2 !== bPpm2) return aPpm2 - bPpm2;
      return b.recencyTs - a.recencyTs;
    })
    .slice(0, 18)
    .map(({ listing }) => ({
      ...listing,
      category: "below_market" as const,
      reason: "Preço atrativo na região (sinal de oportunidade)."
    }));

  const priceDrop = listings
    .map((listing) => {
      const currentPrice = toNumberOrNull(listing.price);
      const previousPrice = toNumberOrNull(listing.previous_price);
      const dropPct =
        currentPrice && previousPrice && previousPrice > currentPrice
          ? (previousPrice - currentPrice) / previousPrice
          : 0;

      return {
        listing,
        dropPct,
        hasSignal: dropPct > 0 || hasPriceDropBadge(listing) || Boolean(listing.price_changed_at),
        recencyTs: toRecencyTs(listing)
      };
    })
    .filter((entry) => entry.hasSignal)
    .sort((a, b) => {
      if (a.dropPct !== b.dropPct) return b.dropPct - a.dropPct;
      return b.recencyTs - a.recencyTs;
    })
    .slice(0, 18)
    .map(({ listing, dropPct }) => ({
      ...listing,
      category: "price_drop" as const,
      reason:
        dropPct > 0
          ? `Queda de preço estimada em ${(dropPct * 100).toFixed(1)}%.`
          : "Indício de ajuste recente de preço."
    }));

  const recent = listings
    .slice()
    .sort((a, b) => toRecencyTs(b) - toRecencyTs(a))
    .slice(0, 18)
    .map((listing) => ({
      ...listing,
      category: "recent" as const,
      reason: "Imóvel recente com potencial de captação ativa."
    }));

  const grouped = [belowMarket, priceDrop, recent];
  const cursors = [0, 0, 0];
  const unique = new Set<string>();
  const resultRows: CaptureCandidate[] = [];

  while (resultRows.length < limit) {
    let progressed = false;

    for (let idx = 0; idx < grouped.length; idx += 1) {
      const group = grouped[idx];
      let cursor = cursors[idx];

      while (cursor < group.length && unique.has(group[cursor].id)) {
        cursor += 1;
      }

      if (cursor >= group.length) {
        cursors[idx] = cursor;
        continue;
      }

      const item = group[cursor];
      unique.add(item.id);
      resultRows.push({
        id: item.id,
        title: item.title,
        price: item.price,
        city: item.city,
        state: item.state,
        neighborhood: item.neighborhood,
        bedrooms: item.bedrooms,
        bathrooms: item.bathrooms,
        parking: item.parking,
        area_m2: item.area_m2,
        property_type: item.property_type,
        portal: item.portal,
        first_seen_at: item.first_seen_at,
        published_at: item.published_at,
        main_image_url: item.main_image_url,
        url: item.url,
        category: item.category,
        reason: item.reason
      });

      cursors[idx] = cursor + 1;
      progressed = true;

      if (resultRows.length >= limit) break;
    }

    if (!progressed) break;
  }

  return resultRows;
}

const passesMinOrZero = (value: number | null, minValue: number | null) => {
  if (minValue === null) return true;
  if (typeof value !== "number" || !Number.isFinite(value)) return true;
  return value === 0 || value >= minValue;
};

const passesMaxOrZero = (value: number | null, maxValue: number | null) => {
  if (maxValue === null) return true;
  if (typeof value !== "number" || !Number.isFinite(value)) return true;
  return value === 0 || value <= maxValue;
};

const countMatchingOpportunities = (
  leadFilter: LeadFilter | undefined,
  captureCandidates: CaptureCandidate[]
) => {
  if (!leadFilter || !leadFilter.active) return 0;

  const neighborhoods = new Set(
    leadFilter.neighborhoods.map((item) => normalizeText(item)).filter(Boolean)
  );
  const propertyTypes = new Set(
    leadFilter.property_types.map((item) => normalizeText(item)).filter(Boolean)
  );

  const count = captureCandidates.filter((listing) => {
    if (typeof listing.price === "number") {
      if (
        typeof leadFilter.min_price === "number" &&
        Number.isFinite(leadFilter.min_price) &&
        listing.price < leadFilter.min_price
      ) {
        return false;
      }

      if (
        typeof leadFilter.max_price === "number" &&
        Number.isFinite(leadFilter.max_price) &&
        listing.price > leadFilter.max_price
      ) {
        return false;
      }
    }

    if (neighborhoods.size > 0) {
      const neighborhood = normalizeText(listing.neighborhood);
      if (!neighborhoods.has(neighborhood)) return false;
    }

    if (propertyTypes.size > 0) {
      const propertyType = normalizeText(listing.property_type);
      if (!propertyTypes.has(propertyType)) return false;
    }

    if (!passesMinOrZero(listing.bedrooms, leadFilter.min_bedrooms)) return false;
    if (!passesMinOrZero(listing.bathrooms, leadFilter.min_bathrooms)) return false;
    if (!passesMinOrZero(listing.parking, leadFilter.min_parking)) return false;
    if (!passesMinOrZero(listing.area_m2, leadFilter.min_area_m2)) return false;
    if (!passesMaxOrZero(listing.area_m2, leadFilter.max_area_m2)) return false;

    return true;
  }).length;

  return count;
};

const resolveNextActionAt = (lead: BaseLead) =>
  lead.next_action_at ?? lead.next_followup_at ?? null;

const resolveReturnAnchor = (lead: BaseLead) =>
  resolveNextActionAt(lead) ?? lead.chase_due_at ?? null;

const isFollowupStatus = (status: PipelineStatus) =>
  status === "contato_feito" || status === "aguardando_retorno";

const mapLeadAsDue = (lead: BaseLead, dueType: "next_action_today" | "chase_due_today", filter: LeadFilter | null): LeadWithMessages => {
  const lastActionSource = lead.last_contact_at ?? lead.last_reply_at ?? lead.last_status_change_at;
  const lastActionLabel =
    lead.last_contact_at
      ? `Contato em ${formatDateTime(lastActionSource)}`
      : lead.last_reply_at
        ? `Resposta em ${formatDateTime(lastActionSource)}`
        : `Última atualização em ${formatDateTime(lastActionSource)}`;

  return {
    ...lead,
    due_type: dueType,
    last_action_label: lastActionLabel,
    suggested_messages: {
      curto: buildMessageForLead({ lead, tone: "curto", filter }),
      profissional: buildMessageForLead({ lead, tone: "profissional", filter }),
      amigavel: buildMessageForLead({ lead, tone: "amigavel", filter })
    }
  };
};

const toSortKey = (lead: BaseLead) => resolveReturnAnchor(lead) ?? lead.created_at ?? "";

export async function buildAiContextForUser(args: {
  supabase: SupabaseClient;
  user: User;
  options?: BuildContextOptions;
}): Promise<AIContextPayload> {
  const { supabase, user, options } = args;
  const timezone = options?.timezone ?? DEFAULT_TIMEZONE;
  const scoreLimit = options?.scoreLimit ?? 10;
  const captureLimit = options?.captureLimit ?? 30;
  const now = new Date();
  const todayKey = getDayFormatter(timezone).format(now);

  const organizationId = await resolveActiveOrganizationId(supabase, user.id);

  const leads = await fetchLeadsForUser({
    supabase,
    userId: user.id,
    organizationId
  });

  const leadFilters = await fetchLeadFiltersByClient({
    supabase,
    clientIds: leads.map((lead) => lead.id),
    organizationId
  });

  const captureCandidates = await fetchCaptureCandidates({
    supabase,
    organizationId,
    limit: captureLimit
  });

  const opportunitiesByLeadId: Record<string, number> = {};
  leads.forEach((lead) => {
    opportunitiesByLeadId[lead.id] = countMatchingOpportunities(
      leadFilters.get(lead.id),
      captureCandidates
    );
  });

  const dueTodayLeads: LeadWithMessages[] = [];
  const overdueLeads: LeadWithMessages[] = [];
  const waitingReturnLeads: BaseLead[] = [];

  const nowPlusWindow = new Date(now.getTime() + WAITING_RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const maxWindowKey = getDayFormatter(timezone).format(nowPlusWindow);

  leads.forEach((lead) => {
    const nextActionAt = resolveNextActionAt(lead);
    const nextActionKey = toDateKey(nextActionAt, timezone);
    const chaseDueKey = toDateKey(lead.chase_due_at, timezone);
    const filter = leadFilters.get(lead.id) ?? null;

    const dueByNextAction = nextActionKey === todayKey;
    const dueByChase = isFollowupStatus(lead.status_pipeline) && !nextActionAt && chaseDueKey === todayKey;

    if (dueByNextAction) {
      dueTodayLeads.push(mapLeadAsDue(lead, "next_action_today", filter));
    } else if (dueByChase) {
      dueTodayLeads.push(mapLeadAsDue(lead, "chase_due_today", filter));
    }

    const overdueByNextAction =
      typeof nextActionKey === "string" &&
      nextActionKey < todayKey;

    const overdueByChase =
      isFollowupStatus(lead.status_pipeline) &&
      !nextActionAt &&
      typeof chaseDueKey === "string" &&
      chaseDueKey < todayKey;

    if (overdueByNextAction || overdueByChase) {
      overdueLeads.push(
        mapLeadAsDue(
          lead,
          overdueByNextAction ? "next_action_today" : "chase_due_today",
          filter
        )
      );
    }

    if (lead.status_pipeline === "aguardando_retorno" && typeof chaseDueKey === "string") {
      if (chaseDueKey >= todayKey && chaseDueKey <= maxWindowKey) {
        waitingReturnLeads.push(lead);
      }
    }
  });

  dueTodayLeads.sort((a, b) => toSortKey(a).localeCompare(toSortKey(b)));
  overdueLeads.sort((a, b) => toSortKey(a).localeCompare(toSortKey(b)));
  waitingReturnLeads.sort((a, b) => toSortKey(a).localeCompare(toSortKey(b)));

  const leadCandidatesForScoring = rankLeadsByScore({
    leads,
    opportunitiesByLeadId,
    now,
    timezone,
    limit: scoreLimit
  });

  return {
    dueTodayLeads,
    overdueLeads,
    waitingReturnLeads,
    leadCandidatesForScoring,
    captureCandidates,
    templates: MESSAGE_TEMPLATES,
    metadata: {
      generatedAt: now.toISOString(),
      organizationId,
      userId: user.id
    }
  };
}

export const aiDebugSummary = (context: AIContextPayload) => ({
  userId: context.metadata.userId,
  organizationId: context.metadata.organizationId,
  dueTodayCount: context.dueTodayLeads.length,
  overdueCount: context.overdueLeads.length,
  waitingReturnCount: context.waitingReturnLeads.length,
  scoredLeadsCount: context.leadCandidatesForScoring.length,
  captureCandidatesCount: context.captureCandidates.length
});

export const aiStatusLabel = statusLabel;
