import PageSkeleton from "@/components/ui/PageSkeleton";
import SkeletonCard from "@/components/ui/SkeletonCard";
import SkeletonList from "@/components/ui/SkeletonList";

export default function AnalyticsLoading() {
  return (
    <PageSkeleton
      titleWidthClassName="w-32"
      subtitleWidthClassName="w-80"
      metaWidthClassName="w-32"
    >
      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <SkeletonCard className="h-[420px]" />
        <div className="space-y-6">
          <SkeletonList
            count={3}
            className="grid gap-4 md:grid-cols-3"
            cardClassName="h-32"
          />
          <SkeletonCard className="h-80" />
          <SkeletonCard className="h-64" />
        </div>
      </div>
    </PageSkeleton>
  );
}
