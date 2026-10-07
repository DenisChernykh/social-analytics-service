import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { RuntimeBindings } from "../../../platform/config/runtime-config";
import type { HttpEnv } from "../../../platform/http/environment";
import { errorResponses, problem } from "../../../platform/http/problem";
import type { Collect } from "../application/collect";

const id = z.string().min(1).max(150);
const params = z.object({ accountId: id });
const jobParams = z.object({ jobId: z.uuid() });
export const jobSchema = z.object({
  id: z.uuid(),
  accountId: id,
  origin: z.enum(["manual", "scheduled", "stories", "comments", "comments_refresh", "audience"]),
  targetMediaId: id.nullable().optional(),
  automatic: z.boolean(),
  status: z.enum(["running", "completed", "failed", "cancelled"]),
  cursor: z.string().nullable(),
  pages: z.number().int(),
  collected: z.number().int(),
  mediaProcessed: z.number().int(),
  attempt: z.number().int(),
  failures: z.number().int(),
  nextAttemptAt: z.number(),
  startedAt: z.number(),
  completedAt: z.number().nullable(),
  lastSuccessAt: z.number().nullable(),
  errorCode: z.string().nullable(),
});
export const scheduleSchema = z.object({
  accountId: id,
  enabled: z.boolean(),
  discoveryMinutes: z.number(),
  nextDiscoveryAt: z.number(),
  nextStoriesAt: z.number(),
  nextInsightsAt: z.number(),
  updatedAt: z.number(),
  lastSuccessAt: z.number().nullable(),
  errorCode: z.string().nullable(),
  failures: z.number(),
  retryAt: z.number(),
});
const body = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});
const responses = <T extends z.ZodType>(schema: T) => ({
  200: {
    description:
      "Collection progress and safe status. Automatic collection is disabled until explicitly enabled.",
    content: { "application/json": { schema } },
  },
  ...errorResponses,
});

export function createCollectionHttp(operations: (env: RuntimeBindings) => Collect) {
  const router = new OpenAPIHono<HttpEnv>({
    defaultHook: (result, c) => {
      if (!result.success)
        return problem(c, 400, "VALIDATION_FAILED", "Request parameters are invalid.");
    },
  });
  const security = [{ personalKey: [] }];
  const statusSchema = z.object({
    schedule: scheduleSchema,
    jobs: z.array(jobSchema),
    comments: z
      .object({
        lastFullPassAt: z.number().nullable(),
        publications: z.number(),
        uniqueComments: z.number(),
        stalePublications: z.number(),
        partialPublications: z.number(),
        pendingReplyBranches: z.number(),
        currentPass: z
          .object({
            id: z.string(),
            status: z.string(),
            mediaProcessed: z.number(),
            remainingPublications: z.number(),
            observations: z.number(),
            errorCode: z.string().nullable(),
          })
          .nullable(),
        webhook: z.object({
          subscriptionConfirmedAt: z.number().nullable(),
          lastReceivedAt: z.number().nullable(),
          lastEventAt: z.number().nullable(),
          active: z.boolean(),
        }),
      })
      .optional(),
    policy: z.object({
      runBudget: z.number(),
      pageSize: z.number(),
      storyPageSize: z.number(),
      commentPageSize: z.number(),
      commentPolicy: z
        .object({
          outerPageSize: z.number(),
          replyPageSize: z.number(),
          recentHours: z.number(),
          recentRefreshHours: z.number(),
          monthRefreshHours: z.number(),
          archiveRefreshHours: z.number(),
          fullReconciliationDays: z.number(),
        })
        .optional(),
      cronMinutes: z.number(),
      ageIntervalsHours: z.array(z.number()),
      ageSnapshotWindows: z.array(
        z.object({ targetHours: z.number(), toleranceHours: z.number() }),
      ),
      maximumConsecutiveFailures: z.number(),
    }),
    note: z.string(),
  });
  router.openapi(
    createRoute({
      method: "get",
      path: "/api/accounts/{accountId}/collection",
      operationId: "getCollectionStatus",
      tags: ["Collection"],
      security,
      request: { params },
      responses: responses(statusSchema),
    }),
    async (c) =>
      c.json(
        statusSchema.parse(await operations(c.env).status(c.req.valid("param").accountId)),
        200,
      ),
  );
  router.openapi(
    createRoute({
      method: "post",
      path: "/api/accounts/{accountId}/collection",
      operationId: "startFullCollection",
      tags: ["Collection"],
      security,
      request: {
        params,
        body: body(
          z.object({ operationId: z.uuid(), stories: z.boolean().default(false) }).strict(),
        ),
      },
      responses: responses(jobSchema),
    }),
    async (c) =>
      c.json(
        jobSchema.parse(
          await operations(c.env).start(
            c.req.valid("param").accountId,
            c.req.valid("json").operationId,
            c.req.valid("json").stories ? "stories" : "manual",
          ),
        ),
        200,
      ),
  );
  router.openapi(
    createRoute({
      method: "post",
      path: "/api/accounts/{accountId}/comments/collect",
      operationId: "startAccountCommentsCollection",
      tags: ["Comments"],
      security,
      request: {
        params,
        body: body(z.object({ operationId: z.uuid() }).strict()),
      },
      responses: responses(jobSchema),
    }),
    async (c) =>
      c.json(
        jobSchema.parse(
          await operations(c.env).start(
            c.req.valid("param").accountId,
            c.req.valid("json").operationId,
            "comments",
          ),
        ),
        200,
      ),
  );
  router.openapi(
    createRoute({
      method: "patch",
      path: "/api/accounts/{accountId}/collection/schedule",
      operationId: "configureCollectionSchedule",
      tags: ["Collection"],
      security,
      request: {
        params,
        body: body(
          z
            .object({
              enabled: z.boolean(),
              discoveryMinutes: z.number().int().min(60).max(10080).default(360),
            })
            .strict(),
        ),
      },
      responses: responses(scheduleSchema),
    }),
    async (c) =>
      c.json(
        scheduleSchema.parse(
          await operations(c.env).configure(c.req.valid("param").accountId, c.req.valid("json")),
        ),
        200,
      ),
  );
  router.openapi(
    createRoute({
      method: "get",
      path: "/api/collection-jobs/{jobId}",
      operationId: "getCollectionJob",
      tags: ["Collection"],
      security,
      request: { params: jobParams },
      responses: responses(jobSchema),
    }),
    async (c) =>
      c.json(jobSchema.parse(await operations(c.env).job(c.req.valid("param").jobId)), 200),
  );
  router.openapi(
    createRoute({
      method: "post",
      path: "/api/collection-jobs/{jobId}/advance",
      operationId: "advanceCollection",
      tags: ["Collection"],
      security,
      request: { params: jobParams, body: body(z.object({}).strict()) },
      responses: responses(jobSchema),
    }),
    async (c) =>
      c.json(jobSchema.parse(await operations(c.env).advance(c.req.valid("param").jobId)), 200),
  );
  router.openapi(
    createRoute({
      method: "patch",
      path: "/api/collection-jobs/{jobId}",
      operationId: "controlCollection",
      tags: ["Collection"],
      security,
      request: {
        params: jobParams,
        body: body(z.object({ action: z.enum(["resume", "cancel"]) }).strict()),
      },
      responses: responses(jobSchema),
    }),
    async (c) =>
      c.json(
        jobSchema.parse(
          await operations(c.env).control(c.req.valid("param").jobId, c.req.valid("json").action),
        ),
        200,
      ),
  );
  return router;
}
