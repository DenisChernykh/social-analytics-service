export const maturityVersion = "account-delay-v1";
export function periodMaturity(to: number, observedAt: number | null, now: number) {
  const periodEnded = to <= now,
    sourceDelayElapsed = to + 48 * 3_600_000 <= now;
  const observedAfterDelay = observedAt !== null && observedAt >= to + 48 * 3_600_000;
  return {
    version: maturityVersion,
    sourceDelayMs: 48 * 3_600_000,
    periodEnded,
    sourceDelayElapsed,
    observedAfterDelay,
    recheckDue: periodEnded && sourceDelayElapsed && !observedAfterDelay,
    matureByPolicy: periodEnded && observedAfterDelay,
    sourceFinal: false as const,
  };
}
