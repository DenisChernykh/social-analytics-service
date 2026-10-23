import type { RuntimeBindings } from "../../platform/config/runtime-config";
import { ApplicationError } from "../../shared/application/application-error";
import type {
  InsightBatchQuery,
  InstagramReader,
  StructuredInsight,
} from "../instagram/public-contracts";
import { AccountInsights } from "./application/insights";
import { D1Insights } from "./infrastructure/d1-insights";

export type InsightOptions = {
  reader: (env: RuntimeBindings) => InstagramReader;
  account: (env: RuntimeBindings, id: string) => Promise<{ externalId: string }>;
  clock?: () => number;
};
export function createInsightOperations(env: RuntimeBindings, options: InsightOptions) {
  return new AccountInsights(
    new D1Insights(env.DB),
    {
      account: (id) => options.account(env, id),
      read: async (accountId, input, operationId) => {
        const account = await options.account(env, accountId);
        const original = options.reader(env);
        const reader = operationId ? (original.forOperation?.(operationId) ?? original) : original;
        if ((await reader.profile(accountId)).userId !== account.externalId)
          throw new ApplicationError(
            "INSTAGRAM_AUTH_EXPIRED",
            "Reconnect Instagram; the token belongs to a different account.",
          );
        const groups = new Map<string, InsightBatchQuery>();
        for (const metric of [...new Set(input.metrics)]) {
          const breakdown =
            input.breakdown ?? (metric === "follows_and_unfollows" ? "follow_type" : undefined);
          const key = breakdown ?? "";
          const group = groups.get(key) ?? {
            metrics: [],
            period: input.kind === "activity" ? ("day" as const) : ("lifetime" as const),
            metricType: input.metricType,
            since: input.from,
            until: input.to === undefined ? undefined : input.to - 1000,
            breakdown,
            timeframe: input.timeframe,
          };
          group.metrics.push(metric);
          groups.set(key, group);
        }
        const results: StructuredInsight[] = [];
        for (const group of groups.values()) {
          try {
            results.push(
              ...(await reader.structuredInsightsBatch(accountId, account.externalId, group)),
            );
          } catch (error) {
            const useful = results.some(
              (v) =>
                v.value !== null ||
                v.points.some((p) => p.value !== null) ||
                v.breakdowns.some((b) => b.results.some((r) => r.value !== null)),
            );
            if (!(error instanceof ApplicationError) || !useful) throw error;
            const reason =
              error.code === "INSTAGRAM_INVALID_BREAKDOWN"
                ? "invalid_breakdown"
                : error.code === "INSTAGRAM_INVALID_REQUEST"
                  ? "invalid_request"
                  : error.code === "INSTAGRAM_OBJECT_UNAVAILABLE"
                    ? "object_unavailable"
                    : ["INSTAGRAM_AUTH_EXPIRED", "INSTAGRAM_PERMISSION_REQUIRED"].includes(
                          error.code,
                        )
                      ? "permission_required"
                      : error.code === "REQUEST_BUDGET_EXHAUSTED"
                        ? "request_deferred"
                        : "source_error";
            results.push(
              ...group.metrics.map(
                (metric) =>
                  ({
                    metric,
                    period: group.period,
                    metricType: group.metricType,
                    value: null,
                    reason,
                    receipt: error.receipt,
                    points: [],
                    breakdowns: [],
                    description: null,
                  }) as StructuredInsight,
              ),
            );
          }
        }
        const byMetric = new Map(results.map((result) => [result.metric, result]));
        return [...new Set(input.metrics)]
          .map(
            (metric) =>
              byMetric.get(metric) ?? {
                metric,
                metricType: input.metricType,
                period: input.kind === "activity" ? ("day" as const) : ("lifetime" as const),
                value: null,
                reason: "not_returned" as const,
                points: [],
                breakdowns: [],
                description: null,
              },
          )
          .map((result) => ({
            ...result,
            provenance: result.receipt
              ? {
                  ...result.receipt,
                  definitionVersion: "instagram-measurement-v2",
                  surface: "instagram" as const,
                  distribution:
                    input.kind === "activity" &&
                    ["reach", "accounts_engaged", "total_interactions"].includes(result.metric)
                      ? ("includes_paid" as const)
                      : ("unknown" as const),
                }
              : undefined,
            unit: "count" as const,
            sourceField: result.metric,
          }));
      },
    },
    options.clock ?? Date.now,
    env.INSTAGRAM_API_VERSION,
  );
}
export type { InsightCollection, InsightInput } from "./domain/model";
export type { ActivityPeriod, ActivityPeriodPlan } from "./domain/periods";

export function createInsightMaintenance(env: RuntimeBindings) {
  return new D1Insights(env.DB);
}
