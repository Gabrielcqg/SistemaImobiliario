import SkeletonCard from "@/components/ui/SkeletonCard";

interface SkeletonListProps {
  count?: number;
  className?: string;
  cardClassName?: string;
}

export default function SkeletonList({
  count = 6,
  className = "grid gap-4 sm:grid-cols-2 xl:grid-cols-3",
  cardClassName = "h-56"
}: SkeletonListProps) {
  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonCard key={index} className={cardClassName} />
      ))}
    </div>
  );
}
