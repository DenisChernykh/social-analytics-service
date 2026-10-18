import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { RuntimeBindings } from "../../../platform/config/runtime-config";
import type { HttpEnv } from "../../../platform/http/environment";
import { errorResponses, problem } from "../../../platform/http/problem";
import { windowCoverageSchema } from "../../../shared/presentation/measurement";
import type { CollectionCommands, CollectionReads } from "../index";

const id = z.string().min(1).max(150);
const params = z.object({ accountId: id });
const jobParams = z.object({ jobId: z.uuid() });
export const jobSchema = z.object({
  id: z.uuid(),
  accountId: id,
  origin: z.enum([
    "manual",
    "scheduled",
    "stories",
    "comments",
    "comments_refresh",
    "audience",
    "activity",
    "catalogue",
  ]),
  targetMediaId: id.nullable().optional(),
  latencyOrigin: z.literal("recorded_from_creation").nullable().optional(),
  httpAttemptsSinceAt: z.number().nullable().optional(),
  firstAttemptAt: z.number().nullable().optional(),
  lastAttemptAt: z.number().nullable().optional(),
  firstUsefulObservationAt: z.number().nullable().optional(),
  lastUsefulObservationAt: z.number().nullable().optional(),
  httpAttempts: z.number().optional(),
  lastStepDurationMs: z.number().nullable().optional(),
  lastStepHttpAttempts: z.number().nullable().optional(),
  effectiveState: z.string().optional(),
  waitingReason: z.string().nullable().optional(),
  queueWaitMs: z.number().nullable().optional(),
  continuationWaitMs: z.number().nullable().optional(),
  automatic: z.boolean(),
  status: z.enum(["running", "completed", "failed", "cancelled"]),
  cursor: z.string().nullable(),
  pages: z.number().int(),
  collected: z.number().int(),
  mediaProcessed: z.number().int(),
  skippedMedia: z.number().int(),
  skippedPeriods: z.number().int(),
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
  timeZone: z.string(),
  nextCatalogueAt: z.number(),
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

export function createCollectionHttp(
  operations: (env: RuntimeBindings) => CollectionReads,
  commands: (env: RuntimeBindings) => CollectionCommands,
) {
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
    mediaRefresh: z
      .object({
        publications: z.number(),
        missingSnapshots: z.number(),
        staleSnapshots: z.number(),
        ready: z.number(),
        deferred: z.number(),
        retries: z.array(
          z.object({
            errorCode: z.string(),
            count: z.number(),
            nextAttemptAt: z.number().nullable(),
          }),
        ),
      })
      .optional(),
    jobsPage: z
      .object({
        nextCursor: z.string().nullable(),
        hasMore: z.boolean(),
        limit: z.number(),
        cutoff: z.number(),
        total: z.number(),
        calculatedAt: z.number(),
        semantics: z.string(),
        aggregates: z.array(
          z.object({
            origin: z.string(),
            status: z.string(),
            count: z.number(),
            due: z.number(),
            oldestDue: z.number().nullable(),
            atRiskFresh: z.number().optional(),
            freshDue: z.number().optional(),
            lastAttempt: z.number().nullable(),
            lastSuccess: z.number().nullable(),
            lastCheck: z.number().nullable().optional(),
            lastUsefulObservation: z.number().nullable(),
          }),
        ),
      })
      .optional(),
    diagnostics: z
      .object({
        expiredSyncAttempts: z.number(),
        expiredInsightAttempts: z.number(),
        expiredCommentAttempts: z.number(),
        leasesInUse: z.number(),
      })
      .optional(),
    freshness: z
      .array(
        z.object({
          origin: z.string(),
          status: z.string(),
          count: z.number(),
          due: z.number(),
          oldestDue: z.number().nullable(),
          atRiskFresh: z.number().optional(),
          freshDue: z.number().optional(),
          lastAttempt: z.number().nullable(),
          lastSuccess: z.number().nullable(),
          lastCheck: z.number().nullable().optional(),
          lastUsefulObservation: z.number().nullable(),
        }),
      )
      .optional(),
    dataFreshness: z
      .array(
        z.object({
          kind: z.string(),
          objects: z.number(),
          lastAttempt: z.number().nullable(),
          lastCheck: z.number().nullable(),
          lastSuccess: z.number().nullable(),
          lastUsefulObservation: z.number().nullable(),
          legacyProvenanceUnknown: z.number(),
        }),
      )
      .optional(),
    capacity: z
      .object({
        dueJobs: z.number(),
        atRiskFreshJobs: z.number(),
        scope: z.string(),
        maximumHttpAttemptsPerTick: z.number(),
        tickWorkMs: z.number(),
        persistenceReserveMs: z.number(),
        pressureIndicator: z.boolean(),
        overload: z.enum(["not_measured", "estimated_deficit"]),
        capacityDeficit: z.number().optional(),
        availableStepsIn15m: z.number().optional(),
        assumptions: z.string(),
      })
      .optional(),
    comments: z
      .object({
        lastFullPassAt: z.number().nullable(),
        publications: z.number(),
        uniqueComments: z.number(),
        stalePublications: z.number(),
        partialPublications: z.number(),
        pendingReplyBranches: z.number(),
        unverifiedReplyBranches: z.number(),
        unavailablePublications: z.number(),
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
      maximumHttpAttempts: z.number().optional(),
      workBudgetMs: z.number().optional(),
      persistenceReserveMs: z.number().optional(),
      version: z.string().optional(),
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
          omittedProbeLimit: z.number(),
        })
        .optional(),
      cronMinutes: z.number(),
      ageIntervalsHours: z.array(z.number()),
      ageSnapshotWindows: z.array(
        z.object({ targetHours: z.number(), toleranceHours: z.number() }),
      ),
      maximumConsecutiveFailures: z.number(),
    }),
    coverage: z.object({
      analysisCoverage: z.array(windowCoverageSchema).optional(),
      collectionCoverage: z.array(windowCoverageSchema).optional(),
      discovery: z.object({
        measurementState: z.enum(["measured", "not_measured"]).optional(),
        denominator: z.number().optional(),
        measuredPublications: z.number(),
        inferredPublications: z.number(),
        averageLagMinutes: z.number().nullable(),
        maximumLagMinutes: z.number().nullable(),
        overOneHour: z.number(),
      }),
      ageSnapshots: z.array(
        z.object({
          targetHours: z.number(),
          expected: z.number(),
          captured: z.number(),
          open: z.number(),
          missed: z.number(),
        }),
      ),
      catalogue: z.object({
        lastFullPassAt: z.number().nullable(),
        currentJobId: z.string().nullable(),
      }),
      activity: z.object({
        timeZone: z.string(),
        providerWindowDays: z.number(),
        expectedIntervals: z.number(),
        observedIntervals: z.number(),
        missingIntervals: z.number(),
        recheckIntervals: z.number(),
        dailyIntervals: z.number(),
        weeklyIntervals: z.number(),
        monthlyIntervals: z.number(),
        uncollectableIntervals: z.array(
          z.object({
            kind: z.enum(["day", "week", "month"]),
            from: z.number(),
            to: z.number(),
            timeZone: z.string(),
            reason: z.literal("exceeds_interval_limit"),
          }),
        ),
        earliestDayFrom: z.number().nullable(),
        latestDayTo: z.number().nullable(),
      }),
    }),
    api: z.object({
      recordedRequests: z.number(),
      sinceAt: z.number().nullable(),
      usagePercent: z.number().nullable(),
      usageObservedAt: z.number().nullable(),
      blockedUntil: z.number(),
      observedAt: z.number().nullable(),
      cachedUnavailableMetrics: z.number(),
      http: z
        .object({
          attempts: z.number(),
          responses: z.number(),
          failuresBeforeResponse: z.number(),
          timeouts: z.number(),
          rateLimitedResponses: z.number(),
          sinceAt: z.number().nullable(),
        })
        .optional(),
      usageHeaders: z
        .object({
          app: z.object({
            state: z.enum(["absent", "recognized", "unknown_schema", "malformed"]),
            sample: z.string().nullable(),
          }),
          business: z.object({
            state: z.enum(["absent", "recognized", "unknown_schema", "malformed"]),
            sample: z.string().nullable(),
          }),
          receivedAt: z.number().nullable(),
        })
        .optional(),
      quotaFreshness: z.enum(["unknown", "fresh", "stale"]).optional(),
      quotaStaleAfterMs: z.number().optional(),
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
      request: {
        params,
        query: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(20),
          cursor: z.string().max(4096).optional(),
        }),
      },
      responses: responses(statusSchema),
    }),
    async (c) =>
      c.json(
        statusSchema.parse(
          await operations(c.env).status(c.req.valid("param").accountId, c.req.valid("query")),
        ),
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
          await commands(c.env).start(
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
          await commands(c.env).start(
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
              discoveryMinutes: z.number().int().min(60).max(10080).default(60),
              timeZone: z.string().min(1).max(100).optional(),
            })
            .strict(),
        ),
      },
      responses: responses(scheduleSchema),
    }),
    async (c) =>
      c.json(
        scheduleSchema.parse(
          await commands(c.env).configure(c.req.valid("param").accountId, c.req.valid("json")),
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
      c.json(jobSchema.parse(await commands(c.env).advance(c.req.valid("param").jobId)), 200),
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
          await commands(c.env).control(c.req.valid("param").jobId, c.req.valid("json").action),
        ),
        200,
      ),
  );
  return router;
}
