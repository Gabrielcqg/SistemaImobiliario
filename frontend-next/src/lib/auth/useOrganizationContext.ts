"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getBootstrapContext,
  ensurePersonalOrganization,
  type BootstrapContext,
  type OrganizationContext
} from "@/lib/auth/organization";
import { ORGANIZATION_CONTEXT_REFRESH_EVENT } from "@/lib/auth/organizationEvents";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const ORGANIZATION_BOOTSTRAP_CACHE_KEY = "organization-bootstrap-context:v1";

type OrganizationBootstrapSnapshot = {
  context: OrganizationContext | null;
  needsOrgChoice: boolean;
  membershipsCount: number;
  cachedAt: number;
};

let memorySnapshot: OrganizationBootstrapSnapshot | null = null;
let bootstrapInFlight: Promise<OrganizationBootstrapSnapshot> | null = null;

type UseOrganizationContextResult = {
  context: OrganizationContext | null;
  organizationId: string | null;
  loading: boolean;
  initialized: boolean;
  needsOrganizationChoice: boolean;
  membershipsCount: number;
  error: string | null;
  refresh: () => Promise<void>;
};

function toOrganizationContext(
  bootstrap: BootstrapContext
): OrganizationContext | null {
  if (
    !bootstrap.activeOrganizationId ||
    !bootstrap.organizationName ||
    !bootstrap.organizationKind ||
    !bootstrap.myRole
  ) {
    return null;
  }

  return {
    organization: {
      id: bootstrap.activeOrganizationId,
      name: bootstrap.organizationName,
      kind: bootstrap.organizationKind,
      seatsTotal: bootstrap.seatsTotal
    },
    role: bootstrap.myRole,
    membersUsed: bootstrap.membersUsed,
    pendingInvites: bootstrap.pendingInvites,
    members: [],
    invites: []
  };
}

function toSnapshot(bootstrap: BootstrapContext): OrganizationBootstrapSnapshot {
  return {
    context: toOrganizationContext(bootstrap),
    needsOrgChoice: bootstrap.needsOrgChoice,
    membershipsCount: bootstrap.membershipsCount,
    cachedAt: Date.now()
  };
}

function readSnapshotFromStorage(): OrganizationBootstrapSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ORGANIZATION_BOOTSTRAP_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OrganizationBootstrapSnapshot | null;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistSnapshot(snapshot: OrganizationBootstrapSnapshot) {
  memorySnapshot = snapshot;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      ORGANIZATION_BOOTSTRAP_CACHE_KEY,
      JSON.stringify(snapshot)
    );
  } catch {
    // Ignore cache persistence errors.
  }
}

function clearSnapshot() {
  memorySnapshot = null;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ORGANIZATION_BOOTSTRAP_CACHE_KEY);
  } catch {
    // Ignore cache clearing errors.
  }
}

async function fetchBootstrapSnapshot(
  supabase: ReturnType<typeof createSupabaseBrowserClient>
): Promise<OrganizationBootstrapSnapshot> {
  if (bootstrapInFlight) {
    return bootstrapInFlight;
  }

  bootstrapInFlight = (async () => {
    const bootstrap = await getBootstrapContext(supabase);
    const snapshot = toSnapshot(bootstrap);
    persistSnapshot(snapshot);
    return snapshot;
  })();

  try {
    return await bootstrapInFlight;
  } finally {
    bootstrapInFlight = null;
  }
}

export function useOrganizationContext(): UseOrganizationContextResult {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [context, setContext] = useState<OrganizationContext | null>(null);
  const [needsOrganizationChoice, setNeedsOrganizationChoice] = useState(false);
  const [membershipsCount, setMembershipsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    if (!memorySnapshot) {
      setLoading(true);
    }

    try {
      let nextSnapshot = await fetchBootstrapSnapshot(supabase);

      if (
        !nextSnapshot.context &&
        !nextSnapshot.needsOrgChoice &&
        nextSnapshot.membershipsCount === 0
      ) {
        await ensurePersonalOrganization(supabase);
        nextSnapshot = await fetchBootstrapSnapshot(supabase);
      }

      setContext(nextSnapshot.context);
      setNeedsOrganizationChoice(nextSnapshot.needsOrgChoice);
      setMembershipsCount(nextSnapshot.membershipsCount);
      setInitialized(true);
      if (!nextSnapshot.context && !nextSnapshot.needsOrgChoice) {
        setError("Nenhuma organizacao ativa foi encontrada para este usuario.");
      }
    } catch (contextError) {
      clearSnapshot();
      setContext(null);
      setNeedsOrganizationChoice(false);
      setMembershipsCount(0);
      setInitialized(true);
      setError(
        contextError instanceof Error
          ? contextError.message
          : "Nao foi possivel carregar a organizacao atual."
      );
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    const snapshot = memorySnapshot ?? readSnapshotFromStorage();
    if (snapshot) {
      memorySnapshot = snapshot;
      setContext(snapshot.context);
      setNeedsOrganizationChoice(snapshot.needsOrgChoice);
      setMembershipsCount(snapshot.membershipsCount);
      setLoading(false);
      setInitialized(true);
    }
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handleRefresh = () => {
      void refresh();
    };

    window.addEventListener(ORGANIZATION_CONTEXT_REFRESH_EVENT, handleRefresh);
    return () => {
      window.removeEventListener(ORGANIZATION_CONTEXT_REFRESH_EVENT, handleRefresh);
    };
  }, [refresh]);

  return {
    context,
    organizationId: context?.organization.id ?? null,
    loading,
    initialized,
    needsOrganizationChoice,
    membershipsCount,
    error,
    refresh
  };
}
