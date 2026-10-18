import {
  type ActivityPeriod,
  createInsightOperations,
  type InsightCollection,
} from "../modules/account-insights";
import { createAnalyticsOperations } from "../modules/analytics";
import { collectionExecution, createCollectionOperations } from "../modules/collection";
import { createCommentOperations } from "../modules/community";
import { createContentOperations } from "../modules/content";
import {
  type CommentWebhookPort,
  createInstagramOperations,
  type InstagramModuleOptions,
} from "../modules/instagram";
import type { RuntimeBindings } from "../platform/config/runtime-config";
import { incompleteOperationError } from "../shared/application/application-error";

function usefulPortion(result: InsightCollection, collected: number) {
  const times = result.values
    .filter(
      (v) =>
        v.value !== null ||
        v.points.some((p) => p.value !== null) ||
        v.breakdowns.some((b) => b.results.some((r) => r.value !== null)),
    )
    .map((v) => v.provenance?.responseReceivedAt ?? result.observedAt)
    .filter((time): time is number => typeof time === "number");
  return {
    collected,
    firstUsefulAt: times.length ? Math.min(...times) : null,
    lastUsefulAt: times.length ? Math.max(...times) : null,
  };
}

export function featureOptions(
  instagram: InstagramModuleOptions = {},
  clock?: () => number,
  scopedReader?: (env: RuntimeBindings) => ReturnType<typeof createInstagramOperations>,
) {
  const reader =
    scopedReader ??
    ((env: RuntimeBindings) =>
      createInstagramOperations(env, { ...instagram, clock: clock ?? instagram.clock }));
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
        snapshots: (
          ids: string[],
          ageDays?: number,
          selection?: Parameters<typeof queries.observations>[2],
        ) => queries.observations(ids, ageDays, selection),
        history: (id: string) => queries.savedHistory(id),
      };
    },
  };
  const commentOptions = {
    reader,
    clock,
    media: (env: RuntimeBindings, id: string) => analytics(env).queries.media(id),
  };
  const collectionOptions = {
    clock,
    comments: (env: RuntimeBindings) => {
      const operations = createCommentOperations(env, commentOptions);
      return {
        requestStats: () => operations.requestStats(),
        enabled: async (accountId: string) =>
          (await reader(env).list()).some(
            (connection) =>
              connection.accountId === accountId &&
              connection.scopes.includes("instagram_business_manage_comments"),
          ),
        isRootComment: (mediaId: string, id: string) => operations.isRootComment(mediaId, id),
        rootCommentIds: (mediaId: string, ids: string[]) => operations.rootCommentIds(mediaId, ids),
        savedCollection: (id: string) => operations.savedCollection(id),
        collect: (mediaId: string, input: Parameters<typeof operations.collect>[1]) =>
          operations.collect(mediaId, input),
      };
    },
    analytics: (env: RuntimeBindings) => {
      const collectionReader = reader(env);
      const localInsightOptions = { ...insightsOptions, reader: () => collectionReader };
      const operations = createAnalyticsOperations(env, {
        ...analyticsOptions,
        reader: () => collectionReader,
      });
      return {
        requestStats: () => collectionReader.requestStats(),
        account: (id: string) => operations.queries.account(id),
        audience: async (
          accountId: string,
          operationId: string,
          dimension: "age" | "gender" | "country" | "city",
        ) => {
          const result = await createInsightOperations(env, localInsightOptions).collect(
            accountId,
            operationId,
            {
              kind: "demographics",
              timeframe: "this_month",
              breakdown: dimension,
              timeZone: "UTC",
              metricType: "total_value",
              metrics: ["follower_demographics", "engaged_audience_demographics"],
            },
          );
          if (result.status !== "completed")
            throw incompleteOperationError(result.status, result.errorCode);
          return usefulPortion(
            result,
            result.values.reduce(
              (total, value) =>
                total +
                value.breakdowns.reduce(
                  (sum, group) =>
                    sum + group.results.filter((entry) => entry.value !== null).length,
                  0,
                ),
              0,
            ),
          );
        },
        apiStatus: (id: string) => reader(env).apiStatus(id),
        activityPlan: (accountId: string, timeZone: string, now: number) =>
          createInsightOperations(env, localInsightOptions).automaticPlan(accountId, timeZone, now),
        activity: async (accountId: string, operationId: string, period: ActivityPeriod) => {
          const result = await createInsightOperations(env, localInsightOptions).collect(
            accountId,
            operationId,
            {
              kind: "activity",
              from: period.from,
              to: period.to,
              timeZone: period.timeZone,
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
                "reposts",
              ],
            },
          );
          if (result.status !== "completed")
            throw incompleteOperationError(result.status, result.errorCode);
          return usefulPortion(
            result,
            result.values.filter(
              (v) =>
                v.value !== null ||
                v.points.some((p) => p.value !== null) ||
                v.breakdowns.some((b) => b.results.some((r) => r.value !== null)),
            ).length,
          );
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
            retrySourceFailure: true,
          });
        },
        page: (accountId: string, operationId: string, cursor: string | null, stories: boolean) =>
          operations.sync.execute({
            accountId,
            operationId,
            cursor,
            pageSize: collectionExecution.pageSize,
            kind: stories ? "stories" : "page",
            retrySourceFailure: true,
          }),
      };
    },
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
        history: (id: string) => queries.savedHistory(id),
      };
    },
  };
  const commentWebhookOptions = {
    port: (env: RuntimeBindings) => ({
      connectedAccounts: async () =>
        (await reader(env).list())
          .filter(
            (connection) =>
              connection.scopes.includes("instagram_business_manage_comments") &&
              connection.expiresAt > (clock ?? Date.now)(),
          )
          .map((connection) => connection.accountId),
      receive: (events: Parameters<CommentWebhookPort["receive"]>[0]) =>
        createCollectionOperations(env, collectionOptions).receiveCommentEvents(events),
      subscribed: (accountId: string) =>
        createCollectionOperations(env, collectionOptions).confirmCommentSubscription(accountId),
      subscribe: (accountId: string) => reader(env).subscribeComments(accountId),
    }),
  };
  return {
    analyticsOptions,
    insightsOptions,
    contentOptions,
    collectionOptions,
    commentOptions,
    reviewOptions,
    commentWebhookOptions,
  };
}
export function createCollectionExecutor(
  env: RuntimeBindings,
  instagram: InstagramModuleOptions = {},
  clock?: () => number,
) {
  const reader = createInstagramOperations(env, {
    ...instagram,
    clock: clock ?? instagram.clock,
    requestBudget: {
      maxAttempts: collectionExecution.maximumHttpAttempts,
      attempts: 0,
      deadlineAt: (clock ?? instagram.clock ?? Date.now)() + collectionExecution.workBudgetMs,
      reserveMs: collectionExecution.persistenceReserveMs,
    },
  });
  const options = featureOptions(instagram, clock, () => reader);
  return createCollectionOperations(env, options.collectionOptions);
}
