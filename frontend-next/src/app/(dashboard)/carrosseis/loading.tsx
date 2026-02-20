import Card from "@/components/ui/Card";
import SkeletonCard from "@/components/ui/SkeletonCard";

export default function CarrosseisLoading() {
  return (
    <div className="space-y-6">
      <Card className="space-y-3 border-zinc-800/90 bg-zinc-950/70">
        <div className="h-4 w-32 animate-pulse rounded bg-zinc-700/60" />
        <div className="h-7 w-64 animate-pulse rounded bg-zinc-700/50" />
      </Card>

      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, rowIndex) => (
          <Card
            key={`row-skeleton-${rowIndex}`}
            className="space-y-4 border-zinc-800/90 bg-zinc-950/75 p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-2">
                <div className="h-3 w-20 animate-pulse rounded bg-zinc-700/60" />
                <div className="h-5 w-40 animate-pulse rounded bg-zinc-700/60" />
              </div>
              <div className="flex gap-2">
                <div className="h-7 w-7 animate-pulse rounded border border-zinc-700 bg-zinc-900/70" />
                <div className="h-7 w-7 animate-pulse rounded border border-zinc-700 bg-zinc-900/70" />
              </div>
            </div>
            <div className="overflow-x-auto pb-1">
              <div className="flex min-w-max gap-3">
                {Array.from({ length: 4 }).map((__, cardIndex) => (
                  <SkeletonCard
                    key={`item-${rowIndex}-${cardIndex}`}
                    className="h-[370px] w-[280px] shrink-0 border-zinc-800/80 bg-zinc-900/70 xl:w-[300px]"
                  />
                ))}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
