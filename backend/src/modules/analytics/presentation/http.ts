import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { RuntimeBindings } from "../../../platform/config/runtime-config";
import type { HttpEnv } from "../../../platform/http/environment";
import { errorResponses, problem } from "../../../platform/http/problem";
import type { AnalyticsQueries } from "../application/queries";
import type { SyncAccount } from "../application/sync-account";
import {
  accountSchema,
  cursorQuery,
  dateQuery,
  growthSchema,
  idSchema,
  limitQuery,
  mediaSchema,
  reportSchema,
  snapshotSchema,
  syncSchema,
  timestamp,
  validRange,
} from "./schemas";

type Operations = { queries: AnalyticsQueries; sync: SyncAccount };
const secured = [{ personalKey: [] }];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const mediaParams = z.object({ mediaId: idSchema });
const accountParams = z.object({ accountId: idSchema });

export function createAnalyticsHttp(
  createOperations: (env: RuntimeBindings) => Operations,
  catalog: Record<string, { field: string; unit: string; appliesTo: string; definition: string }>,
) {
  const router = new OpenAPIHono<HttpEnv>({
    defaultHook: (result, c) => {
      if (!result.success)
        return problem(c, 400, "VALIDATION_FAILED", "Request parameters are invalid.");
    },
  });
  router.openapi(
    createRoute({
      method: "get",
      path: "/api/accounts",
      operationId: "listSocialAccounts",
      tags: ["Accounts"],
      security: secured,
      responses: {
        200: json(
          z.object({ accounts: z.array(accountSchema) }),
          "Accounts with locally collected data.",
        ),
        ...errorResponses,
      },
    }),
    async (c) => c.json({ accounts: await createOperations(c.env).queries.accounts() }, 200),
  );

  router.openapi(
    createRoute({
      method: "get",
      path: "/api/media",
      operationId: "searchMedia",
      tags: ["Media"],
      security: secured,
      request: {
        query: z
          .object({
            q: z.string().min(1).max(200).optional(),
            accountId: idSchema.optional(),
            productType: z.enum(["REELS", "FEED", "STORY", "UNKNOWN"]).optional(),
            rubric: z.string().min(1).max(100).optional(),
            goal: z.string().min(1).max(100).optional(),
            format: z.string().min(1).max(100).optional(),
            from: dateQuery,
            to: dateQuery,
            cursor: cursorQuery,
            limit: limitQuery,
          })
          .refine(validRange),
      },
      responses: {
        200: json(
          z.object({ items: z.array(mediaSchema), nextCursor: z.string().nullable() }),
          "Search titles, captions and permalinks. Dates filter publication time; all query words must match.",
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { q, ...input } = c.req.valid("query");
      return c.json(await createOperations(c.env).queries.search({ ...input, query: q }), 200);
    },
  );

  router.openapi(
    createRoute({
      method: "get",
      path: "/api/reports/media",
      operationId: "resolveMediaReport",
      tags: ["Reports"],
      security: secured,
      request: {
        query: z.object({
          query: z.string().trim().min(1).max(200),
          accountId: idSchema.optional(),
        }),
      },
      responses: {
        200: json(
          z.object({
            status: z.enum(["matched", "ambiguous", "not_found"]),
            candidates: z.array(mediaSchema),
            moreMatches: z.boolean(),
            report: z.union([reportSchema, z.null()]),
          }),
          "Full report by title or caption. Ambiguous searches return candidates and require a choice.",
        ),
        ...errorResponses,
      },
    }),
    async (c) => c.json(await createOperations(c.env).queries.resolve(c.req.valid("query")), 200),
  );

  router.openapi(
    createRoute({
      method: "get",
      path: "/api/media/{mediaId}",
      operationId: "getMedia",
      tags: ["Media"],
      security: secured,
      request: { params: mediaParams },
      responses: {
        200: json(mediaSchema, "Publication metadata and manually assigned title."),
        ...errorResponses,
      },
    }),
    async (c) =>
      c.json(await createOperations(c.env).queries.media(c.req.valid("param").mediaId), 200),
  );

  router.openapi(
    createRoute({
      method: "patch",
      path: "/api/media/{mediaId}",
      operationId: "updateMediaMetadata",
      tags: ["Media"],
      security: secured,
      request: {
        params: mediaParams,
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z
                .object({
                  title: z.string().trim().min(1).max(200).nullable().optional(),
                  durationSeconds: z.number().finite().positive().max(86400).nullable().optional(),
                })
                .strict()
                .refine((input) => Object.keys(input).length > 0),
            },
          },
        },
      },
      responses: {
        200: json(
          mediaSchema,
          "Save an alias such as «Кино курьер» and optional known duration in seconds. Instagram is not modified.",
        ),
        ...errorResponses,
      },
    }),
    async (c) =>
      c.json(
        await createOperations(c.env).queries.updateMedia(
          c.req.valid("param").mediaId,
          c.req.valid("json"),
        ),
        200,
      ),
  );

  router.openapi(
    createRoute({
      method: "get",
      path: "/api/media/{mediaId}/statistics",
      operationId: "getMediaStatistics",
      tags: ["Reports"],
      security: secured,
      request: { params: mediaParams },
      responses: {
        200: json(
          reportSchema,
          "Latest API metrics, derived formulas, freshness, missing data and growth since the previous snapshot.",
        ),
        ...errorResponses,
      },
    }),
    async (c) =>
      c.json(await createOperations(c.env).queries.report(c.req.valid("param").mediaId), 200),
  );

  router.openapi(
    createRoute({
      method: "get",
      path: "/api/media/{mediaId}/history",
      operationId: "getMediaHistory",
      tags: ["Reports"],
      security: secured,
      request: {
        params: mediaParams,
        query: z
          .object({ from: dateQuery, to: dateQuery, cursor: cursorQuery, limit: limitQuery })
          .refine(validRange),
      },
      responses: {
        200: json(
          z.object({
            items: z.array(snapshotSchema),
            nextCursor: z.string().nullable(),
            growth: growthSchema,
            intervals: z.array(growthSchema),
            coverage: z.object({
              fromSnapshot: timestamp.nullable(),
              toSnapshot: timestamp.nullable(),
              truncated: z.boolean(),
            }),
          }),
          "Collected snapshots in descending order; dates filter observation time, not publication time.",
        ),
        ...errorResponses,
      },
    }),
    async (c) =>
      c.json(
        await createOperations(c.env).queries.history(
          c.req.valid("param").mediaId,
          c.req.valid("query"),
        ),
        200,
      ),
  );

  router.openapi(
    createRoute({
      method: "get",
      path: "/api/media/{mediaId}/benchmark",
      operationId: "benchmarkMedia",
      tags: ["Reports"],
      security: secured,
      request: { params: mediaParams },
      responses: {
        200: json(
          z.object({
            mediaId: idSchema,
            cohort: z.object({
              accountId: idSchema,
              productType: z.string(),
              examined: z.number(),
              snapshots: z.number(),
              truncated: z.boolean(),
            }),
            comparisons: z.record(
              z.string(),
              z.object({
                value: z.number().nullable(),
                median: z.number().nullable(),
                sampleSize: z.number(),
                ratioToMedian: z.number().nullable(),
              }),
            ),
            note: z.string(),
          }),
          "Compare lifetime views, reach, saves and shares with the median of recent media of the same type.",
        ),
        ...errorResponses,
      },
    }),
    async (c) =>
      c.json(await createOperations(c.env).queries.benchmark(c.req.valid("param").mediaId), 200),
  );

  const totalSchema = z.object({
    value: z.number().nullable(),
    knownSum: z.number(),
    available: z.number(),
    mediaCount: z.number(),
  });
  router.openapi(
    createRoute({
      method: "get",
      path: "/api/accounts/{accountId}/summary",
      operationId: "getAccountSummary",
      tags: ["Accounts"],
      security: secured,
      request: {
        params: accountParams,
        query: z
          .object({
            from: dateQuery,
            to: dateQuery,
            productType: z.enum(["REELS", "FEED", "STORY", "UNKNOWN"]).optional(),
            rubric: z.string().min(1).max(100).optional(),
            goal: z.string().min(1).max(100).optional(),
            format: z.string().min(1).max(100).optional(),
          })
          .refine(validRange),
      },
      responses: {
        200: json(
          z.object({
            account: accountSchema,
            cohort: z.object({
              publishedFrom: timestamp.nullable(),
              publishedTo: timestamp.nullable(),
              productType: z.string().nullable(),
              mediaCount: z.number(),
              truncated: z.boolean(),
            }),
            totals: z.object({
              views: totalSchema,
              likes: totalSchema,
              comments: totalSchema,
              saves: totalSchema,
              shares: totalSchema,
            }),
            snapshotRange: z.object({ oldest: timestamp.nullable(), newest: timestamp.nullable() }),
            note: z.string(),
          }),
          "Cumulative statistics of a publication cohort, with coverage for every sum; reach is not added across media.",
        ),
        ...errorResponses,
      },
    }),
    async (c) =>
      c.json(
        await createOperations(c.env).queries.summary(
          c.req.valid("param").accountId,
          c.req.valid("query"),
        ),
        200,
      ),
  );

  router.openapi(
    createRoute({
      method: "get",
      path: "/api/accounts/{accountId}/history",
      operationId: "getAccountHistory",
      tags: ["Accounts"],
      security: secured,
      request: {
        params: accountParams,
        query: z
          .object({
            limit: limitQuery,
            cursor: z.string().min(1).max(4096).optional(),
            from: dateQuery.optional(),
            to: dateQuery.optional(),
          })
          .refine(validRange),
      },
      responses: {
        200: json(
          z.object({
            items: z.array(
              z.object({
                observedAt: timestamp,
                followersCount: z.number().nullable(),
                mediaCount: z.number().nullable(),
              }),
            ),
            nextCursor: z.string().nullable(),
            followerNetChange: z.number().nullable(),
            coverage: z.object({
              totalObservations: z.number().int(),
              fromSnapshot: timestamp.nullable(),
              toSnapshot: timestamp.nullable(),
              truncated: z.boolean(),
            }),
            note: z.string(),
          }),
          "Follower count observations and their net change.",
        ),
        ...errorResponses,
      },
    }),
    async (c) =>
      c.json(
        await createOperations(c.env).queries.accountHistory(
          c.req.valid("param").accountId,
          c.req.valid("query"),
        ),
        200,
      ),
  );

  router.openapi(
    createRoute({
      method: "post",
      path: "/api/accounts/{accountId}/sync",
      operationId: "syncAccountPage",
      tags: ["Collection"],
      security: secured,
      request: {
        params: accountParams,
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z
                .object({
                  operationId: z.uuid(),
                  cursor: z.string().min(1).max(4096).nullable().default(null),
                  pageSize: z.number().int().min(1).max(3).default(3),
                })
                .strict(),
            },
          },
        },
      },
      responses: {
        200: json(
          syncSchema,
          "Collect one page from Meta and persist it atomically. Continue using nextCursor and a new operationId until nextCursor is null. Repeating the same operationId is idempotent.",
        ),
        ...errorResponses,
      },
    }),
    async (c) =>
      c.json(
        syncSchema.parse(
          await createOperations(c.env).sync.execute({
            accountId: c.req.valid("param").accountId,
            ...c.req.valid("json"),
          }),
        ),
        200,
      ),
  );

  router.openapi(
    createRoute({
      method: "get",
      path: "/api/sync-runs/{operationId}",
      operationId: "getSyncRun",
      tags: ["Collection"],
      security: secured,
      request: { params: z.object({ operationId: z.uuid() }) },
      responses: {
        200: json(
          syncSchema,
          "Retrieve the outcome after an interrupted or timed out client request.",
        ),
        ...errorResponses,
      },
    }),
    async (c) =>
      c.json(
        syncSchema.parse(
          await createOperations(c.env).queries.run(c.req.valid("param").operationId),
        ),
        200,
      ),
  );

  router.openapi(
    createRoute({
      method: "get",
      path: "/api/metrics",
      operationId: "getMetricCatalog",
      tags: ["Reports"],
      security: secured,
      responses: {
        200: json(
          z.object({
            source: z.literal("instagram_api"),
            supportedPlatforms: z.array(z.string()),
            metrics: z.record(
              z.string(),
              z.object({
                field: z.string(),
                unit: z.string(),
                appliesTo: z.string(),
                definition: z.string(),
              }),
            ),
            note: z.string(),
          }),
          "Available metric definitions; actual availability depends on media, permissions and Meta.",
        ),
        ...errorResponses,
      },
    }),
    (c) =>
      c.json(
        {
          source: "instagram_api" as const,
          supportedPlatforms: ["instagram"],
          metrics: catalog,
          note: "Missing values are null with a reason. Some metrics are estimated by Meta; no values are invented.",
        },
        200,
      ),
  );
  router.openapi(
    createRoute({
      method: "post",
      path: "/api/media/{mediaId}/refresh",
      operationId: "refreshMedia",
      tags: ["Collection"],
      security: secured,
      request: {
        params: mediaParams,
        body: {
          required: true,
          content: { "application/json": { schema: z.object({ operationId: z.uuid() }).strict() } },
        },
      },
      responses: {
        200: json(
          syncSchema,
          "Refresh the selected publication without traversing the account catalogue. Query sync-runs after an uncertain response.",
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const operations = createOperations(c.env);
      const media = await operations.queries.media(c.req.valid("param").mediaId);
      return c.json(
        syncSchema.parse(
          await operations.sync.execute({
            accountId: media.accountId,
            operationId: c.req.valid("json").operationId,
            cursor: null,
            pageSize: 1,
            kind: "media",
            mediaId: media.id,
          }),
        ),
        200,
      );
    },
  );
  return router;
}
