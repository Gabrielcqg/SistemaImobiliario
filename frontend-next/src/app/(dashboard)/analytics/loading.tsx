export default function AnalyticsLoading() {
  return (
    <div className="space-y-6">
      <div className="h-6 w-40 rounded bg-white/10 animate-pulse" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="h-40 rounded-2xl border border-zinc-800 bg-white/5 animate-pulse"
          />
        ))}
      </div>
      <div className="h-64 rounded-2xl border border-zinc-800 bg-white/5 animate-pulse" />
    </div>
  );
}
