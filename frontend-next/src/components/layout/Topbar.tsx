"use client";

import { useQueryClient } from "@tanstack/react-query";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  BarChart3,
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  LogOut,
  Search,
  UserCircle2,
  Users
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useOrganizationContext } from "@/lib/auth/useOrganizationContext";
import {
  createCrmClientBundleQueryOptions,
  createCrmClientsQueryOptions
} from "@/lib/crm/query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { dispatchNavigationStart } from "@/lib/navigation/progress";

const navItems = [
  { label: "Buscador", href: "/buscador", icon: Search },
  { label: "CRM", href: "/crm", icon: Users },
  { label: "IA", href: "/ia", icon: BrainCircuit },
  { label: "Analytics", href: "/analytics", icon: BarChart3 }
];

function resolveUserDisplayName(
  userMetadata: Record<string, unknown> | null,
  fallbackEmail: string | null
) {
  const metadataNameCandidates = [
    userMetadata?.full_name,
    userMetadata?.name,
    userMetadata?.onboarding_full_name
  ];
  for (const candidate of metadataNameCandidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  if (fallbackEmail) {
    return fallbackEmail.split("@")[0] || "Usuario";
  }
  return "Usuario";
}

function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    context: organizationContext,
    organizationId,
    loading: organizationLoading
  } = useOrganizationContext();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const crmPrefetchingRef = useRef(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState("Usuario");
  const [profileEmail, setProfileEmail] = useState("email-nao-informado");

  const isBrokerageOwner =
    organizationContext?.organization.kind === "brokerage" &&
    organizationContext.role === "owner";

  const seatsAvailable =
    organizationContext &&
      organizationContext.organization.kind === "brokerage"
      ? Math.max(
        0,
        organizationContext.organization.seatsTotal -
        (organizationContext.membersUsed + organizationContext.pendingInvites)
      )
      : 0;
  const hasMissingInvites = isBrokerageOwner && seatsAvailable > 0;

  useEffect(() => {
    setMobileNavOpen(false);
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

  useEffect(() => {
    let cancelled = false;

    const loadUserProfile = async () => {
      const {
        data: { user }
      } = await supabase.auth.getUser();
      if (cancelled) return;

      const email =
        typeof user?.email === "string" && user.email.trim().length > 0
          ? user.email.trim()
          : "email-nao-informado";
      const metadata = (user?.user_metadata ?? null) as Record<string, unknown> | null;
      const name = resolveUserDisplayName(metadata, user?.email ?? null);

      setProfileEmail(email);
      setProfileName(name);
    };

    void loadUserProfile();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    if (!profileOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!profileMenuRef.current) return;
      if (!profileMenuRef.current.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProfileOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [profileOpen]);

  const handleLogout = async () => {
    setLogoutLoading(true);
    setProfileOpen(false);
    await supabase.auth.signOut();
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("organization-bootstrap-context:v1");
    }
    dispatchNavigationStart();
    router.replace("/login");
    router.refresh();
    setLogoutLoading(false);
  };

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
    <div className="border-b border-zinc-800 px-4 py-4 sm:px-6">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 items-start justify-between gap-2 lg:items-center">
          <div className="flex shrink-0 items-center gap-2.5">
            <div className="relative h-8 w-8 shrink-0 overflow-visible sm:h-9 sm:w-9">
              <Image
                src="/imoradar-logo.png"
                alt="ImoRadar"
                fill
                sizes="(max-width: 640px) 32px, 36px"
                className="object-contain scale-125"
              />
            </div>
            <span className="text-[15px] font-semibold leading-none tracking-[0.01em] text-zinc-100 sm:text-base">
              ImoRadar
            </span>
          </div>

          <div className="flex min-w-0 items-center gap-2 lg:hidden">
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              aria-expanded={mobileNavOpen}
              aria-controls="dashboard-topbar-nav"
              onClick={() => setMobileNavOpen((previous) => !previous)}
            >
              {mobileNavOpen ? "Fechar" : "Menu"}
            </button>
          </div>

          <div className="hidden min-w-0 flex-1 overflow-visible lg:ml-12 lg:block">
            <nav className="-my-2 flex min-w-0 items-center gap-2 overflow-x-auto py-2">
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
                    }}
                    className={`btn btn-sm btn-nav btn-led-interaction relative w-auto shrink-0 gap-2 px-3 ${isActive
                      ? "bg-surface-lifted text-white ring-1 ring-white/10 shadow-[inset_0_-2px_0_rgba(255,255,255,0.9),0_10px_18px_-14px_rgba(255,255,255,0.55)] after:absolute after:bottom-[3px] after:left-3 after:right-3 after:h-0.5 after:rounded-full after:bg-white/85 after:shadow-[0_0_10px_rgba(255,255,255,0.35)] after:content-['']"
                      : "btn-ghost text-zinc-400 hover:text-zinc-100"
                      }`}
                  >
                    <Icon className="h-4 w-4 shrink-0 transition-transform group-hover:scale-110" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}

              {organizationLoading ? (
                <div className="h-8 w-24 shrink-0 animate-pulse rounded bg-zinc-700/60" />
              ) : null}
            </nav>
          </div>

          <div className="ml-auto flex w-auto flex-wrap items-center justify-end gap-2">
            {isBrokerageOwner ? (
              <Link
                href="/onboarding/imobiliaria/convidar"
                className={`btn btn-sm btn-led-interaction sm:w-auto ${hasMissingInvites
                  ? "btn-solid" // solid
                  : "btn-ghost"
                  }`}
              >
                {hasMissingInvites ? (
                  <span className="mr-2 rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-red-200">
                    Faltando convite
                  </span>
                ) : null}
                <span className="mr-2">
                  {hasMissingInvites
                    ? `Onboarding: faltam ${seatsAvailable} convites`
                    : "Onboarding Equipe"}
                </span>
                <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            ) : null}
            <div className="relative" ref={profileMenuRef}>
              <button
                type="button"
                aria-label="Abrir menu de perfil"
                aria-expanded={profileOpen}
                onClick={() => setProfileOpen((previous) => !previous)}
                className="btn btn-icon btn-ghost btn-led-interaction"
              >
                <UserCircle2 className="h-5 w-5" />
                <ChevronDown
                  className={`absolute -bottom-1 -right-1 h-3 w-3 transition-transform ${profileOpen ? "rotate-180" : ""
                    }`}
                />
              </button>

              {profileOpen ? (
                <div className="absolute right-0 top-14 z-40 w-64 rounded-xl border border-zinc-800 bg-black/95 p-3 shadow-glow backdrop-blur-md">
                  <div className="space-y-1 border-b border-zinc-800 pb-3">
                    <p className="text-sm font-semibold text-zinc-100">{profileName}</p>
                    <p className="break-all text-xs text-zinc-400">{profileEmail}</p>
                  </div>
                  <div className="pt-3">
                    <button
                      type="button"
                      onClick={handleLogout}
                      disabled={logoutLoading}
                      className="btn btn-sm btn-ghost w-full justify-start gap-2"
                    >
                      <LogOut className="h-4 w-4" />
                      {logoutLoading ? "Saindo..." : "Sair"}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <nav
          id="dashboard-topbar-nav"
          className={`${mobileNavOpen ? "flex" : "hidden"} min-w-0 flex-col gap-2 lg:hidden`}
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
                  setMobileNavOpen(false);
                }}
                className={`btn btn-md btn-nav btn-led-interaction relative w-full justify-start gap-3 ${isActive
                  ? "bg-surface-lifted text-white ring-1 ring-white/10 shadow-[inset_0_-2px_0_rgba(255,255,255,0.9),0_10px_18px_-14px_rgba(255,255,255,0.45)] after:absolute after:bottom-[4px] after:left-4 after:right-4 after:h-0.5 after:rounded-full after:bg-white/85 after:shadow-[0_0_10px_rgba(255,255,255,0.3)] after:content-['']"
                  : "btn-ghost text-zinc-400 hover:text-zinc-100"
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
      </div>
    </div>
  );
}

export default memo(Topbar);
