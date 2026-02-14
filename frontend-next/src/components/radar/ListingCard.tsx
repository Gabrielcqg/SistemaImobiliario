"use client";

import {
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform
} from "framer-motion";
import { useMemo } from "react";
import type { MouseEvent } from "react";
import type { Listing } from "@/hooks/useListings";

const formatCurrency = (value: number | null) => {
  if (typeof value !== "number") return "Preço não informado";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0
  }).format(value);
};

const formatDate = (value: string | null) => {
  if (!value) return "Data não informada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data inválida";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short"
  }).format(date);
};

type ListingCardProps = {
  listing: Listing;
};

export default function ListingCard({ listing }: ListingCardProps) {
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

  const portalLabel = listing.portal ? listing.portal.toUpperCase() : "PORTAL";
  const isNew24h = useMemo(() => {
    if (!listing.first_seen_at) return false;
    const ts = new Date(listing.first_seen_at).getTime();
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts <= 24 * 60 * 60 * 1000;
  }, [listing.first_seen_at]);

  const fullTitle = (listing.title ?? "Imóvel sem título").trim();
  const displayTitle = useMemo(() => {
    const words = fullTitle.split(/\s+/).filter(Boolean);
    if (words.length <= 8) return fullTitle;
    return `${words.slice(0, 8).join(" ")}…`;
  }, [fullTitle]);

  const location = useMemo(() => {
    const neighborhood =
      listing.neighborhood_normalized ?? listing.neighborhood ?? "";
    const city = listing.city ?? listing.state ?? "";
    if (city && neighborhood) return `${city} · ${neighborhood}`;
    return city || neighborhood || "Localização não informada";
  }, [
    listing.city,
    listing.state,
    listing.neighborhood,
    listing.neighborhood_normalized
  ]);

  const details = useMemo(() => {
    const items: string[] = [];
    if (typeof listing.bedrooms === "number") {
      items.push(`${listing.bedrooms} quartos`);
    }
    if (typeof listing.bathrooms === "number") {
      items.push(`${listing.bathrooms} banh`);
    }
    if (typeof listing.parking === "number") {
      items.push(`${listing.parking} vaga${listing.parking > 1 ? "s" : ""}`);
    }
    if (typeof listing.area_m2 === "number") {
      items.push(`${Math.round(listing.area_m2)} m²`);
    }
    return items;
  }, [listing.area_m2, listing.bathrooms, listing.bedrooms, listing.parking]);

  return (
    <motion.div
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={
        shouldReduceMotion
          ? undefined
          : { rotateX, rotateY, transformStyle: "preserve-3d" }
      }
      className="relative rounded-2xl border border-zinc-800 bg-white/5 p-5 shadow-glow backdrop-blur-md transition-colors duration-150 focus-within:border-white/40"
      whileHover={shouldReduceMotion ? undefined : { scale: 1.01 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
    >
      {isNew24h ? (
        <span className="pointer-events-none absolute right-3 top-1 z-10 rounded-full border border-white/30 bg-white/10 px-2 py-1 text-[9px] uppercase tracking-[0.4em] text-white">
          Novo
        </span>
      ) : null}
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-zinc-700 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-zinc-300">
            {portalLabel}
          </span>
        </div>
        <span>{formatDate(listing.first_seen_at)}</span>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-zinc-800 bg-black/60">
        {listing.main_image_url ? (
          <img
            src={listing.main_image_url}
            alt={listing.title ?? "Listing"}
            className="h-40 w-full object-cover"
          />
        ) : (
          <div className="flex h-40 items-center justify-center text-xs uppercase tracking-[0.35em] text-zinc-600">
            Sem imagem
          </div>
        )}
      </div>

      <div className="mt-4">
        <p className="text-base font-semibold" title={fullTitle}>
          {displayTitle}
        </p>
        <p className="mt-2 text-xl font-semibold">
          {formatCurrency(listing.price)}
        </p>
        <p className="mt-2 text-sm text-zinc-400">{location}</p>
      </div>

      {details.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-400">
          {details.map((item) => (
            <span
              key={item}
              className="rounded-full border border-zinc-800 bg-black/60 px-3 py-1"
            >
              {item}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-zinc-500">Detalhes não informados.</p>
      )}

      <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
        {listing.url ? (
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
    </motion.div>
  );
}
