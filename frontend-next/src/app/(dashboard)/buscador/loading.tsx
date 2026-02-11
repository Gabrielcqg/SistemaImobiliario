export default function BuscadorLoading() {
  return (
    <div className="space-y-6">
      <div className="h-6 w-48 rounded bg-white/10 animate-pulse" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="h-56 rounded-2xl border border-zinc-800 bg-white/5 animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}
