import type { RuntimeBindings } from "../../platform/config/runtime-config";
import { ApplicationError } from "../../shared/application/application-error";
import type { InstagramReader } from "../instagram/public-contracts";
import { AccountInsights } from "./application/insights";
import { D1Insights } from "./infrastructure/d1-insights";
import { createInsightsHttp } from "./presentation/http";

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
      read: async (accountId, input) => {
        const account = await options.account(env, accountId);
        const reader = options.reader(env);
        if ((await reader.profile(accountId)).userId !== account.externalId)
          throw new ApplicationError(
            "INSTAGRAM_AUTH_EXPIRED",
            "Reconnect Instagram; the token belongs to a different account.",
          );
        const results = [];
        for (const metric of [...new Set(input.metrics)])
          results.push(
            await reader.structuredInsights(accountId, account.externalId, {
              metric,
              period: input.kind === "activity" ? "day" : "lifetime",
              metricType: input.metricType,
              since: input.from,
              until: input.to === undefined ? undefined : input.to - 1000,
              breakdown:
                input.breakdown ?? (metric === "follows_and_unfollows" ? "follow_type" : undefined),
              timeframe: input.timeframe,
            }),
          );
        return results.map((result) => ({
          ...result,
          unit: "count" as const,
          sourceField: result.metric,
        }));
      },
    },
    options.clock ?? Date.now,
    env.INSTAGRAM_API_VERSION,
  );
}
export function createInsightModule(options: InsightOptions) {
  return { router: createInsightsHttp((env) => createInsightOperations(env, options)) };
}
export type { InsightCollection, InsightInput } from "./domain/model";
export { activityReportSchema } from "./presentation/http";
