import type { ReactNode } from "react";

interface PageSkeletonProps {
  titleWidthClassName?: string;
  subtitleWidthClassName?: string;
  metaWidthClassName?: string;
  children?: ReactNode;
}

export default function PageSkeleton({
  titleWidthClassName = "w-44",
  subtitleWidthClassName = "w-80",
  metaWidthClassName = "w-24",
  children
}: PageSkeletonProps) {
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-3">
          <div
            className={`h-7 rounded bg-white/10 animate-pulse ${titleWidthClassName}`}
          />
          <div
            className={`h-4 rounded bg-white/10 animate-pulse ${subtitleWidthClassName}`}
          />
        </div>
        <div
          className={`h-3 rounded bg-white/10 animate-pulse ${metaWidthClassName}`}
        />
      </div>

      {children}
    </div>
  );
}
