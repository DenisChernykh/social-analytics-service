import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { RuntimeBindings } from "../../../platform/config/runtime-config";
import type { HttpEnv } from "../../../platform/http/environment";
import { errorResponses, problem } from "../../../platform/http/problem";
import {
  maturitySchema,
  measurementProvenanceSchema,
  receiptReferenceSchema,
} from "../../../shared/presentation/measurement";
import type { AccountInsights } from "../application/insights";
import { activityMetrics, supportsActivityMetric } from "../domain/model";

const id = z.string().min(1).max(150);
const date = z.iso.datetime({ offset: true }).transform(Date.parse);
const timeZone = z.string().min(1).max(100).default("UTC");
const metricType = z.enum(["total_value", "time_series"]).default("total_value");
const timeframe = z.enum([
  "last_14_days",
  "last_30_days",
  "last_90_days",
  "this_month",
  "prev_month",
  "this_week",
]);
const collectionTimeframe = z.enum(["this_month", "this_week"]).default("this_month");
const dimension = z.enum(["age", "gender", "country", "city"]);
const activityBreakdown = z
  .enum(["media_product_type", "follow_type", "follower_type", "contact_button_type"])
  .optional();
const inputSchema = z.object({
  kind: z.enum(["activity", "demographics"]),
  from: z.number().optional(),
  to: z.number().optional(),
  timeZone: z.string(),
  metricType: z.enum(["total_value", "time_series"]),
  metrics: z.array(z.string()),
  breakdown: z.string().optional(),
  timeframe: z.string().optional(),
});
const reason = z.string().nullable();
export const insightValueSchema = z.object({
  provenance: measurementProvenanceSchema.optional(),
  receipt: receiptReferenceSchema.optional(),
  unit: z.literal("count"),
  sourceField: z.string(),
  metric: z.string(),
  period: z.string(),
  metricType: z.enum(["total_value", "time_series"]),
  value: z.number().nullable(),
  reason,
  description: z.string().nullable(),
  points: z.array(z.object({ value: z.number().nullable(), endTime: z.number(), reason })),
  breakdowns: z.array(
    z.object({
      dimensions: z.array(z.string()),
      results: z.array(
        z.object({ categories: z.array(z.string()), value: z.number().nullable(), reason }),
      ),
    }),
  ),
});
export const insightCollectionSchema = z.object({
  id: z.uuid(),
  accountId: id,
  input: inputSchema,
  status: z.enum(["running", "completed", "failed"]),
  persistedStatus: z.enum(["running", "completed", "failed"]).optional(),
  effectiveState: z.enum(["running", "completed", "failed", "expired"]).optional(),
  expiredAt: z.number().nullable().optional(),
  periodKey: z.string().optional(),
  definitionVersion: z.string().optional(),
  coverageState: z.enum(["complete", "partial", "empty"]).optional(),
  requestBounds: z
    .object({
      from: z.number(),
      to: z.number(),
      timeZone: z.string(),
      semantics: z.literal("[from,to)"),
      sourceSince: z.number(),
      sourceUntil: z.number(),
      sourceBoundaryContract: z.string(),
    })
    .optional(),
  requestedAt: z.number(),
  observedAt: z.number().nullable(),
  apiVersion: z.string(),
  provider: z.string(),
  scope: z.enum(["instagram_account_period", "instagram_audience_timeframe"]),
  aggregation: z.enum(["period", "timeframe"]),
  object: z.enum(["account", "audience"]),
  values: z.array(insightValueSchema),
  errorCode: z.string().nullable(),
});
const historySchema = z.object({
  items: z.array(insightCollectionSchema),
  truncated: z.boolean(),
  nextCursor: z.string().nullable(),
  limits: z.array(z.string()),
});
export const activityReportSchema = z.object({
  accountId: id,
  requestedPeriod: z.object({
    from: z.number(),
    to: z.number(),
    timeZone: z.string(),
    semantics: z.string(),
  }),
  current: insightCollectionSchema.nullable(),
  previous: insightCollectionSchema.nullable(),
  comparable: z.boolean(),
  comparisons: z.array(
    z.object({
      metric: z.string(),
      current: z.number().nullable(),
      previous: z.number().nullable(),
      absoluteChange: z.number().nullable(),
      percentChange: z.number().nullable(),
      formula: z.string(),
      reason,
    }),
  ),
  categoryComparisons: z.array(
    z.object({
      metric: z.string(),
      dimensions: z.array(z.string()),
      categories: z.array(z.string()),
      current: z.number().nullable(),
      previous: z.number().nullable(),
      absoluteChange: z.number().nullable(),
      percentChange: z.number().nullable(),
      formula: z.string(),
      reason,
    }),
  ),
  coverage: z.object({
    currentAvailable: z.boolean(),
    previousAvailable: z.boolean(),
    truncated: z.boolean(),
    requestedWindowComplete: z.boolean(),
    maturity: maturitySchema.optional(),
    usefulMetrics: z.number().optional(),
    maturityTimeBasis: z
      .enum(["earliest_useful_response", "legacy_or_collection_timestamp"])
      .optional(),
    requestedMetrics: z.number().optional(),
    observedAt: z.number().nullable(),
  }),
  note: z.string(),
});
const audienceSchema = z.object({
  items: z.array(insightCollectionSchema),
  truncated: z.boolean(),
  nextCursor: z.string().nullable(),
  percentages: z.array(
    z.object({
      collectionId: z.string(),
      audiences: z.array(
        z.object({
          metric: z.string(),
          denominator: z.number().nullable(),
          availableCategories: z.number().int(),
          categories: z.array(
            z.object({
              categories: z.array(z.string()),
              value: z.number().nullable(),
              reason,
              percent: z.number().nullable(),
            }),
          ),
        }),
      ),
    }),
  ),
  comparison: z
    .object({ current: z.string().optional(), previous: z.string().optional(), note: z.string() })
    .nullable(),
  limitations: z.array(z.string()),
});
const body = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});
const responses = <T extends z.ZodType>(schema: T) => ({
  200: {
    description:
      "Official account insights with requested periods, collection time and availability. Reading reports never collects data.",
    content: { "application/json": { schema } },
  },
  ...errorResponses,
});
const params = z.object({ accountId: id });

export function createInsightsHttp(operations: (env: RuntimeBindings) => AccountInsights) {
  const router = new OpenAPIHono<HttpEnv>({
    defaultHook: (result, c) => {
      if (!result.success)
        return problem(c, 400, "VALIDATION_FAILED", "Request parameters are invalid.");
    },
  });
  const security = [{ personalKey: [] }];
  router.openapi(
    createRoute({
      method: "post",
      path: "/api/accounts/{accountId}/insights/collect",
      operationId: "collectAccountInsights",
      tags: ["Account Insights"],
      security,
      request: {
        params,
        body: body(
          z
            .object({
              operationId: z.uuid(),
              from: date,
              to: date,
              timeZone,
              metricType,
              metrics: z.array(z.enum(activityMetrics)).min(1).max(12).optional(),
              breakdown: activityBreakdown,
            })
            .strict()
            .refine(
              (input) =>
                input.from < input.to &&
                (input.metricType !== "time_series" || input.breakdown === undefined) &&
                (input.metrics === undefined ||
                  input.metrics.every((metric) =>
                    supportsActivityMetric(metric, input.metricType, input.breakdown),
                  )),
            ),
        ),
      },
      responses: responses(insightCollectionSchema),
    }),
    async (c) => {
      const { operationId, metrics, ...input } = c.req.valid("json");
      return c.json(
        insightCollectionSchema.parse(
          await operations(c.env).collect(c.req.valid("param").accountId, operationId, {
            ...input,
            metrics:
              metrics ??
              activityMetrics.filter((metric) =>
                supportsActivityMetric(metric, input.metricType, input.breakdown),
              ),
            kind: "activity",
          }),
        ),
        200,
      );
    },
  );
  router.openapi(
    createRoute({
      method: "post",
      path: "/api/accounts/{accountId}/audience/collect",
      operationId: "collectAudienceInsights",
      tags: ["Account Insights"],
      security,
      request: {
        params,
        body: body(
          z
            .object({ operationId: z.uuid(), timeframe: collectionTimeframe, breakdown: dimension })
            .strict(),
        ),
      },
      responses: responses(insightCollectionSchema),
    }),
    async (c) => {
      const { operationId, ...input } = c.req.valid("json");
      return c.json(
        insightCollectionSchema.parse(
          await operations(c.env).collect(c.req.valid("param").accountId, operationId, {
            ...input,
            kind: "demographics",
            timeZone: "UTC",
            metricType: "total_value",
            metrics: ["follower_demographics", "engaged_audience_demographics"],
          }),
        ),
        200,
      );
    },
  );
  router.openapi(
    createRoute({
      method: "get",
      path: "/api/accounts/{accountId}/activity",
      operationId: "getAccountActivity",
      tags: ["Account Insights"],
      security,
      request: {
        params,
        query: z
          .object({
            from: date,
            to: date,
            timeZone,
            metricType,
            breakdown: activityBreakdown,
            compareFrom: date.optional(),
            compareTo: date.optional(),
          })
          .refine(
            (input) =>
              input.from < input.to &&
              ((input.compareFrom === undefined && input.compareTo === undefined) ||
                (input.compareFrom !== undefined &&
                  input.compareTo !== undefined &&
                  input.compareFrom < input.compareTo)),
          ),
      },
      responses: responses(activityReportSchema),
    }),
    async (c) =>
      c.json(
        activityReportSchema.parse(
          await operations(c.env).activity(c.req.valid("param").accountId, c.req.valid("query")),
        ),
        200,
      ),
  );
  router.openapi(
    createRoute({
      method: "get",
      path: "/api/accounts/{accountId}/insights/history",
      operationId: "getAccountInsightHistory",
      tags: ["Account Insights"],
      security,
      request: {
        params,
        query: z.object({
          kind: z.enum(["activity", "demographics"]).default("activity"),
          limit: z.coerce.number().int().min(1).max(100).default(20),
          cursor: z.string().min(1).max(200).optional(),
        }),
      },
      responses: responses(historySchema),
    }),
    async (c) =>
      c.json(
        historySchema.parse(
          await operations(c.env).history(
            c.req.valid("param").accountId,
            c.req.valid("query").kind,
            c.req.valid("query").limit,
            c.req.valid("query").cursor,
          ),
        ),
        200,
      ),
  );
  router.openapi(
    createRoute({
      method: "get",
      path: "/api/accounts/{accountId}/audience",
      operationId: "getAudienceInsights",
      tags: ["Account Insights"],
      security,
      request: {
        params,
        query: z.object({
          timeframe,
          breakdown: dimension,
          limit: z.coerce.number().int().min(1).max(100).default(20),
          cursor: z.string().min(1).max(200).optional(),
        }),
      },
      responses: responses(audienceSchema),
    }),
    async (c) =>
      c.json(
        audienceSchema.parse(
          await operations(c.env).audience(
            c.req.valid("param").accountId,
            c.req.valid("query").timeframe,
            c.req.valid("query").breakdown,
            c.req.valid("query").limit,
            c.req.valid("query").cursor,
          ),
        ),
        200,
      ),
  );
  router.openapi(
    createRoute({
      method: "get",
      path: "/api/insight-collections/{operationId}",
      operationId: "getInsightCollection",
      tags: ["Account Insights"],
      security,
      request: { params: z.object({ operationId: z.uuid() }) },
      responses: responses(insightCollectionSchema),
    }),
    async (c) =>
      c.json(
        insightCollectionSchema.parse(
          await operations(c.env).collection(c.req.valid("param").operationId),
        ),
        200,
      ),
  );
  return router;
}
