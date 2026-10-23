export type JobAggregate = {
  origin: string;
  status: string;
  count: number;
  due: number;
  oldestDue: number | null;
  atRiskFresh: number;
  freshDue: number;
  lastAttempt: number | null;
  lastSuccess: number | null;
  lastUsefulObservation: number | null;
};

export type TerminalJobCounter = Pick<
  JobAggregate,
  "origin" | "status" | "count" | "lastAttempt" | "lastSuccess" | "lastUsefulObservation"
> & {
  day: number;
  maxStartedAt: number | null;
  lastCompletedAt: number | null;
  pendingParents: number;
};

export type MediaStatusCounter = {
  lastSuccess?: number | null;
  lastUseful?: number | null;
  legacy?: number;
  latest?: { id: string; at: number; operationId: string | null; deferred: number } | null;
  reachWindows?: Record<string, number | null>;
};

export function maximumTime(a: number | null | undefined, b: number | null | undefined) {
  return a == null ? (b ?? null) : b == null ? a : Math.max(a, b);
}

export function jobAggregates(counters: TerminalJobCounter[], running: JobAggregate[]) {
  const result = new Map<string, JobAggregate>();
  for (const row of counters) {
    if (!row.count) continue;
    const key = `${row.origin}:${row.status}`;
    const previous = result.get(key);
    result.set(key, {
      origin: row.origin,
      status: row.status,
      count: (previous?.count ?? 0) + row.count,
      due: 0,
      oldestDue: null,
      atRiskFresh: 0,
      freshDue: 0,
      lastAttempt: maximumTime(previous?.lastAttempt, row.lastAttempt),
      lastSuccess: maximumTime(previous?.lastSuccess, row.lastSuccess),
      lastUsefulObservation: maximumTime(
        previous?.lastUsefulObservation,
        row.lastUsefulObservation,
      ),
    });
  }
  return [...result.values(), ...running].sort(
    (a, b) => a.origin.localeCompare(b.origin) || a.status.localeCompare(b.status),
  );
}
