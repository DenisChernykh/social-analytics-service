import type { Media, MetricKey, Metrics, Snapshot } from "./model";

export type CalculatedMetric = {
  value: number | null;
  unit: "percent" | "ratio" | "count_per_hour" | "count";
  formula: string;
  inputs: Record<string, number | null>;
  reason:
    | "missing_inputs"
    | "zero_denominator"
    | "no_baseline"
    | "invalid_interval"
    | "counter_decreased"
    | null;
};

function ratio(
  numerator: number | null,
  denominator: number | null,
  formula: string,
  inputs: Record<string, number | null>,
  unit: CalculatedMetric["unit"] = "percent",
): CalculatedMetric {
  const reason =
    numerator === null || denominator === null
      ? "missing_inputs"
      : denominator <= 0
        ? "zero_denominator"
        : null;
  return {
    value: reason
      ? null
      : ((numerator as number) / (denominator as number)) * (unit === "percent" ? 100 : 1),
    unit,
    formula,
    inputs,
    reason,
  };
}

export function calculateMetrics(metrics: Metrics, media: Media) {
  const values = Object.fromEntries(
    Object.entries(metrics).map(([key, metric]) => [key, metric.value]),
  ) as Record<MetricKey, number | null>;
  const interactionInputs = {
    likes: values.likes,
    comments: values.comments,
    saves: values.saves,
    shares: values.shares,
  };
  const components = Object.values(interactionInputs);
  const interactions =
    values.totalInteractions ??
    (components.every((v) => v !== null)
      ? components.reduce<number>((sum, v) => sum + (v as number), 0)
      : null);
  const durationMs = media.durationSeconds === null ? null : media.durationSeconds * 1000;
  return {
    engagementByReach: ratio(interactions, values.reach, "interactions / reach * 100", {
      interactions,
      reach: values.reach,
    }),
    engagementByViews: ratio(interactions, values.views, "interactions / views * 100", {
      interactions,
      views: values.views,
    }),
    saveRate: ratio(values.saves, values.reach, "saves / reach * 100", {
      saves: values.saves,
      reach: values.reach,
    }),
    shareRate: ratio(values.shares, values.reach, "shares / reach * 100", {
      shares: values.shares,
      reach: values.reach,
    }),
    viewsPerReachedAccount: ratio(
      values.views,
      values.reach,
      "views / reach",
      { views: values.views, reach: values.reach },
      "ratio",
    ),
    averageWatchRatio: ratio(
      values.averageWatchTimeMs,
      durationMs,
      "averageWatchTimeMs / durationMs * 100",
      { averageWatchTimeMs: values.averageWatchTimeMs, durationMs },
    ),
  };
}

export function calculateGrowth(
  before: Snapshot | null,
  after: Snapshot | null,
  metric: MetricKey = "views",
) {
  const initial = before?.metrics[metric].value ?? null;
  const latest = after?.metrics[metric].value ?? null;
  const elapsedHours = before && after ? (after.observedAt - before.observedAt) / 3_600_000 : null;
  const change = initial !== null && latest !== null ? latest - initial : null;
  const reason: CalculatedMetric["reason"] =
    !before || !after
      ? "no_baseline"
      : initial === null || latest === null
        ? "missing_inputs"
        : elapsedHours === null || elapsedHours <= 0
          ? "invalid_interval"
          : (change as number) < 0
            ? "counter_decreased"
            : null;
  const inputs = { initial, latest, elapsedHours };
  return {
    metric,
    from: before?.observedAt ?? null,
    to: after?.observedAt ?? null,
    netChange: change,
    gain: {
      value: reason ? null : change,
      unit: "count" as const,
      formula: "latest - initial",
      inputs,
      reason,
    },
    perHour: {
      value: reason ? null : (change as number) / (elapsedHours as number),
      unit: "count_per_hour" as const,
      formula: "(latest - initial) / elapsedHours",
      inputs,
      reason,
    },
    percent: {
      value: reason
        ? null
        : initial === 0
          ? null
          : ((change as number) / (initial as number)) * 100,
      unit: "percent" as const,
      formula: "(latest - initial) / initial * 100",
      inputs,
      reason: (reason ?? (initial === 0 ? "zero_denominator" : null)) as CalculatedMetric["reason"],
    },
  };
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}
