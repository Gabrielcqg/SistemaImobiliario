// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { useCallback, useState } from "react";
import { describe, expect, it } from "vitest";
import { resolveCommittedPipelineFromServer } from "./selectionGuards";

type PipelineStatus = "contato_feito" | "em_conversa";

function PipelineSaveHarness() {
  const [committedPipelineId, setCommittedPipelineId] =
    useState<PipelineStatus>("contato_feito");
  const [pendingPipelineId, setPendingPipelineId] =
    useState<PipelineStatus | null>(null);
  const [isSavingPipeline, setIsSavingPipeline] = useState(false);
  const [committedWrites, setCommittedWrites] = useState(0);

  const setCommitted = useCallback((next: PipelineStatus) => {
    setCommittedPipelineId((previous) => {
      if (previous === next) return previous;
      setCommittedWrites((count) => count + 1);
      return next;
    });
  }, []);

  const syncFromServer = useCallback(
    (incoming: PipelineStatus, savingFlag: boolean) => {
      setCommittedPipelineId((previous) => {
        const decision = resolveCommittedPipelineFromServer({
          currentCommitted: previous,
          incomingFromServer: incoming,
          isSavingPipeline: savingFlag
        });

        if (!decision.changed) {
          return previous;
        }

        setCommittedWrites((count) => count + 1);
        return decision.nextCommitted;
      });
    },
    []
  );

  const savePipeline = useCallback(() => {
    if (!pendingPipelineId) return;

    setIsSavingPipeline(true);

    // Simulate stale refetch while mutation is still saving.
    syncFromServer("contato_feito", true);

    // Save success: commit exactly once to the pending pipeline.
    setCommitted(pendingPipelineId);
    setPendingPipelineId(null);
    setIsSavingPipeline(false);

    // Simulate post-save refetch returning the same committed value.
    syncFromServer(pendingPipelineId, false);
  }, [pendingPipelineId, setCommitted, syncFromServer]);

  return (
    <div>
      <p data-testid="committed">{committedPipelineId}</p>
      <p data-testid="pending">{pendingPipelineId ?? "none"}</p>
      <p data-testid="is-saving">{isSavingPipeline ? "yes" : "no"}</p>
      <p data-testid="writes">{committedWrites}</p>

      <button type="button" onClick={() => setPendingPipelineId("em_conversa")}>
        select-em-conversa
      </button>
      <button type="button" onClick={savePipeline}>
        save
      </button>
    </div>
  );
}

describe("pipeline save selection stability (RTL)", () => {
  it("changes committed pipeline at most once after Save even with stale refetch", () => {
    render(<PipelineSaveHarness />);

    expect(screen.getByTestId("committed").textContent).toBe("contato_feito");
    expect(screen.getByTestId("writes").textContent).toBe("0");

    fireEvent.click(screen.getByText("select-em-conversa"));

    // Click only updates pending, committed remains stable.
    expect(screen.getByTestId("pending").textContent).toBe("em_conversa");
    expect(screen.getByTestId("committed").textContent).toBe("contato_feito");
    expect(screen.getByTestId("writes").textContent).toBe("0");

    fireEvent.click(screen.getByText("save"));

    expect(screen.getByTestId("pending").textContent).toBe("none");
    expect(screen.getByTestId("is-saving").textContent).toBe("no");
    expect(screen.getByTestId("committed").textContent).toBe("em_conversa");
    expect(screen.getByTestId("writes").textContent).toBe("1");
  });
});
