import SkeletonCard from "@/components/ui/SkeletonCard";
import SkeletonList from "@/components/ui/SkeletonList";

export default function BuscadorLoading() {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <SkeletonCard className="h-[560px]" />
        <div className="space-y-6">
          <SkeletonCard className="h-14" />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <SkeletonCard className="h-60 md:col-span-2 xl:col-span-2" />
            <SkeletonCard className="h-60" />
            <SkeletonCard className="h-60" />
          </div>
          <SkeletonList />
        </div>
      </div>
    </div>
  );
}
