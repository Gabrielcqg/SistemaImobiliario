"use client";

import ListingCard from "@/components/radar/ListingCard";
import Card from "@/components/ui/Card";
import SkeletonCard from "@/components/ui/SkeletonCard";
import type { Listing } from "@/hooks/useListings";

type RowCarouselProps = {
  title: string;
  subtitle: string;
  total: number;
  items: Listing[];
  index: number;
  visibleCount: number;
  loading: boolean;
  error: string | null;
  emptyMessage: string;
  placeholderMessage?: string;
  onPrevious: () => void;
  onNext: () => void;
};

const shortError = (value: string) => {
  if (value.length <= 92) return value;
  return `${value.slice(0, 89)}...`;
};

const CARD_WIDTH_CLASS = "w-[280px] shrink-0 xl:w-[300px]";

export default function RowCarousel({
  title,
  subtitle,
  total,
  items,
  index,
  visibleCount,
  loading,
  error,
  emptyMessage,
  placeholderMessage,
  onPrevious,
  onNext
}: RowCarouselProps) {
  const maxIndex = Math.max(total - visibleCount, 0);
  const canGoPrevious = index > 0;
  const canGoNext = index < maxIndex;
  const start = total > 0 ? index + 1 : 0;
  const end = total > 0 ? Math.min(index + visibleCount, total) : 0;
  const visibleItems = items.slice(index, index + visibleCount);

  return (
    <Card className="space-y-4 border-zinc-800/90 bg-zinc-950/75 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.25em] text-zinc-500">{subtitle}</p>
          <h3 className="mt-1 truncate text-base font-semibold text-white">{title}</h3>
          <p className="mt-1 text-xs text-zinc-400">{`Mostrando ${start}-${end} de ${total}`}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={`Anterior em ${title}`}
            disabled={loading || !canGoPrevious}
            onClick={onPrevious}
            className="accent-outline accent-sheen accent-focus rounded-lg px-2 py-1 text-xs text-zinc-300 transition hover:text-zinc-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          >
            ◀
          </button>
          <button
            type="button"
            aria-label={`Próximo em ${title}`}
            disabled={loading || !canGoNext}
            onClick={onNext}
            className="accent-outline accent-sheen accent-focus rounded-lg px-2 py-1 text-xs text-zinc-300 transition hover:text-zinc-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          >
            ▶
          </button>
        </div>
      </div>

      {loading ? (
        <div className="overflow-x-auto pb-1">
          <div className="flex min-w-max gap-3">
            {Array.from({ length: visibleCount }).map((_, skeletonIndex) => (
              <SkeletonCard
                key={`skeleton-${title}-${skeletonIndex}`}
                className={`${CARD_WIDTH_CLASS} h-[370px] border-zinc-800/80 bg-zinc-900/70`}
              />
            ))}
          </div>
        </div>
      ) : null}

      {!loading && error ? (
        <div className="rounded-xl border border-red-500/35 bg-red-950/40 p-3 text-sm text-red-200">
          <p className="font-medium">Erro ao carregar</p>
          <p className="mt-1 text-xs text-red-100/85">{shortError(error)}</p>
        </div>
      ) : null}

      {!loading && !error && placeholderMessage ? (
        <div className="rounded-xl border border-dashed border-zinc-700 bg-black/40 px-4 py-8 text-center text-sm text-zinc-400">
          {placeholderMessage}
        </div>
      ) : null}

      {!loading && !error && !placeholderMessage && total === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-700 bg-black/40 px-4 py-8 text-center text-sm text-zinc-400">
          {emptyMessage}
        </div>
      ) : null}

      {!loading && !error && !placeholderMessage && total > 0 ? (
        <div className="overflow-x-auto pb-1">
          <div className="flex min-w-max gap-3">
            {visibleItems.map((listing) => (
              <div key={`${title}-${listing.id}`} className={CARD_WIDTH_CLASS}>
                <ListingCard
                  listing={listing}
                  className="border-zinc-800/90 bg-zinc-950/85 shadow-[0_0_0_1px_rgba(39,39,42,0.45)]"
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
