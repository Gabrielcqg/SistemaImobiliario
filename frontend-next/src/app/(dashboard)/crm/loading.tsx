import PageSkeleton from "@/components/ui/PageSkeleton";
import SkeletonCard from "@/components/ui/SkeletonCard";

export default function CrmLoading() {
  return (
    <PageSkeleton
      titleWidthClassName="w-24"
      subtitleWidthClassName="w-80"
      metaWidthClassName="w-20"
    >
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <SkeletonCard className="h-[520px]" />
        <div className="space-y-6">
          <SkeletonCard className="h-[320px]" />
          <SkeletonCard className="h-[300px]" />
          <SkeletonCard className="h-[340px]" />
        </div>
      </div>
    </PageSkeleton>
  );
}
