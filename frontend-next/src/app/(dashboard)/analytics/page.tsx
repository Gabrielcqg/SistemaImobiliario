"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { motion, useMotionValue, useTransform } from "framer-motion";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import SkeletonCard from "@/components/ui/SkeletonCard";
import { useAnalytics } from "@/hooks/useAnalytics";
import type { PortalChartDatum } from "@/components/analytics/PortalDistributionChart";

const PortalDistributionChart = dynamic(
  () => import("@/components/analytics/PortalDistributionChart"),
  {
    ssr: false,
    loading: () => <SkeletonCard className="h-full" />
  }
);

const dayOptions = [
  { label: "7 dias", value: 7 },
  { label: "15 dias", value: 15 },
  { label: "30 dias", value: 30 }
] as const;

const formatCurrency = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0
  }).format(value);
};

const formatNumber = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("pt-BR").format(Math.round(value));
};

function useTweenedNumber(value: number | null) {
  const [display, setDisplay] = useState(value ?? 0);
  const displayRef = useRef(display);

  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    if (value === null) {
      setDisplay(0);
      return;
    }

    let raf: number;
    const start = displayRef.current;
    const diff = value - start;
    const duration = 300;
    const startTime = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startTime) / duration);
      setDisplay(start + diff * progress);
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return display;
}

function InsightCard({
  label,
  value,
  helper
}: {
  label: string;
  value: string;
  helper?: string;
}) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useTransform(y, [-40, 40], [6, -6]);
  const rotateY = useTransform(x, [-40, 40], [-6, 6]);

  return (
    <motion.div
      onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        x.set(event.clientX - rect.left - rect.width / 2);
        y.set(event.clientY - rect.top - rect.height / 2);
      }}
      onMouseLeave={() => {
        x.set(0);
        y.set(0);
      }}
      style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
      className="rounded-2xl border border-zinc-800 bg-white/5 p-5 shadow-glow backdrop-blur-md"
      whileHover={{ scale: 1.02 }}
    >
      <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
        {label}
      </p>
      <p className="mt-3 text-2xl font-semibold">{value}</p>
      {helper ? (
        <p className="mt-2 text-xs text-zinc-400">{helper}</p>
      ) : null}
    </motion.div>
  );
}

export default function AnalyticsPage() {
  const { filters, setFilters, metrics, loading, error } = useAnalytics({
    maxDaysFresh: 15
  });

  const portalStats = metrics.portalStats;
  const portalOptions = useMemo(
    () => portalStats.map((stat) => stat.portal),
    [portalStats]
  );

  const [portalA, setPortalA] = useState<string>("");
  const [portalB, setPortalB] = useState<string>("");
  const [mix, setMix] = useState(50);

  useEffect(() => {
    if (!portalOptions.length) return;
    setPortalA((prev) => prev || portalOptions[0]);
    setPortalB((prev) => prev || portalOptions[Math.min(1, portalOptions.length - 1)]);
  }, [portalOptions]);

  const statA = portalStats.find((stat) => stat.portal === portalA);
  const statB = portalStats.find((stat) => stat.portal === portalB);

  const blendedPrice =
    statA && statB && statA.avgPrice !== null && statB.avgPrice !== null
      ? statA.avgPrice * (1 - mix / 100) + statB.avgPrice * (mix / 100)
      : null;

  const blendedPricePerM2 =
    statA &&
    statB &&
    statA.avgPricePerM2 !== null &&
    statB.avgPricePerM2 !== null
      ? statA.avgPricePerM2 * (1 - mix / 100) +
        statB.avgPricePerM2 * (mix / 100)
      : null;

  const animatedPrice = useTweenedNumber(blendedPrice);
  const animatedPricePerM2 = useTweenedNumber(blendedPricePerM2);

  const chartData = useMemo<PortalChartDatum[]>(
    () =>
      portalStats.map((stat) => ({
        portal: stat.portal.toUpperCase(),
        count: stat.count
      })),
    [portalStats]
  );

  const isEmpty = !loading && metrics.totalCount === 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Analytics</h2>
          <p className="text-sm text-zinc-400">
            Métricas do inventário capturado pelo radar.
          </p>
        </div>
        <div className="text-xs uppercase tracking-[0.35em] text-zinc-500">
          Últimos {filters.maxDaysFresh} dias
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <Card className="space-y-5">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
              Filtros
            </p>
            <h3 className="mt-2 text-lg font-semibold">Recorte analítico</h3>
          </div>

          <div className="space-y-3">
            <label className="text-xs text-zinc-500">Dias frescos</label>
            <select
              value={filters.maxDaysFresh}
              onChange={(event) =>
                setFilters({
                  maxDaysFresh: Number(event.target.value) as 7 | 15 | 30
                })
              }
              className="w-full rounded-lg border border-zinc-800 bg-black/60 px-4 py-2 text-sm text-white"
            >
              {dayOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-3">
            <label className="text-xs text-zinc-500">Bairro normalizado</label>
            <Input
              placeholder="ex: pinheiros"
              value={filters.neighborhood_normalized ?? ""}
              onChange={(event) =>
                setFilters({ neighborhood_normalized: event.target.value || "" })
              }
            />
          </div>

          <div className="space-y-3">
            <label className="text-xs text-zinc-500">Portal</label>
            <select
              value={filters.portal ?? ""}
              onChange={(event) =>
                setFilters({ portal: event.target.value || "" })
              }
              className="w-full rounded-lg border border-zinc-800 bg-black/60 px-4 py-2 text-sm text-white"
            >
              <option value="">Todos</option>
              {portalOptions.map((portal) => (
                <option key={portal} value={portal}>
                  {portal}
                </option>
              ))}
            </select>
          </div>

          <Button
            variant="secondary"
            onClick={() =>
              setFilters({
                maxDaysFresh: 15,
                neighborhood_normalized: "",
                portal: ""
              })
            }
          >
            Limpar filtros
          </Button>
        </Card>

        <div className="space-y-6">
          {error ? (
            <Card className="border-red-500/40 bg-red-500/10 text-red-200">
              {error}
            </Card>
          ) : null}

          {isEmpty ? (
            <Card className="text-center">
              <p className="text-lg font-semibold">Sem dados</p>
              <p className="mt-2 text-sm text-zinc-400">
                Nenhum listing encontrado para esse recorte.
              </p>
            </Card>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                {loading ? (
                  Array.from({ length: 3 }).map((_, index) => (
                    <div
                      key={`skeleton-${index}`}
                      className="h-32 rounded-2xl border border-zinc-800 bg-white/5 animate-pulse"
                    />
                  ))
                ) : (
                  <>
                    <InsightCard
                      label="Listings"
                      value={formatNumber(metrics.totalCount)}
                      helper="Capturados no período"
                    />
                    <InsightCard
                      label="Preço médio"
                      value={formatCurrency(metrics.avgPrice)}
                      helper="Considerando valores informados"
                    />
                    <InsightCard
                      label="Preço médio / m²"
                      value={
                        metrics.avgPricePerM2 !== null
                          ? formatCurrency(metrics.avgPricePerM2)
                          : "—"
                      }
                      helper="Calculado via área quando disponível"
                    />
                  </>
                )}
              </div>

              <Card>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                      Distribuição
                    </p>
                    <h3 className="mt-2 text-lg font-semibold">Por portal</h3>
                  </div>
                </div>
                <div className="mt-6 h-64">
                  <Suspense fallback={<SkeletonCard className="h-full" />}>
                    <PortalDistributionChart data={chartData} />
                  </Suspense>
                </div>
              </Card>

              <Card className="space-y-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                      Comparativo
                    </p>
                    <h3 className="mt-2 text-lg font-semibold">
                      Portal A vs Portal B
                    </h3>
                  </div>
                  <div className="text-xs text-zinc-500">
                    Deslize para comparar
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <select
                    value={portalA}
                    onChange={(event) => setPortalA(event.target.value)}
                    className="w-full rounded-lg border border-zinc-800 bg-black/60 px-4 py-2 text-sm text-white"
                  >
                    {portalOptions.map((portal) => (
                      <option key={portal} value={portal}>
                        {portal}
                      </option>
                    ))}
                  </select>
                  <select
                    value={portalB}
                    onChange={(event) => setPortalB(event.target.value)}
                    className="w-full rounded-lg border border-zinc-800 bg-black/60 px-4 py-2 text-sm text-white"
                  >
                    {portalOptions.map((portal) => (
                      <option key={portal} value={portal}>
                        {portal}
                      </option>
                    ))}
                  </select>
                </div>

                <input
                  type="range"
                  min={0}
                  max={100}
                  value={mix}
                  onChange={(event) => setMix(Number(event.target.value))}
                  className="w-full accent-white"
                />

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-zinc-800 bg-black/50 p-4">
                    <p className="text-xs text-zinc-500">Preço médio combinado</p>
                    <motion.p
                      key={mix}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-2 text-xl font-semibold"
                    >
                      {blendedPrice === null
                        ? "—"
                        : formatCurrency(animatedPrice)}
                    </motion.p>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-black/50 p-4">
                    <p className="text-xs text-zinc-500">Preço/m² combinado</p>
                    <motion.p
                      key={mix + 1}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-2 text-xl font-semibold"
                    >
                      {blendedPricePerM2 === null
                        ? "—"
                        : formatCurrency(animatedPricePerM2)}
                    </motion.p>
                  </div>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
