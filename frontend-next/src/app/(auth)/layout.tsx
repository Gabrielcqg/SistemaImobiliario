import { Suspense } from "react";
import type { ReactNode } from "react";

export default function AuthLayout({
  children
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center overflow-x-clip px-4 py-10 sm:px-6 sm:py-16">
      <Suspense
        fallback={
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-white/5 p-6 shadow-glow backdrop-blur-md">
            <div className="h-6 w-32 animate-pulse rounded bg-zinc-700/70" />
            <div className="mt-4 h-4 w-full animate-pulse rounded bg-zinc-800/70" />
            <div className="mt-2 h-4 w-4/5 animate-pulse rounded bg-zinc-800/70" />
          </div>
        }
      >
        {children}
      </Suspense>
    </div>
  );
}
