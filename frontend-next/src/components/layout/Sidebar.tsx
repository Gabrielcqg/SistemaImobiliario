"use client";

import Link from "next/link";
import { BarChart3, Search, Users } from "lucide-react";
import { usePathname } from "next/navigation";
import { memo, useEffect, useState } from "react";
import { dispatchNavigationStart } from "@/lib/navigation/progress";

const navItems = [
  { label: "Buscador", href: "/buscador", icon: Search },
  { label: "Analytics", href: "/analytics", icon: BarChart3 },
  { label: "CRM", href: "/crm", icon: Users }
];

function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <aside className="w-full border-b border-zinc-800 bg-black/80 px-4 py-4 sm:px-6 md:h-screen md:w-64 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r md:px-6 md:py-6">
      <div className="flex items-center justify-between md:flex-col md:items-start md:gap-8">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-zinc-500">
            Projeto
          </p>
          <h2 className="mt-2 text-lg font-semibold">HomeRadar</h2>
        </div>
        <button
          type="button"
          className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs uppercase tracking-[0.25em] text-zinc-300 transition hover:bg-white/10 md:hidden"
          aria-expanded={mobileOpen}
          aria-controls="dashboard-sidebar-nav"
          onClick={() => setMobileOpen((prev) => !prev)}
        >
          {mobileOpen ? "Fechar" : "Menu"}
        </button>
      </div>

      <nav
        id="dashboard-sidebar-nav"
        className={`${mobileOpen ? "mt-4 flex" : "hidden"} min-w-0 flex-col gap-2 md:mt-8 md:flex`}
      >
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
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
                setMobileOpen(false);
              }}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm whitespace-normal break-words transition ${
                isActive
                  ? "bg-white text-black"
                  : "text-zinc-300 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

export default memo(Sidebar);
