"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, LogOut, UserCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOrganizationContext } from "@/lib/auth/useOrganizationContext";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { dispatchNavigationStart } from "@/lib/navigation/progress";

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
  const router = useRouter();
  const { context: organizationContext, loading: organizationLoading } =
    useOrganizationContext();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const [logoutLoading, setLogoutLoading] = useState(false);
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

  return (
    <div className="border-b border-zinc-800 px-4 py-4 sm:px-6">
      <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
            Dashboard
          </p>
          <h1 className="mt-1 text-xl font-semibold">Visão Geral</h1>
          <div className="mt-1 break-words text-xs text-zinc-500">
            {organizationLoading ? (
              <span className="inline-block h-3 w-40 animate-pulse rounded bg-zinc-700/70" />
            ) : organizationContext?.organization.name ? (
              `Organizacao ativa: ${organizationContext.organization.name}`
            ) : (
              "Sem organizacao ativa"
            )}
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
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
    </div>
  );
}

export default memo(Topbar);
