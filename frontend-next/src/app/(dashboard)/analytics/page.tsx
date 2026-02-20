"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Funnel,
  Gauge,
  Target,
  Users
} from "lucide-react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { useOrganizationContext } from "@/lib/auth/useOrganizationContext";
import { useOrganizerAnalytics } from "@/hooks/useOrganizerAnalytics";

const PERIOD_OPTIONS = [
  { label: "Hoje", value: "today" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
  { label: "Mês atual", value: "month" },
  { label: "Intervalo", value: "custom" }
] as const;

const SORT_OPTIONS = [
  { label: "Fechados", value: "closedWon" },
  { label: "Conversão", value: "conversionRate" },
  { label: "Atrasos", value: "overdueTasks" },
  { label: "Resposta", value: "avgResponseHours" },
  { label: "Contatos", value: "contacts" }
] as const;

const formatNumber = (value: number) =>
  new Intl.NumberFormat("pt-BR").format(value);

const formatPct = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)}%`;
};

const formatHours = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return "—";
  if (value < 1) return `${Math.round(value * 60)} min`;
  return `${value.toFixed(1)} h`;
};

const formatDelta = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return "—";
  const abs = Math.abs(value).toFixed(1);
  const sign = value > 0 ? "+" : "";
  return `${sign}${abs}%`;
};

const getDeltaTone = (value: number | null) => {
  if (value === null) return "text-zinc-400";
  if (value > 0) return "accent-text";
  if (value < 0) return "text-red-300";
  return "text-zinc-300";
};

const getStatusTone = (value: "verde" | "amarelo" | "vermelho") => {
  if (value === "verde") return "accent-badge";
  if (value === "amarelo") return "accent-badge text-amber-100";
  return "accent-badge text-red-200";
};

const formatPeriodDate = (isoDate: string) => {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return "--/--";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit"
  }).format(parsed);
};

const formatInlineError = (message: string) => {
  if (message.length <= 72) return message;
  return `${message.slice(0, 69)}...`;
};

type SummaryMiniCardProps = {
  title: string;
  value: number;
  loading: boolean;
  error: string | null;
  isEmpty: boolean;
};

function SummaryMiniCard({
  title,
  value,
  loading,
  error,
  isEmpty
}: SummaryMiniCardProps) {
  return (
    <div className="min-h-[96px] rounded-xl accent-surface px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">{title}</p>
      {loading ? (
        <div className="mt-2 space-y-2">
          <div className="h-7 w-20 animate-pulse rounded-md bg-zinc-700/50" />
          <p className="text-xs text-zinc-500">Carregando...</p>
        </div>
      ) : null}
      {!loading && error ? (
        <div className="mt-2 space-y-1">
          <p className="text-sm font-semibold text-red-300">Erro ao carregar</p>
          <p className="text-xs text-red-200/80">{formatInlineError(error)}</p>
        </div>
      ) : null}
      {!loading && !error && isEmpty ? (
        <p className="mt-3 text-sm text-zinc-400">Sem dados no período</p>
      ) : null}
      {!loading && !error && !isEmpty ? (
        <p className="mt-2 text-3xl font-semibold leading-none text-white">{formatNumber(value)}</p>
      ) : null}
    </div>
  );
}

export default function AnalyticsPage() {
  const {
    context: organizationContext,
    organizationId,
    loading: organizationLoading,
    needsOrganizationChoice
  } = useOrganizationContext();

  const canAccessAnalytics = useMemo(() => {
    if (!organizationContext) return false;
    if (organizationContext.organization.kind === "individual") return true;
    return organizationContext.role === "owner" || organizationContext.role === "admin";
  }, [organizationContext]);

  const {
    filters,
    setFilters,
    refresh,
    loading,
    membersError,
    metricsError,
    data,
    members,
    appliedRange,
    summaryCards
  } = useOrganizerAnalytics(
    canAccessAnalytics ? organizationId : null,
    organizationContext?.role ?? null
  );
  const appliedPeriodLabel = `${appliedRange.label}: ${formatPeriodDate(
    appliedRange.startISO
  )} -> ${formatPeriodDate(appliedRange.endISO)}`;
  const hasNoDataForPeriod =
    !loading && !metricsError && data.hasAnyCrmData && !data.hasPeriodData;
  const hasNoCrmData =
    !loading && !metricsError && !data.hasAnyCrmData;

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    console.info("[OrganizerAnalyticsPage] filters:changed", {
      organizationId,
      selectedPeriod: filters.period,
      selectedMemberId: filters.memberId,
      startISO: appliedRange.startISO,
      endISO: appliedRange.endISO
    });
  }, [
    filters.memberId,
    filters.period,
    appliedRange.startISO,
    appliedRange.endISO,
    organizationId
  ]);

  if (
    !organizationLoading &&
    !organizationContext &&
    !needsOrganizationChoice
  ) {
    return (
      <Card className="panel border-red-500/40 bg-red-500/10 text-sm text-red-100">
        Não foi possível identificar uma organização ativa para carregar o painel.
      </Card>
    );
  }

  if (!organizationLoading && !canAccessAnalytics) {
    return (
      <section className="mx-auto w-full max-w-3xl space-y-4 rounded-2xl border border-red-500/35 bg-red-500/10 p-6">
        <h2 className="text-xl font-semibold text-white">403 | Sem acesso</h2>
        <p className="text-sm text-red-100">
          Este painel é exclusivo para owner/admin da organização ou conta individual.
        </p>
        <Link href="/crm" className="text-sm text-white underline underline-offset-4">
          Voltar para CRM
        </Link>
      </section>
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      <Card className="panel space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
              Painel do Organizador
            </p>
            <h2 className="mt-2 text-2xl section-title">Analytics de execução do time</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Foco em resultados por membro, gargalos do funil e alertas operacionais.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <span className="accent-badge rounded-full px-3 py-1">
              Período: {appliedPeriodLabel}
            </span>
            <Button variant="ghost" className="h-8 px-3 text-xs" onClick={refresh}>
              Atualizar
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
              Período
            </label>
            <div className="flex flex-wrap gap-2">
              {PERIOD_OPTIONS.map((option) => {
                const active = filters.period === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      if (process.env.NODE_ENV !== "production") {
                        console.info("[OrganizerAnalyticsPage] ui:period:click", {
                          organizationId,
                          nextPeriod: option.value
                        });
                      }
                      setFilters({
                        period: option.value
                      });
                    }}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition border border-transparent focus-visible:outline-none ${active
                      ? "is-active-fixed"
                      : "bg-surface text-zinc-400 hover:text-white hover:border-zinc-700 hover:bg-surface-lifted"
                      }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
              Membro
            </label>
            <select
              value={filters.memberId}
              onChange={(event) => {
                if (process.env.NODE_ENV !== "production") {
                  console.info("[OrganizerAnalyticsPage] ui:member:change", {
                    organizationId,
                    nextMemberId: event.target.value
                  });
                }
                setFilters({ memberId: event.target.value });
              }}
              className="w-full rounded-lg px-3 py-2 text-sm text-zinc-100 accent-focus accent-control"
            >
              <option value="all">Todos os membros</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <SummaryMiniCard
              title="Membros ativos no período"
              value={summaryCards.activeMembersCount}
              loading={summaryCards.loading}
              error={summaryCards.error}
              isEmpty={summaryCards.isEmpty}
            />
            <SummaryMiniCard
              title="Itens movimentados"
              value={summaryCards.movedItemsCount}
              loading={summaryCards.loading}
              error={summaryCards.error}
              isEmpty={summaryCards.isEmpty}
            />
            <SummaryMiniCard
              title="Ganhos (organização)"
              value={data.organizationClosureCounts.won}
              loading={loading}
              error={metricsError}
              isEmpty={!data.hasAnyCrmData}
            />
            <SummaryMiniCard
              title="Perdas (organização)"
              value={data.organizationClosureCounts.lost}
              loading={loading}
              error={metricsError}
              isEmpty={!data.hasAnyCrmData}
            />
          </div>
        </div>

        {filters.period === "custom" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              type="date"
              value={filters.customStart}
              onChange={(event) => setFilters({ customStart: event.target.value })}
            />
            <Input
              type="date"
              value={filters.customEnd}
              onChange={(event) => setFilters({ customEnd: event.target.value })}
            />
          </div>
        ) : null}
      </Card>

      {membersError ? (
        <Card className="panel border-amber-500/40 bg-amber-500/10 text-sm text-amber-100">
          {membersError}
        </Card>
      ) : null}

      {metricsError ? (
        <Card className="panel border-red-500/40 bg-red-500/10 text-sm text-red-100">
          {metricsError}
        </Card>
      ) : null}

      {hasNoCrmData ? (
        <Card className="panel accent-surface text-sm text-zinc-200">
          Esta organização ainda não tem atividade de CRM suficiente para o painel. Assim que
          clientes/etapas forem registrados, os indicadores aparecerão aqui.
        </Card>
      ) : null}

      {hasNoDataForPeriod ? (
        <Card className="panel accent-surface text-sm text-zinc-200">
          Sem dados para o período selecionado. Tente ampliar para <strong>30d</strong> ou{" "}
          <strong>Mês atual</strong>.
        </Card>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center gap-2 text-zinc-200">
          <Gauge className="h-4 w-4" />
          <h3 className="text-lg font-semibold">Resultado da Equipe</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {loading
            ? Array.from({ length: 7 }).map((_, index) => (
              <div
                key={`loading-kpi-${index}`}
                className="h-40 animate-pulse rounded-2xl border border-zinc-800 bg-white/5"
              />
            ))
            : data.kpis.map((kpi) => (
              <Card key={kpi.key} className="space-y-2 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{kpi.label}</p>
                <p className="text-2xl font-semibold text-white">{formatNumber(kpi.value)}</p>
                <div className="flex items-center gap-2 text-xs">
                  <span className={getDeltaTone(kpi.changePct)}>
                    {kpi.changePct !== null && kpi.changePct >= 0 ? (
                      <ArrowUpRight className="mr-1 inline h-3 w-3" />
                    ) : (
                      <ArrowDownRight className="mr-1 inline h-3 w-3" />
                    )}
                    {formatDelta(kpi.changePct)} vs anterior
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const topMember = members.find(
                      (member) => member.label === kpi.topMemberLabel
                    );
                    if (topMember) setFilters({ memberId: topMember.id });
                  }}
                  className="text-xs text-zinc-400 underline underline-offset-4 hover:text-white"
                >
                  Top membro: {kpi.topMemberLabel} ({formatNumber(kpi.topMemberValue)})
                </button>
              </Card>
            ))}
        </div>
      </section>

      <section className="grid gap-6 2xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card className="panel min-w-0 space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-zinc-200">
              <Users className="h-4 w-4" />
              <h3 className="text-lg font-semibold">Painel por Membro</h3>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <select
                value={filters.sortBy}
                onChange={(event) =>
                  setFilters({
                    sortBy: event.target.value as
                      | "closedWon"
                      | "conversionRate"
                      | "overdueTasks"
                      | "avgResponseHours"
                      | "contacts"
                  })
                }
                className="rounded-lg px-2 py-1.5 text-zinc-200 accent-focus accent-control"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    Ordenar por {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() =>
                  setFilters({
                    sortDirection: filters.sortDirection === "asc" ? "desc" : "asc"
                  })
                }
                className="rounded-lg px-2 py-1.5 text-zinc-300 transition hover:text-white accent-outline accent-sheen accent-focus focus-visible:outline-none"
              >
                {filters.sortDirection === "asc" ? "↑ Asc" : "↓ Desc"}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-xs">
              <thead className="text-zinc-500">
                <tr>
                  <th className="pb-2 pr-2">Membro</th>
                  <th className="pb-2 pr-2">Novos</th>
                  <th className="pb-2 pr-2">Contatos</th>
                  <th className="pb-2 pr-2">Visitas</th>
                  <th className="pb-2 pr-2">Propostas</th>
                  <th className="pb-2 pr-2">Fechados</th>
                  <th className="pb-2 pr-2">Conversão</th>
                  <th className="pb-2 pr-2">Resp. média</th>
                  <th className="pb-2 pr-2">Atrasadas</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody className="text-zinc-200">
                {(loading ? [] : data.memberRows).map((row) => (
                  <tr
                    key={row.memberId}
                    className="border-t border-zinc-800/80 transition hover:bg-white/5"
                  >
                    <td className="py-2 pr-2">
                      <button
                        type="button"
                        onClick={() => setFilters({ memberId: row.memberId })}
                        className="accent-outline accent-sheen accent-focus rounded-lg px-2 py-1 text-left text-zinc-100 focus-visible:outline-none"
                      >
                        <span className="block font-medium text-white underline underline-offset-4">
                          {row.memberLabel}
                        </span>
                        <span className="block text-[11px] text-zinc-500">
                          {row.memberEmail ?? "E-mail não disponível"}
                        </span>
                      </button>
                    </td>
                    <td className="py-2 pr-2">{formatNumber(row.newItems)}</td>
                    <td className="py-2 pr-2">{formatNumber(row.contacts)}</td>
                    <td className="py-2 pr-2">{formatNumber(row.visits)}</td>
                    <td className="py-2 pr-2">{formatNumber(row.proposals)}</td>
                    <td className="py-2 pr-2">{formatNumber(row.closedWon)}</td>
                    <td className="py-2 pr-2">{formatPct(row.conversionRate)}</td>
                    <td className="py-2 pr-2">{formatHours(row.avgResponseHours)}</td>
                    <td className="py-2 pr-2">{formatNumber(row.overdueTasks)}</td>
                    <td className="py-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${getStatusTone(
                          row.status
                        )}`}
                      >
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {!loading && data.memberRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-6 text-center text-sm text-zinc-500">
                      Sem atividade de membros para o recorte atual.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="panel min-w-0 space-y-4 p-4">
          <div className="flex items-center gap-2 text-zinc-200">
            <Funnel className="h-4 w-4" />
            <h3 className="text-lg font-semibold">Funil CRM</h3>
          </div>
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-1">
            {data.funnel.steps.map((step) => {
              const maxCount = Math.max(1, ...data.funnel.steps.map((item) => item.count));
              const widthPct = (step.count / maxCount) * 100;
              return (
                <div key={step.status} className="space-y-1 rounded-lg accent-surface p-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-300">{step.label}</span>
                    <span className="text-zinc-400">
                      {formatNumber(step.count)}{" "}
                      {step.conversionFromPrev !== null
                        ? `• conv ${formatPct(step.conversionFromPrev)}`
                        : ""}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-white transition-all"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    Aging médio:{" "}
                    {step.avgAgingDays !== null ? `${step.avgAgingDays.toFixed(1)} dias` : "—"}
                  </p>
                </div>
              );
            })}
          </div>
          <div className="rounded-xl accent-surface px-3 py-2 text-xs text-zinc-400">
            Gargalo atual: {data.funnel.bottleneckLabel ?? "Sem gargalo crítico no recorte."}
          </div>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card className="panel space-y-4 p-4">
          <h3 className="text-lg font-semibold text-white">Tempo de Resposta</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl accent-surface p-3">
              <p className="text-xs text-zinc-500">Média geral 1º contato</p>
              <p className="mt-2 text-xl font-semibold">{formatHours(data.response.avgHours)}</p>
            </div>
            <div className="rounded-xl accent-surface p-3">
              <p className="text-xs text-zinc-500">% dentro da meta</p>
              <p className="mt-2 text-xl font-semibold">{formatPct(data.response.withinGoalPct)}</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Top 3 rápidos</p>
              <ul className="mt-2 space-y-2 text-sm text-zinc-200">
                {data.response.fastest.map((item) => (
                  <li key={`fast-${item.memberId}`} className="flex justify-between">
                    <span>{item.memberLabel}</span>
                    <span className="accent-text">{formatHours(item.avgHours)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Top 3 lentos</p>
              <ul className="mt-2 space-y-2 text-sm text-zinc-200">
                {data.response.slowest.map((item) => (
                  <li key={`slow-${item.memberId}`} className="flex justify-between">
                    <span>{item.memberLabel}</span>
                    <span className="text-red-300">{formatHours(item.avgHours)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
            <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
              Meta de resposta (horas)
            </label>
            <Input
              type="number"
              min={1}
              max={168}
              value={String(filters.responseGoalHours)}
              onChange={(event) =>
                setFilters({
                  responseGoalHours: Math.max(1, Number(event.target.value || 24))
                })
              }
              className="sm:w-24"
            />
          </div>
        </Card>

        <Card className="panel space-y-4 p-4">
          <h3 className="text-lg font-semibold text-white">Atividades & Tarefas</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl accent-surface p-3">
              <p className="text-xs text-zinc-500">Atrasadas</p>
              <p className="mt-1 text-xl font-semibold">{formatNumber(data.tasks.overdue)}</p>
            </div>
            <div className="rounded-xl accent-surface p-3">
              <p className="text-xs text-zinc-500">Hoje</p>
              <p className="mt-1 text-xl font-semibold">{formatNumber(data.tasks.dueToday)}</p>
            </div>
            <div className="rounded-xl accent-surface p-3">
              <p className="text-xs text-zinc-500">Próx. 7 dias</p>
              <p className="mt-1 text-xl font-semibold">{formatNumber(data.tasks.next7Days)}</p>
            </div>
          </div>
          <div className="rounded-xl accent-surface p-3 text-sm text-zinc-300">
            Criadas vs concluídas no período: {formatNumber(data.tasks.created)} /{" "}
            {formatNumber(data.tasks.completed)}{" "}
            <span
              className={
                data.tasks.backlogDelta > 0
                  ? "text-red-300"
                  : data.tasks.backlogDelta < 0
                    ? "accent-text"
                    : "text-zinc-300"
              }
            >
              ({data.tasks.backlogDelta > 0 ? "+" : ""}
              {formatNumber(data.tasks.backlogDelta)} no backlog)
            </span>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Distribuição de atrasos</p>
            <ul className="mt-2 space-y-1 text-sm">
              {data.tasks.byMemberOverdue.map((item) => (
                <li key={item.memberId} className="flex justify-between text-zinc-300">
                  <span>{item.memberLabel}</span>
                  <span>{formatNumber(item.count)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card className="panel space-y-4 p-4">
          <h3 className="text-lg font-semibold text-white">Alertas operacionais</h3>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-red-300">Risco alto</p>
            <div className="mt-2 grid gap-2">
              {data.alerts.riskHigh.map((alert) => (
                <Link
                  key={alert.key}
                  href={alert.href}
                  className="flex items-center justify-between rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-100 hover:border-red-400/40"
                >
                  <span>{alert.label}</span>
                  <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs">
                    {formatNumber(alert.value)}
                  </span>
                </Link>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Operacional</p>
            <div className="mt-2 grid gap-2">
              {data.alerts.operational.map((alert) => (
                <Link
                  key={alert.key}
                  href={alert.href}
                  className="flex items-center justify-between rounded-lg accent-surface px-3 py-2 text-sm text-zinc-200"
                >
                  <span>{alert.label}</span>
                  <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs">
                    {formatNumber(alert.value)}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </Card>

        <Card className="panel space-y-4 p-4">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-zinc-300" />
            <h3 className="text-lg font-semibold text-white">Metas mensais</h3>
          </div>
          <p className="text-xs text-zinc-500">
            Fonte atual: placeholders locais. Plugar metas reais via backend em{" "}
            <code className="text-zinc-300">GOAL_PLACEHOLDER_TARGETS</code> no hook{" "}
            <code className="text-zinc-300">useOrganizerAnalytics</code>.
          </p>
          <div className="space-y-2">
            {data.goals.metrics.map((metric) => (
              <div key={metric.key} className="rounded-lg accent-surface p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-200">{metric.label}</span>
                  <span className="text-zinc-400">
                    {formatNumber(metric.achieved)} / {formatNumber(metric.target)}
                  </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-zinc-800">
                  <div
                    className={`h-full rounded-full ${metric.status === "atingida"
                      ? "bg-gradient-to-r from-amber-400 via-indigo-400 to-sky-400"
                      : metric.status === "em_risco"
                        ? "bg-amber-400"
                        : "bg-red-400"
                      }`}
                    style={{ width: `${Math.min(metric.progressPct, 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-zinc-500">
                  {metric.status === "atingida"
                    ? "Atingida"
                    : metric.status === "em_risco"
                      ? "Em risco"
                      : "Fora da meta"}
                </p>
              </div>
            ))}
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Progresso por membro</p>
            <ul className="mt-2 space-y-2">
              {data.goals.byMember.map((item) => (
                <li key={item.memberId} className="space-y-1">
                  <div className="flex justify-between text-xs text-zinc-300">
                    <span>{item.memberLabel}</span>
                    <span>{formatPct(item.progressPct)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-white"
                      style={{ width: `${Math.min(item.progressPct, 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card className="panel space-y-4 p-4">
          <h3 className="text-lg font-semibold text-white">Comparativo mensal</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: "Entradas", metric: data.monthlyComparison.entries },
              { label: "Movimentações", metric: data.monthlyComparison.movements },
              { label: "Fechamentos", metric: data.monthlyComparison.closures }
            ].map((item) => (
              <div key={item.label} className="rounded-xl accent-surface p-3">
                <p className="text-xs text-zinc-500">{item.label}</p>
                <p className="mt-1 text-xl font-semibold text-white">
                  {formatNumber(item.metric.current)}
                </p>
                <p className={`mt-1 text-xs ${getDeltaTone(item.metric.deltaPct)}`}>
                  {formatDelta(item.metric.deltaPct)} vs mês anterior
                </p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="panel space-y-4 p-4">
          <h3 className="text-lg font-semibold text-white">Leaderboard</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Resultado (Fechados)</p>
              <ol className="mt-2 space-y-2 text-sm">
                {data.leaderboard.byResult.slice(0, 5).map((row, index) => (
                  <li key={`result-${row.memberId}`} className="flex justify-between text-zinc-200">
                    <span>
                      {index + 1}. {row.memberLabel}
                    </span>
                    <span>{formatNumber(row.resultValue)}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                Produção (Contatos+Visitas+Propostas)
              </p>
              <ol className="mt-2 space-y-2 text-sm">
                {data.leaderboard.byProduction.slice(0, 5).map((row, index) => (
                  <li key={`production-${row.memberId}`} className="flex justify-between text-zinc-200">
                    <span>
                      {index + 1}. {row.memberLabel}
                    </span>
                    <span>{formatNumber(row.productionValue)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <p className="text-xs text-zinc-500">
            Pesos padrão para score: fechados {data.leaderboard.weights.closedWon}, contatos{" "}
            {data.leaderboard.weights.contacts}, visitas {data.leaderboard.weights.visits},
            propostas {data.leaderboard.weights.proposals}.
          </p>
        </Card>
      </section>

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={`analytics-loading-${index}`}
              className="h-36 animate-pulse rounded-2xl border border-zinc-800 bg-white/5"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
