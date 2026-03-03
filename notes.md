# CRM Pipeline Bounce — Diagnosis + Fix Notes

Date: 2026-02-28  
Scope: `frontend-next/src/app/(dashboard)/crm/page.tsx`

## Phase 0 — Inventory of all pipeline-selection writers

| File path | Writer | Trigger / conditions | Can overwrite user choice? |
|---|---|---|---|
| `frontend-next/src/app/(dashboard)/crm/page.tsx:921-943` | `setCommittedPipelineStatus(next, source)` | Called by sync effect and save-success handler | YES (committed source of truth) |
| `frontend-next/src/app/(dashboard)/crm/page.tsx:945-958` | `setPendingPipelineStatus(next, source)` | Called by click/open modal, close modal, save success/error, selected client change | YES (pending only; does not change displayed pipeline) |
| `frontend-next/src/app/(dashboard)/crm/page.tsx:1137-1174` | selected-client sync effect (`resolveCommittedPipelineFromServer`) | Runs when `selectedClient`/`isSavingPipeline`/`committedPipelineStatus` changes; syncs server value into committed value | YES (guarded now; blocked while saving) |
| `frontend-next/src/app/(dashboard)/crm/page.tsx:2090` | `openStatusTransitionModal` -> `setPendingPipelineStatus(next, "pipeline-click")` | User clicks pipeline stage | NO (only pending) |
| `frontend-next/src/app/(dashboard)/crm/page.tsx:2105` | `closeStatusTransitionModal` clears pending | User closes modal; skipped if saving | NO |
| `frontend-next/src/app/(dashboard)/crm/page.tsx:2306` | save error clears pending | Mutation error path | NO |
| `frontend-next/src/app/(dashboard)/crm/page.tsx:2364-2365` | save success writes committed + clears pending | Mutation success path | YES (intended single committed write on save) |
| `frontend-next/src/app/(dashboard)/crm/page.tsx:2678-2681` | selected client change clears pending | `selectedClientId` change effect | NO |
| `frontend-next/src/app/(dashboard)/crm/page.tsx:2360-2363` + `1139-1147` + `1827-1835` | `pendingPipelineStatusByClientRef` optimistic overlay | Set on save-success; consumed on selected-client sync + list apply | INDIRECT (prevents stale server values from overriding committed) |
| `frontend-next/src/app/(dashboard)/crm/page.tsx:2366-2414` | `queryClient.setQueryData(...)` | Immediate cache patch after save-success | INDIRECT (stabilizes data to avoid stale bounce) |
| `frontend-next/src/app/(dashboard)/crm/page.tsx:1026-1036` + `2450-2454` | query invalidation (`invalidateCrmQuery`) | After save | INDIRECT (can trigger stale/fresh fetch sequence) |

Extra checks:
- `router.refresh()` inside CRM page: **not present**.
- Pipeline keys: both desktop and mobile lists use `key={step.value}` (`3991-4000`, `5042-5048`) — no `key={index}` remount issue on pipeline items.

## Phase 1 — Trace harness used

Debug tracing (already in code, behind `DEBUG_CRM`):
- Mount/unmount: `crm:mounted` / `crm:unmounted` (`1132-1135`)
- Pipeline writes: `pipeline:committed-change`, `pipeline:pending-change` (`921-958`)
- Save lifecycle: `pipeline:save:start|error|done` (`2130`, `2307`, `2458`)
- Lock guard event: `pipeline:sync-skip-while-saving` (`1158-1163`)
- Query invalidation and fetch logs: `query:invalidate:*`, `query:clients`, `query:selected-client-bundle` (`1026-1036`, `1228-1262`)

Repro route for slow network:
- `/crm?debugCRM=1&debugDelayMs=1500`

Expected/observed trace contract after fix:
- During save, stale sync attempts are logged as `pipeline:sync-skip-while-saving`.
- After save, `pipeline:committed-change` should happen at most once for the target stage.

## Phase 2 — Confirmed root cause (evidence-based)

### Confirmed cause A: competing writers during refetch window (committed vs server sync)

Current evidence of competing writer (now guarded):
- Save success writes committed: `setCommittedPipelineStatus(statusModalTarget, "save-success")` (`2364`)
- Server-sync effect can also write committed from fetched data: `setCommittedPipelineStatus(..., "selected-client-sync")` (`1166`)

Why bounce happened pre-fix:
- Refetch/invalidation could deliver stale status between those two writers.
- Without save-lock guard, sync effect could temporarily apply old status, then later apply new status.

Guard added now:
- `resolveCommittedPipelineFromServer(... isSavingPipeline)` returns `saving-lock` and blocks write while saving (`selectionGuards.ts:142-171`, `page.tsx:1151-1165`).

### Confirmed cause B: old UI model mixed display state and animation state

Pre-fix code (removed in this patch) used:
- `confirmedIndex`, `animIndex`, `isPipelineAnimating`, and animation reset to zero.
- This produced a forced visual “back then forward” path even when target was known.

Removed behavior evidence (diff):
```diff
- const [confirmedIndex, setConfirmedIndex] = useState(0);
- const [animIndex, setAnimIndex] = useState(0);
- const [isPipelineAnimating, setIsPipelineAnimating] = useState(false);
- setAnimIndex(0);
```

### Timeline (pre-fix)

- T0: user clicks Save for pipeline change.
- T1: local update starts and invalidation/refetch starts.
- T2: stale list/bundle arrives first; sync/default path re-applies old stage.
- T3: fresh list/bundle arrives; new stage is applied again.
- Result: visible jump (old -> new -> old -> new, or reverse depending on timing).

## Phase 3 — Implemented fix

### 1) Explicit committed vs pending vs saving states

Implemented in `page.tsx`:
- `committedPipelineStatusState` (`689-690`) = displayed/committed stage.
- `pendingPipelineStatusState` (`691-692`) = clicked but not saved stage.
- `isSavingPipeline` (`683`) = save lock.

Rules now enforced:
- Click stage: only `pending` changes (`2090`).
- Save success: one committed write (`2364`) + clear pending (`2365`).
- While saving: server sync cannot overwrite committed (`1151-1165`).

### 2) Default/sync guard during save + optimistic stale protection

- Added helper: `resolveCommittedPipelineFromServer` (`selectionGuards.ts:142-171`).
- Added pending overlay map per client to mask stale server responses until convergence (`2360-2363`, consumed at `1139-1147` and `1827-1835`).

### 3) Removed bounce-prone animation state machine

- Removed `confirmedIndex/animIndex/isPipelineAnimating` model.
- Display now derives directly from committed status:
  - `displayIndex = PIPELINE_INDEX_BY_STATUS[committedPipelineStatus]` (`753`).

### 4) Kept multi-user background updates without overriding current save intent

- Refetch/invalidation remains (`2450-2454`) so multi-user updates still arrive.
- Save lock + pending overlay prevent background stale packets from forcing a visual jump during save.

## Phase 4 — Minimal automated verification

Added tests:
- `frontend-next/src/lib/crm/selectionGuards.test.ts`
  - lock while saving blocks stale overwrite.
  - post-save sync remains stable.
- `frontend-next/src/lib/crm/pipelineBounce.rtl.test.tsx` (RTL + jsdom)
  - simulates: click stage (pending only), save with stale refetch in between, asserts committed writes count is exactly `1`.

## Validation commands + output

Run in `frontend-next`:
- `npm run lint` -> **No ESLint warnings or errors**
- `npx tsc --noEmit --pretty false` -> **success (no output)**
- `npm run test` -> **2 files passed, 8 tests passed**
