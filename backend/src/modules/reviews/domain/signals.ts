export type GrowthPoint = { id: string; observedAt: number; views: number | null };
export function growthIntervals(points: GrowthPoint[]) {
  const sorted = [...points].sort(
    (a, b) => a.observedAt - b.observedAt || a.id.localeCompare(b.id),
  );
  return sorted.slice(1).map((point, index) => {
    const previous = sorted[index] as GrowthPoint;
    const hours = (point.observedAt - previous.observedAt) / 3_600_000;
    const change =
      point.views !== null && previous.views !== null ? point.views - previous.views : null;
    const reason =
      change === null
        ? "missing_inputs"
        : hours <= 0
          ? "invalid_interval"
          : change < 0
            ? "counter_decreased"
            : hours > 168
              ? "collection_gap"
              : null;
    return {
      from: previous.observedAt,
      to: point.observedAt,
      fromSnapshotId: previous.id,
      toSnapshotId: point.id,
      netChange: change,
      perHour: reason === null && change !== null ? change / hours : null,
      reason,
      formula: "(current.views - previous.views) / elapsed_hours",
    };
  });
}
export function resurgence(publishedAt: number, intervals: ReturnType<typeof growthIntervals>) {
  const last = intervals.at(-1);
  const previous = intervals
    .slice(-4, -1)
    .map((item) => item.perHour)
    .filter((value): value is number => value !== null);
  const sorted = [...previous].sort((a, b) => a - b);
  const baseline = sorted.length >= 3 ? (sorted[1] ?? null) : null;
  return {
    detected:
      !!last &&
      last.to - publishedAt >= 30 * 86_400_000 &&
      last.perHour !== null &&
      last.netChange !== null &&
      last.netChange >= 100 &&
      baseline !== null &&
      baseline > 0 &&
      last.perHour >= baseline * 3,
    baselinePerHour: baseline,
    minimumIntervals: 3,
    thresholdRatio: 3,
    minimumGain: 100,
    last: last ?? null,
    note: "Only observed intervals up to seven days with nondecreasing counters. A resurgence is an observation, not evidence of its cause.",
  };
}
