type PerfCounters = {
  gridRenders: number;
  cardRenders: number;
  commitCount: number;
  commitMs: number;
};

const counters: PerfCounters = {
  gridRenders: 0,
  cardRenders: 0,
  commitCount: 0,
  commitMs: 0
};

const isDev = process.env.NODE_ENV !== "production";

export function incPerfCounter(key: keyof PerfCounters) {
  if (!isDev) return;
  counters[key] += 1;
}

export function addCommitDuration(ms: number) {
  if (!isDev) return;
  counters.commitCount += 1;
  counters.commitMs += ms;
}

export function snapshotAndResetPerf() {
  if (!isDev) {
    return {
      gridRenders: 0,
      cardRenders: 0,
      commitCount: 0,
      commitMs: 0
    };
  }
  const snapshot = { ...counters };
  counters.gridRenders = 0;
  counters.cardRenders = 0;
  counters.commitCount = 0;
  counters.commitMs = 0;
  return snapshot;
}
