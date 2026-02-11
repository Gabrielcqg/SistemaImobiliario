export default function CrmLoading() {
  return (
    <div className="space-y-6">
      <div className="h-6 w-36 rounded bg-white/10 animate-pulse" />
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="h-80 rounded-2xl border border-zinc-800 bg-white/5 animate-pulse" />
        <div className="h-80 rounded-2xl border border-zinc-800 bg-white/5 animate-pulse" />
      </div>
    </div>
  );
}
