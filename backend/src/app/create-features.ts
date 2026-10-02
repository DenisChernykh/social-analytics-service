import { createInsightOperations } from "../modules/account-insights";
import { createAnalyticsOperations } from "../modules/analytics";
import { createCollectionOperations } from "../modules/collection";
import { createContentOperations } from "../modules/content";
import { createInstagramOperations, type InstagramModuleOptions } from "../modules/instagram";
import type { RuntimeBindings } from "../platform/config/runtime-config";

export function featureOptions(instagram: InstagramModuleOptions = {}, clock?: () => number) {
  const reader = (env: RuntimeBindings) =>
    createInstagramOperations(env, { ...instagram, clock: clock ?? instagram.clock });
  const analyticsOptions = { reader, clock };
  const analytics = (env: RuntimeBindings) => createAnalyticsOperations(env, analyticsOptions);
  const insightsOptions = {
    reader,
    clock,
    account: (env: RuntimeBindings, id: string) => analytics(env).queries.account(id),
  };
  const contentOptions = {
    clock,
    analytics: (env: RuntimeBindings) => {
      const queries = analytics(env).queries;
      return {
        account: (id: string) => queries.account(id),
        media: (id: string) => queries.media(id),
        selection: (ids: string[]) => queries.mediaSelection(ids),
        search: (filter: Parameters<typeof queries.search>[0]) => queries.search(filter),
        snapshots: (ids: string[], ageDays?: number) => queries.observations(ids, ageDays),
        history: async (id: string) => {
          const result = await queries.history(id, { limit: 100 });
          return { items: result.items, truncated: !!result.nextCursor };
        },
      };
    },
  };
  const collectionOptions = {
    clock,
    analytics: (env: RuntimeBindings) => {
      const operations = analytics(env);
      return {
        account: (id: string) => operations.queries.account(id),
        activity: async (accountId: string, operationId: string, now: number) => {
          const to = Math.floor(now / 86_400_000) * 86_400_000;
          await createInsightOperations(env, insightsOptions).collect(accountId, operationId, {
            kind: "activity",
            from: to - 3 * 86_400_000,
            to,
            timeZone: "UTC",
            metricType: "total_value",
            metrics: [
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
            ],
          });
        },
        refresh: async (id: string, operationId: string) => {
          const media = await operations.queries.media(id);
          return operations.sync.execute({
            accountId: media.accountId,
            operationId,
            cursor: null,
            pageSize: 1,
            kind: "media",
            mediaId: id,
          });
        },
        page: (accountId: string, operationId: string, cursor: string | null, stories: boolean) =>
          operations.sync.execute({
            accountId,
            operationId,
            cursor,
            pageSize: stories ? 5 : 1,
            kind: stories ? "stories" : "page",
          }),
      };
    },
  };
  const commentOptions = {
    reader,
    clock,
    media: (env: RuntimeBindings, id: string) => analytics(env).queries.media(id),
  };
  const reviewOptions = {
    clock,
    evidence: (env: RuntimeBindings) => {
      const queries = analytics(env).queries;
      const insights = createInsightOperations(env, insightsOptions);
      const content = createContentOperations(env, contentOptions);
      return {
        account: (id: string) => queries.account(id),
        activity: (
          id: string,
          input: {
            from: number;
            to: number;
            timeZone: string;
            compareFrom?: number;
            compareTo?: number;
          },
        ) => insights.activity(id, { ...input, metricType: "total_value" }),
        summary: (id: string, input: { from: number; to: number }) =>
          queries.summary(id, { from: input.from, to: input.to - 1 }),
        ranking: (id: string, input: { ageDays: 1 | 7 | 30; timeZone: string }) =>
          content.rank({
            accountId: id,
            ageDays: input.ageDays,
            timeZone: input.timeZone,
            metric: "reach",
          }),
        history: async (id: string) => {
          const result = await queries.history(id, { limit: 100 });
          return { items: result.items, truncated: !!result.nextCursor };
        },
      };
    },
  };
  return {
    analyticsOptions,
    insightsOptions,
    contentOptions,
    collectionOptions,
    commentOptions,
    reviewOptions,
  };
}
export function createScheduledOperations(env: RuntimeBindings) {
  return createCollectionOperations(env, featureOptions().collectionOptions);
}
