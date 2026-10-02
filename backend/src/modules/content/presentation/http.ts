import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { RuntimeBindings } from "../../../platform/config/runtime-config";
import type { HttpEnv } from "../../../platform/http/environment";
import { errorResponses, problem } from "../../../platform/http/problem";
import { mediaSchema, snapshotSchema } from "../../analytics";
import type { Content } from "../application/content";

const id = z.string().min(1).max(150);
const text = z.string().trim().min(1).max(100);
export const contextValuesSchema = z
  .object({
    rubric: text.nullable().optional(),
    series: text.nullable().optional(),
    topics: z.array(text).max(20).optional(),
    tags: z.array(text).max(20).optional(),
    format: text.nullable().optional(),
    hook: text.nullable().optional(),
    callToAction: text.nullable().optional(),
    goal: text.nullable().optional(),
    sponsored: z.boolean().nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
  })
  .strict();
const contextSchema = z.object({
  confirmed: contextValuesSchema,
  proposal: contextValuesSchema,
  confirmedSource: z.literal("manual"),
  proposalSource: z.literal("assistant_suggestion"),
  updatedAt: z.number(),
});
const ratioSchema = z.object({
  value: z.number().nullable(),
  inputs: z.object({ numerator: z.number().nullable(), denominator: z.number().nullable() }),
  formula: z.string(),
  reason: z.string().nullable(),
});
export const recordSchema = z
  .object({
    id: z.uuid(),
    mediaId: id,
    kind: z.enum([
      "production_hours",
      "production_cost",
      "leads",
      "sales",
      "revenue",
      "profit",
      "clicks",
    ]),
    value: z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
    unit: z.enum(["hours", "count", "money"]),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    from: z.number().int(),
    to: z.number().int(),
    source: z.string().trim().min(1).max(1000),
    attribution: z.enum(["production", "tagged_link", "promo_code", "confirmed_manual"]),
    allocation: z.string().trim().min(1).max(1000),
  })
  .strict()
  .refine(
    (row) =>
      (row.value >= 0 || row.kind === "profit") &&
      row.from < row.to &&
      (row.kind === "production_hours"
        ? row.unit === "hours" && row.currency === null && row.attribution === "production"
        : ["production_cost", "revenue", "profit"].includes(row.kind)
          ? row.unit === "money" &&
            row.currency !== null &&
            (row.kind === "production_cost"
              ? row.attribution === "production"
              : row.attribution !== "production")
          : row.unit === "count" &&
            row.currency === null &&
            Number.isInteger(row.value) &&
            row.attribution !== "production"),
  );
const businessSchema = z.object({
  mediaId: id,
  records: z.array(recordSchema.safeExtend({ recordedAt: z.number() })),
  hours: z.number().nullable(),
  leadsPerHour: ratioSchema,
  salesPerHour: ratioSchema,
  currencies: z.array(
    z.object({
      currency: z.string(),
      cost: z.number().nullable(),
      revenue: z.number().nullable(),
      profit: z.number().nullable(),
      revenuePerCost: ratioSchema,
      returnOnCost: ratioSchema,
      profitPerHour: ratioSchema,
    }),
  ),
  limitations: z.array(z.string()),
});
const distribution = {
  sampleSize: z.number(),
  median: z.number().nullable(),
  minimum: z.number().nullable(),
  maximum: z.number().nullable(),
  q25: z.number().nullable(),
  q75: z.number().nullable(),
  enoughData: z.boolean(),
};
const planSchema = z
  .object({
    question: z.string().trim().min(1).max(4000),
    metric: z.enum(["views", "reach", "saves", "shares", "comments", "follows"]),
    ageDays: z.union([z.literal(1), z.literal(7), z.literal(30)]),
    decisionRule: z.string().trim().min(1).max(4000),
    minimumSample: z.number().int().min(5).max(100).default(5),
    variants: z
      .array(z.object({ name: text, mediaIds: z.array(id).max(50) }).strict())
      .min(2)
      .max(5),
    retrospective: z.boolean(),
  })
  .strict()
  .refine(
    (plan) => plan.variants.reduce((sum, variant) => sum + variant.mediaIds.length, 0) <= 100,
  );
const conclusionSchema = z.object({
  verdict: z.enum(["supported", "not_supported", "insufficient_data"]),
  reasoning: z.string().min(1).max(4000),
  nextCheck: z.string().min(1).max(4000),
  recordedAt: z.number(),
  source: z.literal("manual"),
});
const experimentSchema = z.object({
  id: z.uuid(),
  accountId: id,
  createdAt: z.number(),
  plan: planSchema,
  assignments: z.array(z.object({ variant: z.string(), mediaId: id })),
  conclusion: conclusionSchema.nullable(),
});
const rankInputSchema = z.object({
  accountId: id,
  ageDays: z.union([z.literal(1), z.literal(7), z.literal(30)]),
  metric: z.enum(["reach", "saves", "shares", "comments", "follows", "views"]),
  productType: z.string().optional(),
  rubric: z.string().optional(),
  goal: z.string().optional(),
  format: z.string().optional(),
  timeZone: z.string(),
});
const rankItemSchema = z.object({
  media: mediaSchema,
  snapshot: z.union([snapshotSchema, z.null()]),
  absolute: z.number().nullable(),
  rate: ratioSchema,
  actualAgeDays: z.number().nullable(),
  observationAgeSeconds: z.number().nullable(),
  baseline: z.number().nullable(),
  sampleSize: z.number(),
  classification: z.object({
    ratio: z.number().nullable(),
    label: z.string(),
    minimumSample: z.number(),
    highThreshold: z.number(),
    lowThreshold: z.number(),
  }),
});
export const rankSchema = z.object({
  input: rankInputSchema,
  items: z.array(rankItemSchema),
  business: z.array(businessSchema),
  efficiency: z.array(
    ratioSchema.safeExtend({ mediaId: id, metric: z.string(), currency: z.string().nullable() }),
  ),
  groups: z.array(
    z.object({
      productType: z.string().optional(),
      apiVersion: z.string().optional(),
      dimension: z.string().optional(),
      value: z.string().optional(),
      ...distribution,
    }),
  ),
  coverage: z.object({
    examined: z.number(),
    observed: z.number(),
    missing: z.number(),
    truncated: z.boolean(),
    toleranceHours: z.number(),
  }),
  formulaVersion: z.string(),
  note: z.string(),
});
const sequenceSchema = z.object({
  id: z.uuid(),
  accountId: id,
  name: text,
  mediaIds: z.array(id).min(1).max(50),
  source: z.literal("manual"),
  updatedAt: z.number(),
});
const sequenceReportSchema = z.object({
  sequence: sequenceSchema,
  items: z.array(z.object({ media: mediaSchema, snapshot: z.union([snapshotSchema, z.null()]) })),
  coverage: z.object({ available: z.number(), stories: z.number() }),
  note: z.string(),
});
const body = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});
const responses = <T extends z.ZodType>(schema: T) => ({
  200: {
    description:
      "Local owner context and evidence-based content analysis. No publication is modified on the social network.",
    content: { "application/json": { schema } },
  },
  ...errorResponses,
});

export function createContentHttp(operations: (env: RuntimeBindings) => Content) {
  const router = new OpenAPIHono<HttpEnv>({
    defaultHook: (result, c) => {
      if (!result.success)
        return problem(c, 400, "VALIDATION_FAILED", "Request parameters are invalid.");
    },
  });
  const security = [{ personalKey: [] }];
  router.openapi(
    createRoute({
      method: "get",
      path: "/api/media/{mediaId}/context",
      operationId: "getMediaContext",
      tags: ["Content"],
      security,
      request: { params: z.object({ mediaId: id }) },
      responses: responses(z.object({ context: contextSchema.nullable() })),
    }),
    async (c) =>
      c.json({ context: await operations(c.env).context(c.req.valid("param").mediaId) }, 200),
  );
  const contextsSchema = z.object({
    items: z.array(z.object({ mediaId: id, context: contextSchema })),
  });
  router.openapi(
    createRoute({
      method: "patch",
      path: "/api/media/context/batch",
      operationId: "setMediaContext",
      tags: ["Content"],
      security,
      request: {
        body: body(
          z
            .object({
              mediaIds: z.array(id).min(1).max(50),
              source: z.enum(["manual", "assistant_suggestion"]),
              replace: z.boolean().default(false),
              values: contextValuesSchema,
            })
            .strict(),
        ),
      },
      responses: responses(contextsSchema),
    }),
    async (c) => {
      const input = c.req.valid("json");
      return c.json(
        contextsSchema.parse(
          await operations(c.env).setContext(
            input.mediaIds,
            input.values,
            input.source,
            input.replace,
          ),
        ),
        200,
      );
    },
  );
  router.openapi(
    createRoute({
      method: "post",
      path: "/api/accounts/{accountId}/business/import",
      operationId: "importBusinessRecords",
      tags: ["Content"],
      security,
      request: {
        params: z.object({ accountId: id }),
        body: body(z.object({ records: z.array(recordSchema).min(1).max(50) }).strict()),
      },
      responses: responses(
        z.object({ imported: z.number(), source: z.string(), recordedAt: z.number() }),
      ),
    }),
    async (c) =>
      c.json(
        await operations(c.env).importRecords(
          c.req.valid("param").accountId,
          c.req.valid("json").records,
        ),
        200,
      ),
  );
  router.openapi(
    createRoute({
      method: "get",
      path: "/api/media/{mediaId}/business",
      operationId: "getBusinessResults",
      tags: ["Content"],
      security,
      request: { params: z.object({ mediaId: id }) },
      responses: responses(businessSchema),
    }),
    async (c) =>
      c.json(
        businessSchema.parse(await operations(c.env).business(c.req.valid("param").mediaId)),
        200,
      ),
  );
  router.openapi(
    createRoute({
      method: "get",
      path: "/api/accounts/{accountId}/content-analysis",
      operationId: "analyzeContent",
      tags: ["Content"],
      security,
      request: {
        params: z.object({ accountId: id }),
        query: z.object({
          ageDays: z.coerce
            .number()
            .pipe(z.union([z.literal(1), z.literal(7), z.literal(30)]))
            .default(7),
          metric: z
            .enum(["reach", "saves", "shares", "comments", "follows", "views"])
            .default("reach"),
          productType: z.enum(["FEED", "REELS", "STORY"]).optional(),
          rubric: text.optional(),
          goal: text.optional(),
          format: text.optional(),
          timeZone: z.string().min(1).max(100).default("UTC"),
        }),
      },
      responses: responses(rankSchema),
    }),
    async (c) =>
      c.json(
        rankSchema.parse(
          await operations(c.env).rank({
            ...c.req.valid("query"),
            accountId: c.req.valid("param").accountId,
          }),
        ),
        200,
      ),
  );
  router.openapi(
    createRoute({
      method: "post",
      path: "/api/accounts/{accountId}/experiments",
      operationId: "createExperiment",
      tags: ["Experiments"],
      security,
      request: {
        params: z.object({ accountId: id }),
        body: body(z.object({ operationId: z.uuid(), plan: planSchema }).strict()),
      },
      responses: responses(experimentSchema),
    }),
    async (c) =>
      c.json(
        experimentSchema.parse(
          await operations(c.env).createExperiment(
            c.req.valid("param").accountId,
            c.req.valid("json").operationId,
            c.req.valid("json").plan,
          ),
        ),
        200,
      ),
  );
  router.openapi(
    createRoute({
      method: "get",
      path: "/api/accounts/{accountId}/experiments",
      operationId: "listExperiments",
      tags: ["Experiments"],
      security,
      request: { params: z.object({ accountId: id }) },
      responses: responses(z.object({ items: z.array(experimentSchema), limit: z.number() })),
    }),
    async (c) => c.json(await operations(c.env).experiments(c.req.valid("param").accountId), 200),
  );
  const evaluateSchema = z.object({
    experiment: experimentSchema,
    variants: z.array(
      z.object({
        name: z.string(),
        publications: z.array(
          z.object({
            media: mediaSchema,
            snapshot: z.union([snapshotSchema, z.null()]),
            value: z.number().nullable(),
          }),
        ),
        ...distribution,
      }),
    ),
    decisionReady: z.boolean(),
    formulaVersion: z.string(),
    limitations: z.array(z.string()),
  });
  router.openapi(
    createRoute({
      method: "get",
      path: "/api/experiments/{experimentId}",
      operationId: "evaluateExperiment",
      tags: ["Experiments"],
      security,
      request: { params: z.object({ experimentId: z.uuid() }) },
      responses: responses(evaluateSchema),
    }),
    async (c) =>
      c.json(
        evaluateSchema.parse(await operations(c.env).evaluate(c.req.valid("param").experimentId)),
        200,
      ),
  );
  router.openapi(
    createRoute({
      method: "patch",
      path: "/api/experiments/{experimentId}/conclusion",
      operationId: "concludeExperiment",
      tags: ["Experiments"],
      security,
      request: {
        params: z.object({ experimentId: z.uuid() }),
        body: body(conclusionSchema.omit({ recordedAt: true, source: true }).strict()),
      },
      responses: responses(experimentSchema),
    }),
    async (c) =>
      c.json(
        experimentSchema.parse(
          await operations(c.env).conclude(c.req.valid("param").experimentId, {
            ...c.req.valid("json"),
            recordedAt: 0,
            source: "manual",
          }),
        ),
        200,
      ),
  );
  router.openapi(
    createRoute({
      method: "post",
      path: "/api/accounts/{accountId}/story-sequences",
      operationId: "setStorySequence",
      tags: ["Stories"],
      security,
      request: {
        params: z.object({ accountId: id }),
        body: body(
          z
            .object({ operationId: z.uuid(), name: text, mediaIds: z.array(id).min(1).max(50) })
            .strict(),
        ),
      },
      responses: responses(sequenceReportSchema),
    }),
    async (c) => {
      const input = c.req.valid("json");
      return c.json(
        sequenceReportSchema.parse(
          await operations(c.env).setSequence({
            id: input.operationId,
            accountId: c.req.valid("param").accountId,
            name: input.name,
            mediaIds: input.mediaIds,
            source: "manual",
            updatedAt: 0,
          }),
        ),
        200,
      );
    },
  );
  router.openapi(
    createRoute({
      method: "get",
      path: "/api/story-sequences/{sequenceId}",
      operationId: "getStorySequence",
      tags: ["Stories"],
      security,
      request: { params: z.object({ sequenceId: z.uuid() }) },
      responses: responses(sequenceReportSchema),
    }),
    async (c) =>
      c.json(
        sequenceReportSchema.parse(
          await operations(c.env).sequence(c.req.valid("param").sequenceId),
        ),
        200,
      ),
  );
  router.openapi(
    createRoute({
      method: "patch",
      path: "/api/experiments/{experimentId}/publications",
      operationId: "assignExperimentPublications",
      tags: ["Experiments"],
      security,
      request: {
        params: z.object({ experimentId: z.uuid() }),
        body: body(
          z
            .object({
              assignments: z.array(z.object({ variant: text, mediaId: id }).strict()).max(100),
            })
            .strict(),
        ),
      },
      responses: responses(experimentSchema),
    }),
    async (c) =>
      c.json(
        experimentSchema.parse(
          await operations(c.env).assign(
            c.req.valid("param").experimentId,
            c.req.valid("json").assignments,
          ),
        ),
        200,
      ),
  );
  return router;
}
