import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { RuntimeBindings } from "../../../platform/config/runtime-config";
import type { HttpEnv } from "../../../platform/http/environment";
import { errorResponses, problem } from "../../../platform/http/problem";
import type { Review } from "../application/review";

const interval = z.object({
  from: z.number(),
  to: z.number(),
  fromSnapshotId: z.string(),
  toSnapshotId: z.string(),
  netChange: z.number().nullable(),
  perHour: z.number().nullable(),
  reason: z.string().nullable(),
  formula: z.string(),
});
const date = z.iso.datetime({ offset: true }).transform(Date.parse);
export function createReviewHttp(
  operations: (env: RuntimeBindings) => Review,
  activitySchema: z.ZodType,
  summarySchema: z.ZodType,
  accountSchema: z.ZodType,
) {
  const schema = z.object({
    account: accountSchema,
    period: z.object({
      from: z.number(),
      to: z.number(),
      compareFrom: z.number().nullable(),
      compareTo: z.number().nullable(),
      timeZone: z.string(),
      semantics: z.string(),
    }),
    generatedAt: z.number(),
    formulaVersion: z.string(),
    accountActivity: activitySchema,
    publicationLifetime: summarySchema,
    snapshotChanges: z.array(
      z.object({
        mediaId: z.string(),
        permalink: z.url(),
        intervals: z.array(interval),
        truncated: z.boolean(),
        resurgence: z.object({
          detected: z.boolean(),
          baselinePerHour: z.number().nullable(),
          minimumIntervals: z.number(),
          thresholdRatio: z.number(),
          minimumGain: z.number(),
          last: interval.nullable(),
          note: z.string(),
        }),
      }),
    ),
    signals: z.array(
      z.object({
        kind: z.string(),
        mediaId: z.string(),
        permalink: z.url(),
        metric: z.string(),
        value: z.number().nullable(),
        baseline: z.number().nullable(),
        sampleSize: z.number(),
        observedAt: z.number(),
        source: z.string(),
        formula: z.string(),
        cause: z.string(),
      }),
    ),
    nextActions: z.array(
      z.object({
        mediaId: z.string(),
        action: z.string(),
        targetMetric: z.string(),
        ageDays: z.number(),
        decisionRule: z.string(),
        evidence: z.string(),
      }),
    ),
    coverage: z.object({
      ranking: z.object({
        examined: z.number(),
        observed: z.number(),
        missing: z.number(),
        truncated: z.boolean(),
        toleranceHours: z.number(),
      }),
      growthExamined: z.number(),
      growthTruncated: z.boolean(),
      periodIncomplete: z.boolean(),
    }),
    limitations: z.array(z.string()),
  });
  const router = new OpenAPIHono<HttpEnv>({
    defaultHook: (result, c) => {
      if (!result.success)
        return problem(c, 400, "VALIDATION_FAILED", "Request parameters are invalid.");
    },
  });
  router.openapi(
    createRoute({
      method: "get",
      path: "/api/accounts/{accountId}/review",
      operationId: "reviewAccount",
      tags: ["Reviews"],
      security: [{ personalKey: [] }],
      request: {
        params: z.object({ accountId: z.string().min(1).max(150) }),
        query: z
          .object({
            from: date,
            to: date,
            compareFrom: date.optional(),
            compareTo: date.optional(),
            timeZone: z.string().min(1).max(100).default("UTC"),
            rankingMode: z
              .enum(["absolute", "per_100_reach", "per_100_views"])
              .default("absolute")
              .describe(
                "Only absolute is supported for reviews. Relative modes return 409 FEATURE_UNAVAILABLE; use content-analysis for relative saves/shares.",
              ),
            ageDays: z.coerce
              .number()
              .pipe(z.union([z.literal(1), z.literal(7), z.literal(30)]))
              .default(7),
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
      responses: {
        200: {
          description:
            "Evidence-based period review separating account activity, lifetime cohorts and snapshot changes, with safe signals and testable actions.",
          content: { "application/json": { schema } },
        },
        ...errorResponses,
      },
    }),
    async (c) =>
      c.json(
        schema.parse(
          await operations(c.env).execute(c.req.valid("param").accountId, c.req.valid("query")),
        ),
        200,
      ),
  );
  return router;
}
