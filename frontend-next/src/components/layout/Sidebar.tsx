"use client";

import Link from "next/link";
import { BarChart3, BrainCircuit, Search, Users } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOrganizationContext } from "@/lib/auth/useOrganizationContext";
import {
  createCrmClientBundleQueryOptions,
  createCrmClientsQueryOptions
} from "@/lib/crm/query";
import { dispatchNavigationStart } from "@/lib/navigation/progress";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const navItems = [
  { label: "Buscador", href: "/buscador", icon: Search },
  { label: "CRM", href: "/crm", icon: Users },
  { label: "IA", href: "/ia", icon: BrainCircuit },
  { label: "Analytics", href: "/analytics", icon: BarChart3 }
];

function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { context: organizationContext, organizationId, loading: organizationLoading } =
    useOrganizationContext();
  const [mobileOpen, setMobileOpen] = useState(false);
  const crmPrefetchingRef = useRef(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const prefetchCrmData = useCallback(() => {
    if (!organizationId || crmPrefetchingRef.current) return;
    crmPrefetchingRef.current = true;

    const run = async () => {
      try {
        const clientsBundle = await queryClient.fetchQuery(
          createCrmClientsQueryOptions({
            supabase,
            organizationId
          })
        );
        const firstClientId = clientsBundle.clients[0]?.id;
        if (firstClientId) {
          await queryClient.prefetchQuery(
            createCrmClientBundleQueryOptions({
              supabase,
              organizationId,
              clientId: firstClientId
            })
          );
        }
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[CRM] prefetch failed", error);
        }
      } finally {
        crmPrefetchingRef.current = false;
      }
    };

    void run();
  }, [organizationId, queryClient, supabase]);

  useEffect(() => {
    if (!organizationId) return;
    const timer = window.setTimeout(() => {
      prefetchCrmData();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [organizationId, prefetchCrmData]);

  const canAccessAnalytics =
    organizationContext?.organization.kind === "individual" ||
    organizationContext?.role === "owner" ||
    organizationContext?.role === "admin";

  const renderedNavItems = navItems.filter((item) => {
    if (item.href !== "/analytics") return true;
    if (organizationLoading) return false;
    return Boolean(canAccessAnalytics);
  });

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
          className="btn btn-sm btn-ghost md:hidden"
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
        {renderedNavItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              onMouseEnter={() => {
                router.prefetch(item.href);
                if (item.href === "/crm") {
                  prefetchCrmData();
                }
              }}
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
              className={`btn btn-md btn-nav btn-led-interaction w-full justify-start gap-3 ${isActive
                ? "bg-surface-lifted text-white" // Active: slightly lighter bg, white text
                : "btn-ghost" // Inactive: Transparent
                }`}
            >
              <Icon className="h-4 w-4 shrink-0 transition-transform group-hover:scale-110" />
              <span>{item.label}</span>
            </Link>
          );
        })}

        {organizationLoading ? (
          <div className="rounded-lg border border-zinc-800 px-3 py-2">
            <div className="h-4 w-24 animate-pulse rounded bg-zinc-700/70" />
          </div>
        ) : null}
      </nav>
    </aside>
  );
}

export default memo(Sidebar);
