"use client";

import {
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform
} from "framer-motion";
import Image from "next/image";
import { Fragment, useMemo } from "react";
import type { MouseEvent } from "react";
import type { Listing } from "@/hooks/useListings";
import { normalizeText } from "@/lib/format/text";
import { getUnifiedPropertyLabelForListing } from "@/lib/listings/unifiedPropertyFilter";

const formatCurrency = (value: number | null | undefined, fallback = "Preço não informado") => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0
  }).format(value);
};

const formatCompactDate = (value: string | null | undefined) => {
  if (!value) return "Sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data inválida";
  const parts = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short"
  }).formatToParts(date);
  const day = parts.find((part) => part.type === "day")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (day && month) {
    return `${day} ${month}`;
  }
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short"
  }).format(date);
};

type ListingCardProps = {
  listing: Listing;
  className?: string;
};

const isPositiveNumber = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export default function ListingCard({ listing, className = "" }: ListingCardProps) {
  const shouldReduceMotion = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useTransform(y, [-50, 50], [8, -8]);
  const rotateY = useTransform(x, [-50, 50], [-8, 8]);

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (shouldReduceMotion) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetX = event.clientX - rect.left - rect.width / 2;
    const offsetY = event.clientY - rect.top - rect.height / 2;
    x.set(offsetX);
    y.set(offsetY);
  };

  const handleMouseLeave = () => {
    if (shouldReduceMotion) return;
    x.set(0);
    y.set(0);
  };

  const portalLabel = useMemo(() => {
    const rawPortal = (listing.portal ?? "").trim().toLowerCase();
    if (!rawPortal) return "PORTAL";
    if (rawPortal === "quintoandar") return "5andar";
    return rawPortal.toUpperCase();
  }, [listing.portal]);

  const isRental = listing.deal_type === "aluguel";
  const isNew24h = useMemo(() => {
    if (!listing.first_seen_at) return false;
    const ts = new Date(listing.first_seen_at).getTime();
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts <= 24 * 60 * 60 * 1000;
  }, [listing.first_seen_at]);

  const fullTitle = (listing.title ?? "Imóvel sem título").trim();
  const displayTitle = useMemo(() => {
    const words = fullTitle.split(/\s+/).filter(Boolean);
    if (words.length <= 12) return fullTitle;
    return `${words.slice(0, 12).join(" ")}…`;
  }, [fullTitle]);

  const location = useMemo(() => {
    const neighborhood = (listing.neighborhood ?? listing.neighborhood_normalized ?? "").trim();
    const city = (listing.city ?? "").trim();
    const state = (listing.state ?? "").trim();
    const cityOrState = city || state;

    if (!neighborhood && !cityOrState) {
      return "Localização não informada";
    }
    if (!neighborhood) {
      return cityOrState;
    }
    if (!cityOrState) {
      return neighborhood;
    }

    const normalizedNeighborhood = normalizeText(neighborhood);
    const normalizedCity = normalizeText(cityOrState);

    if (
      normalizedNeighborhood === normalizedCity ||
      normalizedNeighborhood.includes(normalizedCity)
    ) {
      return neighborhood;
    }

    if (normalizedCity.includes(normalizedNeighborhood)) {
      return cityOrState;
    }

    return `${neighborhood}, ${cityOrState}`;
  }, [
    listing.city,
    listing.state,
    listing.neighborhood,
    listing.neighborhood_normalized
  ]);

  const effectiveDate = listing.published_at ?? listing.first_seen_at ?? null;
  const dateLabel = useMemo(() => formatCompactDate(effectiveDate), [effectiveDate]);
  const propertyTypeLabel = useMemo(
    () => getUnifiedPropertyLabelForListing(listing),
    [listing]
  );

  const mainPrice = useMemo(() => {
    if (isRental) {
      return isPositiveNumber(listing.total_cost) ? listing.total_cost : listing.price;
    }
    return listing.price;
  }, [isRental, listing.price, listing.total_cost]);

  const mainPriceText = useMemo(
    () => formatCurrency(mainPrice),
    [mainPrice]
  );

  const rentalCosts = useMemo(
    () =>
      isRental
        ? [
          isPositiveNumber(listing.condo_fee)
            ? { key: "condominio", label: "Condomínio", value: listing.condo_fee }
            : null,
          isPositiveNumber(listing.iptu)
            ? { key: "iptu", label: "IPTU", value: listing.iptu }
            : null
        ].filter(
          (
            item
          ): item is { key: string; label: "Condomínio" | "IPTU"; value: number } =>
            item !== null
        )
        : [],
    [isRental, listing.condo_fee, listing.iptu]
  );

  const details = useMemo(
    () =>
      [
        isPositiveNumber(listing.bedrooms)
          ? `${listing.bedrooms} quarto${listing.bedrooms === 1 ? "" : "s"}`
          : null,
        isPositiveNumber(listing.bathrooms)
          ? `${listing.bathrooms} banh.`
          : null,
        isPositiveNumber(listing.parking)
          ? `${listing.parking} vaga${listing.parking === 1 ? "" : "s"}`
          : null,
        isPositiveNumber(listing.area_m2)
          ? `${Math.round(listing.area_m2)}m²`
          : null
      ].filter(
        (item): item is string => item !== null
      ),
    [listing.area_m2, listing.bathrooms, listing.bedrooms, listing.parking]
  );

  return (
    <div className="relative w-full min-w-0">
      <motion.div
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={
          shouldReduceMotion
            ? undefined
            : { rotateX, rotateY, transformStyle: "preserve-3d" }
        }
        className={`relative flex h-[470px] min-h-0 flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-white/5 p-4 shadow-glow backdrop-blur-md transition-colors duration-150 focus-within:border-white/40 sm:h-[492px] sm:p-4 ${className}`.trim()}
        whileHover={shouldReduceMotion ? undefined : { scale: 1.01 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
      >
        {listing.url ? (
          <a
            href={listing.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Abrir anuncio: ${listing.title ?? "imovel"}`}
            className="group block cursor-pointer overflow-hidden rounded-xl border border-zinc-800 bg-black/60 transition hover:border-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            {listing.main_image_url ? (
              <div className="relative h-44 w-full sm:h-48">
                {isNew24h ? (
                  <>
                    <span className="sr-only">Imóvel novo nas últimas 24 horas</span>
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute left-2 top-2 z-10 inline-flex items-center rounded-full border border-emerald-400/25 bg-black/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-200 backdrop-blur"
                    >
                      NOVO
                    </span>
                  </>
                ) : null}
                <Image
                  src={listing.main_image_url}
                  alt={listing.title ?? "Listing"}
                  fill
                  sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                  className="object-cover transition duration-200 group-hover:scale-[1.01]"
                />
              </div>
            ) : (
              <div className="relative flex h-44 items-center justify-center text-xs uppercase tracking-[0.35em] text-zinc-600 sm:h-48">
                {isNew24h ? (
                  <>
                    <span className="sr-only">Imóvel novo nas últimas 24 horas</span>
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute left-2 top-2 z-10 inline-flex items-center rounded-full border border-emerald-400/25 bg-black/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-200 backdrop-blur"
                    >
                      NOVO
                    </span>
                  </>
                ) : null}
                Sem imagem
              </div>
            )}
          </a>
        ) : (
          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-black/60">
            {listing.main_image_url ? (
              <div className="relative h-44 w-full sm:h-48">
                {isNew24h ? (
                  <>
                    <span className="sr-only">Imóvel novo nas últimas 24 horas</span>
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute left-2 top-2 z-10 inline-flex items-center rounded-full border border-emerald-400/25 bg-black/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-200 backdrop-blur"
                    >
                      NOVO
                    </span>
                  </>
                ) : null}
                <Image
                  src={listing.main_image_url}
                  alt={listing.title ?? "Listing"}
                  fill
                  sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                  className="object-cover"
                />
              </div>
            ) : (
              <div className="relative flex h-44 items-center justify-center text-xs uppercase tracking-[0.35em] text-zinc-600 sm:h-48">
                {isNew24h ? (
                  <>
                    <span className="sr-only">Imóvel novo nas últimas 24 horas</span>
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute left-2 top-2 z-10 inline-flex items-center rounded-full border border-emerald-400/25 bg-black/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-200 backdrop-blur"
                    >
                      NOVO
                    </span>
                  </>
                ) : null}
                Sem imagem
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          <p
            className="min-h-[40px] text-sm font-semibold leading-snug text-zinc-100 sm:min-h-[42px] sm:text-[15px]"
            title={fullTitle}
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden"
            }}
          >
            {displayTitle}
          </p>
          <p className="mt-2.5 text-lg font-semibold leading-none text-zinc-100 sm:text-xl">
            {mainPriceText}
            {isRental ? (
              <span className="ml-1 text-xs font-medium uppercase tracking-[0.08em] text-zinc-400">
                /mês
              </span>
            ) : null}
          </p>
          {isRental && rentalCosts.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-zinc-400">
              {rentalCosts.map((item, index) => (
                <Fragment key={item.key}>
                  {index > 0 ? (
                    <span aria-hidden="true" className="text-zinc-600">
                      |
                    </span>
                  ) : null}
                  <span>
                    <span className="text-zinc-500">{item.label}</span>{" "}
                    <span className="text-zinc-300">{formatCurrency(item.value, "—")}</span>
                  </span>
                </Fragment>
              ))}
            </div>
          ) : null}
          {details.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[15px] leading-5 text-zinc-300">
              {details.map((item, index) => (
                <Fragment key={`${listing.id}-${item}`}>
                  {index > 0 ? (
                    <span aria-hidden="true" className="text-zinc-600">
                      |
                    </span>
                  ) : null}
                  <span>{item}</span>
                </Fragment>
              ))}
            </div>
          ) : null}
          <div className="mt-2.5 min-h-[20px]">
            <p className="truncate text-sm text-zinc-400" title={location}>
              {location}
            </p>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-zinc-800 bg-black/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-300">
              {propertyTypeLabel}
            </span>
          </div>

          <div className="mt-auto pt-3">
            <div className="border-t border-zinc-800 pt-2.5">
              <div className="flex min-w-0 items-center justify-between gap-3 text-xs text-zinc-500">
                <span className="truncate font-medium uppercase tracking-[0.12em] text-zinc-400">
                  {portalLabel}
                </span>
                <span className="shrink-0 whitespace-nowrap text-sm font-semibold">{dateLabel}</span>
              </div>
            </div>

            <div className="mt-2.5 flex items-center justify-between text-xs text-zinc-500">
              {listing.url ? (
                <a
                  href={listing.url}
                  target="_blank"
                  rel="noopener noreferrer"
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
    </div>
  );
}
