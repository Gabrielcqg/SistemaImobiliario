"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type PipelineStatus =
  | "novo_match"
  | "contato_feito"
  | "em_conversa"
  | "aguardando_retorno"
  | "visita_agendada"
  | "proposta"
  | "fechado";

type ClosedOutcome = "won" | "lost" | null;
type PeriodPreset = "today" | "7d" | "30d" | "month" | "custom";
type SortBy =
  | "closedWon"
  | "conversionRate"
  | "overdueTasks"
  | "avgResponseHours"
  | "contacts";
type SortDirection = "asc" | "desc";

type MemberOption = {
  id: string;
  label: string;
  email: string | null;
  role: "owner" | "admin" | "member";
};

type MemberPerformance = {
  memberId: string;
  memberLabel: string;
  memberEmail: string | null;
  newItems: number;
  advancedItems: number;
  contacts: number;
  visits: number;
  proposals: number;
  closedWon: number;
  closedLost: number;
  conversionRate: number;
  avgResponseHours: number | null;
  overdueTasks: number;
  status: "verde" | "amarelo" | "vermelho";
};

type KpiCard = {
  key:
    | "newItems"
    | "advancedItems"
    | "contacts"
    | "visits"
    | "proposals"
    | "closedWon"
    | "closedLost";
  label: string;
  value: number;
  prevValue: number;
  changePct: number | null;
  topMemberLabel: string;
  topMemberValue: number;
};

type FunnelStep = {
  status: PipelineStatus;
  label: string;
  count: number;
  conversionFromPrev: number | null;
  avgAgingDays: number | null;
};

type ResponseLeaderboardItem = {
  memberId: string;
  memberLabel: string;
  avgHours: number;
};

type AlertCard = {
  key:
    | "noContact"
    | "unassigned"
    | "stalledProposal"
    | "visitNoFollowUp"
    | "duplicates"
    | "incompleteData";
  label: string;
  value: number;
  href: string;
  severity: "alto" | "operacional";
};

type GoalMetric = {
  key: "contacts" | "visits" | "proposals" | "closedWon";
  label: string;
  target: number;
  achieved: number;
  progressPct: number;
  status: "atingida" | "em_risco" | "fora_meta";
};

type MemberGoalProgress = {
  memberId: string;
  memberLabel: string;
  progressPct: number;
};

type ComparisonMetric = {
  current: number;
  previous: number;
  deltaPct: number | null;
};

type LeaderboardRow = {
  memberId: string;
  memberLabel: string;
  resultValue: number;
  productionValue: number;
  weightedScore: number;
};

type OrganizerAnalyticsData = {
  rangeLabel: string;
  totalClientsInOrg: number;
  totalTimelineEventsInOrg: number;
  organizationClosureCounts: {
    won: number;
    lost: number;
  };
  hasAnyCrmData: boolean;
  hasPeriodData: boolean;
  activeMembersInPeriod: number;
  movedItemsInPeriod: number;
  kpis: KpiCard[];
  memberRows: MemberPerformance[];
  funnel: {
    steps: FunnelStep[];
    bottleneckLabel: string | null;
  };
  response: {
    avgHours: number | null;
    withinGoalPct: number | null;
    fastest: ResponseLeaderboardItem[];
    slowest: ResponseLeaderboardItem[];
  };
  tasks: {
    overdue: number;
    dueToday: number;
    next7Days: number;
    created: number;
    completed: number;
    backlogDelta: number;
    byMemberOverdue: Array<{
      memberId: string;
      memberLabel: string;
      count: number;
    }>;
  };
  alerts: {
    riskHigh: AlertCard[];
    operational: AlertCard[];
  };
  goals: {
    source: "placeholder";
    monthLabel: string;
    metrics: GoalMetric[];
    byMember: MemberGoalProgress[];
  };
  monthlyComparison: {
    entries: ComparisonMetric;
    movements: ComparisonMetric;
    closures: ComparisonMetric;
  };
  leaderboard: {
    byResult: LeaderboardRow[];
    byProduction: LeaderboardRow[];
    weights: { closedWon: number; contacts: number; visits: number; proposals: number };
  };
};

type OrganizerAnalyticsFilters = {
  period: PeriodPreset;
  customStart: string;
  customEnd: string;
  memberId: string;
  sortBy: SortBy;
  sortDirection: SortDirection;
  responseGoalHours: number;
};

type UseOrganizerAnalyticsResult = {
  filters: OrganizerAnalyticsFilters;
  setFilters: (next: Partial<OrganizerAnalyticsFilters>) => void;
  refresh: () => void;
  loading: boolean;
  membersError: string | null;
  metricsError: string | null;
  error: string | null;
  data: OrganizerAnalyticsData;
  members: MemberOption[];
  appliedRange: AppliedRange;
  summaryCards: SummaryCardsState;
};

type ClientRow = {
  id: string;
  owner_user_id?: string | null;
  user_id: string | null;
  name: string | null;
  contact_info: { email?: string; phone?: string } | null;
  status_pipeline: PipelineStatus | string | null;
  closed_outcome: ClosedOutcome | string | null;
  next_action_at: string | null;
  next_followup_at: string | null;
  chase_due_at: string | null;
  last_contact_at: string | null;
  last_reply_at: string | null;
  visit_at: string | null;
  proposal_value: number | null;
  last_status_change_at: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type TimelineRow = {
  id: string;
  client_id: string;
  actor_user_id: string | null;
  event_type: string | null;
  from_status: PipelineStatus | string | null;
  to_status: PipelineStatus | string | null;
  payload:
    | {
        next_action?: string | null;
        next_action_at?: string | null;
        next_followup_at?: string | null;
        chase_due_at?: string | null;
        visit_at?: string | null;
        proposal_value?: number | null;
        closed_outcome?: ClosedOutcome | string | null;
      }
    | null
    | string;
  created_at: string | null;
};

type OrganizationMemberRow = {
  user_id: string;
  role?: "owner" | "admin" | "member" | null;
  status?: "active" | "invited" | "disabled" | null;
};

type OrganizationMemberDirectoryRow = {
  user_id: string | null;
  role: string | null;
  status: string | null;
  member_email: string | null;
  member_name: string | null;
};

type DateRange = {
  label: string;
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
};

type AppliedRange = {
  label: string;
  startISO: string;
  endISO: string;
};

type SummaryCardsState = {
  activeMembersCount: number;
  movedItemsCount: number;
  loading: boolean;
  error: string | null;
  isEmpty: boolean;
};

type SupabaseLikeError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

const PIPELINE_ORDER: PipelineStatus[] = [
  "novo_match",
  "contato_feito",
  "em_conversa",
  "aguardando_retorno",
  "visita_agendada",
  "proposta",
  "fechado"
];

const PIPELINE_LABEL: Record<PipelineStatus, string> = {
  novo_match: "Novo Match",
  contato_feito: "Contato feito",
  em_conversa: "Em conversa",
  aguardando_retorno: "Aguardando retorno",
  visita_agendada: "Visita agendada",
  proposta: "Proposta",
  fechado: "Fechado"
};

const CONTACT_ACTIONS = new Set([
  "ligar",
  "whatsapp",
  "enviar_informacoes",
  "follow_up"
]);

const GOAL_PLACEHOLDER_TARGETS = {
  contacts: 120,
  visits: 40,
  proposals: 24,
  closedWon: 10
};

const LEADERBOARD_WEIGHTS = {
  closedWon: 6,
  contacts: 1,
  visits: 2,
  proposals: 3
};

const DEFAULT_FILTERS: OrganizerAnalyticsFilters = {
  period: "30d",
  customStart: "",
  customEnd: "",
  memberId: "all",
  sortBy: "closedWon",
  sortDirection: "desc",
  responseGoalHours: 24
};

const toAppliedRange = (range: DateRange): AppliedRange => ({
  label: range.label,
  startISO: range.start.toISOString(),
  endISO: range.end.toISOString()
});

const toSummaryErrorMessage = (value: string) => {
  const normalized = value
    .replace(/^Erro ao carregar métricas:\s*/i, "")
    .replace(/^Erro ao calcular métricas:\s*/i, "")
    .trim();
  if (normalized.length <= 96) return normalized;
  return `${normalized.slice(0, 93)}...`;
};

const toSupabaseErrorMeta = (error: SupabaseLikeError | null) => ({
  code: error?.code ?? null,
  message: error?.message ?? null,
  details: error?.details ?? null,
  hint: error?.hint ?? null
});

const emptyData: OrganizerAnalyticsData = {
  rangeLabel: "Sem período",
  totalClientsInOrg: 0,
  totalTimelineEventsInOrg: 0,
  organizationClosureCounts: {
    won: 0,
    lost: 0
  },
  hasAnyCrmData: false,
  hasPeriodData: false,
  activeMembersInPeriod: 0,
  movedItemsInPeriod: 0,
  kpis: [],
  memberRows: [],
  funnel: {
    steps: PIPELINE_ORDER.map((status) => ({
      status,
      label: PIPELINE_LABEL[status],
      count: 0,
      conversionFromPrev: null,
      avgAgingDays: null
    })),
    bottleneckLabel: null
  },
  response: {
    avgHours: null,
    withinGoalPct: null,
    fastest: [],
    slowest: []
  },
  tasks: {
    overdue: 0,
    dueToday: 0,
    next7Days: 0,
    created: 0,
    completed: 0,
    backlogDelta: 0,
    byMemberOverdue: []
  },
  alerts: {
    riskHigh: [],
    operational: []
  },
  goals: {
    source: "placeholder",
    monthLabel: "Mês atual",
    metrics: [],
    byMember: []
  },
  monthlyComparison: {
    entries: { current: 0, previous: 0, deltaPct: null },
    movements: { current: 0, previous: 0, deltaPct: null },
    closures: { current: 0, previous: 0, deltaPct: null }
  },
  leaderboard: {
    byResult: [],
    byProduction: [],
    weights: LEADERBOARD_WEIGHTS
  }
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

const normalizeRole = (value?: string | null): "owner" | "admin" | "member" => {
  if (value === "owner" || value === "admin" || value === "member") return value;
  return "member";
};

const parseDateSafe = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const resolveClientFollowupAt = (client: ClientRow) =>
  parseDateSafe(client.next_action_at) ?? parseDateSafe(client.next_followup_at);

const resolveTimelineFollowupAt = (
  payload?: {
    next_action_at?: string | null;
    next_followup_at?: string | null;
  } | null
) => parseDateSafe(payload?.next_action_at ?? payload?.next_followup_at ?? null);

const resolveClientMovementAt = (client: ClientRow) =>
  parseDateSafe(client.updated_at) ??
  parseDateSafe(client.last_status_change_at) ??
  parseDateSafe(client.created_at);

const startOfDay = (value: Date) =>
  new Date(value.getFullYear(), value.getMonth(), value.getDate(), 0, 0, 0, 0);

const endOfDay = (value: Date) =>
  new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999);

const startOfMonth = (value: Date) =>
  new Date(value.getFullYear(), value.getMonth(), 1, 0, 0, 0, 0);

const endOfMonth = (value: Date) =>
  new Date(value.getFullYear(), value.getMonth() + 1, 0, 23, 59, 59, 999);

const isWithin = (value: Date | null, rangeStart: Date, rangeEnd: Date) => {
  if (!value) return false;
  return value >= rangeStart && value <= rangeEnd;
};

const toLowerSafe = (value?: string | null) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const calcDeltaPct = (current: number, previous: number) => {
  if (previous <= 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
};

const isMissingColumnError = (errorMessage?: string) =>
  typeof errorMessage === "string" &&
  /(column .* does not exist|could not find the .* column .* schema cache|pgrst204)/i.test(
    errorMessage
  );

const isMissingRelationError = (errorMessage?: string) =>
  typeof errorMessage === "string" &&
  /(relation .* does not exist|could not find the table .* schema cache|pgrst)/i.test(
    errorMessage
  );

const isMissingFunctionError = (errorMessage?: string) =>
  typeof errorMessage === "string" &&
  /(function .* does not exist|pgrst202|42883)/i.test(errorMessage);

function resolveDateRange(filters: OrganizerAnalyticsFilters): DateRange {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  if (filters.period === "today") {
    const previousStart = new Date(todayStart);
    previousStart.setDate(previousStart.getDate() - 1);
    const previousEnd = endOfDay(previousStart);
    return {
      label: "Hoje",
      start: todayStart,
      end: todayEnd,
      previousStart: startOfDay(previousStart),
      previousEnd
    };
  }

  if (filters.period === "month") {
    const currentStart = startOfMonth(now);
    const currentEnd = now;
    const previousMonthAnchor = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const previousStart = startOfMonth(previousMonthAnchor);
    const previousEnd = endOfMonth(previousMonthAnchor);
    return {
      label: "Mês atual",
      start: currentStart,
      end: currentEnd,
      previousStart,
      previousEnd
    };
  }

  if (filters.period === "custom") {
    const customStart = parseDateSafe(filters.customStart);
    const customEnd = parseDateSafe(filters.customEnd);
    if (customStart && customEnd && customStart <= customEnd) {
      const start = startOfDay(customStart);
      const end = endOfDay(customEnd);
      const duration = end.getTime() - start.getTime();
      return {
        label: "Intervalo personalizado",
        start,
        end,
        previousStart: new Date(start.getTime() - duration - 1),
        previousEnd: new Date(start.getTime() - 1)
      };
    }
  }

  const daysBack = filters.period === "30d" ? 30 : 7;
  const start = new Date(todayStart);
  start.setDate(start.getDate() - (daysBack - 1));
  const end = todayEnd;
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - (daysBack - 1));
  return {
    label: `Últimos ${daysBack} dias`,
    start,
    end,
    previousStart: startOfDay(previousStart),
    previousEnd: endOfDay(previousEnd)
  };
}

function normalizePayload(payload: TimelineRow["payload"]) {
  if (!payload) return null;
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload) as {
        next_action?: string | null;
        next_action_at?: string | null;
        next_followup_at?: string | null;
        chase_due_at?: string | null;
        visit_at?: string | null;
        proposal_value?: number | null;
        closed_outcome?: ClosedOutcome | string | null;
      };
    } catch {
      return null;
    }
  }
  return payload;
}

function toMemberLabel(userId: string) {
  return `Membro ${userId.slice(0, 6)}`;
}

function toMemberNameFallback(email: string | null, userId: string) {
  if (email) {
    const localPart = email.split("@")[0]?.trim();
    if (localPart) {
      return localPart.replace(/[._-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
    }
  }
  return toMemberLabel(userId);
}

function resolveClientOwnerId(
  client?: Pick<ClientRow, "owner_user_id" | "user_id"> | null
) {
  const owner = client?.owner_user_id ?? client?.user_id ?? null;
  if (typeof owner !== "string") return null;
  const normalized = owner.trim();
  return normalized.length > 0 ? normalized : null;
}

function buildStatusTag(row: MemberPerformance): MemberPerformance["status"] {
  if (
    row.conversionRate >= 20 &&
    row.overdueTasks <= 2 &&
    (row.avgResponseHours === null || row.avgResponseHours <= 24)
  ) {
    return "verde";
  }
  if (
    row.conversionRate >= 10 &&
    row.overdueTasks <= 5 &&
    (row.avgResponseHours === null || row.avgResponseHours <= 48)
  ) {
    return "amarelo";
  }
  return "vermelho";
}

function getMetricStatus(progressPct: number): GoalMetric["status"] {
  if (progressPct >= 100) return "atingida";
  if (progressPct >= 70) return "em_risco";
  return "fora_meta";
}

export function useOrganizerAnalytics(
  organizationId: string | null,
  activeRole?: string | null
): UseOrganizerAnalyticsResult {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [filters, setFiltersState] = useState<OrganizerAnalyticsFilters>(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [data, setData] = useState<OrganizerAnalyticsData>(emptyData);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [appliedRange, setAppliedRange] = useState<AppliedRange>(() =>
    toAppliedRange(resolveDateRange(DEFAULT_FILTERS))
  );
  const [summaryCards, setSummaryCards] = useState<SummaryCardsState>({
    activeMembersCount: 0,
    movedItemsCount: 0,
    loading: false,
    error: null,
    isEmpty: false
  });

  const setFilters = useCallback((next: Partial<OrganizerAnalyticsFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...next }));
  }, []);

  const refresh = useCallback(() => {
    setRefreshTick((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!organizationId) {
      const fallbackRange = toAppliedRange(resolveDateRange(filters));
      setAppliedRange(fallbackRange);
      setData({
        ...emptyData,
        rangeLabel: fallbackRange.label
      });
      setMembers([]);
      setMembersError("Nenhuma organização ativa encontrada para listar membros.");
      setMetricsError("Nenhuma organização ativa encontrada para calcular métricas.");
      setSummaryCards({
        activeMembersCount: 0,
        movedItemsCount: 0,
        loading: false,
        error: "Nenhuma organização ativa encontrada.",
        isEmpty: false
      });
      setLoading(false);
      return;
    }

    let active = true;

    const fetchAndCompute = async () => {
      setLoading(true);
      setMembersError(null);
      setMetricsError(null);

      const range = resolveDateRange(filters);
      const rangeSnapshot = toAppliedRange(range);
      const now = new Date();
      const monthStart = startOfMonth(now);
      const prevMonthAnchor = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevMonthStart = startOfMonth(prevMonthAnchor);
      const prevMonthEnd = endOfMonth(prevMonthAnchor);
      const isDev = process.env.NODE_ENV !== "production";
      const logSummaryCardsError = (
        error: SupabaseLikeError | null,
        selectedMemberId: string,
        message?: string
      ) => {
        if (!isDev) return;
        console.error("[OrganizerAnalytics] summaryCards:fetch:error", {
          organizationId,
          selectedPeriod: filters.period,
          startISO: rangeSnapshot.startISO,
          endISO: rangeSnapshot.endISO,
          selectedMemberId,
          activeMembersCount: 0,
          movedItemsCount: 0,
          supabaseError: toSupabaseErrorMeta(error),
          message: message ?? error?.message ?? null
        });
      };

      setAppliedRange(rangeSnapshot);
      setSummaryCards((prev) => ({
        ...prev,
        loading: true,
        error: null,
        isEmpty: false
      }));

      const {
        data: { user }
      } = await supabase.auth.getUser();

      if (isDev) {
        console.info("[OrganizerAnalytics] metrics:fetch:start", {
          orgId: organizationId,
          userId: user?.id ?? null,
          role: activeRole ?? null,
          period: filters.period,
          memberId: filters.memberId,
          rangeStartIso: range.start.toISOString(),
          rangeEndIso: range.end.toISOString()
        });
        console.info("[OrganizerAnalytics] summaryCards:fetch:start", {
          organizationId,
          selectedPeriod: filters.period,
          startISO: rangeSnapshot.startISO,
          endISO: rangeSnapshot.endISO,
          selectedMemberId: filters.memberId
        });
      }

      const clientsBaseFields =
        "id, owner_user_id, user_id, name, contact_info, status_pipeline, closed_outcome, next_action_at, next_followup_at, chase_due_at, last_contact_at, last_reply_at, visit_at, proposal_value, last_status_change_at, updated_at, created_at";
      const clientsNoUpdatedFields =
        "id, owner_user_id, user_id, name, contact_info, status_pipeline, closed_outcome, next_action_at, next_followup_at, chase_due_at, last_contact_at, last_reply_at, visit_at, proposal_value, last_status_change_at, created_at";
      const clientsFallbackFields =
        "id, user_id, name, contact_info, status_pipeline, created_at";
      const timelineFields =
        "id, client_id, actor_user_id, event_type, from_status, to_status, payload, created_at";
      const membersFields = "user_id, role, status";
      const membersFallbackFields = "user_id, role";
      let nextMembersError: string | null = null;
      let nextMetricsError: string | null = null;
      let summarySupabaseError: SupabaseLikeError | null = null;

      const [membersQuery, memberDirectoryQuery] = await Promise.all([
        supabase
          .from("organization_members")
          .select(membersFields)
          .eq("organization_id", organizationId),
        supabase.rpc("get_org_member_directory", { p_org_id: organizationId })
      ]);

      let membershipRows = (membersQuery.data as OrganizationMemberRow[] | null) ?? [];
      let membersQueryError = membersQuery.error;
      if (membersQueryError && isMissingColumnError(membersQueryError.message)) {
        const fallback = await supabase
          .from("organization_members")
          .select(membersFallbackFields)
          .eq("organization_id", organizationId);
        membershipRows = (fallback.data as OrganizationMemberRow[] | null) ?? [];
        membersQueryError = fallback.error;
      }
      if (membersQueryError) {
        nextMembersError = `Erro ao carregar membros: ${membersQueryError.message}`;
        if (isDev) {
          console.error("[OrganizerAnalytics] members query failed", {
            orgId: organizationId,
            code: membersQueryError.code,
            details: membersQueryError.details,
            hint: membersQueryError.hint,
            message: membersQueryError.message
          });
        }
        membershipRows = [];
      }
      if (isDev && !membersQueryError) {
        console.info("[OrganizerAnalytics] query:organization_members", {
          orgId: organizationId,
          dataLength: membershipRows.length,
          sample: membershipRows.slice(0, 3)
        });
      }

      let memberDirectoryRows =
        (memberDirectoryQuery.data as OrganizationMemberDirectoryRow[] | null) ?? [];
      if (memberDirectoryQuery.error) {
        if (!isMissingFunctionError(memberDirectoryQuery.error.message)) {
          const rpcMessage = `Erro ao carregar diretório de membros: ${memberDirectoryQuery.error.message}`;
          nextMembersError = nextMembersError
            ? `${nextMembersError} | ${rpcMessage}`
            : rpcMessage;
          if (isDev) {
            console.error("[OrganizerAnalytics] member directory rpc failed", {
              orgId: organizationId,
              code: memberDirectoryQuery.error.code,
              details: memberDirectoryQuery.error.details,
              hint: memberDirectoryQuery.error.hint,
              message: memberDirectoryQuery.error.message
            });
          }
        }
        memberDirectoryRows = [];
      }
      if (isDev && !memberDirectoryQuery.error) {
        console.info("[OrganizerAnalytics] query:get_org_member_directory", {
          orgId: organizationId,
          dataLength: memberDirectoryRows.length,
          sample: memberDirectoryRows.slice(0, 3)
        });
      }

      const memberDirectoryById = new Map<
        string,
        { name: string | null; email: string | null; role: string | null; status: string | null }
      >();
      memberDirectoryRows.forEach((row) => {
        if (typeof row.user_id !== "string" || row.user_id.length === 0) return;
        memberDirectoryById.set(row.user_id, {
          name: typeof row.member_name === "string" ? row.member_name : null,
          email: typeof row.member_email === "string" ? row.member_email : null,
          role: typeof row.role === "string" ? row.role : null,
          status: typeof row.status === "string" ? row.status : null
        });
      });

      const allMemberIds = new Set<string>();
      membershipRows.forEach((row) => {
        if (row.user_id && row.status !== "disabled") {
          allMemberIds.add(row.user_id);
        }
      });
      memberDirectoryRows.forEach((row) => {
        if (typeof row.user_id === "string" && row.user_id.length > 0) {
          if (row.status !== "disabled") {
            allMemberIds.add(row.user_id);
          }
        }
      });

      const memberOptions: MemberOption[] = Array.from(allMemberIds).map((userId) => {
        const roleFromMembership = membershipRows.find(
          (row) => row.user_id === userId
        )?.role;
        const directory = memberDirectoryById.get(userId);
        const memberEmail = directory?.email ?? null;
        const memberName = directory?.name ?? toMemberNameFallback(memberEmail, userId);
        const normalizedRole = normalizeRole(
          directory?.role ?? roleFromMembership ?? null
        );
        return {
          id: userId,
          label: memberName,
          email: memberEmail,
          role: normalizedRole
        };
      });

      memberOptions.sort((a, b) => {
        if (a.role === b.role) return a.label.localeCompare(b.label);
        if (a.role === "owner") return -1;
        if (b.role === "owner") return 1;
        if (a.role === "admin") return -1;
        if (b.role === "admin") return 1;
        return a.label.localeCompare(b.label);
      });

      if (!nextMembersError && memberOptions.length === 0) {
        nextMembersError = "Nenhum membro encontrado para esta organização.";
      }

      if (!active) return;
      setMembers(memberOptions);
      setMembersError(nextMembersError);

      const clientsQuery = await supabase
        .from("clients")
        .select(clientsBaseFields)
        .eq("org_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(4000);

      let clientsRows = (clientsQuery.data as ClientRow[] | null) ?? [];
      let clientsError = clientsQuery.error;

      if (clientsError && isMissingColumnError(clientsError.message)) {
        const fallbackWithoutUpdated = await supabase
          .from("clients")
          .select(clientsNoUpdatedFields)
          .eq("org_id", organizationId)
          .order("created_at", { ascending: false })
          .limit(4000);
        clientsRows = (fallbackWithoutUpdated.data as ClientRow[] | null) ?? [];
        clientsError = fallbackWithoutUpdated.error;
      }

      if (clientsError && isMissingColumnError(clientsError.message)) {
        const fallbackLegacy = await supabase
          .from("clients")
          .select(clientsFallbackFields)
          .eq("org_id", organizationId)
          .order("created_at", { ascending: false })
          .limit(4000);
        clientsRows = (fallbackLegacy.data as ClientRow[] | null) ?? [];
        clientsError = fallbackLegacy.error;
      }

      if (clientsError) {
        summarySupabaseError = clientsError;
        if (isDev) {
          console.error("[OrganizerAnalytics] clients query failed", {
            orgId: organizationId,
            code: clientsError.code,
            details: clientsError.details,
            hint: clientsError.hint,
            message: clientsError.message
          });
        }
        logSummaryCardsError(clientsError, filters.memberId, clientsError.message ?? undefined);
        if (!active) return;
        setMembersError(nextMembersError);
        setMetricsError(`Erro ao carregar métricas: ${clientsError.message}`);
        setData({
          ...emptyData,
          rangeLabel: range.label
        });
        setSummaryCards({
          activeMembersCount: 0,
          movedItemsCount: 0,
          loading: false,
          error: toSummaryErrorMessage(clientsError.message ?? "Erro desconhecido."),
          isEmpty: false
        });
        setLoading(false);
        return;
      }
      if (isDev) {
        console.info("[OrganizerAnalytics] query:clients", {
          orgId: organizationId,
          dataLength: clientsRows.length,
          sample: clientsRows.slice(0, 3)
        });
      }

      const timelineQuery = await supabase
        .from("crm_timeline")
        .select(timelineFields)
        .eq("org_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(6000);

      let timelineRows = (timelineQuery.data as TimelineRow[] | null) ?? [];
      if (timelineQuery.error && !isMissingRelationError(timelineQuery.error.message)) {
        nextMetricsError = `Erro ao carregar métricas: ${timelineQuery.error.message}`;
        summarySupabaseError = timelineQuery.error;
        if (isDev) {
          console.error("[OrganizerAnalytics] timeline query failed", {
            orgId: organizationId,
            code: timelineQuery.error.code,
            details: timelineQuery.error.details,
            hint: timelineQuery.error.hint,
            message: timelineQuery.error.message
          });
        }
        timelineRows = [];
      }
      if (timelineQuery.error && isMissingRelationError(timelineQuery.error.message)) {
        timelineRows = [];
      }
      if (isDev && !timelineQuery.error) {
        console.info("[OrganizerAnalytics] query:crm_timeline", {
          orgId: organizationId,
          dataLength: timelineRows.length,
          sample: timelineRows.slice(0, 3)
        });
      }

      const clientsById = new Map<string, ClientRow>();
      clientsRows.forEach((row) => clientsById.set(row.id, row));

      const memberMap = new Map<string, MemberOption>(
        memberOptions.map((member) => [member.id, member])
      );
      clientsRows.forEach((row) => {
        const ownerId = resolveClientOwnerId(row);
        if (!ownerId || memberMap.has(ownerId)) return;
        const directory = memberDirectoryById.get(ownerId);
        const roleFromMembership = membershipRows.find(
          (member) => member.user_id === ownerId
        )?.role;
        const memberEmail = directory?.email ?? row.contact_info?.email?.trim() ?? null;
        const memberName =
          directory?.name ??
          (row.name?.trim().length ? row.name.trim() : toMemberNameFallback(memberEmail, ownerId));
        memberMap.set(ownerId, {
          id: ownerId,
          label: memberName,
          email: memberEmail,
          role: normalizeRole(directory?.role ?? roleFromMembership ?? null)
        });
      });

      memberOptions.splice(0, memberOptions.length, ...Array.from(memberMap.values()));

      memberOptions.sort((a, b) => {
        if (a.role === b.role) return a.label.localeCompare(b.label);
        if (a.role === "owner") return -1;
        if (b.role === "owner") return 1;
        if (a.role === "admin") return -1;
        if (b.role === "admin") return 1;
        return a.label.localeCompare(b.label);
      });

      if (!nextMembersError && memberOptions.length === 0) {
        nextMembersError = "Nenhum membro encontrado para esta organização.";
      }

      if (!active) return;
      setMembers(memberOptions);
      setMembersError(nextMembersError);

      if (isDev) {
        console.info("[OrganizerAnalytics] query:counts", {
          crmSource: "public.clients",
          orgId: organizationId,
          role: activeRole ?? null,
          clients: clientsRows.length,
          timeline: timelineRows.length,
          members: membershipRows.length,
          directory: memberDirectoryRows.length
        });
      }

      const organizationClosureCounts = clientsRows.reduce(
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
      );

      const selectedMemberId =
        filters.memberId !== "all" && memberOptions.some((m) => m.id === filters.memberId)
          ? filters.memberId
          : "all";

      const filteredClients =
        selectedMemberId === "all"
          ? clientsRows
          : clientsRows.filter(
              (client) => resolveClientOwnerId(client) === selectedMemberId
            );

      const contactEventsByClient = new Map<string, Date[]>();
      const normalizedTimeline = timelineRows.map((event) => {
        const payload = normalizePayload(event.payload);
        const toStatus = normalizePipelineStatus(event.to_status);
        const createdAt = parseDateSafe(event.created_at);
        const nextAction = toLowerSafe(payload?.next_action);
        const hasContactAction =
          CONTACT_ACTIONS.has(nextAction) ||
          toStatus === "contato_feito" ||
          toStatus === "em_conversa" ||
          toStatus === "aguardando_retorno";

        if (hasContactAction && createdAt) {
          const existing = contactEventsByClient.get(event.client_id) ?? [];
          existing.push(createdAt);
          contactEventsByClient.set(event.client_id, existing);
        }

        const ownerUserId =
          resolveClientOwnerId(clientsById.get(event.client_id)) ??
          event.actor_user_id ??
          null;

        return {
          ...event,
          payload,
          toStatus,
          createdAt,
          ownerUserId,
          isStatusChange: Boolean(event.to_status || event.from_status),
          isContactEvent: hasContactAction,
          isVisitEvent: toStatus === "visita_agendada" || Boolean(payload?.visit_at),
          isProposalEvent: toStatus === "proposta" || typeof payload?.proposal_value === "number",
          isClosedWon:
            toStatus === "fechado" &&
            ((payload?.closed_outcome as string | null | undefined) === "won" ||
              clientsById.get(event.client_id)?.closed_outcome === "won"),
          isClosedLost:
            toStatus === "fechado" &&
            ((payload?.closed_outcome as string | null | undefined) === "lost" ||
              clientsById.get(event.client_id)?.closed_outcome === "lost"),
          hasTaskCreated: Boolean(
            resolveTimelineFollowupAt(payload) ?? parseDateSafe(payload?.chase_due_at ?? null)
          )
        };
      });

      for (const [clientId, dates] of contactEventsByClient) {
        dates.sort((a, b) => a.getTime() - b.getTime());
        contactEventsByClient.set(clientId, dates);
      }

      const filteredTimeline =
        selectedMemberId === "all"
          ? normalizedTimeline
          : normalizedTimeline.filter((event) => event.ownerUserId === selectedMemberId);

      const currentCreatedClients = filteredClients.filter((client) =>
        isWithin(parseDateSafe(client.created_at), range.start, range.end)
      );

      const currentEvents = filteredTimeline.filter((event) =>
        isWithin(event.createdAt, range.start, range.end)
      );
      const currentMovedClients = filteredClients.filter((client) =>
        isWithin(resolveClientMovementAt(client), range.start, range.end)
      );

      const currentMovedClientIds = new Set(currentMovedClients.map((client) => client.id));

      const createMetricAggregate = () => ({
        newItems: 0,
        advancedItems: 0,
        contacts: 0,
        visits: 0,
        proposals: 0,
        closedWon: 0,
        closedLost: 0
      });

      // Source of truth for organizer metrics: same dataset used by CRM cards (`public.clients`).
      const computeMetricCounts = (
        membersSource: MemberOption[],
        clientsSource: ClientRow[],
        eventsSource: typeof normalizedTimeline,
        periodStart: Date,
        periodEnd: Date
      ) => {
        const byMember = new Map<
          string,
          {
            newItems: number;
            advancedItems: number;
            contacts: number;
            visits: number;
            proposals: number;
            closedWon: number;
            closedLost: number;
          }
        >();

        membersSource.forEach((member) => byMember.set(member.id, createMetricAggregate()));
        const total = createMetricAggregate();

        const ensureAggregate = (owner: string) => {
          if (!byMember.has(owner)) {
            byMember.set(owner, createMetricAggregate());
          }
          return byMember.get(owner)!;
        };

        const periodEvents = eventsSource.filter((event) =>
          isWithin(event.createdAt, periodStart, periodEnd)
        );

        const createdClientsInRange = clientsSource.filter((client) =>
          isWithin(parseDateSafe(client.created_at), periodStart, periodEnd)
        );
        createdClientsInRange.forEach((client) => {
          const owner = resolveClientOwnerId(client);
          if (!owner) return;
          const aggregate = ensureAggregate(owner);
          aggregate.newItems += 1;
          total.newItems += 1;
        });

        const movedClientsInRange = clientsSource.filter((client) =>
          isWithin(resolveClientMovementAt(client), periodStart, periodEnd)
        );
        movedClientsInRange.forEach((client) => {
          const owner = resolveClientOwnerId(client);
          if (!owner) return;
          const aggregate = ensureAggregate(owner);
          aggregate.advancedItems += 1;
          total.advancedItems += 1;
        });

        const clientsWithTimelineEvents = new Set(
          periodEvents.map((event) => event.client_id).filter(Boolean)
        );

        periodEvents.forEach((event) => {
          const owner = event.ownerUserId;
          if (!owner) return;
          const aggregate = ensureAggregate(owner);
          if (event.isContactEvent) {
            aggregate.contacts += 1;
            total.contacts += 1;
          }
          if (event.isVisitEvent) {
            aggregate.visits += 1;
            total.visits += 1;
          }
          if (event.isProposalEvent) {
            aggregate.proposals += 1;
            total.proposals += 1;
          }
          if (event.isClosedWon) {
            aggregate.closedWon += 1;
            total.closedWon += 1;
          }
          if (event.isClosedLost) {
            aggregate.closedLost += 1;
            total.closedLost += 1;
          }
        });

        // Fallback para bases legadas sem timeline consistente.
        clientsSource.forEach((client) => {
          const owner = resolveClientOwnerId(client);
          if (!owner || clientsWithTimelineEvents.has(client.id)) return;

          const aggregate = ensureAggregate(owner);
          const status = normalizePipelineStatus(client.status_pipeline);
          const statusAnchor =
            parseDateSafe(client.last_status_change_at) ?? parseDateSafe(client.created_at);
          const visitAt = parseDateSafe(client.visit_at);
          const hasProposalValue =
            typeof client.proposal_value === "number" &&
            Number.isFinite(client.proposal_value) &&
            client.proposal_value > 0;
          const outcome = client.closed_outcome === "lost" ? "lost" : "won";

          if (
            isWithin(visitAt, periodStart, periodEnd) ||
            (status === "visita_agendada" &&
              isWithin(statusAnchor, periodStart, periodEnd))
          ) {
            aggregate.visits += 1;
            total.visits += 1;
          }

          if (
            (status === "proposta" && isWithin(statusAnchor, periodStart, periodEnd)) ||
            (hasProposalValue && isWithin(statusAnchor, periodStart, periodEnd))
          ) {
            aggregate.proposals += 1;
            total.proposals += 1;
          }

          if (status === "fechado" && isWithin(statusAnchor, periodStart, periodEnd)) {
            if (outcome === "lost") {
              aggregate.closedLost += 1;
              total.closedLost += 1;
            } else {
              aggregate.closedWon += 1;
              total.closedWon += 1;
            }
          }
        });

        return { byMember, total };
      };

      const currentMetrics = computeMetricCounts(
        memberOptions,
        filteredClients,
        filteredTimeline,
        range.start,
        range.end
      );
      const previousMetrics = computeMetricCounts(
        memberOptions,
        filteredClients,
        filteredTimeline,
        range.previousStart,
        range.previousEnd
      );

      const activeMemberIds = new Set<string>();
      const activeClientsInRange = new Map<string, ClientRow>();
      currentCreatedClients.forEach((client) => {
        activeClientsInRange.set(client.id, client);
      });
      currentMovedClients.forEach((client) => {
        activeClientsInRange.set(client.id, client);
      });
      activeClientsInRange.forEach((client) => {
        const ownerId = resolveClientOwnerId(client);
        if (ownerId) activeMemberIds.add(ownerId);
      });
      currentEvents.forEach((event) => {
        if (event.ownerUserId) activeMemberIds.add(event.ownerUserId);
      });
      memberOptions.forEach((member) => {
        const metrics = currentMetrics.byMember.get(member.id);
        if (!metrics) return;
        const volume =
          metrics.newItems +
          metrics.advancedItems +
          metrics.contacts +
          metrics.visits +
          metrics.proposals +
          metrics.closedWon +
          metrics.closedLost;
        if (volume > 0) activeMemberIds.add(member.id);
      });

      const movedStatusCounts = PIPELINE_ORDER.reduce<Record<PipelineStatus, number>>(
        (acc, status) => {
          acc[status] = 0;
          return acc;
        },
        {
          novo_match: 0,
          contato_feito: 0,
          em_conversa: 0,
          aguardando_retorno: 0,
          visita_agendada: 0,
          proposta: 0,
          fechado: 0
        }
      );
      currentMovedClients.forEach((client) => {
        const status = normalizePipelineStatus(client.status_pipeline);
        movedStatusCounts[status] += 1;
      });

      if (isDev) {
        console.info("[OrganizerAnalytics] metrics:period", {
          crmSource: "public.clients",
          orgId: organizationId,
          selectedMemberId,
          rangeStartIso: range.start.toISOString(),
          rangeEndIso: range.end.toISOString(),
          createdInRange: currentCreatedClients.length,
          movedInRange: currentMovedClientIds.size,
          activeMembersInRange: activeMemberIds.size,
          statusCountsFromClients: movedStatusCounts
        });
      }

      const firstResponseHoursByClient = new Map<string, number>();
      const clientsWithTimelineContact = new Set(contactEventsByClient.keys());
      filteredClients.forEach((client) => {
        const createdAt = parseDateSafe(client.created_at);
        const firstContactAt = (contactEventsByClient.get(client.id) ?? [])[0] ?? null;
        if (createdAt && firstContactAt) {
          const hours = (firstContactAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
          if (hours >= 0 && Number.isFinite(hours)) {
            firstResponseHoursByClient.set(client.id, hours);
          }
          return;
        }

        // Fallback para clientes sem timeline de contato: usa último avanço de status.
        if (!createdAt || clientsWithTimelineContact.has(client.id)) return;
        const status = normalizePipelineStatus(client.status_pipeline);
        if (status === "novo_match") return;
        const statusAnchor = parseDateSafe(client.last_status_change_at);
        if (!statusAnchor) return;
        const hours = (statusAnchor.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
        if (hours >= 0 && Number.isFinite(hours)) {
          firstResponseHoursByClient.set(client.id, hours);
        }
      });

      const nowRef = new Date();
      const next7 = new Date(nowRef);
      next7.setDate(next7.getDate() + 7);

      const memberPerformanceRows = memberOptions
        .filter((member) =>
          selectedMemberId === "all" ? true : member.id === selectedMemberId
        )
        .map((member) => {
          const ownedClients = filteredClients.filter(
            (client) => resolveClientOwnerId(client) === member.id
          );
          const responseSamples = ownedClients
            .map((client) => firstResponseHoursByClient.get(client.id))
            .filter((value): value is number => typeof value === "number");

          const avgResponseHours =
            responseSamples.length > 0
              ? responseSamples.reduce((acc, value) => acc + value, 0) /
                responseSamples.length
              : null;

          const overdueTasks = ownedClients.filter((client) => {
            const status = normalizePipelineStatus(client.status_pipeline);
            if (status === "fechado") return false;
            const followupAt =
              resolveClientFollowupAt(client) ?? parseDateSafe(client.chase_due_at);
            if (!followupAt) return false;
            return followupAt < nowRef;
          }).length;

          const metrics = currentMetrics.byMember.get(member.id) ?? {
            newItems: 0,
            advancedItems: 0,
            contacts: 0,
            visits: 0,
            proposals: 0,
            closedWon: 0,
            closedLost: 0
          };

          const row: MemberPerformance = {
            memberId: member.id,
            memberLabel: member.label,
            memberEmail: member.email,
            newItems: metrics.newItems,
            advancedItems: metrics.advancedItems,
            contacts: metrics.contacts,
            visits: metrics.visits,
            proposals: metrics.proposals,
            closedWon: metrics.closedWon,
            closedLost: metrics.closedLost,
            conversionRate:
              metrics.newItems > 0
                ? (metrics.closedWon / metrics.newItems) * 100
                : metrics.closedWon > 0
                  ? 100
                  : 0,
            avgResponseHours,
            overdueTasks,
            status: "amarelo"
          };

          row.status = buildStatusTag(row);
          return row;
        });

      const sortedMemberRows = [...memberPerformanceRows].sort((a, b) => {
        const direction = filters.sortDirection === "asc" ? 1 : -1;
        const getValue = (row: MemberPerformance) => {
          if (filters.sortBy === "closedWon") return row.closedWon;
          if (filters.sortBy === "conversionRate") return row.conversionRate;
          if (filters.sortBy === "overdueTasks") return row.overdueTasks;
          if (filters.sortBy === "contacts") return row.contacts;
          return row.avgResponseHours ?? Number.MAX_SAFE_INTEGER;
        };
        const aValue = getValue(a);
        const bValue = getValue(b);
        if (aValue === bValue) return a.memberLabel.localeCompare(b.memberLabel);
        return (aValue - bValue) * direction;
      });

      const kpiDefinitions = [
        { key: "newItems", label: "Itens novos no CRM" },
        { key: "advancedItems", label: "Itens avançados de etapa" },
        { key: "contacts", label: "Contatos feitos" },
        { key: "visits", label: "Visitas marcadas" },
        { key: "proposals", label: "Propostas enviadas" },
        { key: "closedWon", label: "Fechados" },
        { key: "closedLost", label: "Perdidos" }
      ] as const;

      const kpis: KpiCard[] = kpiDefinitions.map((definition) => {
        const key = definition.key;
        const currentValue = currentMetrics.total[key];
        const prevValue = previousMetrics.total[key];
        let topMemberLabel = "—";
        let topMemberValue = 0;
        memberPerformanceRows.forEach((row) => {
          const rowValue = row[key] as number;
          if (rowValue > topMemberValue) {
            topMemberValue = rowValue;
            topMemberLabel = row.memberLabel;
          }
        });
        return {
          key,
          label: definition.label,
          value: currentValue,
          prevValue,
          changePct: calcDeltaPct(currentValue, prevValue),
          topMemberLabel,
          topMemberValue
        };
      });

      const funnelClients = filteredClients.filter((client) => {
        const createdAt = parseDateSafe(client.created_at);
        return createdAt ? createdAt <= range.end : true;
      });
      const funnelSteps: FunnelStep[] = PIPELINE_ORDER.reduce<FunnelStep[]>(
        (steps, status, index) => {
          const inStage = funnelClients.filter(
            (client) => normalizePipelineStatus(client.status_pipeline) === status
          );
          const count = inStage.length;
          const prevCount = index > 0 ? steps[index - 1]?.count ?? 0 : 0;
          const conversionFromPrev =
            index === 0 || prevCount === 0 ? null : (count / prevCount) * 100;
          const agingValues = inStage
            .map((client) => {
              const anchor =
                parseDateSafe(client.last_status_change_at) ?? parseDateSafe(client.created_at);
              if (!anchor) return null;
              return Math.max(0, (nowRef.getTime() - anchor.getTime()) / (1000 * 60 * 60 * 24));
            })
            .filter((value): value is number => typeof value === "number");

          steps.push({
            status,
            label: PIPELINE_LABEL[status],
            count,
            conversionFromPrev,
            avgAgingDays:
              agingValues.length > 0
                ? agingValues.reduce((acc, value) => acc + value, 0) / agingValues.length
                : null
          });

          return steps;
        },
        []
      );

      const bottleneckStep = funnelSteps
        .filter((step) => step.status !== "fechado" && (step.avgAgingDays ?? 0) > 0)
        .sort((a, b) => (b.avgAgingDays ?? 0) - (a.avgAgingDays ?? 0))[0];

      const allResponseSamples = memberPerformanceRows
        .map((row) => row.avgResponseHours)
        .filter((value): value is number => typeof value === "number");
      const overallAvgResponseHours =
        allResponseSamples.length > 0
          ? allResponseSamples.reduce((acc, value) => acc + value, 0) /
            allResponseSamples.length
          : null;

      const withinGoalPopulation = filteredClients
        .map((client) => firstResponseHoursByClient.get(client.id))
        .filter((value): value is number => typeof value === "number");
      const withinGoalCount = withinGoalPopulation.filter(
        (value) => value <= filters.responseGoalHours
      ).length;
      const withinGoalPct =
        withinGoalPopulation.length > 0
          ? (withinGoalCount / withinGoalPopulation.length) * 100
          : null;

      const responseSorted = memberPerformanceRows
        .filter((row) => typeof row.avgResponseHours === "number")
        .map((row) => ({
          memberId: row.memberId,
          memberLabel: row.memberLabel,
          avgHours: row.avgResponseHours as number
        }))
        .sort((a, b) => a.avgHours - b.avgHours);

      const clientsWithFollowup = filteredClients.filter(
        (client) =>
          resolveClientFollowupAt(client) !== null || parseDateSafe(client.chase_due_at) !== null
      );
      const dueTodayCount = clientsWithFollowup.filter((client) => {
        const followupAt =
          resolveClientFollowupAt(client) ?? parseDateSafe(client.chase_due_at);
        if (!followupAt) return false;
        return (
          followupAt >= startOfDay(nowRef) &&
          followupAt <= endOfDay(nowRef) &&
          normalizePipelineStatus(client.status_pipeline) !== "fechado"
        );
      }).length;
      const overdueCount = clientsWithFollowup.filter((client) => {
        const followupAt =
          resolveClientFollowupAt(client) ?? parseDateSafe(client.chase_due_at);
        if (!followupAt) return false;
        return (
          followupAt < nowRef &&
          normalizePipelineStatus(client.status_pipeline) !== "fechado"
        );
      }).length;
      const next7DaysCount = clientsWithFollowup.filter((client) => {
        const followupAt =
          resolveClientFollowupAt(client) ?? parseDateSafe(client.chase_due_at);
        if (!followupAt) return false;
        return (
          followupAt > endOfDay(nowRef) &&
          followupAt <= endOfDay(next7) &&
          normalizePipelineStatus(client.status_pipeline) !== "fechado"
        );
      }).length;

      const tasksCreatedCount = currentEvents.filter((event) => event.hasTaskCreated).length;
      const tasksCompletedCount = currentEvents.filter((event) => event.isStatusChange).length;

      const byMemberOverdue = memberPerformanceRows
        .map((row) => ({
          memberId: row.memberId,
          memberLabel: row.memberLabel,
          count: row.overdueTasks
        }))
        .sort((a, b) => b.count - a.count);

      const noContactCount = filteredClients.filter((client) => {
        const createdAt = parseDateSafe(client.created_at);
        if (!createdAt) return false;
        const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
        if (nowRef.getTime() - createdAt.getTime() < threeDaysMs) return false;
        return !contactEventsByClient.get(client.id)?.length;
      }).length;

      const unassignedCount = filteredClients.filter(
        (client) => !resolveClientOwnerId(client)
      ).length;
      const stalledProposalCount = filteredClients.filter((client) => {
        const status = normalizePipelineStatus(client.status_pipeline);
        if (status !== "proposta") return false;
        const anchor =
          parseDateSafe(client.last_status_change_at) ?? parseDateSafe(client.created_at);
        if (!anchor) return false;
        const days = (nowRef.getTime() - anchor.getTime()) / (1000 * 60 * 60 * 24);
        return days >= 7;
      }).length;
      const visitNoFollowupCount = filteredClients.filter((client) => {
        const status = normalizePipelineStatus(client.status_pipeline);
        if (status !== "visita_agendada") return false;
        return (
          resolveClientFollowupAt(client) === null &&
          parseDateSafe(client.chase_due_at) === null
        );
      }).length;

      const duplicateMap = new Map<string, number>();
      filteredClients.forEach((client) => {
        const email = toLowerSafe(client.contact_info?.email);
        const phone = toLowerSafe(client.contact_info?.phone);
        const keys = [email ? `email:${email}` : "", phone ? `phone:${phone}` : ""].filter(
          Boolean
        );
        keys.forEach((key) =>
          duplicateMap.set(key, (duplicateMap.get(key) ?? 0) + 1)
        );
      });
      const duplicatesCount = Array.from(duplicateMap.values()).filter(
        (value) => value > 1
      ).length;

      const incompleteDataCount = filteredClients.filter((client) => {
        const hasName = Boolean(client.name && client.name.trim().length > 0);
        const hasEmail = Boolean(client.contact_info?.email?.trim());
        const hasPhone = Boolean(client.contact_info?.phone?.trim());
        return !hasName || (!hasEmail && !hasPhone);
      }).length;

      const alertCards: AlertCard[] = [
        {
          key: "noContact",
          label: "Sem contato há 3+ dias",
          value: noContactCount,
          href: "/crm?alert=sem-contato",
          severity: "alto"
        },
        {
          key: "stalledProposal",
          label: "Proposta parada há 7+ dias",
          value: stalledProposalCount,
          href: "/crm?alert=proposta-parada",
          severity: "alto"
        },
        {
          key: "visitNoFollowUp",
          label: "Visita sem follow-up",
          value: visitNoFollowupCount,
          href: "/crm?alert=visita-sem-followup",
          severity: "alto"
        },
        {
          key: "unassigned",
          label: "Sem responsável",
          value: unassignedCount,
          href: "/crm?alert=sem-responsavel",
          severity: "operacional"
        },
        {
          key: "duplicates",
          label: "Duplicados detectados",
          value: duplicatesCount,
          href: "/crm?alert=duplicados",
          severity: "operacional"
        },
        {
          key: "incompleteData",
          label: "Dados incompletos",
          value: incompleteDataCount,
          href: "/crm?alert=dados-incompletos",
          severity: "operacional"
        }
      ];

      const monthClients = filteredClients.filter((client) =>
        isWithin(parseDateSafe(client.created_at), monthStart, now)
      );
      const monthMetrics = computeMetricCounts(
        memberOptions,
        filteredClients,
        filteredTimeline,
        monthStart,
        now
      );

      const goalMetricSeed: Array<
        Pick<GoalMetric, "key" | "label" | "target" | "achieved">
      > = [
        {
          key: "contacts",
          label: "Contatos",
          target: GOAL_PLACEHOLDER_TARGETS.contacts,
          achieved: monthMetrics.total.contacts
        },
        {
          key: "visits",
          label: "Visitas",
          target: GOAL_PLACEHOLDER_TARGETS.visits,
          achieved: monthMetrics.total.visits
        },
        {
          key: "proposals",
          label: "Propostas",
          target: GOAL_PLACEHOLDER_TARGETS.proposals,
          achieved: monthMetrics.total.proposals
        },
        {
          key: "closedWon",
          label: "Fechados",
          target: GOAL_PLACEHOLDER_TARGETS.closedWon,
          achieved: monthMetrics.total.closedWon
        }
      ];

      const goalMetrics: GoalMetric[] = goalMetricSeed.map((metric) => {
        const progressPct =
          metric.target > 0 ? Math.min(150, (metric.achieved / metric.target) * 100) : 0;
        return {
          ...metric,
          progressPct,
          status: getMetricStatus(progressPct)
        };
      });

      const memberGoalProgress: MemberGoalProgress[] = memberPerformanceRows.map((member) => {
        const memberMonthMetrics = monthMetrics.byMember.get(member.memberId);
        const achieved =
          (memberMonthMetrics?.contacts ?? 0) +
          (memberMonthMetrics?.visits ?? 0) +
          (memberMonthMetrics?.proposals ?? 0) +
          (memberMonthMetrics?.closedWon ?? 0);
        const target =
          GOAL_PLACEHOLDER_TARGETS.contacts /
            Math.max(1, memberPerformanceRows.length) +
          GOAL_PLACEHOLDER_TARGETS.visits / Math.max(1, memberPerformanceRows.length) +
          GOAL_PLACEHOLDER_TARGETS.proposals / Math.max(1, memberPerformanceRows.length) +
          GOAL_PLACEHOLDER_TARGETS.closedWon / Math.max(1, memberPerformanceRows.length);
        return {
          memberId: member.memberId,
          memberLabel: member.memberLabel,
          progressPct: target > 0 ? Math.min(150, (achieved / target) * 100) : 0
        };
      });

      const prevMonthClients = filteredClients.filter((client) =>
        isWithin(parseDateSafe(client.created_at), prevMonthStart, prevMonthEnd)
      );
      const prevMonthMetrics = computeMetricCounts(
        memberOptions,
        filteredClients,
        filteredTimeline,
        prevMonthStart,
        prevMonthEnd
      );
      const currentMonthClosures =
        monthMetrics.total.closedWon + monthMetrics.total.closedLost;
      const previousMonthClosures =
        prevMonthMetrics.total.closedWon + prevMonthMetrics.total.closedLost;

      const leaderboardRows: LeaderboardRow[] = memberPerformanceRows.map((row) => {
        const productionValue = row.contacts + row.visits + row.proposals;
        const weightedScore =
          row.closedWon * LEADERBOARD_WEIGHTS.closedWon +
          row.contacts * LEADERBOARD_WEIGHTS.contacts +
          row.visits * LEADERBOARD_WEIGHTS.visits +
          row.proposals * LEADERBOARD_WEIGHTS.proposals;
        return {
          memberId: row.memberId,
          memberLabel: row.memberLabel,
          resultValue: row.closedWon,
          productionValue,
          weightedScore
        };
      });

      const nextData: OrganizerAnalyticsData = {
        rangeLabel: range.label,
        totalClientsInOrg: filteredClients.length,
        totalTimelineEventsInOrg: filteredTimeline.length,
        organizationClosureCounts,
        hasAnyCrmData: filteredClients.length > 0 || filteredTimeline.length > 0,
        hasPeriodData:
          currentCreatedClients.length > 0 ||
          currentMovedClients.length > 0 ||
          currentEvents.length > 0 ||
          currentMetrics.total.newItems > 0 ||
          currentMetrics.total.advancedItems > 0 ||
          currentMetrics.total.contacts > 0 ||
          currentMetrics.total.visits > 0 ||
          currentMetrics.total.proposals > 0 ||
          currentMetrics.total.closedWon > 0 ||
          currentMetrics.total.closedLost > 0,
        activeMembersInPeriod: activeMemberIds.size,
        movedItemsInPeriod: currentMovedClientIds.size,
        kpis,
        memberRows: sortedMemberRows,
        funnel: {
          steps: funnelSteps,
          bottleneckLabel: bottleneckStep?.label ?? null
        },
        response: {
          avgHours: overallAvgResponseHours,
          withinGoalPct,
          fastest: responseSorted.slice(0, 3),
          slowest: [...responseSorted].reverse().slice(0, 3)
        },
        tasks: {
          overdue: overdueCount,
          dueToday: dueTodayCount,
          next7Days: next7DaysCount,
          created: tasksCreatedCount,
          completed: tasksCompletedCount,
          backlogDelta: tasksCreatedCount - tasksCompletedCount,
          byMemberOverdue
        },
        alerts: {
          riskHigh: alertCards.filter((card) => card.severity === "alto"),
          operational: alertCards.filter((card) => card.severity === "operacional")
        },
        goals: {
          source: "placeholder",
          monthLabel: new Intl.DateTimeFormat("pt-BR", {
            month: "long",
            year: "numeric"
          }).format(now),
          metrics: goalMetrics,
          byMember: memberGoalProgress.sort((a, b) => b.progressPct - a.progressPct)
        },
        monthlyComparison: {
          entries: {
            current: monthClients.length,
            previous: prevMonthClients.length,
            deltaPct: calcDeltaPct(monthClients.length, prevMonthClients.length)
          },
          movements: {
            current: monthMetrics.total.advancedItems,
            previous: prevMonthMetrics.total.advancedItems,
            deltaPct: calcDeltaPct(
              monthMetrics.total.advancedItems,
              prevMonthMetrics.total.advancedItems
            )
          },
          closures: {
            current: currentMonthClosures,
            previous: previousMonthClosures,
            deltaPct: calcDeltaPct(currentMonthClosures, previousMonthClosures)
          }
        },
        leaderboard: {
          byResult: [...leaderboardRows].sort((a, b) => b.resultValue - a.resultValue),
          byProduction: [...leaderboardRows].sort(
            (a, b) => b.productionValue - a.productionValue
          ),
          weights: LEADERBOARD_WEIGHTS
        }
      };

      if (isDev) {
        console.info("[OrganizerAnalytics] metrics:fetch:done", {
          orgId: organizationId,
          selectedMemberId,
          rangeStartIso: range.start.toISOString(),
          rangeEndIso: range.end.toISOString(),
          totalClientsInOrg: nextData.totalClientsInOrg,
          totalTimelineEventsInOrg: nextData.totalTimelineEventsInOrg,
          hasAnyCrmData: nextData.hasAnyCrmData,
          hasPeriodData: nextData.hasPeriodData,
          activeMembersInPeriod: nextData.activeMembersInPeriod,
          movedItemsInPeriod: nextData.movedItemsInPeriod
        });
        if (nextMetricsError) {
          console.error("[OrganizerAnalytics] summaryCards:fetch:error", {
            organizationId,
            selectedPeriod: filters.period,
            startISO: rangeSnapshot.startISO,
            endISO: rangeSnapshot.endISO,
            selectedMemberId,
            activeMembersCount: nextData.activeMembersInPeriod,
            movedItemsCount: nextData.movedItemsInPeriod,
            supabaseError: toSupabaseErrorMeta(summarySupabaseError),
            message: nextMetricsError
          });
        } else {
          console.info("[OrganizerAnalytics] summaryCards:fetch:success", {
            organizationId,
            selectedPeriod: filters.period,
            startISO: rangeSnapshot.startISO,
            endISO: rangeSnapshot.endISO,
            selectedMemberId,
            activeMembersCount: nextData.activeMembersInPeriod,
            movedItemsCount: nextData.movedItemsInPeriod
          });
        }
      }

      if (!active) return;
      setMetricsError(nextMetricsError);
      setData(nextData);
      setSummaryCards({
        activeMembersCount: nextData.activeMembersInPeriod,
        movedItemsCount: nextData.movedItemsInPeriod,
        loading: false,
        error: nextMetricsError ? toSummaryErrorMessage(nextMetricsError) : null,
        isEmpty: !nextMetricsError && !nextData.hasPeriodData
      });
      setLoading(false);
    };

    void fetchAndCompute().catch((error: unknown) => {
      const fallbackRange = toAppliedRange(resolveDateRange(filters));
      const message =
        error instanceof Error
          ? error.message
          : "Erro desconhecido durante o cálculo dos indicadores.";

      if (process.env.NODE_ENV !== "production") {
        console.error("[OrganizerAnalytics] summaryCards:fetch:error", {
          organizationId,
          selectedPeriod: filters.period,
          startISO: fallbackRange.startISO,
          endISO: fallbackRange.endISO,
          selectedMemberId: filters.memberId,
          activeMembersCount: 0,
          movedItemsCount: 0,
          supabaseError: toSupabaseErrorMeta(null),
          message
        });
      }

      if (!active) return;
      setAppliedRange(fallbackRange);
      setData({
        ...emptyData,
        rangeLabel: fallbackRange.label
      });
      setMetricsError(`Erro ao calcular métricas: ${message}`);
      setSummaryCards({
        activeMembersCount: 0,
        movedItemsCount: 0,
        loading: false,
        error: toSummaryErrorMessage(message),
        isEmpty: false
      });
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [activeRole, filters, organizationId, refreshTick, supabase]);

  const error = metricsError ?? membersError;

  return {
    filters,
    setFilters,
    refresh,
    loading,
    membersError,
    metricsError,
    error,
    data,
    members,
    appliedRange,
    summaryCards
  };
}
