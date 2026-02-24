"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import ResultOverlay from "@/components/crm/ResultOverlay";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import SkeletonList from "@/components/ui/SkeletonList";
import NeighborhoodAutocomplete from "@/components/filters/NeighborhoodAutocomplete";
import PropertyCategoryMultiSelect from "@/components/filters/PropertyCategoryMultiSelect";
import { useOrganizationContext } from "@/lib/auth/useOrganizationContext";
import {
  createCrmClientBundleQueryOptions,
  createCrmClientsQueryOptions,
  crmQueryKeys
} from "@/lib/crm/query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatThousandsBR, parseBRNumber } from "@/lib/format/numberInput";
import { normalizeText } from "@/lib/format/text";
import {
  getUnifiedPropertyLabelForListing,
  isTerrenoListing,
  matchesUnifiedPropertyFilter,
  normalizeUnifiedPropertyCategories,
  type UnifiedPropertyCategory
} from "@/lib/listings/unifiedPropertyFilter";

type PipelineStatus =
  | "novo_match"
  | "contato_feito"
  | "em_conversa"
  | "aguardando_retorno"
  | "visita_agendada"
  | "proposta"
  | "fechado";

type ClosedOutcome = "won" | "lost" | null;

type LostReasonValue =
  | "preco"
  | "localizacao"
  | "documentacao"
  | "desistencia"
  | "cliente_sumiu"
  | "comprou_outro_imovel"
  | "condicoes_imovel"
  | "outro";

type NextActionValue =
  | "ligar"
  | "whatsapp"
  | "enviar_informacoes"
  | "solicitar_documentos"
  | "agendar_visita"
  | "fazer_proposta"
  | "follow_up"
  | "outro";

type Client = {
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

type ClientFilter = {
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

type Listing = {
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

type Match = {
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

type TimelinePayload = {
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

type CrmTimelineEvent = {
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

type PipelineModalSource = "pipeline" | "card";

type PipelineTransitionDraft = {
  next_action: NextActionValue | "";
  no_followup_date: boolean;
  next_action_at: string;
  note: string;
  closed_outcome: ClosedOutcome;
  lost_reason: LostReasonValue | "";
  lost_reason_detail: string;
  visit_at: string;
  visit_notes: string;
  proposal_value: string;
  proposal_valid_until: string;
  final_value: string;
  final_note: string;
};

type ListingRuleFn = (
  listing?: Listing | null,
  override?: ClientFilter | null
) => boolean;

type ListingRules = {
  isWithinPriceRange: ListingRuleFn;
  isWithinListingRules: ListingRuleFn;
  isWithinFreshWindow: ListingRuleFn;
};

const LAST_VIEWED_KEY = "crm:lastViewedAtByClient";
const PIPELINE_STEPS = [
  { value: "novo_match", label: "Novo Match" },
  { value: "contato_feito", label: "Contato feito" },
  { value: "em_conversa", label: "Em Conversa" },
  { value: "aguardando_retorno", label: "Aguardando retorno" },
  { value: "visita_agendada", label: "Visita Agendada" },
  { value: "proposta", label: "Proposta" },
  { value: "fechado", label: "Fechado" }
] as const;
const PIPELINE_INDEX_BY_STATUS: Record<PipelineStatus, number> = {
  novo_match: 0,
  contato_feito: 1,
  em_conversa: 2,
  aguardando_retorno: 3,
  visita_agendada: 4,
  proposta: 5,
  fechado: 6
};
const PIPELINE_STATUS_LABEL: Record<PipelineStatus, string> = {
  novo_match: "Novo Match",
  contato_feito: "Contato feito",
  em_conversa: "Em Conversa",
  aguardando_retorno: "Aguardando retorno",
  visita_agendada: "Visita Agendada",
  proposta: "Proposta",
  fechado: "Fechado"
};
const PIPELINE_STATUS_HELP: Record<PipelineStatus, string> = {
  novo_match: "Lead entrou e ainda não teve contato inicial.",
  contato_feito: "Contato inicial realizado; retorno planejado.",
  em_conversa: "Cliente respondeu e conversa ativa.",
  aguardando_retorno: "Imóveis/info enviados; aguardando feedback.",
  visita_agendada: "Visita marcada com data definida.",
  proposta: "Proposta enviada em negociação.",
  fechado: "Negócio finalizado (ganho ou perdido)."
};
const CLOSED_OUTCOME_OPTIONS = [
  { value: "won", label: "Fechado (Ganho)" },
  { value: "lost", label: "Fechado (Perdido)" }
] as const;
const LOST_REASON_OPTIONS: { value: LostReasonValue; label: string }[] = [
  { value: "preco", label: "Preço" },
  { value: "localizacao", label: "Localização" },
  { value: "documentacao", label: "Documentação" },
  { value: "desistencia", label: "Desistência" },
  { value: "cliente_sumiu", label: "Cliente sumiu" },
  { value: "comprou_outro_imovel", label: "Comprou outro imóvel" },
  { value: "condicoes_imovel", label: "Condições do imóvel" },
  { value: "outro", label: "Outro" }
];
const NEXT_ACTION_OPTIONS: { value: NextActionValue; label: string }[] = [
  { value: "ligar", label: "Ligar" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "enviar_informacoes", label: "Enviar informações" },
  { value: "solicitar_documentos", label: "Solicitar documentos" },
  { value: "agendar_visita", label: "Agendar visita" },
  { value: "fazer_proposta", label: "Fazer proposta" },
  { value: "follow_up", label: "Follow-up" },
  { value: "outro", label: "Outro" }
];
const NEXT_ACTION_SET = new Set<NextActionValue>(
  NEXT_ACTION_OPTIONS.map((option) => option.value)
);
const LOST_REASON_SET = new Set<LostReasonValue>(
  LOST_REASON_OPTIONS.map((option) => option.value)
);
const DEAL_TYPE_OPTIONS = [
  { label: "Venda", value: "venda" },
  { label: "Aluguel", value: "aluguel" }
] as const;
type PropertyTypeValue = UnifiedPropertyCategory;
const FRESHNESS_OPTIONS = [
  { label: "Todos", value: "" },
  { label: "7 dias", value: "7" },
  { label: "15 dias", value: "15" },
  { label: "30 dias", value: "30" }
] as const;
const createInitialPipelineTransitionDraft = (): PipelineTransitionDraft => ({
  next_action: "",
  no_followup_date: false,
  next_action_at: "",
  note: "",
  closed_outcome: null,
  lost_reason: "",
  lost_reason_detail: "",
  visit_at: "",
  visit_notes: "",
  proposal_value: "",
  proposal_valid_until: "",
  final_value: "",
  final_note: ""
});

const CONTACT_CHASE_HOURS = 24;
const RETURN_CHASE_HOURS = 48;
const RESULT_OVERLAY_DURATION_MS = 900;

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

const formatDateTimeDisplay = (value?: string | null) => {
  const date = parseDateSafe(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
};

const formatDateDisplay = (value?: string | null) => {
  const date = parseDateSafe(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
};

const toDateTimeLocalInputValue = (value?: string | null) => {
  const date = parseDateSafe(value);
  if (!date) return "";

  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
};

const fromDateTimeLocalInputValue = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const toDateInputValue = (value?: string | null) => {
  const date = parseDateSafe(value);
  if (!date) return "";
  return date.toISOString().slice(0, 10);
};

const fromDateInputValueToIso = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const startOfDay = (value: Date) =>
  new Date(value.getFullYear(), value.getMonth(), value.getDate(), 0, 0, 0, 0);

const endOfDay = (value: Date) =>
  new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999);

const addHoursIso = (baseIso: string, hours: number) => {
  const baseDate = parseDateSafe(baseIso);
  if (!baseDate) return null;
  return new Date(baseDate.getTime() + hours * 60 * 60 * 1000).toISOString();
};

const toArray = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const toPropertyTypeValues = (value: string) => {
  return normalizeUnifiedPropertyCategories(toArray(value)) as PropertyTypeValue[];
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

const parseDecimalInput = (value: string) => {
  if (!value.trim()) return null;
  const normalized = value.replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

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

const resolveClientNextActionAt = (client?: Client | null) =>
  client?.next_action_at ?? client?.next_followup_at ?? client?.data_retorno ?? null;

const resolveClientReturnAnchor = (client?: Client | null) =>
  resolveClientNextActionAt(client) ?? client?.chase_due_at ?? null;

type DueFilter = "today" | "overdue";

const parseDueFilter = (value: string | null): DueFilter | null => {
  if (value === "today" || value === "overdue") return value;
  return null;
};

const isClientDueToday = (client: Client, now: Date) => {
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);

  const nextActionAt = parseDateSafe(resolveClientNextActionAt(client));
  if (nextActionAt) {
    return nextActionAt >= dayStart && nextActionAt <= dayEnd;
  }

  const status = normalizePipelineStatus(client.status_pipeline);
  if (status !== "contato_feito" && status !== "aguardando_retorno") {
    return false;
  }

  const chaseDueAt = parseDateSafe(client.chase_due_at);
  return chaseDueAt ? chaseDueAt >= dayStart && chaseDueAt <= dayEnd : false;
};

const isClientOverdue = (client: Client, now: Date) => {
  const dayStart = startOfDay(now);

  const nextActionAt = parseDateSafe(resolveClientNextActionAt(client));
  if (nextActionAt) {
    return nextActionAt < dayStart;
  }

  const status = normalizePipelineStatus(client.status_pipeline);
  if (status !== "contato_feito" && status !== "aguardando_retorno") {
    return false;
  }

  const chaseDueAt = parseDateSafe(client.chase_due_at);
  return chaseDueAt ? chaseDueAt < dayStart : false;
};

const getStageDateRows = (client: Client) => {
  const status = normalizePipelineStatus(client.status_pipeline);
  const nextActionAt = resolveClientNextActionAt(client);
  const returnAnchor = resolveClientReturnAnchor(client);

  if (status === "novo_match") {
    return [
      { label: "Entrou em", value: formatDateDisplay(client.added_at ?? client.created_at) },
      { label: "Próxima ação", value: formatDateTimeDisplay(nextActionAt) }
    ];
  }

  if (status === "contato_feito") {
    return [
      { label: "Contato em", value: formatDateTimeDisplay(client.last_contact_at) },
      { label: "Retornar em", value: formatDateTimeDisplay(returnAnchor) }
    ];
  }

  if (status === "em_conversa") {
    return [{ label: "Respondeu em", value: formatDateTimeDisplay(client.last_reply_at) }];
  }

  if (status === "aguardando_retorno") {
    return [
      { label: "Enviado em", value: formatDateTimeDisplay(client.last_contact_at) },
      { label: "Cobrar em", value: formatDateTimeDisplay(returnAnchor) }
    ];
  }

  return [{ label: "Próxima ação", value: formatDateTimeDisplay(nextActionAt) }];
};

const parseFreshDays = (value: string | number | null | undefined) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed === 7 || parsed === 15 || parsed === 30) return parsed;
  return null;
};

const passesMinOrZero = (
  listingValue: number | null | undefined,
  minValue: number | null
) => {
  if (minValue === null) return true;
  if (typeof listingValue !== "number" || !Number.isFinite(listingValue)) {
    return false;
  }
  return listingValue >= minValue;
};

const passesMaxOrZero = (
  listingValue: number | null | undefined,
  maxValue: number | null
) => {
  if (maxValue === null) return true;
  if (typeof listingValue !== "number" || !Number.isFinite(listingValue)) {
    return true;
  }
  return listingValue === 0 || listingValue <= maxValue;
};

const isMissingColumnError = (errorMessage?: string) =>
  typeof errorMessage === "string" &&
  /(column .* does not exist|could not find the .* column .* schema cache|pgrst204)/i.test(
    errorMessage
  );

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
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const {
    context: organizationContext,
    organizationId,
    loading: organizationLoading,
    needsOrganizationChoice,
    error: organizationError
  } = useOrganizationContext();

  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [clientDraft, setClientDraft] = useState({
    name: "",
    email: "",
    phone: "",
    next_action_at: "",
    descricao_contexto: "",
    status_pipeline: PIPELINE_STEPS[0].value as string
  });
  const [isCreatingClient, setIsCreatingClient] = useState(false);
  const [clientSaving, setClientSaving] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [isLoadingClients, setIsLoadingClients] = useState(true);

  const [filterDraft, setFilterDraft] = useState({
    active: true,
    min_price: "",
    max_price: "",
    min_rent: "",
    max_rent: "",
    neighborhoods: "",
    min_bedrooms: "",
    min_bathrooms: "",
    min_parking: "",
    min_area_m2: "",
    max_area_m2: "",
    max_days_fresh: "15",
    deal_type: "venda" as "venda" | "aluguel",
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
  const [isClientSide, setIsClientSide] = useState(false);
  const [timelineEvents, setTimelineEvents] = useState<CrmTimelineEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [mobileStagePickerOpen, setMobileStagePickerOpen] = useState(false);
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [statusModalSaving, setStatusModalSaving] = useState(false);
  const [statusModalError, setStatusModalError] = useState<string | null>(null);
  const [clientFormModalOpen, setClientFormModalOpen] = useState(false);
  const [resultOverlayType, setResultOverlayType] = useState<"won" | "lost" | null>(
    null
  );
  const [statusModalTarget, setStatusModalTarget] =
    useState<PipelineStatus>("novo_match");
  const [statusModalFrom, setStatusModalFrom] =
    useState<PipelineStatus>("novo_match");
  const [statusModalSource, setStatusModalSource] =
    useState<PipelineModalSource>("pipeline");
  const [transitionDraft, setTransitionDraft] = useState<PipelineTransitionDraft>(
    createInitialPipelineTransitionDraft
  );
  const [confirmedIndex, setConfirmedIndex] = useState(0);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const [animIndex, setAnimIndex] = useState(0);
  const [isPipelineAnimating, setIsPipelineAnimating] = useState(false);
  const [pipelineTrack, setPipelineTrack] = useState({
    start: 0,
    width: 0,
    fill: 0,
    top: 0,
    ready: false
  });
  const prefersReducedMotion = useReducedMotion();

  const realtimeRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const queueRef = useRef<Match[]>([]);
  const queueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pipelineAnimationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processingQueueRef = useRef(false);
  const selectedClientIdRef = useRef<string | null>(null);
  const lastAppliedClientsBundleKeyRef = useRef<string | null>(null);
  const lastAppliedClientBundleKeyRef = useRef<string | null>(null);
  const lastViewedAtRef = useRef<Record<string, string>>({});
  const matchIdsRef = useRef<Set<string>>(new Set());
  const pipelineChipsRef = useRef<HTMLDivElement | null>(null);
  const pipelineButtonRefs = useRef<Record<PipelineStatus, HTMLButtonElement | null>>(
    {
      novo_match: null,
      contato_feito: null,
      em_conversa: null,
      aguardando_retorno: null,
      visita_agendada: null,
      proposta: null,
      fechado: null
    }
  );
  const acknowledgeClientViewRef = useRef<(clientId: string) => void>(() => { });
  const listingRulesRef = useRef<ListingRules | null>(null);

  const confirmedPipelineStatus = normalizePipelineStatus(clientDraft.status_pipeline);
  const displayIndex = isPipelineAnimating ? animIndex : confirmedIndex;
  const displayPipelineStatus =
    PIPELINE_STEPS[displayIndex]?.value ?? PIPELINE_STEPS[0].value;
  const isResultOverlayVisible = Boolean(resultOverlayType);
  const statusModalIsActivityOnly = statusModalFrom === statusModalTarget;
  const statusModalScheduleLabel =
    statusModalTarget === "contato_feito"
      ? "Retornar em"
      : statusModalTarget === "aguardando_retorno"
        ? "Cobrar em"
        : "Próxima ação";
  const pipelineProgressPercent =
    PIPELINE_STEPS.length > 1
      ? (displayIndex / (PIPELINE_STEPS.length - 1)) * 100
      : 0;
  const selectedNeighborhoods = useMemo(
    () => toArray(filterDraft.neighborhoods),
    [filterDraft.neighborhoods]
  );
  const selectedPropertyTypes = useMemo(
    () => toPropertyTypeValues(filterDraft.property_types),
    [filterDraft.property_types]
  );
  const requestedClientId = useMemo(() => {
    const value = searchParams.get("clientId");
    return value && value.trim().length > 0 ? value.trim() : null;
  }, [searchParams]);
  const requestedDueFilter = useMemo(
    () => parseDueFilter(searchParams.get("due")),
    [searchParams]
  );
  const clientsQueryOptions = useMemo(
    () =>
      createCrmClientsQueryOptions({
        supabase,
        organizationId: organizationId ?? "__no-org__"
      }),
    [organizationId, supabase]
  );
  const selectedClientBundleQueryOptions = useMemo(
    () =>
      createCrmClientBundleQueryOptions({
        supabase,
        organizationId: organizationId ?? "__no-org__",
        clientId: selectedClientId ?? "__no-client__"
      }),
    [organizationId, selectedClientId, supabase]
  );
  const clientsQuery = useQuery({
    ...clientsQueryOptions,
    enabled: Boolean(organizationId && !organizationLoading),
    placeholderData: (previous) => previous
  });
  const selectedClientBundleQuery = useQuery({
    ...selectedClientBundleQueryOptions,
    enabled: Boolean(organizationId && selectedClientId),
    placeholderData: (previous) => previous
  });
  const clientsSource = useMemo(
    () => clientsQuery.data?.clients ?? [],
    [clientsQuery.data]
  );
  const activeClientsSource = useMemo(
    () =>
      clientsSource.filter(
        (client) => normalizePipelineStatus(client.status_pipeline) !== "fechado"
      ),
    [clientsSource]
  );
  const selectedClient = useMemo(
    () => activeClientsSource.find((client) => client.id === selectedClientId) ?? null,
    [activeClientsSource, selectedClientId]
  );
  const visibleClients = useMemo(() => {
    if (!requestedDueFilter) return activeClientsSource;
    const now = new Date();
    if (requestedDueFilter === "today") {
      return activeClientsSource.filter((client) => isClientDueToday(client, now));
    }
    return activeClientsSource.filter((client) => isClientOverdue(client, now));
  }, [activeClientsSource, requestedDueFilter]);
  const userClosureCounts = useMemo(
    () =>
      clientsSource.reduce(
        (acc, client) => {
          if (normalizePipelineStatus(client.status_pipeline) !== "fechado") {
            return acc;
          }
          if (client.closed_outcome === "won") {
            acc.won += 1;
          } else if (client.closed_outcome === "lost") {
            acc.lost += 1;
          }
          return acc;
        },
        { won: 0, lost: 0 }
      ),
    [clientsSource]
  );

  const getAuthenticatedUserId = useCallback(async () => {
    const {
      data: { user },
      error
    } = await supabase.auth.getUser();

    if (error || !user) {
      const message = error?.message ?? "Usuário não autenticado.";
      console.error("Erro ao obter usuário autenticado:", error ?? message);
      return null;
    }

    return user.id;
  }, [supabase]);

  const isClientOwnedByUser = useCallback(
    (clientId: string, userId: string) =>
      clientsSource.some((client) => {
        if (client.id !== clientId) return false;
        const ownerId = client.owner_user_id ?? client.user_id;
        return ownerId === userId;
      }),
    [clientsSource]
  );

  const clearPipelineAnimationTimer = useCallback(() => {
    if (!pipelineAnimationTimerRef.current) return;
    clearTimeout(pipelineAnimationTimerRef.current);
    pipelineAnimationTimerRef.current = null;
  }, []);

  const playPipelineProgressAnimation = useCallback(
    async (targetIndex: number) => {
      const normalizedTarget = Math.max(
        0,
        Math.min(targetIndex, PIPELINE_STEPS.length - 1)
      );

      clearPipelineAnimationTimer();

      if (prefersReducedMotion) {
        setAnimIndex(normalizedTarget);
        setIsPipelineAnimating(false);
        return;
      }

      setIsPipelineAnimating(true);
      setAnimIndex(0);

      await new Promise<void>((resolve) => {
        let current = 0;
        const stepMs = 150;

        const tick = () => {
          if (current >= normalizedTarget) {
            setAnimIndex(normalizedTarget);
            setIsPipelineAnimating(false);
            pipelineAnimationTimerRef.current = null;
            resolve();
            return;
          }

          current += 1;
          setAnimIndex(current);
          pipelineAnimationTimerRef.current = setTimeout(tick, stepMs);
        };

        if (normalizedTarget === 0) {
          setAnimIndex(0);
          setIsPipelineAnimating(false);
          resolve();
          return;
        }

        pipelineAnimationTimerRef.current = setTimeout(tick, stepMs);
      });
    },
    [clearPipelineAnimationTimer, prefersReducedMotion]
  );

  const playResultOverlay = useCallback(async (type: "won" | "lost") => {
    setResultOverlayType(type);

    await new Promise<void>((resolve) => {
      if (resultOverlayTimerRef.current) {
        clearTimeout(resultOverlayTimerRef.current);
      }
      resultOverlayTimerRef.current = setTimeout(() => {
        resultOverlayTimerRef.current = null;
        resolve();
      }, RESULT_OVERLAY_DURATION_MS);
    });

    setResultOverlayType(null);
  }, []);

  const recalculatePipelineTrack = useCallback(() => {
    const container = pipelineChipsRef.current;
    const first = pipelineButtonRefs.current[PIPELINE_STEPS[0].value];
    const last = pipelineButtonRefs.current[PIPELINE_STEPS[PIPELINE_STEPS.length - 1].value];
    const active = pipelineButtonRefs.current[displayPipelineStatus];

    if (!container || !first || !last || !active) {
      setPipelineTrack((prev) =>
        prev.ready ? { start: 0, width: 0, fill: 0, top: 0, ready: false } : prev
      );
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const firstRect = first.getBoundingClientRect();
    const lastRect = last.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();

    const start = firstRect.left + firstRect.width / 2 - containerRect.left;
    const end = lastRect.left + lastRect.width / 2 - containerRect.left;
    const activeCenter =
      activeRect.left + activeRect.width / 2 - containerRect.left;
    const lineTop =
      firstRect.top -
      containerRect.top +
      firstRect.height / 2 +
      Math.max(firstRect.height * 0.62, 10);

    const width = Math.max(end - start, 0);
    const fill = Math.min(Math.max(activeCenter - start, 0), width);

    setPipelineTrack({ start, width, fill, top: lineTop, ready: true });
  }, [displayPipelineStatus]);

  useEffect(() => {
    const nextIndex = PIPELINE_INDEX_BY_STATUS[confirmedPipelineStatus];
    setConfirmedIndex(nextIndex);
    if (!isPipelineAnimating) {
      setAnimIndex(nextIndex);
    }
  }, [confirmedPipelineStatus, isPipelineAnimating]);

  useEffect(() => () => clearPipelineAnimationTimer(), [clearPipelineAnimationTimer]);

  useEffect(
    () => () => {
      if (resultOverlayTimerRef.current) {
        clearTimeout(resultOverlayTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    const raf = window.requestAnimationFrame(recalculatePipelineTrack);
    return () => window.cancelAnimationFrame(raf);
  }, [recalculatePipelineTrack, selectedClientId, statusModalOpen, displayIndex]);

  useEffect(() => {
    const onResize = () => recalculatePipelineTrack();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [recalculatePipelineTrack]);

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

  const resetDraftFromClient = useCallback((client: Client | null) => {
    const nextDraft = {
      name: client?.name ?? "",
      email: client?.contact_info?.email ?? "",
      phone: client?.contact_info?.phone ?? "",
      next_action_at: toDateInputValue(resolveClientNextActionAt(client)),
      descricao_contexto: client?.descricao_contexto ?? "",
      status_pipeline: normalizePipelineStatus(client?.status_pipeline)
    };
    setClientDraft((previous) => {
      if (
        previous.name === nextDraft.name &&
        previous.email === nextDraft.email &&
        previous.phone === nextDraft.phone &&
        previous.next_action_at === nextDraft.next_action_at &&
        previous.descricao_contexto === nextDraft.descricao_contexto &&
        previous.status_pipeline === nextDraft.status_pipeline
      ) {
        return previous;
      }
      return nextDraft;
    });
  }, []);

  const openCreateClientForm = useCallback(() => {
    setIsCreatingClient(true);
    setClientError(null);
    setClientDraft({
      name: "",
      email: "",
      phone: "",
      next_action_at: "",
      descricao_contexto: "",
      status_pipeline: PIPELINE_STEPS[0].value
    });
    setClientFormModalOpen(true);
  }, []);

  const openEditClientForm = useCallback(() => {
    if (!selectedClient) return;
    setIsCreatingClient(false);
    setClientError(null);
    resetDraftFromClient(selectedClient);
    setClientFormModalOpen(true);
  }, [resetDraftFromClient, selectedClient]);

  const closeClientFormModal = useCallback(() => {
    if (clientSaving) return;
    setClientFormModalOpen(false);
    if (isCreatingClient) {
      setIsCreatingClient(false);
    }
    if (selectedClient) {
      resetDraftFromClient(selectedClient);
    }
  }, [clientSaving, isCreatingClient, resetDraftFromClient, selectedClient]);

  useEffect(() => {
    if (!requestedDueFilter || isCreatingClient || visibleClients.length === 0) {
      return;
    }

    if (
      selectedClientId &&
      visibleClients.some((client) => client.id === selectedClientId)
    ) {
      return;
    }

    const firstClient = visibleClients[0];
    setSelectedClientId(firstClient.id);
    resetDraftFromClient(firstClient);
  }, [
    isCreatingClient,
    resetDraftFromClient,
    requestedDueFilter,
    selectedClientId,
    visibleClients
  ]);

  const getStatusLabel = (status?: string | null) =>
    PIPELINE_STATUS_LABEL[normalizePipelineStatus(status)];
  const getNextActionLabel = (value?: string | null) =>
    NEXT_ACTION_OPTIONS.find((option) => option.value === value)?.label ?? value ?? "—";
  const getLostReasonLabel = (value?: string | null) =>
    LOST_REASON_OPTIONS.find((option) => option.value === value)?.label ?? value ?? "—";

  const getNeighborhood = (listing?: Listing | null) =>
    listing?.neighborhood ?? "Bairro não informado";
  const getPropertyTypeLabel = (listing?: Listing | null) =>
    getUnifiedPropertyLabelForListing(listing);
  const getPortalLabel = (listing?: Listing | null) => {
    if (!listing?.url) return "Sem portal";
    try {
      const hostname = new URL(listing.url).hostname.replace(/^www\./, "");
      return hostname.split(".")[0]?.toUpperCase() || "Portal";
    } catch {
      return "Portal";
    }
  };

  const getListingComparablePrice = (
    listing: Listing | null | undefined,
    dealType: "venda" | "aluguel"
  ) => (dealType === "aluguel" ? listing?.total_cost : listing?.price);

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

  const getRentRange = (override?: ClientFilter | null) => {
    const min =
      typeof override?.min_rent === "number"
        ? override.min_rent
        : parseBRNumber(filterDraft.min_rent);
    const max =
      typeof override?.max_rent === "number"
        ? override.max_rent
        : parseBRNumber(filterDraft.max_rent);
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
    const maxAreaM2 =
      typeof override?.max_area_m2 === "number"
        ? parseMinFilter(override.max_area_m2)
        : parseMinInput(filterDraft.max_area_m2);
    const propertyTypes = Array.isArray(override?.property_types)
      ? normalizeUnifiedPropertyCategories(override.property_types)
      : selectedPropertyTypes;

    const dealType = override ? override.deal_type || "venda" : filterDraft.deal_type;

    return {
      minBedrooms,
      minBathrooms,
      minParking,
      minAreaM2,
      maxAreaM2,
      propertyTypes,
      dealType
    };
  };

  const getMaxDaysFresh = (override?: ClientFilter | null) => {
    if (typeof override?.max_days_fresh === "number") {
      return parseFreshDays(override.max_days_fresh);
    }
    return parseFreshDays(filterDraft.max_days_fresh);
  };

  const isWithinFreshWindow = (
    listing?: Listing | null,
    override?: ClientFilter | null
  ) => {
    const maxDaysFresh = getMaxDaysFresh(override);
    if (maxDaysFresh === null) return true;
    const referenceDate = listing?.published_at ?? listing?.first_seen_at;
    if (!referenceDate) return true;
    const ts = new Date(referenceDate).getTime();
    if (!Number.isFinite(ts)) return true;
    const cutoff = Date.now() - maxDaysFresh * 24 * 60 * 60 * 1000;
    return ts >= cutoff;
  };

  const isWithinPriceRange = (
    listing?: Listing | null,
    override?: ClientFilter | null
  ): boolean => {
    const { min, max } = getPriceRange(override);
    const dealType = override?.deal_type ?? filterDraft.deal_type ?? "venda";
    if (typeof min === "number" && typeof max === "number") {
      const totalComparable = getListingComparablePrice(listing, dealType);
      if (typeof totalComparable !== "number") return false;
      if (totalComparable < min || totalComparable > max) return false;
    }

    if (dealType === "aluguel") {
      const { min: minRent, max: maxRent } = getRentRange(override);
      if (typeof minRent === "number" && typeof maxRent === "number") {
        const rentValue = listing?.price;
        if (typeof rentValue !== "number") return false;
        if (rentValue < minRent || rentValue > maxRent) return false;
      }
    }

    return true;
  };

  const filterByPriceRange = (rows: Match[], override?: ClientFilter | null) => {
    const { min, max } = getPriceRange(override);
    const dealType = override?.deal_type ?? filterDraft.deal_type ?? "venda";
    const { min: minRent, max: maxRent } = getRentRange(override);
    if (
      typeof min !== "number" &&
      typeof max !== "number" &&
      (dealType !== "aluguel" ||
        (typeof minRent !== "number" && typeof maxRent !== "number"))
    ) {
      return rows;
    }
    return rows.filter((row) => {
      if (typeof min === "number" && typeof max === "number") {
        const totalComparable = getListingComparablePrice(row.listing, dealType);
        if (
          typeof totalComparable !== "number" ||
          totalComparable < min ||
          totalComparable > max
        ) {
          return false;
        }
      }

      if (
        dealType === "aluguel" &&
        typeof minRent === "number" &&
        typeof maxRent === "number"
      ) {
        const rentValue = row.listing?.price;
        if (typeof rentValue !== "number" || rentValue < minRent || rentValue > maxRent) {
          return false;
        }
      }

      return true;
    });
  };

  const isWithinListingRules = (
    listing?: Listing | null,
    override?: ClientFilter | null
  ): boolean => {
    if (!listing) return true;

    const {
      minBedrooms,
      minBathrooms,
      minParking,
      minAreaM2,
      maxAreaM2,
      propertyTypes,
      dealType
    } =
      getListingFilters(override);

    if (dealType && listing.deal_type && listing.deal_type !== dealType) {
      return false;
    }

    if (propertyTypes.length > 0 && !matchesUnifiedPropertyFilter(listing, propertyTypes)) {
      return false;
    }

    const isTerreno = isTerrenoListing(listing);
    if (!isTerreno && !passesMinOrZero(listing.bedrooms, minBedrooms)) return false;
    if (!isTerreno && !passesMinOrZero(listing.bathrooms, minBathrooms)) return false;
    if (!isTerreno && !passesMinOrZero(listing.parking, minParking)) return false;
    if (!passesMinOrZero(listing.area_m2, minAreaM2)) return false;
    if (!passesMaxOrZero(listing.area_m2, maxAreaM2)) return false;

    return true;
  };

  const filterMatchesByDraft = (rows: Match[], override?: ClientFilter | null) =>
    filterByPriceRange(rows, override).filter(
      (row) =>
        isWithinFreshWindow(row.listing, override) &&
        isWithinListingRules(row.listing, override)
    );
  listingRulesRef.current = {
    isWithinPriceRange,
    isWithinListingRules,
    isWithinFreshWindow
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

  const fetchClientAlerts = async (ownerUserIdArg?: string) => {
    if (!organizationId) {
      setClientAlerts({});
      return;
    }

    const ownerUserId = ownerUserIdArg ?? (await getAuthenticatedUserId());
    if (!ownerUserId) {
      setAlertsError("Usuário não autenticado para carregar alertas.");
      setClientAlerts({});
      return;
    }

    setAlertsError(null);
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
      ownedClientRows =
        (legacyScopedClients.data as { id: string }[] | null) ?? [];
      ownerScopedClientsError = legacyScopedClients.error;
    }

    if (ownerScopedClientsError) {
      setAlertsError(ownerScopedClientsError.message);
      setClientAlerts({});
      console.error("Erro ao carregar clientes do usuário para alertas:", ownerScopedClientsError);
      return;
    }

    const ownedClientIds = ownedClientRows.map((row) => row.id);
    if (ownedClientIds.length === 0) {
      setClientAlerts({});
      return;
    }

    const { data, error } = await supabase
      .from("automated_matches")
      .select("client_id")
      .eq("org_id", organizationId)
      .in("client_id", ownedClientIds)
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
    let listingQuery = supabase
      .from("listings")
      .select(
        "id, title, price, total_cost, neighborhood, bedrooms, bathrooms, parking, area_m2, deal_type, property_type, property_subtype, url, main_image_url, published_at, first_seen_at"
      )
      .in("id", ids);

    if (organizationId) {
      listingQuery = listingQuery.or(`org_id.is.null,org_id.eq.${organizationId}`);
    }

    const { data, error } = await listingQuery;

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

  const applyClientsBundle = useCallback(
    (
      bundle: {
        clients: Client[];
        clientAlerts: Record<string, number>;
      },
      options?: {
        nextSelectedId?: string | null;
      }
    ) => {
      const sorted = bundle.clients;
      const activeClients = sorted.filter(
        (client) => normalizePipelineStatus(client.status_pipeline) !== "fechado"
      );
      setClientAlerts(bundle.clientAlerts);
      setClientError(null);
      setAlertsError(null);
      setIsLoadingClients(false);

      if (activeClients.length === 0) {
        setIsCreatingClient(false);
        setSelectedClientId(null);
        return;
      }

      const requestedSelection = requestedDueFilter ? null : requestedClientId;
      const preferredSelection =
        options?.nextSelectedId ??
        requestedSelection ??
        selectedClientIdRef.current ??
        null;

      if (preferredSelection) {
        const found =
          activeClients.find((client) => client.id === preferredSelection) ?? null;
        if (found) {
          setSelectedClientId(preferredSelection);
          setIsCreatingClient(false);
          resetDraftFromClient(found);
          return;
        }
      }

      const fallbackClient = activeClients[0];
      setSelectedClientId(fallbackClient.id);
      setIsCreatingClient(false);
      resetDraftFromClient(fallbackClient);
    },
    [requestedClientId, requestedDueFilter, resetDraftFromClient]
  );

  const fetchClients = useCallback(
    async (nextSelectedId?: string) => {
      if (!organizationId) {
        setClientAlerts({});
        setSelectedClientId(null);
        setClientError(null);
        setAlertsError(null);
        setIsLoadingClients(false);
        return;
      }

      const queryOptions = createCrmClientsQueryOptions({
        supabase,
        organizationId
      });
      const cached = queryClient.getQueryData<{
        clients: Client[];
        clientAlerts: Record<string, number>;
      }>(queryOptions.queryKey);
      if (cached) {
        applyClientsBundle(cached, { nextSelectedId });
      } else if (clientsSource.length === 0) {
        setIsLoadingClients(true);
      }

      try {
        const fresh = await queryClient.fetchQuery({
          ...queryOptions,
          staleTime: 0
        });
        applyClientsBundle(fresh, { nextSelectedId });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Erro ao carregar clientes.";
        setClientError(message);
        setAlertsError(message);
        setIsLoadingClients(false);
      }
    },
    [applyClientsBundle, clientsSource.length, organizationId, queryClient, supabase]
  );

  const fetchTimeline = async (clientId: string) => {
    if (!organizationId) {
      setTimelineEvents([]);
      setTimelineLoading(false);
      return;
    }

    const ownerUserId = await getAuthenticatedUserId();
    if (!ownerUserId) {
      setTimelineError("Usuário não autenticado para carregar timeline.");
      setTimelineEvents([]);
      setTimelineLoading(false);
      return;
    }

    if (!isClientOwnedByUser(clientId, ownerUserId)) {
      setTimelineError("Cliente fora do escopo do usuário logado.");
      setTimelineEvents([]);
      setTimelineLoading(false);
      return;
    }

    setTimelineLoading(true);
    setTimelineError(null);

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
      setTimelineError(error.message);
      setTimelineEvents([]);
      console.error("Erro ao buscar timeline:", error);
    } else {
      setTimelineEvents((data as CrmTimelineEvent[] | null) ?? []);
    }

    setTimelineLoading(false);
  };

  const openStatusTransitionModal = (
    nextStatus: PipelineStatus,
    source: PipelineModalSource = "pipeline"
  ) => {
    if (!organizationId) {
      setClientError("Nenhuma organizacao ativa para atualizar o pipeline.");
      return;
    }

    if (!selectedClientId || !selectedClient) {
      setClientError("Selecione e salve um cliente antes de mover no pipeline.");
      return;
    }

    const currentStatus = normalizePipelineStatus(
      selectedClient.status_pipeline ?? clientDraft.status_pipeline
    );

    const nextDraft = createInitialPipelineTransitionDraft();
    if (
      selectedClient.next_action &&
      NEXT_ACTION_SET.has(selectedClient.next_action as NextActionValue)
    ) {
      nextDraft.next_action = selectedClient.next_action as NextActionValue;
    }

    const persistedNextActionAt = resolveClientReturnAnchor(selectedClient);
    if (persistedNextActionAt) {
      nextDraft.no_followup_date = false;
      nextDraft.next_action_at = toDateTimeLocalInputValue(persistedNextActionAt);
    } else {
      nextDraft.no_followup_date = true;
      nextDraft.next_action_at = "";
    }

    if (
      (nextStatus === "contato_feito" || nextStatus === "aguardando_retorno") &&
      !nextDraft.next_action_at
    ) {
      const suggestionHours =
        nextStatus === "contato_feito" ? CONTACT_CHASE_HOURS : RETURN_CHASE_HOURS;
      const suggestedIso = new Date(Date.now() + suggestionHours * 60 * 60 * 1000).toISOString();
      nextDraft.no_followup_date = false;
      nextDraft.next_action_at = toDateTimeLocalInputValue(suggestedIso);
    }

    if (nextStatus === "visita_agendada") {
      nextDraft.visit_at = toDateTimeLocalInputValue(selectedClient.visit_at);
      nextDraft.visit_notes = selectedClient.visit_notes ?? "";
    }

    if (nextStatus === "proposta") {
      nextDraft.proposal_value =
        typeof selectedClient.proposal_value === "number"
          ? String(selectedClient.proposal_value)
          : "";
      nextDraft.proposal_valid_until = toDateInputValue(
        selectedClient.proposal_valid_until
      );
    }

    if (nextStatus === "fechado") {
      nextDraft.closed_outcome =
        selectedClient.closed_outcome === "won" ||
          selectedClient.closed_outcome === "lost"
          ? selectedClient.closed_outcome
          : "won";
      if (
        selectedClient.lost_reason &&
        LOST_REASON_SET.has(selectedClient.lost_reason as LostReasonValue)
      ) {
        nextDraft.lost_reason = selectedClient.lost_reason as LostReasonValue;
      }
      nextDraft.lost_reason_detail = selectedClient.lost_reason_detail ?? "";
    }

    setStatusModalFrom(currentStatus);
    setStatusModalTarget(nextStatus);
    setStatusModalSource(source);
    setMobileStagePickerOpen(false);
    setPendingIndex(PIPELINE_INDEX_BY_STATUS[nextStatus]);
    setTransitionDraft(nextDraft);
    setStatusModalError(null);
    setStatusModalOpen(true);
  };

  const closeStatusTransitionModal = () => {
    if (statusModalSaving) return;
    setStatusModalOpen(false);
    setPendingIndex(null);
    setStatusModalError(null);
  };

  const handlePipelineChange = (
    nextStatus: PipelineStatus,
    source: PipelineModalSource = "pipeline"
  ) => {
    setMobileStagePickerOpen(false);
    openStatusTransitionModal(nextStatus, source);
  };

  const handleConfirmStatusTransition = async () => {
    if (!organizationId || !selectedClientId || !selectedClient) {
      setStatusModalError("Cliente inválido para atualizar status.");
      return;
    }

    const ownerUserId = await getAuthenticatedUserId();
    if (!ownerUserId) {
      setStatusModalError("Usuário não autenticado para atualizar o pipeline.");
      return;
    }
    if (!isClientOwnedByUser(selectedClientId, ownerUserId)) {
      setStatusModalError("Você não tem acesso para atualizar este cliente.");
      return;
    }

    const parsedNextActionAt = transitionDraft.next_action_at
      ? fromDateTimeLocalInputValue(transitionDraft.next_action_at)
      : null;

    if (transitionDraft.next_action_at && !parsedNextActionAt) {
      setStatusModalError("Data da próxima ação inválida.");
      return;
    }

    const nextActionAt = transitionDraft.no_followup_date ? null : parsedNextActionAt;

    let visitAt: string | null = null;
    if (statusModalTarget === "visita_agendada") {
      visitAt = fromDateTimeLocalInputValue(transitionDraft.visit_at);
      if (!visitAt) {
        setStatusModalError("Data/hora da visita é obrigatória.");
        return;
      }
    }

    let proposalValue: number | null = null;
    let proposalValidUntil: string | null = null;
    if (statusModalTarget === "proposta") {
      proposalValue = parseDecimalInput(transitionDraft.proposal_value);
      if (proposalValue === null) {
        setStatusModalError("Valor da proposta é obrigatório.");
        return;
      }
      if (transitionDraft.proposal_valid_until) {
        const proposalDate = new Date(transitionDraft.proposal_valid_until);
        if (Number.isNaN(proposalDate.getTime())) {
          setStatusModalError("Validade da proposta inválida.");
          return;
        }
        proposalValidUntil = proposalDate.toISOString();
      }
    }

    let closedOutcome: ClosedOutcome = null;
    let lostReason: LostReasonValue | null = null;
    let lostReasonDetail: string | null = null;
    if (statusModalTarget === "fechado") {
      closedOutcome = transitionDraft.closed_outcome;
      if (!closedOutcome) {
        setStatusModalError("Selecione se o fechamento foi ganho ou perdido.");
        return;
      }

      if (closedOutcome === "lost") {
        if (!transitionDraft.lost_reason) {
          setStatusModalError("Motivo da perda é obrigatório.");
          return;
        }
        lostReason = transitionDraft.lost_reason;
        lostReasonDetail = transitionDraft.lost_reason_detail.trim() || null;
      }
    }

    const finalValue = parseDecimalInput(transitionDraft.final_value);
    const nowIso = new Date().toISOString();
    const isContactStage =
      statusModalTarget === "contato_feito" || statusModalTarget === "aguardando_retorno";
    const shouldTrackReply = statusModalTarget === "em_conversa";
    const lastContactAt = isContactStage ? nowIso : selectedClient.last_contact_at ?? null;
    const lastReplyAt = shouldTrackReply ? nowIso : selectedClient.last_reply_at ?? null;
    const autoChaseDueAt = isContactStage
      ? addHoursIso(
        nowIso,
        statusModalTarget === "contato_feito" ? CONTACT_CHASE_HOURS : RETURN_CHASE_HOURS
      )
      : null;
    const chaseDueAt = isContactStage ? nextActionAt ?? autoChaseDueAt : null;

    const isStatusChange = statusModalTarget !== statusModalFrom;
    const updatePayload: Record<string, unknown> = {
      status_pipeline: statusModalTarget,
      closed_outcome: statusModalTarget === "fechado" ? closedOutcome : null,
      lost_reason:
        statusModalTarget === "fechado" && closedOutcome === "lost"
          ? lostReason
          : null,
      lost_reason_detail:
        statusModalTarget === "fechado" && closedOutcome === "lost"
          ? lostReasonDetail
          : null,
      next_action: transitionDraft.next_action || null,
      next_action_at: nextActionAt,
      next_followup_at: nextActionAt,
      chase_due_at: chaseDueAt,
      last_contact_at: lastContactAt,
      last_reply_at: lastReplyAt,
      data_retorno: nextActionAt ? nextActionAt.slice(0, 10) : null
    };
    if (isStatusChange) {
      updatePayload.last_status_change_at = nowIso;
    }

    const legacyUpdatePayload: Record<string, unknown> = {
      status_pipeline: statusModalTarget,
      closed_outcome: statusModalTarget === "fechado" ? closedOutcome : null,
      lost_reason:
        statusModalTarget === "fechado" && closedOutcome === "lost"
          ? lostReason
          : null,
      lost_reason_detail:
        statusModalTarget === "fechado" && closedOutcome === "lost"
          ? lostReasonDetail
          : null,
      next_action: transitionDraft.next_action || null,
      next_followup_at: nextActionAt,
      data_retorno: nextActionAt ? nextActionAt.slice(0, 10) : null
    };
    if (isStatusChange) {
      legacyUpdatePayload.last_status_change_at = nowIso;
    }

    if (statusModalTarget === "visita_agendada") {
      updatePayload.visit_at = visitAt;
      updatePayload.visit_notes = transitionDraft.visit_notes.trim() || null;
      legacyUpdatePayload.visit_at = visitAt;
      legacyUpdatePayload.visit_notes = transitionDraft.visit_notes.trim() || null;
    }

    if (statusModalTarget === "proposta") {
      updatePayload.proposal_value = proposalValue;
      updatePayload.proposal_valid_until = proposalValidUntil;
      legacyUpdatePayload.proposal_value = proposalValue;
      legacyUpdatePayload.proposal_valid_until = proposalValidUntil;
    }

    setStatusModalSaving(true);
    setStatusModalError(null);
    setClientError(null);

    let { error: updateError } = await supabase
      .from("clients")
      .update(updatePayload)
      .eq("id", selectedClientId)
      .eq("org_id", organizationId)
      .eq("owner_user_id", ownerUserId);

    if (updateError && isMissingColumnError(updateError.message)) {
      const fallback = await supabase
        .from("clients")
        .update(legacyUpdatePayload)
        .eq("id", selectedClientId)
        .eq("org_id", organizationId)
        .eq("user_id", ownerUserId);
      updateError = fallback.error;
    }

    if (updateError) {
      setStatusModalSaving(false);
      setStatusModalError(updateError.message);
      console.error("Erro ao atualizar pipeline:", updateError);
      return;
    }

    const timelinePayload: TimelinePayload = {
      source: statusModalSource,
      note: transitionDraft.note.trim() || null,
      next_action: transitionDraft.next_action || null,
      next_action_at: nextActionAt,
      next_followup_at: nextActionAt,
      chase_due_at: chaseDueAt,
      last_contact_at: lastContactAt,
      last_reply_at: lastReplyAt,
      visit_at: visitAt,
      visit_notes: transitionDraft.visit_notes.trim() || null,
      proposal_value: proposalValue,
      proposal_valid_until: proposalValidUntil,
      closed_outcome: closedOutcome,
      lost_reason: lostReason,
      lost_reason_detail: lostReasonDetail,
      final_value: finalValue,
      final_note: transitionDraft.final_note.trim() || null
    };

    const timelinePayloadClean = Object.fromEntries(
      Object.entries(timelinePayload).filter(([, value]) => value !== undefined)
    );

    const { error: timelineInsertError } = await supabase.from("crm_timeline").insert({
      org_id: organizationId,
      client_id: selectedClientId,
      event_type: isStatusChange ? "STATUS_CHANGE" : "PIPELINE_ACTIVITY",
      from_status: statusModalFrom,
      to_status: statusModalTarget,
      payload: timelinePayloadClean
    });

    if (timelineInsertError) {
      console.error("Erro ao registrar evento da timeline:", timelineInsertError);
      setClientError(
        `Status atualizado, mas não foi possível registrar histórico: ${timelineInsertError.message}`
      );
    }

    const targetIndex = PIPELINE_INDEX_BY_STATUS[statusModalTarget];
    setConfirmedIndex(targetIndex);
    setClientDraft((prev) => ({ ...prev, status_pipeline: statusModalTarget }));
    queryClient.setQueryData<{
      ownerUserId: string;
      clients: Client[];
      clientAlerts: Record<string, number>;
    }>(crmQueryKeys.clients(organizationId), (previous) => {
      if (!previous) return previous;

      return {
        ...previous,
        clients: previous.clients.map((client) =>
          client.id === selectedClientId
            ? {
              ...client,
              status_pipeline: statusModalTarget,
              closed_outcome:
                statusModalTarget === "fechado" ? closedOutcome : null,
              lost_reason:
                statusModalTarget === "fechado" && closedOutcome === "lost"
                  ? lostReason
                  : null,
              lost_reason_detail:
                statusModalTarget === "fechado" && closedOutcome === "lost"
                  ? lostReasonDetail
                  : null,
              next_action: transitionDraft.next_action || null,
              next_action_at: nextActionAt,
              next_followup_at: nextActionAt,
              chase_due_at: chaseDueAt,
              last_contact_at: lastContactAt,
              last_reply_at: lastReplyAt,
              data_retorno: nextActionAt ? nextActionAt.slice(0, 10) : null,
              visit_at: statusModalTarget === "visita_agendada" ? visitAt : client.visit_at,
              visit_notes:
                statusModalTarget === "visita_agendada"
                  ? transitionDraft.visit_notes.trim() || null
                  : client.visit_notes,
              proposal_value:
                statusModalTarget === "proposta" ? proposalValue : client.proposal_value,
              proposal_valid_until:
                statusModalTarget === "proposta"
                  ? proposalValidUntil
                  : client.proposal_valid_until,
              last_status_change_at: isStatusChange
                ? nowIso
                : client.last_status_change_at
            }
            : client
        )
      };
    });
    const updatedClientsSnapshot = queryClient.getQueryData<{
      ownerUserId: string;
      clients: Client[];
      clientAlerts: Record<string, number>;
    }>(crmQueryKeys.clients(organizationId));
    const nextActiveClient =
      updatedClientsSnapshot?.clients.find(
        (client) =>
          client.id !== selectedClientId &&
          normalizePipelineStatus(client.status_pipeline) !== "fechado"
      ) ?? null;

    setStatusModalOpen(false);
    setPendingIndex(null);
    setStatusModalError(null);
    setStatusModalSaving(false);

    const closureType =
      statusModalTarget === "fechado" &&
        (closedOutcome === "won" || closedOutcome === "lost")
        ? closedOutcome
        : null;

    if (closureType) {
      await playResultOverlay(closureType);
      if (nextActiveClient) {
        setSelectedClientId(nextActiveClient.id);
        setIsCreatingClient(false);
        resetDraftFromClient(nextActiveClient);
      } else {
        setSelectedClientId(null);
        setIsCreatingClient(false);
      }
    } else {
      await fetchTimeline(selectedClientId);
      await playPipelineProgressAnimation(targetIndex);
    }

    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: crmQueryKeys.clients(organizationId),
        exact: true
      }),
      queryClient.invalidateQueries({
        queryKey: crmQueryKeys.clientBundle(organizationId, selectedClientId),
        exact: true
      })
    ]);
  };

  const fetchFilter = async (clientId: string) => {
    if (!organizationId) {
      setFilterError("Nenhuma organizacao ativa para carregar filtros.");
      return null;
    }

    setFilterError(null);
    const SELECT_FILTERS_FIELDS =
      "id, org_id, client_id, active, min_price, max_price, min_rent, max_rent, neighborhoods, min_bedrooms, min_bathrooms, min_parking, min_area_m2, max_area_m2, max_days_fresh, property_types, deal_type";
    const selectBaseColumns =
      "id, org_id, client_id, active, min_price, max_price, neighborhoods, min_bedrooms, max_days_fresh, property_types";

    const primary = await supabase
      .from("client_filters")
      .select(SELECT_FILTERS_FIELDS)
      .eq("client_id", clientId)
      .eq("org_id", organizationId)
      .maybeSingle();
    let filterData = (primary.data as ClientFilter | null) ?? null;
    let filterError = primary.error;

    if (filterError && isMissingColumnError(filterError.message)) {
      const fallback = await supabase
        .from("client_filters")
        .select(selectBaseColumns)
        .eq("client_id", clientId)
        .eq("org_id", organizationId)
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
      min_rent:
        typeof filter?.min_rent === "number"
          ? formatThousandsBR(String(filter.min_rent))
          : "",
      max_rent:
        typeof filter?.max_rent === "number"
          ? formatThousandsBR(String(filter.max_rent))
          : "",
      neighborhoods: Array.isArray(filter?.neighborhoods)
        ? filter?.neighborhoods.join(", ")
        : "",
      min_bedrooms: filter?.min_bedrooms?.toString() ?? "",
      min_bathrooms: filter?.min_bathrooms?.toString() ?? "",
      min_parking: filter?.min_parking?.toString() ?? "",
      min_area_m2: filter?.min_area_m2?.toString() ?? "",
      max_area_m2: filter?.max_area_m2?.toString() ?? "",
      max_days_fresh: filter?.max_days_fresh?.toString() ?? "15",
      property_types: Array.isArray(filter?.property_types)
        ? normalizeUnifiedPropertyCategories(filter.property_types).join(", ")
        : "",
      deal_type: filter?.deal_type ?? "venda"
    });
    setNeighborhoodInput("");

    return filter;
  };

  const fetchMatches = async (
    clientId: string,
    page: number,
    filterOverride?: ClientFilter | null
  ) => {
    if (!organizationId) {
      setMatches([]);
      setMatchesHasMore(false);
      return;
    }

    setMatchesLoading(true);
    setMatchesError(null);
    const pageSize = 8;
    const { data, error } = await supabase
      .from("automated_matches")
      .select(
        "id, org_id, client_id, listing_id, seen, is_notified, created_at, listing:listing_id (id, title, price, total_cost, neighborhood, bedrooms, bathrooms, parking, area_m2, deal_type, property_type, property_subtype, url, main_image_url, published_at, first_seen_at)"
      )
      .eq("org_id", organizationId)
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

  const fetchHistory = async (
    clientId: string,
    page: number,
    filterOverride?: ClientFilter | null
  ) => {
    if (!organizationId) {
      setHistory([]);
      setHistoryHasMore(false);
      return;
    }

    setHistoryLoading(true);
    setMatchesError(null);
    const pageSize = 8;
    const { data, error } = await supabase
      .from("automated_matches")
      .select(
        "id, org_id, client_id, listing_id, seen, is_notified, created_at, listing:listing_id (id, title, price, total_cost, neighborhood, bedrooms, bathrooms, parking, area_m2, deal_type, property_type, property_subtype, url, main_image_url, published_at, first_seen_at)"
      )
      .eq("org_id", organizationId)
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

  const fetchArchived = async (
    clientId: string,
    page: number,
    filterOverride?: ClientFilter | null
  ) => {
    if (!organizationId) {
      setArchived([]);
      setArchivedHasMore(false);
      return;
    }

    setArchivedLoading(true);
    setMatchesError(null);
    const pageSize = 8;
    const { data, error } = await supabase
      .from("automated_matches")
      .select(
        "id, org_id, client_id, listing_id, seen, is_notified, created_at, listing:listing_id (id, title, price, total_cost, neighborhood, bedrooms, bathrooms, parking, area_m2, deal_type, property_type, property_subtype, url, main_image_url, published_at, first_seen_at)"
      )
      .eq("org_id", organizationId)
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

  useEffect(() => {
    setLastViewedAtByClient(loadLastViewedMap());
  }, []);

  useEffect(() => {
    setIsClientSide(true);
  }, []);

  useEffect(() => {
    selectedClientIdRef.current = selectedClientId;
  }, [selectedClientId]);

  useEffect(() => {
    clearPipelineAnimationTimer();
    setIsPipelineAnimating(false);
    setMobileStagePickerOpen(false);
    setPendingIndex(null);
  }, [selectedClientId, clearPipelineAnimationTimer]);

  useEffect(() => {
    if (organizationLoading) return;
    if (!organizationId) {
      lastAppliedClientsBundleKeyRef.current = null;
      lastAppliedClientBundleKeyRef.current = null;
      setClientAlerts({});
      setSelectedClientId(null);
      setMatches([]);
      setHistory([]);
      setArchived([]);
      setTimelineEvents([]);
      setIsLoadingClients(false);
      return;
    }
    if (clientsSource.length === 0 && clientsQuery.isPending) {
      setIsLoadingClients(true);
    }
  }, [clientsQuery.isPending, clientsSource.length, organizationId, organizationLoading]);

  useEffect(() => {
    if (!organizationId || !clientsQuery.data) return;
    const applyKey = `${organizationId}:${clientsQuery.dataUpdatedAt}:${requestedDueFilter ?? "none"}:${requestedClientId ?? "none"
      }`;
    if (lastAppliedClientsBundleKeyRef.current === applyKey) {
      return;
    }
    lastAppliedClientsBundleKeyRef.current = applyKey;
    applyClientsBundle(clientsQuery.data, {
      nextSelectedId: requestedDueFilter ? undefined : requestedClientId ?? undefined
    });
  }, [
    applyClientsBundle,
    clientsQuery.data,
    clientsQuery.dataUpdatedAt,
    organizationId,
    requestedClientId,
    requestedDueFilter
  ]);

  useEffect(() => {
    if (!organizationId || !clientsQuery.error) return;
    const message =
      clientsQuery.error instanceof Error
        ? clientsQuery.error.message
        : "Erro ao carregar clientes.";
    setClientError(message);
    setAlertsError(message);
    setIsLoadingClients(false);
  }, [clientsQuery.error, organizationId]);

  useEffect(() => {
    lastViewedAtRef.current = lastViewedAtByClient;
  }, [lastViewedAtByClient]);

  useEffect(() => {
    matchIdsRef.current = new Set(
      [...matches, ...history, ...archived].map((match) => match.id)
    );
  }, [matches, history, archived]);

  useEffect(() => {
    if (!organizationId || !selectedClientId) {
      lastAppliedClientBundleKeyRef.current = null;
      setFilterError(null);
      setMatches([]);
      setHistory([]);
      setArchived([]);
      setMatchesPage(0);
      setHistoryPage(0);
      setArchivedPage(0);
      setTimelineEvents([]);
      setMatchesLoading(false);
      setHistoryLoading(false);
      setArchivedLoading(false);
      setTimelineLoading(false);
      return;
    }
    if (selectedClientBundleQuery.isPending && !selectedClientBundleQuery.data) {
      setMatchesLoading(true);
      setHistoryLoading(true);
      setArchivedLoading(true);
      setTimelineLoading(true);
    }
  }, [
    organizationId,
    selectedClientBundleQuery.data,
    selectedClientBundleQuery.isPending,
    selectedClientId
  ]);

  useEffect(() => {
    if (!organizationId || !selectedClientId || !selectedClientBundleQuery.data) {
      return;
    }
    const applyKey = `${organizationId}:${selectedClientId}:${selectedClientBundleQuery.dataUpdatedAt}`;
    if (lastAppliedClientBundleKeyRef.current === applyKey) {
      return;
    }
    lastAppliedClientBundleKeyRef.current = applyKey;

    const bundle = selectedClientBundleQuery.data;
    const filter = bundle.filter;

    setFilterError(null);
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
      min_rent:
        typeof filter?.min_rent === "number"
          ? formatThousandsBR(String(filter.min_rent))
          : "",
      max_rent:
        typeof filter?.max_rent === "number"
          ? formatThousandsBR(String(filter.max_rent))
          : "",
      neighborhoods: Array.isArray(filter?.neighborhoods)
        ? filter?.neighborhoods.join(", ")
        : "",
      min_bedrooms: filter?.min_bedrooms?.toString() ?? "",
      min_bathrooms: filter?.min_bathrooms?.toString() ?? "",
      min_parking: filter?.min_parking?.toString() ?? "",
      min_area_m2: filter?.min_area_m2?.toString() ?? "",
      max_area_m2: filter?.max_area_m2?.toString() ?? "",
      max_days_fresh: filter?.max_days_fresh?.toString() ?? "15",
      property_types: Array.isArray(filter?.property_types)
        ? normalizeUnifiedPropertyCategories(filter.property_types).join(", ")
        : "",
      deal_type: filter?.deal_type ?? "venda"
    });

    setMatches(bundle.matches);
    setMatchesHasMore(bundle.matchesHasMore);
    setMatchesPage(0);
    setMatchesLoading(false);
    setMatchesError(null);

    setHistory(bundle.history);
    setHistoryHasMore(bundle.historyHasMore);
    setHistoryPage(0);
    setHistoryLoading(false);

    setArchived(bundle.archived);
    setArchivedHasMore(bundle.archivedHasMore);
    setArchivedPage(0);
    setArchivedLoading(false);

    setTimelineEvents(bundle.timeline);
    setTimelineError(null);
    setTimelineLoading(false);
    acknowledgeClientViewRef.current(selectedClientId);
  }, [
    organizationId,
    selectedClientBundleQuery.data,
    selectedClientBundleQuery.dataUpdatedAt,
    selectedClientId
  ]);

  useEffect(() => {
    if (!organizationId || !selectedClientId || !selectedClientBundleQuery.error) {
      return;
    }
    const message =
      selectedClientBundleQuery.error instanceof Error
        ? selectedClientBundleQuery.error.message
        : "Erro ao carregar dados do cliente.";
    setFilterError(message);
    setMatchesError(message);
    setTimelineError(message);
    setMatchesLoading(false);
    setHistoryLoading(false);
    setArchivedLoading(false);
    setTimelineLoading(false);
  }, [organizationId, selectedClientBundleQuery.error, selectedClientId]);

  useEffect(() => {
    if (!organizationId) return;
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
          if (newMatch.org_id && newMatch.org_id !== organizationId) return;
          if (newMatch.seen) return;

          // Realtime payload não traz join, então fazemos fetch do listing.
          let listingQuery = supabase
            .from("listings")
            .select(
              "id, title, price, total_cost, neighborhood, bedrooms, bathrooms, parking, area_m2, deal_type, property_type, property_subtype, url, main_image_url, published_at, first_seen_at"
            )
            .eq("id", newMatch.listing_id);

          listingQuery = listingQuery.or(`org_id.is.null,org_id.eq.${organizationId}`);

          const { data: listing, error: listingError } = await listingQuery.maybeSingle();

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
            !rules.isWithinListingRules(enriched.listing) ||
            !rules.isWithinFreshWindow(enriched.listing)
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
  }, [organizationId, selectedClientId, supabase]);

  const handleSaveClient = async () => {
    if (!organizationId) {
      setClientError("Nenhuma organizacao ativa para salvar clientes.");
      return;
    }

    setClientSaving(true);
    setClientError(null);
    const trimmedName = clientDraft.name.trim();
    const nextActionDate = clientDraft.next_action_at || null;
    const nextActionAt = fromDateInputValueToIso(clientDraft.next_action_at);
    const normalizedDraftStatus = normalizePipelineStatus(clientDraft.status_pipeline);
    const chaseDueAt =
      normalizedDraftStatus === "contato_feito" ||
        normalizedDraftStatus === "aguardando_retorno"
        ? nextActionAt
        : null;

    if (!trimmedName) {
      setClientError("Nome é obrigatório.");
      setClientSaving(false);
      return;
    }

    if (isCreatingClient) {
      const ownerUserId = await getAuthenticatedUserId();

      if (!ownerUserId) {
        const message = "Usuário não autenticado.";
        setClientError(message);
        setClientSaving(false);
        return;
      }

      const { data, error } = await supabase
        .from("clients")
        .insert({
          org_id: organizationId,
          owner_user_id: ownerUserId,
          user_id: ownerUserId,
          name: trimmedName,
          contact_info: {
            email: clientDraft.email?.trim() || null,
            phone: clientDraft.phone?.trim() || null
          },
          data_retorno: nextActionDate,
          descricao_contexto: clientDraft.descricao_contexto || null,
          status_pipeline: clientDraft.status_pipeline || null,
          next_followup_at: nextActionAt,
          next_action_at: nextActionAt,
          chase_due_at: chaseDueAt
        })
        .select(
          "id, org_id, owner_user_id, user_id, name, contact_info, data_retorno, descricao_contexto, status_pipeline, next_action_at, next_followup_at, chase_due_at, last_contact_at, last_reply_at, created_at"
        )
        .single();

      let createData = data as Client | null;
      let createError = error;
      if (createError && isMissingColumnError(createError.message)) {
        const fallback = await supabase
          .from("clients")
          .insert({
            org_id: organizationId,
            owner_user_id: ownerUserId,
            user_id: ownerUserId,
            name: trimmedName,
            contact_info: {
              email: clientDraft.email?.trim() || null,
              phone: clientDraft.phone?.trim() || null
            },
            data_retorno: nextActionDate,
            descricao_contexto: clientDraft.descricao_contexto || null,
            status_pipeline: clientDraft.status_pipeline || null,
            next_followup_at: nextActionAt
          })
          .select(
            "id, org_id, owner_user_id, user_id, name, contact_info, data_retorno, descricao_contexto, status_pipeline, next_followup_at, created_at"
          )
          .single();
        createData = (fallback.data as Client | null) ?? null;
        createError = fallback.error;
      }

      if (createError) {
        setClientError(createError.message);
        console.error("Erro ao criar client:", createError);
        setClientSaving(false);
        return;
      }

      if (createData) {
        setSelectedClientId((createData as Client).id);
        setIsCreatingClient(false);
        await fetchClients((createData as Client).id);
        setClientFormModalOpen(false);
      }
    } else if (selectedClientId) {
      const ownerUserId = await getAuthenticatedUserId();
      if (!ownerUserId) {
        setClientError("Usuário não autenticado para atualizar cliente.");
        setClientSaving(false);
        return;
      }
      if (!isClientOwnedByUser(selectedClientId, ownerUserId)) {
        setClientError("Você não tem acesso para atualizar este cliente.");
        setClientSaving(false);
        return;
      }

      let { error } = await supabase
        .from("clients")
        .update({
          name: trimmedName,
          contact_info: {
            email: clientDraft.email?.trim() || null,
            phone: clientDraft.phone?.trim() || null
          },
          data_retorno: nextActionDate,
          descricao_contexto: clientDraft.descricao_contexto || null,
          status_pipeline: clientDraft.status_pipeline || null,
          next_followup_at: nextActionAt,
          next_action_at: nextActionAt,
          chase_due_at: chaseDueAt
        })
        .eq("id", selectedClientId)
        .eq("org_id", organizationId)
        .eq("owner_user_id", ownerUserId);

      if (error && isMissingColumnError(error.message)) {
        const fallback = await supabase
          .from("clients")
          .update({
            name: trimmedName,
            contact_info: {
              email: clientDraft.email?.trim() || null,
              phone: clientDraft.phone?.trim() || null
            },
            data_retorno: nextActionDate,
            descricao_contexto: clientDraft.descricao_contexto || null,
            status_pipeline: clientDraft.status_pipeline || null,
            next_followup_at: nextActionAt
          })
          .eq("id", selectedClientId)
          .eq("org_id", organizationId)
          .eq("user_id", ownerUserId);
        error = fallback.error;
      }

      if (error) {
        setClientError(error.message);
        console.error("Erro ao atualizar client:", error);
      } else {
        await fetchClients(selectedClientId);
        setClientFormModalOpen(false);
      }
    } else {
      setClientError("Selecione um client para editar.");
    }

    setClientSaving(false);
  };

  const sanitizeFilterPayload = <T extends Record<string, unknown>>(payload: T) =>
    Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined)
    ) as T;

  const syncMatchesFromListings = async (
    clientId: string,
    overrideFilter: ClientFilter
  ) => {
    if (!organizationId) return;
    const { min, max } = getPriceRange(overrideFilter);
    const { min: minRent, max: maxRent } = getRentRange(overrideFilter);
    const activeDealType = overrideFilter.deal_type ?? "venda";
    const priceColumn = activeDealType === "aluguel" ? "total_cost" : "price";
    if (typeof min !== "number" || typeof max !== "number") return;
    if (!Array.isArray(overrideFilter.neighborhoods) || overrideFilter.neighborhoods.length === 0) {
      return;
    }
    const normalizedNeighborhoods = Array.from(
      new Set(
        overrideFilter.neighborhoods
          .map((item) => normalizeText(item))
          .filter((item) => item.length > 0)
      )
    );

    const buildBaseListingsQuery = () => {
      let query = supabase
        .from("listings")
        .select(
          "id, title, price, total_cost, neighborhood, bedrooms, bathrooms, parking, area_m2, deal_type, property_type, property_subtype, url, main_image_url, published_at, first_seen_at"
        )
        .eq("deal_type", activeDealType)
        .gte(priceColumn, min)
        .lte(priceColumn, max)
        .or(`org_id.is.null,org_id.eq.${organizationId}`);

      if (
        activeDealType === "aluguel" &&
        typeof minRent === "number" &&
        typeof maxRent === "number"
      ) {
        query = query.gte("price", minRent).lte("price", maxRent);
      }

      if (normalizedNeighborhoods.length > 0) {
        query = query.in("neighborhood_normalized", normalizedNeighborhoods);
      } else {
        query = query.in("neighborhood", overrideFilter.neighborhoods);
      }

      return query;
    };

    const maxDaysFresh = getMaxDaysFresh(overrideFilter);
    let listingRows: Listing[] = [];

    if (maxDaysFresh === null) {
      const { data, error: listingsError } = await buildBaseListingsQuery();
      if (listingsError) {
        throw new Error(listingsError.message);
      }
      listingRows = (data as Listing[] | null) ?? [];
    } else {
      const cutoffIso = new Date(
        Date.now() - maxDaysFresh * 24 * 60 * 60 * 1000
      ).toISOString();

      const [publishedQuery, createdFallbackQuery] = await Promise.all([
        buildBaseListingsQuery().gte("published_at", cutoffIso),
        buildBaseListingsQuery()
          .is("published_at", null)
          .gte("first_seen_at", cutoffIso)
      ]);

      if (publishedQuery.error) {
        throw new Error(publishedQuery.error.message);
      }
      if (createdFallbackQuery.error) {
        throw new Error(createdFallbackQuery.error.message);
      }

      const mergedRows = [
        ...((publishedQuery.data as Listing[] | null) ?? []),
        ...((createdFallbackQuery.data as Listing[] | null) ?? [])
      ];
      const dedupedById = new Map(mergedRows.map((row) => [row.id, row]));
      listingRows = Array.from(dedupedById.values());
    }

    const matchingListings = listingRows.filter(
      (listing) =>
        isWithinFreshWindow(listing, overrideFilter) &&
        isWithinListingRules(listing, overrideFilter)
    );
    if (matchingListings.length === 0) return;

    const candidateIds = Array.from(
      new Set(
        matchingListings
          .map((listing) => listing.id)
          .filter((listingId): listingId is string => Boolean(listingId))
      )
    );
    if (candidateIds.length === 0) return;

    const { data: existingRows, error: existingError } = await supabase
      .from("automated_matches")
      .select("listing_id")
      .eq("org_id", organizationId)
      .eq("client_id", clientId)
      .in("listing_id", candidateIds);

    if (existingError) {
      throw new Error(existingError.message);
    }

    const existingIds = new Set(
      ((existingRows as { listing_id: string }[] | null) ?? []).map(
        (row) => row.listing_id
      )
    );
    const newMatches = candidateIds
      .filter((listingId) => !existingIds.has(listingId))
      .map((listingId) => ({
        org_id: organizationId,
        client_id: clientId,
        listing_id: listingId,
        seen: false,
        is_notified: false
      }));

    if (newMatches.length === 0) return;
    const { error: insertError } = await supabase
      .from("automated_matches")
      .insert(newMatches);
    if (insertError) {
      throw new Error(insertError.message);
    }
  };

  const handleSaveFilters = async () => {
    if (!selectedClientId || !organizationId) return;
    setFilterSaving(true);
    setFilterError(null);

    const neighborhoods = selectedNeighborhoods;
    const propertyTypes = selectedPropertyTypes;
    const minPrice = parseBRNumber(filterDraft.min_price);
    const maxPrice = parseBRNumber(filterDraft.max_price);
    const minRent = parseBRNumber(filterDraft.min_rent);
    const maxRent = parseBRNumber(filterDraft.max_rent);

    if (neighborhoods.length === 0) {
      setFilterError("Bairro é obrigatório");
      setFilterSaving(false);
      return;
    }

    if (typeof minPrice !== "number" || typeof maxPrice !== "number") {
      setFilterError("Defina preço mínimo e máximo");
      setFilterSaving(false);
      return;
    }

    if (minPrice > maxPrice) {
      setFilterError("Preço mínimo não pode ser maior que máximo");
      setFilterSaving(false);
      return;
    }

    if ((filterDraft.deal_type || "venda") === "aluguel") {
      const filledMinRent = typeof minRent === "number";
      const filledMaxRent = typeof maxRent === "number";
      if (filledMinRent !== filledMaxRent) {
        setFilterError("Preencha aluguel mínimo e máximo");
        setFilterSaving(false);
        return;
      }
      if (filledMinRent && filledMaxRent && minRent > maxRent) {
        setFilterError("Aluguel mínimo não pode ser maior que máximo");
        setFilterSaving(false);
        return;
      }
    }

    const minBedrooms = parseMinInput(filterDraft.min_bedrooms);
    const minBathrooms = parseMinInput(filterDraft.min_bathrooms);
    const minParking = parseMinInput(filterDraft.min_parking);
    const minAreaM2 = parseMinInput(filterDraft.min_area_m2);
    const maxAreaM2 = parseMinInput(filterDraft.max_area_m2);
    const maxDaysFresh = parseFreshDays(filterDraft.max_days_fresh);

    const basePayload = sanitizeFilterPayload({
      org_id: organizationId,
      client_id: selectedClientId,
      active: filterDraft.active,
      deal_type: filterDraft.deal_type,
      min_price: minPrice,
      max_price: maxPrice,
      min_rent:
        (filterDraft.deal_type || "venda") === "aluguel" &&
          typeof minRent === "number" &&
          typeof maxRent === "number"
          ? minRent
          : null,
      max_rent:
        (filterDraft.deal_type || "venda") === "aluguel" &&
          typeof minRent === "number" &&
          typeof maxRent === "number"
          ? maxRent
          : null,
      neighborhoods,
      min_bedrooms: minBedrooms ?? null,
      max_days_fresh: maxDaysFresh,
      property_types: propertyTypes.length > 0 ? propertyTypes : []
    });
    const extendedPayload = sanitizeFilterPayload({
      ...basePayload,
      min_bathrooms: minBathrooms ?? null,
      min_parking: minParking ?? null,
      min_area_m2: minAreaM2 ?? null,
      max_area_m2: maxAreaM2 ?? null
    });

    let { error } = await supabase
      .from("client_filters")
      .upsert(extendedPayload, { onConflict: "client_id" });

    if (error && isMissingColumnError(error.message)) {
      const payloadWithoutRentColumns = sanitizeFilterPayload({
        ...extendedPayload,
        min_rent: undefined,
        max_rent: undefined
      });
      const fallback = await supabase
        .from("client_filters")
        .upsert(payloadWithoutRentColumns, { onConflict: "client_id" });
      error = fallback.error;

      if (error && isMissingColumnError(error.message)) {
        const legacyFallback = await supabase
          .from("client_filters")
          .upsert(
            sanitizeFilterPayload({
              ...basePayload,
              min_rent: undefined,
              max_rent: undefined
            }),
            { onConflict: "client_id" }
          );
        error = legacyFallback.error;
      }
    }

    if (error) {
      setFilterError(error.message);
    } else if (selectedClientId) {
      const filterForQuery: ClientFilter = {
        org_id: organizationId,
        client_id: selectedClientId,
        active: filterDraft.active,
        deal_type: filterDraft.deal_type,
        min_price: minPrice,
        max_price: maxPrice,
        min_rent:
          (filterDraft.deal_type || "venda") === "aluguel" &&
            typeof minRent === "number" &&
            typeof maxRent === "number"
            ? minRent
            : null,
        max_rent:
          (filterDraft.deal_type || "venda") === "aluguel" &&
            typeof minRent === "number" &&
            typeof maxRent === "number"
            ? maxRent
            : null,
        neighborhoods,
        min_bedrooms: minBedrooms,
        min_bathrooms: minBathrooms,
        min_parking: minParking,
        min_area_m2: minAreaM2,
        max_area_m2: maxAreaM2,
        max_days_fresh: maxDaysFresh,
        property_types: propertyTypes.length > 0 ? propertyTypes : []
      };

      try {
        await syncMatchesFromListings(selectedClientId, filterForQuery);
      } catch (syncError) {
        const message =
          syncError instanceof Error
            ? syncError.message
            : "Não foi possível sincronizar os matches com os listings.";
        setFilterError(message);
      }

      await Promise.all([
        fetchMatches(selectedClientId, 0, filterForQuery),
        fetchHistory(selectedClientId, 0, filterForQuery),
        fetchArchived(selectedClientId, 0, filterForQuery)
      ]);
    }

    setFilterSaving(false);
  };

  const handleMatchAction = async (
    match: Match,
    action: "curate" | "archive" | "delete"
  ) => {
    if (!organizationId) {
      setMatchesError("Nenhuma organizacao ativa para atualizar matches.");
      return;
    }

    setMatchesError(null);
    setMatches((prev) => prev.filter((item) => item.id !== match.id));

    if (action === "delete") {
      const { error } = await supabase
        .from("automated_matches")
        .delete()
        .eq("id", match.id)
        .eq("org_id", organizationId);

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
        .eq("id", match.id)
        .eq("org_id", organizationId);

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
    if (!organizationId) {
      setMatchesError("Nenhuma organizacao ativa para atualizar curadoria.");
      return;
    }

    setMatchesError(null);
    setHistory((prev) => prev.filter((item) => item.id !== match.id));

    if (action === "delete") {
      const { error } = await supabase
        .from("automated_matches")
        .delete()
        .eq("id", match.id)
        .eq("org_id", organizationId);

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
        .eq("id", match.id)
        .eq("org_id", organizationId);

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
    if (!selectedClientId || !organizationId) return;
    const ownerUserId = await getAuthenticatedUserId();
    if (!ownerUserId) {
      setClientError("Usuário não autenticado para remover cliente.");
      return;
    }
    if (!isClientOwnedByUser(selectedClientId, ownerUserId)) {
      setClientError("Você não tem acesso para remover este cliente.");
      return;
    }
    const confirmDelete = window.confirm(
      "Tem certeza que deseja remover este client? Essa ação não pode ser desfeita."
    );
    if (!confirmDelete) return;
    let { error } = await supabase
      .from("clients")
      .delete()
      .eq("id", selectedClientId)
      .eq("org_id", organizationId)
      .eq("owner_user_id", ownerUserId);

    if (error && isMissingColumnError(error.message)) {
      const fallback = await supabase
        .from("clients")
        .delete()
        .eq("id", selectedClientId)
        .eq("org_id", organizationId)
        .eq("user_id", ownerUserId);
      error = fallback.error;
    }

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
    const now = new Date();
    return activeClientsSource.filter((client) => isClientDueToday(client, now)).length;
  }, [activeClientsSource]);
  const isCrmEmptyState =
    !isLoadingClients && clientsSource.length === 0 && !selectedClient;

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
    <div className="min-w-0 space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-2xl section-title">CRM</h2>
          <p className="break-words text-sm text-zinc-400">
            Gerencie clientes, filtros e matches em tempo real.
            {organizationContext
              ? ` Organizacao ativa: ${organizationContext.organization.name}.`
              : ""}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-zinc-700 px-3 py-1 text-zinc-200">
              Ganhos: <span className="font-semibold text-white">{userClosureCounts.won}</span>
            </span>
            <span className="rounded-full border border-zinc-700 px-3 py-1 text-zinc-200">
              Perdas: <span className="font-semibold text-white">{userClosureCounts.lost}</span>
            </span>
          </div>
        </div>
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="panel space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                Clientes
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={openCreateClientForm}
              disabled={isResultOverlayVisible}
            >
              Criar cliente
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
          {requestedDueFilter ? (
            <p className="rounded-lg accent-alert px-3 py-2 text-xs text-zinc-200">
              Filtro ativo:{" "}
              <span className="font-semibold text-white">
                {requestedDueFilter === "today"
                  ? "retornos de hoje"
                  : "retornos atrasados"}
              </span>
            </p>
          ) : null}
          <div className="space-y-2">
            {isLoadingClients && visibleClients.length === 0 ? (
              <SkeletonList />
            ) : visibleClients.length === 0 ? (
              <p className="text-sm text-zinc-500">
                {requestedDueFilter
                  ? "Nenhum cliente neste filtro."
                  : "Nenhum client ainda."}
              </p>
            ) : (
              visibleClients.map((client) => {
                const alertCount = clientAlerts[client.id] ?? 0;
                const stageRows = getStageDateRows(client);
                return (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => {
                      setIsCreatingClient(false);
                      setSelectedClientId(client.id);
                      resetDraftFromClient(client);
                    }}
                    className={`w-full rounded-lg border px-4 py-3 text-left text-sm transition focus-visible:outline-none ${selectedClientId === client.id && !isCreatingClient
                      ? "is-active-fixed bg-surface-lifted text-white"
                      : "border-transparent bg-surface text-zinc-400 hover:text-zinc-100 hover:bg-surface-lifted"
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
                        <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                          {getStatusLabel(client.status_pipeline)}
                        </p>
                        <div className="mt-1 space-y-0.5">
                          {stageRows.map((row) => (
                            <p key={`${client.id}-${row.label}`} className="text-[11px] text-zinc-500">
                              {row.label}: {row.value}
                            </p>
                          ))}
                        </div>
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

        <div className="min-w-0 space-y-6 xl:grid xl:grid-cols-[minmax(0,1.55fr)_340px] xl:items-start xl:gap-6 xl:space-y-0">
          <div className="grid gap-6 xl:col-span-2 xl:grid-cols-[minmax(0,1.8fr)_320px] xl:items-start">
            <Card className="panel space-y-5 p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                    Detalhes do cliente
                  </p>
                  <h3 className="mt-2 text-lg font-semibold text-zinc-50 sm:text-xl">
                    {selectedClient?.name ||
                      (isCrmEmptyState ? "Nenhum cliente cadastrado" : "Selecione um cliente")}
                  </h3>
                </div>
                <div className="flex items-center gap-2 rounded-full border border-zinc-800 bg-black/40 px-3 py-1.5 text-xs text-zinc-300">
                  <span className="text-zinc-500">Pipeline</span>
                  <span className="font-semibold text-white">{displayIndex + 1}</span>
                  <span className="text-zinc-500">/ {PIPELINE_STEPS.length}</span>
                </div>
              </div>

              <div className="space-y-4 rounded-2xl bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-4 ring-1 ring-white/5 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1.5">
                    <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Pipeline</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-base font-semibold text-zinc-100 sm:text-lg">
                        {getStatusLabel(confirmedPipelineStatus)}
                      </h4>
                      <span className="rounded-full border border-zinc-700 bg-black/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-zinc-300">
                        Etapa atual
                      </span>
                    </div>
                    <p className="max-w-3xl text-sm leading-relaxed text-zinc-400">
                      {PIPELINE_STATUS_HELP[displayPipelineStatus]}
                    </p>
                  </div>

                  <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 text-xs text-zinc-400">
                    {statusModalOpen && pendingIndex !== null ? (
                      <span className="rounded-full border border-zinc-800 bg-black/30 px-2.5 py-1">
                        Selecionado: {PIPELINE_STEPS[pendingIndex]?.label ?? "Etapa pendente"}
                      </span>
                    ) : null}
                    {confirmedPipelineStatus === "fechado" ? (
                      <span className="rounded-full border border-zinc-700 bg-black/40 px-2.5 py-1 text-zinc-200">
                        {selectedClient?.closed_outcome === "won"
                          ? "Fechado (Ganho)"
                          : selectedClient?.closed_outcome === "lost"
                            ? "Fechado (Perdido)"
                            : "Fechado"}
                      </span>
                    ) : null}
                  </div>
                </div>

                {!isCreatingClient && selectedClient ? (
                  <div className="grid gap-2 rounded-2xl border border-zinc-800/80 bg-black/30 p-3 text-sm text-zinc-300 sm:grid-cols-2 xl:grid-cols-4">
                    {getStageDateRows(selectedClient).map((row) => (
                      <div
                        key={`selected-${row.label}`}
                        className="rounded-xl border border-zinc-800/60 bg-black/30 px-3 py-2"
                      >
                        <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                          {row.label}
                        </p>
                        <p className="mt-1 text-sm text-zinc-100">{row.value}</p>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="space-y-4 lg:hidden">
                  <div className="flex items-start justify-between gap-3 rounded-2xl border border-zinc-800 bg-black/40 p-4">
                    <div>
                      <p className="text-xs text-zinc-500">Etapa atual</p>
                      <p className="mt-1 text-base font-semibold text-zinc-100">
                        {getStatusLabel(displayPipelineStatus)}
                      </p>
                    </div>
                    <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-[10px] text-zinc-300">
                      {displayIndex + 1}/{PIPELINE_STEPS.length}
                    </span>
                  </div>

                  <div className="relative h-2.5 overflow-hidden rounded-full bg-zinc-800/90">
                    <motion.div
                      className="absolute inset-y-0 left-0 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.45)]"
                      animate={{ width: `${pipelineProgressPercent}%` }}
                      transition={{ type: "spring", stiffness: 170, damping: 24 }}
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={
                        statusModalSaving ||
                        isPipelineAnimating ||
                        isCreatingClient ||
                        !selectedClientId
                      }
                      onClick={() => setMobileStagePickerOpen(true)}
                    >
                      Alterar etapa
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={
                        statusModalSaving ||
                        isPipelineAnimating ||
                        isCreatingClient ||
                        !selectedClientId
                      }
                      onClick={() => handlePipelineChange(confirmedPipelineStatus)}
                    >
                      Registrar atividade
                    </Button>
                  </div>
                </div>

                <div ref={pipelineChipsRef} className="relative hidden pb-8 pt-3 lg:block">
                  {pipelineTrack.ready ? (
                    <>
                      <div
                        className="pointer-events-none absolute z-0 h-1.5 rounded-full bg-zinc-800/90"
                        style={{
                          left: pipelineTrack.start,
                          top: pipelineTrack.top,
                          width: pipelineTrack.width
                        }}
                      />
                      <motion.div
                        className="pointer-events-none absolute z-0 h-1.5 rounded-full bg-white shadow-[0_0_14px_rgba(255,255,255,0.35)]"
                        animate={{
                          left: pipelineTrack.start,
                          top: pipelineTrack.top,
                          width: pipelineTrack.fill
                        }}
                        transition={{ type: "spring", stiffness: 170, damping: 24 }}
                      />
                      <motion.span
                        className="pointer-events-none absolute z-0 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-zinc-900 bg-white shadow-[0_0_16px_rgba(255,255,255,0.65)]"
                        animate={{
                          left: pipelineTrack.start + pipelineTrack.fill,
                          top: pipelineTrack.top + 0.5
                        }}
                        transition={{ type: "spring", stiffness: 170, damping: 24 }}
                      />
                    </>
                  ) : null}

                  <div className="relative z-10 grid grid-cols-7 gap-3">
                    {PIPELINE_STEPS.map((step) => {
                      const stepIndex = PIPELINE_INDEX_BY_STATUS[step.value];
                      const isCompleted = stepIndex < displayIndex;
                      const isActive = stepIndex === displayIndex;
                      return (
                        <button
                          key={step.value}
                          ref={(element) => {
                            pipelineButtonRefs.current[step.value] = element;
                          }}
                          type="button"
                          onClick={() => handlePipelineChange(step.value)}
                          disabled={
                            statusModalSaving ||
                            isPipelineAnimating ||
                            isCreatingClient ||
                            !selectedClientId
                          }
                          aria-current={isActive ? "step" : undefined}
                          className={`min-h-[74px] min-w-0 rounded-2xl border px-3 py-3 text-center text-[11px] font-semibold leading-tight transition accent-focus focus-visible:outline-none ${isActive
                            ? "accent-fill accent-sheen text-zinc-50 shadow-[0_10px_30px_rgba(255,255,255,0.08)]"
                            : isCompleted
                              ? "accent-fill-subtle text-sky-100"
                              : "accent-outline text-zinc-300 hover:text-zinc-100"
                            }`}
                        >
                          <span className="block">
                            {step.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </Card>

            <Card className="panel space-y-4 p-4 xl:p-5">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                  Dados do cliente
                </p>
                <h3 className="mt-1 text-base font-semibold text-zinc-100">Resumo</h3>
              </div>

              {isCrmEmptyState ? (
                <div className="rounded-xl border border-zinc-800 bg-black/30 p-4">
                  <p className="text-sm text-zinc-300">
                    Você ainda não possui clientes cadastrados no CRM.
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="mt-3 w-full"
                    onClick={openCreateClientForm}
                    disabled={isResultOverlayVisible}
                  >
                    Criar cliente
                  </Button>
                </div>
              ) : !selectedClient ? (
                <div className="rounded-xl border border-zinc-800 bg-black/30 p-4">
                  <p className="text-sm text-zinc-300">
                    Selecione um cliente na lista para visualizar os detalhes.
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid gap-2">
                    <div className="rounded-xl border border-zinc-800/90 bg-black/25 px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Nome</p>
                      <p className="mt-1 text-sm text-zinc-100">{selectedClient.name || "—"}</p>
                    </div>
                    <div className="rounded-xl border border-zinc-800/90 bg-black/25 px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Email</p>
                      <p className="mt-1 break-all text-sm text-zinc-100">
                        {selectedClient.contact_info?.email || "—"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-zinc-800/90 bg-black/25 px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                        Telefone
                      </p>
                      <p className="mt-1 text-sm text-zinc-100">
                        {selectedClient.contact_info?.phone || "—"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-zinc-800/90 bg-black/25 px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                        Próxima ação
                      </p>
                      <p className="mt-1 text-sm text-zinc-100">
                        {formatDateTimeDisplay(resolveClientNextActionAt(selectedClient))}
                      </p>
                    </div>
                    <div className="rounded-xl border border-zinc-800/90 bg-black/25 px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                        Descrição / contexto
                      </p>
                      <p
                        className="mt-1 text-sm text-zinc-100"
                        style={{
                          display: "-webkit-box",
                          WebkitLineClamp: 4,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden"
                        }}
                      >
                        {selectedClient.descricao_contexto || "—"}
                      </p>
                    </div>
                  </div>

                  {clientError ? (
                    <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                      {clientError}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      onClick={openEditClientForm}
                      disabled={isResultOverlayVisible}
                    >
                      Editar
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                      onClick={handleRemoveClient}
                    >
                      Remover Cliente
                    </Button>
                  </div>
                </>
              )}
            </Card>
          </div>

          {selectedClientId ? (
            <Card className="space-y-4 p-4 xl:col-start-2 xl:row-start-3 xl:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                    Arquivados
                  </p>
                  <h3 className="mt-1 text-base font-semibold">Imóveis guardados</h3>
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

              {matchesError ? (
                <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {matchesError}
                </p>
              ) : null}

              {archivedLoading && archived.length === 0 ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <div className="h-40 rounded-2xl border border-zinc-800 bg-white/5 animate-pulse" />
                  <div className="h-40 rounded-2xl border border-zinc-800 bg-white/5 animate-pulse" />
                </div>
              ) : null}

              {archived.length === 0 && !archivedLoading ? (
                <p className="text-sm text-zinc-500">Nenhum imóvel guardado para este cliente.</p>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 xl:max-h-[420px] xl:overflow-y-auto xl:pr-1">
                {archived.map((match) => {
                  const listing = match.listing;
                  const title = truncateWords(listing?.title || "Listing", 12);
                  const listingPrice =
                    listing?.deal_type === "aluguel"
                      ? formatCurrency(listing?.total_cost ?? listing?.price ?? null)
                      : formatCurrency(listing?.price ?? null);
                  return (
                    <div
                      key={match.id}
                      className="overflow-hidden rounded-2xl border border-zinc-800 bg-black/40"
                    >
                      <div className="relative h-32 border-b border-zinc-800 bg-black/50">
                        {listing?.main_image_url ? (
                          <Image
                            src={listing.main_image_url}
                            alt={listing?.title || "Imóvel guardado"}
                            fill
                            sizes="(max-width: 768px) 100vw, (max-width: 1280px) 45vw, 340px"
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-[10px] uppercase tracking-[0.3em] text-zinc-600">
                            Sem imagem
                          </div>
                        )}
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/90 to-transparent" />
                        <div className="absolute inset-x-2 bottom-2 flex flex-wrap gap-1.5">
                          <span className="rounded-full border border-zinc-700/90 bg-black/70 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-zinc-100">
                            {getPropertyTypeLabel(listing)}
                          </span>
                          {listing?.deal_type ? (
                            <span className="rounded-full border border-zinc-700/90 bg-black/70 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-zinc-300">
                              {listing.deal_type}
                            </span>
                          ) : null}
                          <span className="rounded-full border border-zinc-700/90 bg-black/70 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-zinc-300">
                            {getPortalLabel(listing)}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-3 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-zinc-100" title={listing?.title || "Listing"}>
                              {title}
                            </p>
                            <p className="mt-1 text-xs text-zinc-500">{getNeighborhood(listing)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-zinc-100">{listingPrice}</p>
                            <p className="mt-1 text-[10px] text-zinc-500">
                              Guardado em {formatDateDisplay(match.created_at)}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 text-[11px] text-zinc-400">
                          {typeof listing?.bedrooms === "number" ? (
                            <span className="rounded-full border border-zinc-800 bg-black/30 px-2.5 py-1">
                              {listing.bedrooms}q
                            </span>
                          ) : null}
                          {typeof listing?.bathrooms === "number" ? (
                            <span className="rounded-full border border-zinc-800 bg-black/30 px-2.5 py-1">
                              {listing.bathrooms}b
                            </span>
                          ) : null}
                          {typeof listing?.parking === "number" ? (
                            <span className="rounded-full border border-zinc-800 bg-black/30 px-2.5 py-1">
                              {listing.parking}v
                            </span>
                          ) : null}
                          {typeof listing?.area_m2 === "number" ? (
                            <span className="rounded-full border border-zinc-800 bg-black/30 px-2.5 py-1">
                              {listing.area_m2} m²
                            </span>
                          ) : null}
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-zinc-500">
                            Status: guardado
                          </span>
                          {listing?.url ? (
                            <a
                              href={listing.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-zinc-300 underline underline-offset-4"
                            >
                              Abrir anúncio
                            </a>
                          ) : (
                            <span className="text-xs text-zinc-500">Sem link</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          ) : null}

          {selectedClientId ? (
            <Card className="space-y-3 p-4 xl:col-start-2 xl:row-start-2 xl:flex xl:max-h-[calc(100vh-7.5rem)] xl:flex-col xl:overflow-hidden">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                  Filtros
                </p>
                <h3 className="mt-1 text-base font-semibold">Preferências</h3>
              </div>

              {filterError ? (
                <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {filterError}
                </p>
              ) : null}

              <div className="space-y-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-1">
                <div className="rounded-2xl border border-zinc-800/90 bg-black/20 p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-3 text-sm text-zinc-300">
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
                    </label>
                    <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                      CRM
                    </span>
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-800/90 bg-black/20 p-3.5">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="crm-fresh-days"
                      className="text-xs font-medium text-zinc-400"
                    >
                      Dias frescos
                    </label>
                    <select
                      id="crm-fresh-days"
                      value={filterDraft.max_days_fresh}
                      onChange={(event) =>
                        setFilterDraft((prev) => ({
                          ...prev,
                          max_days_fresh: event.target.value
                        }))
                      }
                      className="w-full appearance-none rounded-xl px-3.5 py-2.5 text-sm text-zinc-100 accent-focus accent-control focus:outline-none"
                    >
                      {FRESHNESS_OPTIONS.map((option) => (
                        <option key={option.label} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-800/90 bg-black/20 p-3.5">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-zinc-400">
                      Tipo de negocio
                    </label>
                    <div className="rounded-xl border border-zinc-800 bg-black/30 p-1">
                      <div className="grid grid-cols-2 gap-1">
                        {DEAL_TYPE_OPTIONS.map((option) => {
                          const active =
                            (filterDraft.deal_type || "venda") === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() =>
                                setFilterDraft((prev) => ({
                                  ...prev,
                                  deal_type: option.value as "venda" | "aluguel"
                                }))
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

                <div className="rounded-2xl border border-zinc-800/90 bg-black/20 p-3.5 space-y-2">
                  <NeighborhoodAutocomplete
                    label="Bairro"
                    placeholder="Digite para buscar bairros"
                    city="Campinas"
                    organizationId={organizationId}
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
                          className="inline-flex items-center gap-2 rounded-full accent-badge px-3 py-1 text-xs text-zinc-200"
                        >
                          {item}
                          <button
                            type="button"
                            onClick={() => removeNeighborhood(item)}
                            className="rim-core rim-secondary inline-flex h-5 w-5 items-center justify-center rounded-full p-0 text-zinc-300 transition hover:text-zinc-100 focus-visible:outline-none [--rim-size:1.5px]"
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

                <div className="rounded-2xl border border-zinc-800/90 bg-black/20 p-4 space-y-3">
                  <p className="text-xs font-medium text-zinc-400">Tipo de imóvel</p>
                  <PropertyCategoryMultiSelect
                    value={selectedPropertyTypes}
                    onChange={setPropertyTypeList}
                    placeholder="Tipo de imóvel"
                  />
                </div>

                <div className="rounded-2xl border border-zinc-800/90 bg-black/20 p-4 space-y-3">
                  <p className="text-xs font-medium text-zinc-400">
                    {(filterDraft.deal_type || "venda") === "aluguel"
                      ? "Valores de aluguel"
                      : "Faixa de preco"}
                  </p>

                  {(filterDraft.deal_type || "venda") === "aluguel" ? (
                    <div className="space-y-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1.5">
                          <label className="text-xs text-zinc-500">
                            Aluguel minimo
                          </label>
                          <Input
                            type="text"
                            placeholder="Aluguel minimo"
                            value={filterDraft.min_rent}
                            onChange={(event) => {
                              const formatted = formatThousandsBR(event.target.value);
                              setFilterDraft((prev) => ({
                                ...prev,
                                min_rent: formatted
                              }));
                            }}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs text-zinc-500">
                            Aluguel maximo
                          </label>
                          <Input
                            type="text"
                            placeholder="Aluguel maximo"
                            value={filterDraft.max_rent}
                            onChange={(event) => {
                              const formatted = formatThousandsBR(event.target.value);
                              setFilterDraft((prev) => ({
                                ...prev,
                                max_rent: formatted
                              }));
                            }}
                          />
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1.5">
                          <label className="text-xs text-zinc-500">
                            Preco total minimo
                          </label>
                          <Input
                            type="text"
                            placeholder="Preco total minimo"
                            value={filterDraft.min_price}
                            onChange={(event) => {
                              const formatted = formatThousandsBR(event.target.value);
                              setFilterDraft((prev) => ({
                                ...prev,
                                min_price: formatted
                              }));
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
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="text-xs text-zinc-500">Preco minimo</label>
                        <Input
                          type="text"
                          placeholder="Preco minimo"
                          value={filterDraft.min_price}
                          onChange={(event) => {
                            const formatted = formatThousandsBR(event.target.value);
                            setFilterDraft((prev) => ({
                              ...prev,
                              min_price: formatted
                            }));
                          }}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs text-zinc-500">Preco maximo</label>
                        <Input
                          type="text"
                          placeholder="Preco maximo"
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
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-zinc-800/90 bg-black/20 p-4 space-y-4">
                  <p className="text-xs font-medium text-zinc-400">
                    Caracteristicas minimas
                  </p>

                  <div className="grid gap-4">
                    <div className="grid gap-x-3 gap-y-4 md:grid-cols-3">
                      <div className="grid content-start gap-2">
                        <label className="min-h-8 text-xs leading-4 text-zinc-500">
                          Quartos min.
                        </label>
                        <Input
                          className="h-10 px-3.5"
                          type="number"
                          min={0}
                          placeholder="Minimo"
                          value={filterDraft.min_bedrooms}
                          onChange={(event) =>
                            setFilterDraft((prev) => ({
                              ...prev,
                              min_bedrooms: event.target.value
                            }))
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
                          value={filterDraft.min_bathrooms}
                          onChange={(event) =>
                            setFilterDraft((prev) => ({
                              ...prev,
                              min_bathrooms: event.target.value
                            }))
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
                          value={filterDraft.min_parking}
                          onChange={(event) =>
                            setFilterDraft((prev) => ({
                              ...prev,
                              min_parking: event.target.value
                            }))
                          }
                        />
                      </div>
                    </div>

                    <div className="grid gap-x-3 gap-y-4 md:grid-cols-2">
                      <div className="grid content-start gap-2">
                        <label className="text-xs leading-4 text-zinc-500">
                          Area minima (m2)
                        </label>
                        <Input
                          className="h-10 px-3.5"
                          type="number"
                          min={0}
                          placeholder="Area minima"
                          value={filterDraft.min_area_m2}
                          onChange={(event) =>
                            setFilterDraft((prev) => ({
                              ...prev,
                              min_area_m2: event.target.value
                            }))
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
                          value={filterDraft.max_area_m2}
                          onChange={(event) =>
                            setFilterDraft((prev) => ({
                              ...prev,
                              max_area_m2: event.target.value
                            }))
                          }
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <Button onClick={handleSaveFilters} disabled={filterSaving}>
                  {filterSaving ? "Salvando..." : "Salvar filtros"}
                </Button>
              </div>
            </Card>
          ) : null}

          {selectedClientId ? (
            <Card className="space-y-3 p-4 xl:col-start-1 xl:row-start-2">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                    Matches
                  </p>
                  <h3 className="mt-1 text-base font-semibold">
                    Stack em tempo real
                  </h3>
                </div>
                <div className="text-xs text-zinc-500">
                  Swipe direita seleciona · esquerda arquiva
                </div>
              </div>

              <div className="relative h-[470px] overflow-hidden xl:h-[500px]">
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
                        className={`absolute inset-0 rounded-2xl border border-zinc-800 bg-black/60 p-4 shadow-glow backdrop-blur-md overflow-hidden sm:p-5 ${isTop ? "pointer-events-auto" : "pointer-events-none"
                          }`}
                        style={{ zIndex: 10 - index }}
                      >
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-white/5 to-transparent" />
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/80 to-transparent" />

                        <div className="relative flex h-full flex-col gap-3">
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

                          <div className="relative h-[210px] overflow-hidden rounded-xl border border-zinc-800 bg-black/50 sm:h-[230px] xl:h-[240px]">
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
                            className="mt-auto space-y-2.5 text-xs text-zinc-500"
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
                                className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
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
            <Card className="space-y-3 p-4 xl:col-start-1 xl:row-start-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                    Curadoria
                  </p>
                  <h3 className="mt-1 text-base font-semibold">
                    Selecionados para o cliente
                  </h3>
                </div>
                <div className="flex flex-wrap items-center gap-2">
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

              <div className="space-y-3 xl:max-h-[360px] xl:overflow-y-auto xl:pr-1">
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
                      className="flex items-center justify-between rounded-xl border border-zinc-800 bg-black/50 px-3 py-2.5"
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
                            disabled={statusModalSaving || isPipelineAnimating}
                            onClick={() =>
                              handlePipelineChange("visita_agendada", "card")
                            }
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

        </div>
      </div>

      {
        isClientSide
          ? createPortal(
            <>
              <AnimatePresence>
                {mobileStagePickerOpen ? (
                  <motion.div
                    className="fixed inset-0 z-[150] flex items-end justify-center lg:hidden"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <button
                      type="button"
                      aria-label="Fechar seletor de etapa"
                      className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                      onClick={() => setMobileStagePickerOpen(false)}
                    />
                    <motion.div
                      className="relative z-10 w-full max-h-[85vh] overflow-y-auto rounded-t-2xl border border-zinc-800 bg-zinc-950 p-4 pb-6 shadow-2xl"
                      initial={{ y: 36, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: 36, opacity: 0 }}
                      transition={{ type: "spring", stiffness: 170, damping: 24 }}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-zinc-700" />
                      <div className="mb-3">
                        <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                          Alterar etapa
                        </p>
                        <h3 className="mt-2 text-lg font-semibold">
                          Escolha a nova etapa do pipeline
                        </h3>
                      </div>

                      <div className="space-y-2">
                        {PIPELINE_STEPS.map((step, index) => {
                          const isCompleted = index < displayIndex;
                          const isActive = index === displayIndex;
                          return (
                            <button
                              key={step.value}
                              type="button"
                              disabled={statusModalSaving || isPipelineAnimating}
                              onClick={() => handlePipelineChange(step.value)}
                              className={`flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition accent-focus focus-visible:outline-none ${isActive
                                ? "accent-fill accent-sheen text-zinc-50"
                                : isCompleted
                                  ? "accent-fill-subtle text-sky-100"
                                  : "accent-outline text-zinc-200"
                                }`}
                            >
                              <span
                                className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${isActive || isCompleted
                                  ? "border-white/35 bg-black/30 text-zinc-100"
                                  : "border-zinc-500 text-zinc-300"
                                  }`}
                              >
                                {isCompleted ? "✓" : index + 1}
                              </span>
                              <span className="min-w-0">
                                <span className="block text-sm font-semibold">
                                  {step.label}
                                </span>
                                <span
                                  className={`mt-0.5 block text-[11px] ${isActive || isCompleted
                                    ? "text-zinc-200/80"
                                    : "text-zinc-500"
                                    }`}
                                >
                                  {isActive
                                    ? "Etapa atual. "
                                    : isCompleted
                                      ? "Etapa já concluída. "
                                      : ""}
                                  {PIPELINE_STATUS_HELP[step.value]}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      <div className="mt-4 flex justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setMobileStagePickerOpen(false)}
                        >
                          Fechar
                        </Button>
                      </div>
                    </motion.div>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              <AnimatePresence>
                {clientFormModalOpen ? (
                  <motion.div
                    className="fixed inset-0 z-[155] flex items-center justify-center p-4"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <button
                      type="button"
                      aria-label="Fechar formulário de cliente"
                      className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                      onClick={closeClientFormModal}
                    />
                    <motion.div
                      className="relative z-10 max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950/95 p-5 shadow-2xl"
                      initial={{ opacity: 0, y: 20, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 20, scale: 0.98 }}
                      transition={{ type: "spring", stiffness: 170, damping: 24 }}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="mb-4">
                        <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                          {isCreatingClient ? "Criar cliente" : "Editar cliente"}
                        </p>
                        <h3 className="mt-2 text-lg font-semibold">
                          {isCreatingClient
                            ? "Cadastrar novo cliente"
                            : selectedClient?.name || "Editar cliente"}
                        </h3>
                      </div>

                      <div className="space-y-4">
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
                          <div className="space-y-2">
                            <Input
                              type="date"
                              placeholder="Próxima ação"
                              value={clientDraft.next_action_at}
                              onChange={(event) =>
                                setClientDraft((prev) => ({
                                  ...prev,
                                  next_action_at: event.target.value
                                }))
                              }
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setClientDraft((prev) => ({
                                  ...prev,
                                  next_action_at: new Date().toISOString().slice(0, 10)
                                }))
                              }
                              className="inline-flex rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-zinc-200 transition accent-outline accent-sheen accent-focus focus-visible:outline-none hover:text-zinc-100"
                            >
                              Definir hoje
                            </button>
                          </div>
                          <textarea
                            placeholder="Descrição / contexto do cliente"
                            value={clientDraft.descricao_contexto}
                            onChange={(event) =>
                              setClientDraft((prev) => ({
                                ...prev,
                                descricao_contexto: event.target.value
                              }))
                            }
                            className="min-h-[44px] rounded-lg px-4 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none accent-focus accent-control"
                          />
                        </div>
                      </div>

                      {clientError ? (
                        <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                          {clientError}
                        </p>
                      ) : null}

                      <div className="mt-5 flex items-center justify-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={closeClientFormModal}
                          disabled={clientSaving}
                        >
                          Cancelar
                        </Button>
                        <Button
                          type="button"
                          onClick={handleSaveClient}
                          disabled={clientSaving}
                        >
                          {clientSaving ? "Salvando..." : "Salvar cliente"}
                        </Button>
                      </div>
                    </motion.div>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              <AnimatePresence>
                {statusModalOpen ? (
                  <motion.div
                    className="fixed inset-0 z-[160] flex items-center justify-center p-4"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <button
                      type="button"
                      aria-label="Fechar modal"
                      className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                      onClick={closeStatusTransitionModal}
                    />
                    <motion.div
                      className="relative z-10 max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950/95 p-5 shadow-2xl"
                      initial={{ opacity: 0, y: 20, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 20, scale: 0.98 }}
                      transition={{ type: "spring", stiffness: 170, damping: 24 }}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="mb-4">
                        <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                          {statusModalIsActivityOnly ? "Registrar atividade" : "Atualizar pipeline"}
                        </p>
                        <h3 className="mt-2 text-lg font-semibold">
                          {statusModalIsActivityOnly
                            ? `${getStatusLabel(statusModalTarget)} · Registrar atividade`
                            : `${getStatusLabel(statusModalFrom)} → ${getStatusLabel(statusModalTarget)}`}
                        </h3>
                        <p className="mt-1 text-xs text-zinc-500">
                          {statusModalIsActivityOnly
                            ? "Atualize próxima ação, cobrança e notas sem mudar a etapa."
                            : "Registre próxima ação, cobrança e detalhes da etapa."}
                        </p>
                      </div>

                      <div className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-2">
                            <label className="text-xs text-zinc-500">Próxima ação</label>
                            <select
                              value={transitionDraft.next_action}
                              onChange={(event) =>
                                setTransitionDraft((prev) => ({
                                  ...prev,
                                  next_action: event.target.value as NextActionValue | ""
                                }))
                              }
                              className="w-full rounded-lg px-3 py-2 text-sm text-white focus:outline-none accent-focus accent-control"
                            >
                              <option value="">Selecione</option>
                              {NEXT_ACTION_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-2">
                            <label className="text-xs text-zinc-500">
                              {statusModalScheduleLabel} (data/hora)
                            </label>
                            <Input
                              type="datetime-local"
                              value={transitionDraft.next_action_at}
                              disabled={transitionDraft.no_followup_date}
                              onChange={(event) =>
                                setTransitionDraft((prev) => ({
                                  ...prev,
                                  next_action_at: event.target.value
                                }))
                              }
                            />
                            <button
                              type="button"
                              disabled={transitionDraft.no_followup_date}
                              onClick={() =>
                                setTransitionDraft((prev) => ({
                                  ...prev,
                                  next_action_at: toDateTimeLocalInputValue(new Date().toISOString())
                                }))
                              }
                              className="inline-flex rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-zinc-200 transition accent-outline accent-sheen accent-focus focus-visible:outline-none hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Definir agora
                            </button>
                            <label className="flex items-center gap-2 text-xs text-zinc-400">
                              <input
                                type="checkbox"
                                checked={transitionDraft.no_followup_date}
                                onChange={(event) =>
                                  setTransitionDraft((prev) => ({
                                    ...prev,
                                    no_followup_date: event.target.checked,
                                    next_action_at: event.target.checked
                                      ? ""
                                      : prev.next_action_at
                                  }))
                                }
                              />
                              Sem data por enquanto
                            </label>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs text-zinc-500">Nota curta</label>
                          <textarea
                            value={transitionDraft.note}
                            onChange={(event) =>
                              setTransitionDraft((prev) => ({
                                ...prev,
                                note: event.target.value
                              }))
                            }
                            rows={2}
                            placeholder="Contexto rápido da mudança"
                            className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none accent-focus accent-control"
                          />
                        </div>

                        {statusModalTarget === "visita_agendada" ? (
                          <div className="rounded-xl accent-surface p-3">
                            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                              Dados da visita
                            </p>
                            <div className="mt-3 grid gap-3 md:grid-cols-2">
                              <Input
                                type="datetime-local"
                                value={transitionDraft.visit_at}
                                onChange={(event) =>
                                  setTransitionDraft((prev) => ({
                                    ...prev,
                                    visit_at: event.target.value
                                  }))
                                }
                              />
                              <Input
                                placeholder="Local/observação rápida"
                                value={transitionDraft.visit_notes}
                                onChange={(event) =>
                                  setTransitionDraft((prev) => ({
                                    ...prev,
                                    visit_notes: event.target.value
                                  }))
                                }
                              />
                            </div>
                          </div>
                        ) : null}

                        {statusModalTarget === "proposta" ? (
                          <div className="rounded-xl accent-surface p-3">
                            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                              Dados da proposta
                            </p>
                            <div className="mt-3 grid gap-3 md:grid-cols-2">
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                placeholder="Valor da proposta"
                                value={transitionDraft.proposal_value}
                                onChange={(event) =>
                                  setTransitionDraft((prev) => ({
                                    ...prev,
                                    proposal_value: event.target.value
                                  }))
                                }
                              />
                              <Input
                                type="date"
                                value={transitionDraft.proposal_valid_until}
                                onChange={(event) =>
                                  setTransitionDraft((prev) => ({
                                    ...prev,
                                    proposal_valid_until: event.target.value
                                  }))
                                }
                              />
                            </div>
                          </div>
                        ) : null}

                        {statusModalTarget === "fechado" ? (
                          <div className="rounded-xl accent-surface p-3">
                            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                              Resultado final
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {CLOSED_OUTCOME_OPTIONS.map((option) => {
                                const active = transitionDraft.closed_outcome === option.value;
                                return (
                                  <button
                                    key={option.value}
                                    type="button"
                                    onClick={() =>
                                      setTransitionDraft((prev) => ({
                                        ...prev,
                                        closed_outcome: option.value,
                                        lost_reason:
                                          option.value === "lost" ? prev.lost_reason : "",
                                        lost_reason_detail:
                                          option.value === "lost" ? prev.lost_reason_detail : ""
                                      }))
                                    }
                                    className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.2em] transition accent-focus focus-visible:outline-none ${active
                                      ? "accent-fill accent-sheen text-zinc-50"
                                      : "accent-outline text-zinc-300 hover:text-white"
                                      }`}
                                  >
                                    {option.label}
                                  </button>
                                );
                              })}
                            </div>

                            {transitionDraft.closed_outcome === "won" ? (
                              <div className="mt-3 grid gap-3 md:grid-cols-2">
                                <Input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  placeholder="Valor final (opcional)"
                                  value={transitionDraft.final_value}
                                  onChange={(event) =>
                                    setTransitionDraft((prev) => ({
                                      ...prev,
                                      final_value: event.target.value
                                    }))
                                  }
                                />
                                <Input
                                  placeholder="Nota final (opcional)"
                                  value={transitionDraft.final_note}
                                  onChange={(event) =>
                                    setTransitionDraft((prev) => ({
                                      ...prev,
                                      final_note: event.target.value
                                    }))
                                  }
                                />
                              </div>
                            ) : null}

                            {transitionDraft.closed_outcome === "lost" ? (
                              <div className="mt-3 space-y-3">
                                <select
                                  value={transitionDraft.lost_reason}
                                  onChange={(event) =>
                                    setTransitionDraft((prev) => ({
                                      ...prev,
                                      lost_reason: event.target.value as LostReasonValue | ""
                                    }))
                                  }
                                  className="w-full rounded-lg px-3 py-2 text-sm text-white focus:outline-none accent-focus accent-control"
                                >
                                  <option value="">Motivo da perda</option>
                                  {LOST_REASON_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                                <textarea
                                  value={transitionDraft.lost_reason_detail}
                                  onChange={(event) =>
                                    setTransitionDraft((prev) => ({
                                      ...prev,
                                      lost_reason_detail: event.target.value
                                    }))
                                  }
                                  rows={2}
                                  placeholder="Detalhe do motivo (opcional)"
                                  className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none accent-focus accent-control"
                                />
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      {statusModalError ? (
                        <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                          {statusModalError}
                        </p>
                      ) : null}

                      <div className="mt-5 flex items-center justify-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={closeStatusTransitionModal}
                          disabled={statusModalSaving}
                        >
                          Cancelar
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={handleConfirmStatusTransition}
                          disabled={statusModalSaving}
                        >
                          {statusModalSaving
                            ? "Salvando..."
                            : statusModalIsActivityOnly
                              ? "Salvar atividade"
                              : "Confirmar mudança"}
                        </Button>
                      </div>
                    </motion.div>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              <AnimatePresence>
                {resultOverlayType ? (
                  <ResultOverlay type={resultOverlayType} />
                ) : null}
              </AnimatePresence>
            </>,
            document.body
          )
          : null
      }
    </div >
  );
}
