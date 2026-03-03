import { describe, expect, it } from "vitest";
import {
  applyPendingPipelineStatus,
  resolveCommittedPipelineFromServer,
  resolveClientSelectionDecision,
  type SelectionLock
} from "./selectionGuards";

describe("resolveClientSelectionDecision", () => {
  it("keeps selection locked during create when fresh list does not include new client yet", () => {
    const lock: SelectionLock = {
      reason: "create-client",
      clientId: "new-client-id",
      expiresAt: Date.now() + 5_000
    };

    const decision = resolveClientSelectionDecision({
      activeClientIds: ["old-1", "old-2"],
      lock,
      selectedClientIdSnapshot: "new-client-id"
    });

    expect(decision).toEqual({
      type: "keep",
      reason: "lock-prevents-fallback"
    });
  });

  it("selects preferred locked client once it appears in list", () => {
    const lock: SelectionLock = {
      reason: "create-client",
      clientId: "new-client-id",
      expiresAt: Date.now() + 5_000
    };

    const decision = resolveClientSelectionDecision({
      activeClientIds: ["new-client-id", "old-1"],
      lock,
      selectedClientIdSnapshot: "new-client-id"
    });

    expect(decision).toEqual({
      type: "select",
      reason: "preferred",
      selectedClientId: "new-client-id",
      preferredSelection: "new-client-id"
    });
  });

  it("falls back to first client when no lock and preferred is missing", () => {
    const decision = resolveClientSelectionDecision({
      activeClientIds: ["a", "b"],
      lock: null,
      selectedClientIdSnapshot: "missing"
    });

    expect(decision).toEqual({
      type: "select",
      reason: "fallback",
      selectedClientId: "a",
      preferredSelection: "missing"
    });
  });
});

describe("applyPendingPipelineStatus", () => {
  it("keeps optimistic pipeline status when server returns stale value", () => {
    const result = applyPendingPipelineStatus(
      { id: "c1", status_pipeline: "contato_feito" },
      {
        status: "em_conversa",
        expiresAt: Date.now() + 10_000
      }
    );

    expect(result.pendingExpired).toBe(false);
    expect(result.pendingResolved).toBe(false);
    expect(result.client.status_pipeline).toBe("em_conversa");
  });

  it("marks pending as resolved when server catches up", () => {
    const result = applyPendingPipelineStatus(
      { id: "c1", status_pipeline: "em_conversa" },
      {
        status: "em_conversa",
        expiresAt: Date.now() + 10_000
      }
    );

    expect(result.pendingExpired).toBe(false);
    expect(result.pendingResolved).toBe(true);
    expect(result.client.status_pipeline).toBe("em_conversa");
  });
});

describe("resolveCommittedPipelineFromServer", () => {
  it("keeps committed pipeline locked while saving even if refetch returns stale status", () => {
    const duringSave = resolveCommittedPipelineFromServer({
      currentCommitted: "em_conversa",
      incomingFromServer: "contato_feito",
      isSavingPipeline: true
    });

    expect(duringSave).toEqual({
      nextCommitted: "em_conversa",
      changed: false,
      reason: "saving-lock"
    });
  });

  it("applies server sync once after save, without double-change", () => {
    const afterSave = resolveCommittedPipelineFromServer({
      currentCommitted: "em_conversa",
      incomingFromServer: "visita_agendada",
      isSavingPipeline: false
    });
    expect(afterSave).toEqual({
      nextCommitted: "visita_agendada",
      changed: true,
      reason: "server-sync"
    });

    const stableAfterSync = resolveCommittedPipelineFromServer({
      currentCommitted: afterSave.nextCommitted,
      incomingFromServer: "visita_agendada",
      isSavingPipeline: false
    });
    expect(stableAfterSync).toEqual({
      nextCommitted: "visita_agendada",
      changed: false,
      reason: "unchanged"
    });
  });
});
