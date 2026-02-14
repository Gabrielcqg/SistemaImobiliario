"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { memo } from "react";
import { dispatchNavigationStart } from "@/lib/navigation/progress";

const navItems = [
  { label: "Buscador", href: "/buscador" },
  { label: "Analytics", href: "/analytics" },
  { label: "CRM", href: "/crm" }
];

function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-full border-b border-zinc-800 bg-black/80 px-6 py-6 md:h-screen md:w-64 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between md:flex-col md:items-start md:gap-8">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-zinc-500">
            Projeto
          </p>
          <h2 className="mt-2 text-lg font-semibold">Imobiliária</h2>
        </div>
        <div className="hidden text-xs text-zinc-500 md:block">
          v0.1
        </div>
      </div>

      <nav className="mt-8 flex gap-2 md:flex-col">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              onClick={() => {
                dispatchNavigationStart();
                if (process.env.NODE_ENV !== "production") {
                  (window as unknown as { __navPerf?: { start: number; href: string } })
                    .__navPerf = {
                    start: performance.now(),
                    href: item.href
                  };
                }
              }}
              className={`rounded-lg px-4 py-2 text-sm transition ${
                isActive
                  ? "bg-white text-black"
                  : "text-zinc-300 hover:bg-white/10 hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

export default memo(Sidebar);
