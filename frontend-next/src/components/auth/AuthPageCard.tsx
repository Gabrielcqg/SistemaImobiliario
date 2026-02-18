import type { ReactNode } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";

type AuthPageCardProps = {
  badge: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
  backHref?: string;
  backLabel?: string;
};

export default function AuthPageCard({
  badge,
  title,
  subtitle,
  children,
  footer,
  backHref,
  backLabel
}: AuthPageCardProps) {
  return (
    <div className="w-full max-w-md">
      <Card className="w-full max-w-md border-zinc-800 bg-white/5 p-8">
        <div className="space-y-6">
          <div className="space-y-2">
            {backHref && backLabel ? (
              <Link
                href={backHref}
                className="inline-flex items-center text-xs uppercase tracking-[0.25em] text-zinc-500 transition hover:text-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                {backLabel}
              </Link>
            ) : null}
            <div className="h-1 w-16 rounded-full bg-gradient-to-r from-white to-zinc-500" />
            <p className="text-xs uppercase tracking-[0.3em] text-zinc-400">{badge}</p>
            <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
            <p className="text-sm text-zinc-400">{subtitle}</p>
          </div>

          {children}

          {footer ? <div className="border-t border-zinc-800 pt-4">{footer}</div> : null}
        </div>
      </Card>
    </div>
  );
}
