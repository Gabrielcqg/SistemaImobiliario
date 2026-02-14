import PageSkeleton from "@/components/ui/PageSkeleton";
import SkeletonCard from "@/components/ui/SkeletonCard";
import SkeletonList from "@/components/ui/SkeletonList";

export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-black text-white">
      <div className="flex min-h-screen flex-col md:flex-row">
        <aside className="w-full border-b border-zinc-800 bg-black/80 px-6 py-6 md:h-screen md:w-64 md:border-b-0 md:border-r">
          <div className="space-y-8">
            <div className="space-y-2">
              <div className="h-3 w-20 rounded bg-white/10 animate-pulse" />
              <div className="h-6 w-36 rounded bg-white/10 animate-pulse" />
            </div>
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="h-9 rounded-lg bg-white/10 animate-pulse"
                />
              ))}
            </div>
          </div>
        </aside>

        <div className="flex flex-1 flex-col">
          <div className="border-b border-zinc-800 px-6 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-2">
                <div className="h-3 w-24 rounded bg-white/10 animate-pulse" />
                <div className="h-6 w-40 rounded bg-white/10 animate-pulse" />
              </div>
              <div className="h-9 w-28 rounded-lg bg-white/10 animate-pulse" />
            </div>
          </div>

          <main className="flex-1 px-6 py-8 lg:px-10">
            <PageSkeleton>
              <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
                <SkeletonCard className="h-[520px]" />
                <div className="space-y-6">
                  <SkeletonCard className="h-[300px]" />
                  <SkeletonList />
                </div>
              </div>
            </PageSkeleton>
          </main>
        </div>
      </div>
    </div>
  );
}
