import Card from "@/components/ui/Card";

export default function IALoading() {
  return (
    <div className="relative min-w-0">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(75%_55%_at_18%_0%,rgba(99,102,241,0.2),transparent_65%),radial-gradient(70%_50%_at_85%_8%,rgba(59,130,246,0.18),transparent_70%)]" />
      <div className="mx-auto max-w-6xl">
        <Card className="h-[80vh] min-h-[640px] animate-pulse border-indigo-300/20 bg-zinc-950/80" />
      </div>
    </div>
  );
}
