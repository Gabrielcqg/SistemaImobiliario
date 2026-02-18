import PageSkeleton from "@/components/ui/PageSkeleton";
import SkeletonCard from "@/components/ui/SkeletonCard";
import SkeletonList from "@/components/ui/SkeletonList";

export default function AnalyticsLoading() {
  return (
    <PageSkeleton
      titleWidthClassName="w-64"
      subtitleWidthClassName="w-80"
      metaWidthClassName="w-40"
    >
      <div className="space-y-6">
        <SkeletonCard className="h-56" />
        <SkeletonList
          count={6}
          className="grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
          cardClassName="h-40"
        />
        <div className="grid gap-6 xl:grid-cols-2">
          <SkeletonCard className="h-[420px]" />
          <SkeletonCard className="h-[420px]" />
        </div>
      </div>
    </PageSkeleton>
  );
}
