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
              className={`inline-flex w-full items-center justify-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition sm:w-auto ${
                hasMissingInvites
                  ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-100 hover:border-emerald-300/60 hover:bg-emerald-500/15"
                  : "border border-zinc-700 bg-zinc-900/60 text-zinc-200 hover:border-zinc-500 hover:text-white"
              }`}
            >
              {hasMissingInvites ? (
                <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.15em]">
                  Faltando convites
                </span>
              ) : null}
              <span>
                {hasMissingInvites
                  ? `Onboarding: faltam ${seatsAvailable} convite(s)`
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
              className="inline-flex h-9 items-center justify-center gap-1 rounded-full border border-zinc-800 px-2.5 text-zinc-300 transition hover:bg-white/10 hover:text-white"
            >
              <UserCircle2 className="h-5 w-5" />
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${
                  profileOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {profileOpen ? (
              <div className="absolute right-0 top-11 z-40 w-64 rounded-xl border border-zinc-800 bg-black/95 p-3 shadow-glow backdrop-blur-md">
                <div className="space-y-1 border-b border-zinc-800 pb-3">
                  <p className="text-sm font-semibold text-zinc-100">{profileName}</p>
                  <p className="break-all text-xs text-zinc-400">{profileEmail}</p>
                </div>
                <div className="pt-3">
                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={logoutLoading}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-zinc-200 transition hover:bg-white/10 hover:text-white disabled:opacity-60"
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
