import SkeletonCard from "@/components/ui/SkeletonCard";
import SkeletonList from "@/components/ui/SkeletonList";

export default function BuscadorLoading() {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <SkeletonCard className="h-[560px]" />
        <div className="space-y-6">
          <SkeletonCard className="h-14" />
          <div className="grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SkeletonCard className="h-60" />
            <SkeletonCard className="h-60" />
            <SkeletonCard className="h-60" />
          </div>
          <SkeletonList />
        </div>
      </div>
    </div>
  );
}
