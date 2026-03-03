export type SelectionLockReason = "create-client" | "pipeline-update";

export type SelectionLock = {
  reason: SelectionLockReason;
  clientId: string | null;
  expiresAt: number;
};

type ResolveClientSelectionArgs = {
  activeClientIds: string[];
  lock: SelectionLock | null;
  nextSelectedIdOption?: string | null;
  requestedSelection?: string | null;
  selectedClientIdSnapshot?: string | null;
};

export type ClientSelectionDecision =
  | {
      type: "clear";
      reason: "empty-list";
    }
  | {
      type: "keep";
      reason: "lock-prevents-fallback" | "locked-empty-list";
    }
  | {
      type: "select";
      reason: "preferred" | "fallback";
      selectedClientId: string;
      preferredSelection: string | null;
    };

export const resolveClientSelectionDecision = (
  args: ResolveClientSelectionArgs
): ClientSelectionDecision => {
  const {
    activeClientIds,
    lock,
    nextSelectedIdOption,
    requestedSelection,
    selectedClientIdSnapshot
  } = args;

  if (activeClientIds.length === 0) {
    if (lock?.clientId) {
      return {
        type: "keep",
        reason: "locked-empty-list"
      };
    }
    return {
      type: "clear",
      reason: "empty-list"
    };
  }

  const preferredSelection =
    lock?.clientId ??
    nextSelectedIdOption ??
    requestedSelection ??
    selectedClientIdSnapshot ??
    null;

  if (preferredSelection && activeClientIds.includes(preferredSelection)) {
    return {
      type: "select",
      reason: "preferred",
      selectedClientId: preferredSelection,
      preferredSelection
    };
  }

  if (lock?.clientId && preferredSelection === lock.clientId) {
    return {
      type: "keep",
      reason: "lock-prevents-fallback"
    };
  }

  return {
    type: "select",
    reason: "fallback",
    selectedClientId: activeClientIds[0],
    preferredSelection
  };
};

export const applyPendingPipelineStatus = <T extends { status_pipeline?: string | null }>(
  client: T,
  pending:
    | {
        status: string;
        expiresAt: number;
      }
    | undefined,
  now = Date.now()
): {
  client: T;
  pendingResolved: boolean;
  pendingExpired: boolean;
} => {
  if (!pending) {
    return {
      client,
      pendingResolved: false,
      pendingExpired: false
    };
  }

  if (now > pending.expiresAt) {
    return {
      client,
      pendingResolved: false,
      pendingExpired: true
    };
  }

  if (client.status_pipeline === pending.status) {
    return {
      client,
      pendingResolved: true,
      pendingExpired: false
    };
  }

  return {
    client: {
      ...client,
      status_pipeline: pending.status
    },
    pendingResolved: false,
    pendingExpired: false
  };
};

type ResolveCommittedPipelineArgs<TStatus extends string> = {
  currentCommitted: TStatus;
  incomingFromServer: TStatus;
  isSavingPipeline: boolean;
};

export const resolveCommittedPipelineFromServer = <TStatus extends string>(
  args: ResolveCommittedPipelineArgs<TStatus>
): {
  nextCommitted: TStatus;
  changed: boolean;
  reason: "saving-lock" | "unchanged" | "server-sync";
} => {
  const { currentCommitted, incomingFromServer, isSavingPipeline } = args;

  if (isSavingPipeline) {
    return {
      nextCommitted: currentCommitted,
      changed: false,
      reason: "saving-lock"
    };
  }

  if (incomingFromServer === currentCommitted) {
    return {
      nextCommitted: currentCommitted,
      changed: false,
      reason: "unchanged"
    };
  }

  return {
    nextCommitted: incomingFromServer,
    changed: true,
    reason: "server-sync"
  };
};
