export const activityMetrics = [
  "views",
  "reach",
  "accounts_engaged",
  "total_interactions",
  "likes",
  "comments",
  "saves",
  "shares",
  "replies",
  "profile_links_taps",
  "follows_and_unfollows",
  "reposts",
] as const;
export type ActivityMetric = (typeof activityMetrics)[number];
export function supportsActivityMetric(
  metric: string,
  metricType: "total_value" | "time_series",
  breakdown?: string,
) {
  if (!activityMetrics.includes(metric as ActivityMetric)) return false;
  if (metricType === "time_series") return metric === "reach" && breakdown === undefined;
  if (breakdown === undefined) return true;
  if (breakdown === "media_product_type")
    return [
      "views",
      "reach",
      "total_interactions",
      "likes",
      "comments",
      "saves",
      "shares",
    ].includes(metric);
  if (breakdown === "follow_type") return ["reach", "follows_and_unfollows"].includes(metric);
  if (breakdown === "follower_type") return metric === "views";
  if (breakdown === "contact_button_type") return metric === "profile_links_taps";
  return false;
}
export type InsightInput = {
  kind: "activity" | "demographics";
  from?: number;
  to?: number;
  timeZone: string;
  metricType: "total_value" | "time_series";
  metrics: string[];
  breakdown?: string;
  timeframe?: string;
};
export type InsightValue = {
  provenance?: import("../../../shared/domain/measurement").MeasurementProvenance;
  receipt?: import("../../../shared/domain/measurement").ReceiptReference;
  unit: "count";
  sourceField: string;
  metric: string;
  period: string;
  metricType: "total_value" | "time_series";
  value: number | null;
  reason:
    | "not_requested"
    | "not_returned"
    | "not_supported"
    | "permission_required"
    | "invalid_value"
    | "invalid_request"
    | "invalid_breakdown"
    | "object_unavailable"
    | "source_error"
    | "request_deferred"
    | "insufficient_audience"
    | null;
  description: string | null;
  points: { value: number | null; endTime: number; reason: string | null }[];
  breakdowns: {
    dimensions: string[];
    results: { categories: string[]; value: number | null; reason: string | null }[];
  }[];
};
export type InsightCollection = {
  periodKey?: string;
  definitionVersion?: string;
  requestBounds?: {
    from: number;
    to: number;
    timeZone: string;
    semantics: "[from,to)";
    sourceSince: number;
    sourceUntil: number;
    sourceBoundaryContract: string;
  };
  coverageState?: "complete" | "partial" | "empty";

  id: string;
  accountId: string;
  input: InsightInput;
  status: "running" | "completed" | "failed";
  requestedAt: number;
  observedAt: number | null;
  apiVersion: string;
  provider: string;
  scope: "instagram_account_period" | "instagram_audience_timeframe";
  aggregation: "period" | "timeframe";
  object: "account" | "audience";
  values: InsightValue[];
  errorCode: string | null;
};
export function compareValues(current: number | null, previous: number | null) {
  return {
    current,
    previous,
    absoluteChange: current !== null && previous !== null ? current - previous : null,
    percentChange:
      current !== null && previous !== null && previous !== 0
        ? ((current - previous) / previous) * 100
        : null,
    formula: "(current - previous) / previous * 100",
    reason:
      current === null || previous === null
        ? "missing_inputs"
        : previous === 0
          ? "zero_denominator"
          : null,
  };
}

export function compareCategories(
  current: InsightValue[],
  previous: InsightValue[],
  comparable: boolean,
) {
  const entries = (values: InsightValue[]) =>
    values.flatMap((value) =>
      value.breakdowns.flatMap((group) =>
        group.results.map((result) => ({
          metric: value.metric,
          dimensions: group.dimensions,
          categories: result.categories,
          value: result.value,
        })),
      ),
    );
  const before = entries(previous);
  const after = entries(current);
  const key = (entry: ReturnType<typeof entries>[number]) =>
    JSON.stringify([entry.metric, entry.dimensions, entry.categories]);
  const beforeByKey = new Map(before.map((entry) => [key(entry), entry.value]));
  const afterByKey = new Map(after.map((entry) => [key(entry), entry.value]));
  return [...new Map([...after, ...before].map((entry) => [key(entry), entry])).values()].map(
    (entry) => ({
      metric: entry.metric,
      dimensions: entry.dimensions,
      categories: entry.categories,
      ...compareValues(
        afterByKey.get(key(entry)) ?? null,
        comparable ? (beforeByKey.get(key(entry)) ?? null) : null,
      ),
    }),
  );
}
