export const activityMetrics = [
  "views",
  "reach",
  "accounts_engaged",
  "total_interactions",
  "likes",
  "comments",
  "saved",
  "shares",
  "replies",
  "profile_links_taps",
  "follows_and_unfollows",
] as const;
export type ActivityMetric = (typeof activityMetrics)[number];
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
  unit: "count";
  sourceField: string;
  metric: string;
  period: string;
  metricType: "total_value" | "time_series";
  value: number | null;
  reason: "not_returned" | "not_supported" | "permission_required" | "invalid_value" | null;
  description: string | null;
  points: { value: number | null; endTime: number; reason: string | null }[];
  breakdowns: {
    dimensions: string[];
    results: { categories: string[]; value: number | null; reason: string | null }[];
  }[];
};
export type InsightCollection = {
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
