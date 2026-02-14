import type { HTMLAttributes } from "react";

interface SkeletonCardProps extends HTMLAttributes<HTMLDivElement> {
  lines?: number;
}

export default function SkeletonCard({
  className = "",
  lines = 0,
  ...props
}: SkeletonCardProps) {
  return (
    <div
      className={`rounded-2xl border border-zinc-800 bg-white/[0.04] p-4 animate-pulse ${className}`.trim()}
      {...props}
    >
      {lines > 0 ? (
        <div className="space-y-2">
          {Array.from({ length: lines }).map((_, index) => (
            <div
              key={index}
              className={`h-3 rounded bg-white/10 ${
                index === lines - 1 ? "w-2/3" : "w-full"
              }`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
