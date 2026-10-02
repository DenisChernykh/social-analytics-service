import { z } from "@hono/zod-openapi";
import { metricKeys } from "../domain/model";

export const idSchema = z.string().min(1).max(150);
export const timestamp = z
  .number()
  .int()
  .openapi({ description: "Unix timestamp in milliseconds, UTC." });
export const accountSchema = z
  .object({
    id: idSchema,
    platform: z.string().openapi({
      description: "Platform of this saved account. Only Instagram is currently connected.",
    }),
    externalId: z.string(),
    username: z.string(),
    accountType: z.string(),
    connectedAt: timestamp,
    lastSyncedAt: timestamp.nullable(),
  })
  .openapi("SocialAccount");
export const mediaSchema = z
  .object({
    id: idSchema,
    accountId: idSchema,
    externalId: z.string(),
    caption: z.string(),
    title: z.string().nullable(),
    mediaType: z.enum(["IMAGE", "VIDEO", "CAROUSEL_ALBUM"]),
    productType: z.string(),
    permalink: z.url(),
    publishedAt: timestamp,
    durationSeconds: z.number().nullable(),
    durationSource: z.literal("manual").nullable(),
    context: z
      .object({
        confirmed: z.object({
          rubric: z.string().nullable().optional(),
          series: z.string().nullable().optional(),
          topics: z.array(z.string()).optional(),
          tags: z.array(z.string()).optional(),
          format: z.string().nullable().optional(),
          hook: z.string().nullable().optional(),
          callToAction: z.string().nullable().optional(),
          goal: z.string().nullable().optional(),
          sponsored: z.boolean().nullable().optional(),
          notes: z.string().nullable().optional(),
        }),
        proposal: z.object({
          rubric: z.string().nullable().optional(),
          series: z.string().nullable().optional(),
          topics: z.array(z.string()).optional(),
          tags: z.array(z.string()).optional(),
          format: z.string().nullable().optional(),
          hook: z.string().nullable().optional(),
          callToAction: z.string().nullable().optional(),
          goal: z.string().nullable().optional(),
          sponsored: z.boolean().nullable().optional(),
          notes: z.string().nullable().optional(),
        }),
        confirmedSource: z.literal("manual"),
        proposalSource: z.literal("assistant_suggestion"),
        updatedAt: timestamp,
      })
      .nullable()
      .optional(),
  })
  .openapi("Media");
export const metricSchema = z
  .object({
    value: z.number().nullable(),
    unit: z.enum(["count", "milliseconds", "percent"]),
    sourceField: z.string(),
    reason: z
      .enum([
        "not_returned",
        "not_supported",
        "permission_required",
        "invalid_value",
        "insufficient_audience",
      ])
      .nullable(),
  })
  .openapi("SourceMetric");
export const metricsSchema = z
  .object(
    Object.fromEntries(metricKeys.map((key) => [key, metricSchema])) as Record<
      (typeof metricKeys)[number],
      typeof metricSchema
    >,
  )
  .openapi("MediaMetrics");
export const snapshotSchema = z
  .object({
    id: z.string(),
    mediaId: idSchema,
    observedAt: timestamp,
    apiVersion: z.string(),
    metrics: metricsSchema,
    storyInsights: z
      .object({ replies: metricSchema, navigation: z.record(z.string(), metricSchema) })
      .nullable()
      .optional(),
  })
  .openapi("MediaSnapshot");
export const calculatedSchema = z
  .object({
    value: z.number().nullable(),
    unit: z.enum(["percent", "ratio", "count_per_hour", "count"]),
    formula: z.string(),
    inputs: z.record(z.string(), z.number().nullable()),
    reason: z
      .enum([
        "missing_inputs",
        "zero_denominator",
        "no_baseline",
        "invalid_interval",
        "counter_decreased",
      ])
      .nullable(),
  })
  .openapi("CalculatedMetric");
export const growthSchema = z
  .object({
    metric: z.enum(metricKeys),
    from: timestamp.nullable(),
    to: timestamp.nullable(),
    netChange: z.number().nullable(),
    gain: calculatedSchema,
    perHour: calculatedSchema,
    percent: calculatedSchema,
  })
  .openapi("SnapshotGrowth");
export const reportSchema = z
  .object({
    media: mediaSchema,
    account: accountSchema,
    source: z
      .object({
        provider: z.string(),
        apiVersion: z.string(),
        observedAt: timestamp,
        ageSeconds: z.number(),
        scope: z.string(),
        object: z.literal("media"),
        aggregation: z.literal("lifetime"),
      })
      .nullable(),
    metrics: metricsSchema.nullable(),
    storyInsights: z
      .object({ replies: metricSchema, navigation: z.record(z.string(), metricSchema) })
      .nullable(),
    calculated: z
      .object({
        engagementByReach: calculatedSchema,
        engagementByViews: calculatedSchema,
        saveRate: calculatedSchema,
        shareRate: calculatedSchema,
        viewsPerReachedAccount: calculatedSchema,
        averageWatchRatio: calculatedSchema,
      })
      .nullable(),
    growth: growthSchema,
    completeness: z.object({
      snapshotAvailable: z.boolean(),
      missingMetrics: z.array(z.enum(metricKeys)),
    }),
    limitations: z.array(z.string()),
  })
  .openapi("MediaReport");
export const syncSchema = z
  .object({
    id: z.uuid(),
    accountId: idSchema,
    inputCursor: z.string().nullable(),
    pageSize: z.number().int(),
    status: z.enum(["running", "completed", "failed"]),
    startedAt: timestamp,
    completedAt: timestamp.nullable(),
    nextCursor: z.string().nullable(),
    mediaCount: z.number().int(),
    errorCode: z.string().nullable(),
  })
  .openapi("SyncRun");
export const dateQuery = z.iso
  .datetime({ offset: true })
  .transform((value) => Date.parse(value))
  .optional();
export const cursorQuery = z.string().min(1).max(4096).optional();
export const limitQuery = z.coerce.number().int().min(1).max(100).default(20);
export const rangeQuery = z.object({ from: dateQuery, to: dateQuery });
export function validRange(input: { from?: number; to?: number }) {
  return input.from === undefined || input.to === undefined || input.from <= input.to;
}

const cohortTotalSchema = z.object({
  value: z.number().nullable(),
  knownSum: z.number(),
  available: z.number(),
  mediaCount: z.number(),
});
export const summarySchema = z.object({
  account: accountSchema,
  cohort: z.object({
    publishedFrom: timestamp.nullable(),
    publishedTo: timestamp.nullable(),
    productType: z.string().nullable(),
    mediaCount: z.number(),
    truncated: z.boolean(),
  }),
  totals: z.object({
    views: cohortTotalSchema,
    likes: cohortTotalSchema,
    comments: cohortTotalSchema,
    saves: cohortTotalSchema,
    shares: cohortTotalSchema,
  }),
  snapshotRange: z.object({ oldest: timestamp.nullable(), newest: timestamp.nullable() }),
  note: z.string(),
});
