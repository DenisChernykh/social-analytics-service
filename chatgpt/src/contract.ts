// Generated from contract/openapi.json. Unknown response fields are stripped.
import { z } from "zod";

const SocialAccountSchema = z.object({
  id: z.string().min(1).max(150),
  platform: z.string(),
  externalId: z.string(),
  username: z.string(),
  accountType: z.string(),
  connectedAt: z.number().int(),
  lastSyncedAt: z.number().int().nullable(),
});
const MediaSchema = z.object({
  id: z.string().min(1).max(150),
  accountId: z.string().min(1).max(150),
  externalId: z.string(),
  caption: z.string(),
  title: z.string().nullable(),
  mediaType: z.enum(["IMAGE", "VIDEO", "CAROUSEL_ALBUM"]),
  productType: z.string(),
  permalink: z.string().url(),
  publishedAt: z.number().int(),
  durationSeconds: z.number().nullable(),
  durationSource: z.enum(["manual"]).nullable(),
  firstDiscoveredAt: z.number().int().nullable().optional(),
  discoverySource: z.enum(["collection", "history_inferred"]).nullable().optional(),
  availability: z
    .object({ unavailableUntil: z.number().int(), errorCode: z.string().nullable() })
    .optional(),
  metadata: z
    .object({
      provider: z.enum(["instagram_api"]),
      apiVersion: z.string(),
      observedAt: z.number().int(),
      mediaUrl: z.string().url().nullable(),
      thumbnailUrl: z.string().url().nullable(),
      altText: z.string().nullable(),
      commentsEnabled: z.boolean().nullable(),
      sharedToFeed: z.boolean().nullable(),
      audioType: z.string().nullable(),
      aiGenerated: z.boolean().nullable(),
      children: z
        .array(
          z.object({
            id: z.string(),
            mediaType: z.string(),
            mediaUrl: z.string().url().nullable(),
            thumbnailUrl: z.string().url().nullable(),
            altText: z.string().nullable(),
          }),
        )
        .nullable(),
      childrenComplete: z.boolean().nullable(),
      unsupportedFields: z.array(z.string()),
    })
    .nullable()
    .optional(),
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
        paidDistribution: z.boolean().nullable().optional(),
        brandPartnership: z.boolean().nullable().optional(),
        coauthor: z.boolean().nullable().optional(),
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
        paidDistribution: z.boolean().nullable().optional(),
        brandPartnership: z.boolean().nullable().optional(),
        coauthor: z.boolean().nullable().optional(),
        notes: z.string().nullable().optional(),
      }),
      confirmedSource: z.enum(["manual"]),
      proposalSource: z.enum(["assistant_suggestion"]),
      updatedAt: z.number().int(),
    })
    .nullable()
    .optional(),
});
const SourceMetricSchema = z.object({
  value: z.number().nullable(),
  unit: z.enum(["count", "milliseconds", "percent"]),
  sourceField: z.string(),
  provenance: z
    .object({
      receiptId: z.string(),
      operationId: z.string().nullable(),
      requestStartedAt: z.number(),
      responseReceivedAt: z.number().nullable(),
      requestedApiVersion: z.string(),
      actualApiVersion: z.string().nullable(),
      login: z.enum(["instagram_login"]),
      definitionVersion: z.string(),
      surface: z.enum(["instagram", "facebook", "combined", "unknown"]),
      distribution: z.enum(["organic", "includes_paid", "unknown"]),
    })
    .nullable()
    .optional(),
  reason: z
    .enum([
      "not_requested",
      "not_returned",
      "not_supported",
      "permission_required",
      "invalid_value",
      "invalid_request",
      "invalid_breakdown",
      "object_unavailable",
      "source_error",
      "request_deferred",
      "insufficient_audience",
    ])
    .nullable(),
});
const MediaMetricsSchema = z
  .object({
    views: SourceMetricSchema,
    reach: SourceMetricSchema,
    likes: SourceMetricSchema,
    comments: SourceMetricSchema,
    saves: SourceMetricSchema,
    shares: SourceMetricSchema,
    totalInteractions: SourceMetricSchema,
    totalWatchTimeMs: SourceMetricSchema,
    averageWatchTimeMs: SourceMetricSchema,
    skipRate: SourceMetricSchema,
    reposts: SourceMetricSchema,
    facebookViews: SourceMetricSchema,
    crosspostedViews: SourceMetricSchema,
    follows: SourceMetricSchema,
    profileVisits: SourceMetricSchema,
  })
  .nullable();
const CalculatedMetricSchema = z.object({
  value: z.number().nullable(),
  unit: z.enum(["actions_per_100", "percent", "ratio", "count_per_hour", "count"]),
  formula: z.string(),
  inputs: z.record(z.string(), z.number().nullable()),
  reason: z
    .enum([
      "missing_inputs",
      "zero_denominator",
      "no_baseline",
      "invalid_interval",
      "counter_decreased",
      "incompatible_measurements",
    ])
    .nullable(),
});
const SnapshotGrowthSchema = z.object({
  metric: z.enum([
    "views",
    "reach",
    "likes",
    "comments",
    "saves",
    "shares",
    "totalInteractions",
    "totalWatchTimeMs",
    "averageWatchTimeMs",
    "skipRate",
    "reposts",
    "facebookViews",
    "crosspostedViews",
    "follows",
    "profileVisits",
  ]),
  from: z.number().int().nullable(),
  to: z.number().int().nullable(),
  netChange: z.number().nullable(),
  gain: CalculatedMetricSchema,
  perHour: CalculatedMetricSchema,
  percent: CalculatedMetricSchema,
});
const MediaReportSchema = z.object({
  media: MediaSchema,
  account: SocialAccountSchema,
  source: z
    .object({
      provider: z.string(),
      apiVersion: z.string(),
      observedAt: z.number().int(),
      ageSeconds: z.number(),
      scope: z.string(),
      object: z.enum(["media"]),
      aggregation: z.enum(["lifetime"]),
    })
    .nullable(),
  observation: z
    .object({
      requestStartedAt: z.number(),
      responseReceivedAt: z.number(),
      receiptIds: z.array(z.string()),
      semantics: z.enum(["sequential_requests_lifetime"]),
      definitionVersion: z.string(),
    })
    .nullable()
    .optional(),
  freshness: z
    .record(
      z.string(),
      z.object({
        lastAttempt: z
          .object({
            receiptId: z.string(),
            requestStartedAt: z.number(),
            responseReceivedAt: z.number().nullable(),
            failedAt: z.number().nullable(),
            status: z.string(),
            httpStatus: z.number().nullable(),
            graphCode: z.number().nullable(),
            graphSubcode: z.number().nullable(),
          })
          .nullable(),
        lastKnownGood: z
          .object({
            value: z.number(),
            observedAt: z.number(),
            receiptId: z.string().nullable(),
            definitionVersion: z.string().nullable(),
            sourceField: z.string(),
            unit: z.string(),
          })
          .nullable(),
        currentReason: z.string().nullable(),
      }),
    )
    .optional(),
  interactionComponents: z
    .object({
      native: z.number().nullable(),
      sum: z.number().nullable(),
      formula: z.string(),
      reason: z.string(),
    })
    .nullable()
    .optional(),
  metrics: MediaMetricsSchema,
  profileActivity: z
    .object({ total: SourceMetricSchema, actions: z.record(z.string(), SourceMetricSchema) })
    .nullable()
    .optional(),
  storyInsights: z
    .object({
      replies: SourceMetricSchema,
      navigationTotal: SourceMetricSchema.optional(),
      navigation: z.record(z.string(), SourceMetricSchema),
    })
    .nullable(),
  calculated: z
    .object({
      interactionBasis: z.enum(["native_total_interactions", "derived_component_sum"]).optional(),
      engagementByReach: CalculatedMetricSchema,
      engagementByViews: CalculatedMetricSchema,
      saveRate: CalculatedMetricSchema,
      shareRate: CalculatedMetricSchema,
      viewsPerReachedAccount: CalculatedMetricSchema,
      averageWatchRatio: CalculatedMetricSchema,
    })
    .nullable(),
  growth: SnapshotGrowthSchema,
  completeness: z.object({
    snapshotAvailable: z.boolean(),
    missingMetrics: z.array(
      z.enum([
        "views",
        "reach",
        "likes",
        "comments",
        "saves",
        "shares",
        "totalInteractions",
        "totalWatchTimeMs",
        "averageWatchTimeMs",
        "skipRate",
        "reposts",
        "facebookViews",
        "crosspostedViews",
        "follows",
        "profileVisits",
      ]),
    ),
  }),
  limitations: z.array(z.string()),
});
const MediaSnapshotSchema = z.object({
  id: z.string(),
  mediaId: z.string().min(1).max(150),
  provenance: z
    .object({
      requestStartedAt: z.number(),
      responseReceivedAt: z.number(),
      receiptIds: z.array(z.string()),
      semantics: z.enum(["sequential_requests_lifetime"]),
      definitionVersion: z.string(),
    })
    .nullable()
    .optional(),
  observedAt: z.number().int(),
  apiVersion: z.string(),
  metrics: MediaMetricsSchema,
  profileActivity: z
    .object({ total: SourceMetricSchema, actions: z.record(z.string(), SourceMetricSchema) })
    .nullable()
    .optional(),
  storyInsights: z
    .object({
      replies: SourceMetricSchema,
      navigationTotal: SourceMetricSchema.optional(),
      navigation: z.record(z.string(), SourceMetricSchema),
    })
    .nullable()
    .optional(),
});
const SyncRunSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().min(1).max(150),
  inputCursor: z.string().nullable(),
  pageSize: z.number().int(),
  status: z.enum(["running", "completed", "failed"]),
  persistedStatus: z.enum(["running", "completed", "failed"]).optional(),
  effectiveState: z.enum(["running", "completed", "failed", "expired"]).optional(),
  expiredAt: z.number().int().nullable().optional(),
  startedAt: z.number().int(),
  completedAt: z.number().int().nullable(),
  nextCursor: z.string().nullable(),
  mediaCount: z.number().int(),
  usefulValues: z.number().nullable().optional(),
  coverageState: z.enum(["complete", "partial", "empty"]).nullable().optional(),
  firstUsefulAt: z.number().int().nullable().optional(),
  lastUsefulAt: z.number().int().nullable().optional(),
  errorCode: z.string().nullable(),
});
export const accountsResponse = z.object({ accounts: z.array(SocialAccountSchema) });
export const searchResponse = z.object({
  items: z.array(MediaSchema),
  nextCursor: z.string().nullable(),
});
export const resolveResponse = z.object({
  status: z.enum(["matched", "ambiguous", "not_found"]),
  candidates: z.array(MediaSchema),
  moreMatches: z.boolean(),
  report: z.union([MediaReportSchema, z.null()]),
});
export const mediaResponse = MediaSchema;
export const reportResponse = MediaReportSchema;
export const historyResponse = z.object({
  items: z.array(MediaSnapshotSchema),
  nextCursor: z.string().nullable(),
  growth: SnapshotGrowthSchema,
  intervals: z.array(SnapshotGrowthSchema),
  coverage: z.object({
    fromSnapshot: z.number().int().nullable(),
    toSnapshot: z.number().int().nullable(),
    truncated: z.boolean(),
  }),
});
export const benchmarkResponse = z.object({
  mediaId: z.string().min(1).max(150),
  cohort: z.object({
    accountId: z.string().min(1).max(150),
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
});
export const summaryResponse = z.object({
  account: SocialAccountSchema,
  cohort: z.object({
    publishedFrom: z.number().int().nullable(),
    publishedTo: z.number().int().nullable(),
    productType: z.string().nullable(),
    mediaCount: z.number(),
    truncated: z.boolean(),
  }),
  totals: z.object({
    views: z.object({
      value: z.number().nullable(),
      knownSum: z.number(),
      available: z.number(),
      mediaCount: z.number(),
    }),
    likes: z.object({
      value: z.number().nullable(),
      knownSum: z.number(),
      available: z.number(),
      mediaCount: z.number(),
    }),
    comments: z.object({
      value: z.number().nullable(),
      knownSum: z.number(),
      available: z.number(),
      mediaCount: z.number(),
    }),
    saves: z.object({
      value: z.number().nullable(),
      knownSum: z.number(),
      available: z.number(),
      mediaCount: z.number(),
    }),
    shares: z.object({
      value: z.number().nullable(),
      knownSum: z.number(),
      available: z.number(),
      mediaCount: z.number(),
    }),
  }),
  snapshotRange: z.object({
    oldest: z.number().int().nullable(),
    newest: z.number().int().nullable(),
  }),
  note: z.string(),
});
export const accountHistoryResponse = z.object({
  items: z.array(
    z.object({
      observedAt: z.number().int(),
      followersCount: z.number().nullable(),
      mediaCount: z.number().nullable(),
    }),
  ),
  nextCursor: z.string().nullable(),
  followerNetChange: z.number().nullable(),
  coverage: z.object({
    totalObservations: z.number().int(),
    fromSnapshot: z.number().int().nullable(),
    toSnapshot: z.number().int().nullable(),
    truncated: z.boolean(),
  }),
  note: z.string(),
});
export const syncResponse = SyncRunSchema;
export const metricsResponse = z.object({
  source: z.enum(["instagram_api"]),
  supportedPlatforms: z.array(z.string()),
  metrics: z.record(
    z.string(),
    z.object({
      field: z.string(),
      unit: z.string(),
      appliesTo: z.string(),
      definition: z.string(),
      level: z.string().optional(),
      definitionVersion: z.string().optional(),
      surface: z.string().optional(),
      distribution: z.string().optional(),
      aggregation: z.string().optional(),
      login: z.string().optional(),
      apiApplicability: z.string().optional(),
      denominator: z.string().optional(),
      limitations: z.array(z.string()).optional(),
    }),
  ),
  note: z.string(),
});
export const refreshResponse = SyncRunSchema;
export const collectionStatusResponse = z.object({
  schedule: z.object({
    accountId: z.string().min(1).max(150),
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
  }),
  jobs: z.array(
    z.object({
      id: z.string().uuid(),
      accountId: z.string().min(1).max(150),
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
      targetMediaId: z.string().min(1).max(150).nullable().optional(),
      latencyOrigin: z.enum(["recorded_from_creation"]).nullable().optional(),
      httpAttemptsSinceAt: z.number().nullable().optional(),
      firstAttemptAt: z.number().nullable().optional(),
      lastAttemptAt: z.number().nullable().optional(),
      firstUsefulObservationAt: z.number().nullable().optional(),
      lastUsefulObservationAt: z.number().nullable().optional(),
      httpAttempts: z.number().optional(),
      lastStepDurationMs: z.number().nullable().optional(),
      lastStepHttpAttempts: z.number().nullable().optional(),
      effectiveState: z.string().optional(),
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
    }),
  ),
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
      capacityDeficit: z.number(),
      availableStepsIn15m: z.number(),
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
    ageSnapshotWindows: z.array(z.object({ targetHours: z.number(), toleranceHours: z.number() })),
    maximumConsecutiveFailures: z.number(),
  }),
  coverage: z.object({
    analysisCoverage: z
      .array(
        z.object({
          targetHours: z.number(),
          toleranceHours: z.number(),
          metric: z.string().optional(),
          rankingMode: z.enum(["absolute", "per_100_reach", "per_100_views"]).optional(),
          analysisCoverage: z.object({
            examined: z.number(),
            observed: z.number(),
            missingEligible: z.number(),
            excludedByReason: z.record(z.string(), z.number()),
            open: z.number(),
            closed: z.number(),
          }),
          collectionObligations: z.object({
            expected: z.number(),
            captured: z.number(),
            missed: z.number(),
            open: z.number(),
            policyHistoryUnknown: z.number(),
            excludedByReason: z.record(z.string(), z.number()).optional(),
            minimumOpportunityMs: z.number(),
            note: z.string(),
          }),
        }),
      )
      .optional(),
    collectionCoverage: z
      .array(
        z.object({
          targetHours: z.number(),
          toleranceHours: z.number(),
          metric: z.string().optional(),
          rankingMode: z.enum(["absolute", "per_100_reach", "per_100_views"]).optional(),
          analysisCoverage: z.object({
            examined: z.number(),
            observed: z.number(),
            missingEligible: z.number(),
            excludedByReason: z.record(z.string(), z.number()),
            open: z.number(),
            closed: z.number(),
          }),
          collectionObligations: z.object({
            expected: z.number(),
            captured: z.number(),
            missed: z.number(),
            open: z.number(),
            policyHistoryUnknown: z.number(),
            excludedByReason: z.record(z.string(), z.number()).optional(),
            minimumOpportunityMs: z.number(),
            note: z.string(),
          }),
        }),
      )
      .optional(),
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
          reason: z.enum(["exceeds_interval_limit"]),
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
export const collectionJobResponse = z.object({
  id: z.string().uuid(),
  accountId: z.string().min(1).max(150),
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
  targetMediaId: z.string().min(1).max(150).nullable().optional(),
  latencyOrigin: z.enum(["recorded_from_creation"]).nullable().optional(),
  httpAttemptsSinceAt: z.number().nullable().optional(),
  firstAttemptAt: z.number().nullable().optional(),
  lastAttemptAt: z.number().nullable().optional(),
  firstUsefulObservationAt: z.number().nullable().optional(),
  lastUsefulObservationAt: z.number().nullable().optional(),
  httpAttempts: z.number().optional(),
  lastStepDurationMs: z.number().nullable().optional(),
  lastStepHttpAttempts: z.number().nullable().optional(),
  effectiveState: z.string().optional(),
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
export const scheduleResponse = z.object({
  accountId: z.string().min(1).max(150),
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
export const accountInsightCollectionResponse = z.object({
  id: z.string().uuid(),
  accountId: z.string().min(1).max(150),
  input: z.object({
    kind: z.enum(["activity", "demographics"]),
    from: z.number().optional(),
    to: z.number().optional(),
    timeZone: z.string(),
    metricType: z.enum(["total_value", "time_series"]),
    metrics: z.array(z.string()),
    breakdown: z.string().optional(),
    timeframe: z.string().optional(),
  }),
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
      semantics: z.enum(["[from,to)"]),
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
  values: z.array(
    z.object({
      provenance: z
        .object({
          receiptId: z.string(),
          operationId: z.string().nullable(),
          requestStartedAt: z.number(),
          responseReceivedAt: z.number().nullable(),
          requestedApiVersion: z.string(),
          actualApiVersion: z.string().nullable(),
          login: z.enum(["instagram_login"]),
          definitionVersion: z.string(),
          surface: z.enum(["instagram", "facebook", "combined", "unknown"]),
          distribution: z.enum(["organic", "includes_paid", "unknown"]),
        })
        .optional(),
      receipt: z
        .object({
          receiptId: z.string(),
          operationId: z.string().nullable(),
          requestStartedAt: z.number(),
          responseReceivedAt: z.number().nullable(),
          requestedApiVersion: z.string(),
          actualApiVersion: z.string().nullable(),
          login: z.enum(["instagram_login"]),
        })
        .optional(),
      unit: z.enum(["count"]),
      sourceField: z.string(),
      metric: z.string(),
      period: z.string(),
      metricType: z.enum(["total_value", "time_series"]),
      value: z.number().nullable(),
      reason: z.string().nullable(),
      description: z.string().nullable(),
      points: z.array(
        z.object({
          value: z.number().nullable(),
          endTime: z.number(),
          reason: z.string().nullable(),
        }),
      ),
      breakdowns: z.array(
        z.object({
          dimensions: z.array(z.string()),
          results: z.array(
            z.object({
              categories: z.array(z.string()),
              value: z.number().nullable(),
              reason: z.string().nullable(),
            }),
          ),
        }),
      ),
    }),
  ),
  errorCode: z.string().nullable(),
});
export const activityResponse = z.object({
  accountId: z.string().min(1).max(150),
  requestedPeriod: z.object({
    from: z.number(),
    to: z.number(),
    timeZone: z.string(),
    semantics: z.string(),
  }),
  current: z
    .object({
      id: z.string().uuid(),
      accountId: z.string().min(1).max(150),
      input: z.object({
        kind: z.enum(["activity", "demographics"]),
        from: z.number().optional(),
        to: z.number().optional(),
        timeZone: z.string(),
        metricType: z.enum(["total_value", "time_series"]),
        metrics: z.array(z.string()),
        breakdown: z.string().optional(),
        timeframe: z.string().optional(),
      }),
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
          semantics: z.enum(["[from,to)"]),
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
      values: z.array(
        z.object({
          provenance: z
            .object({
              receiptId: z.string(),
              operationId: z.string().nullable(),
              requestStartedAt: z.number(),
              responseReceivedAt: z.number().nullable(),
              requestedApiVersion: z.string(),
              actualApiVersion: z.string().nullable(),
              login: z.enum(["instagram_login"]),
              definitionVersion: z.string(),
              surface: z.enum(["instagram", "facebook", "combined", "unknown"]),
              distribution: z.enum(["organic", "includes_paid", "unknown"]),
            })
            .optional(),
          receipt: z
            .object({
              receiptId: z.string(),
              operationId: z.string().nullable(),
              requestStartedAt: z.number(),
              responseReceivedAt: z.number().nullable(),
              requestedApiVersion: z.string(),
              actualApiVersion: z.string().nullable(),
              login: z.enum(["instagram_login"]),
            })
            .optional(),
          unit: z.enum(["count"]),
          sourceField: z.string(),
          metric: z.string(),
          period: z.string(),
          metricType: z.enum(["total_value", "time_series"]),
          value: z.number().nullable(),
          reason: z.string().nullable(),
          description: z.string().nullable(),
          points: z.array(
            z.object({
              value: z.number().nullable(),
              endTime: z.number(),
              reason: z.string().nullable(),
            }),
          ),
          breakdowns: z.array(
            z.object({
              dimensions: z.array(z.string()),
              results: z.array(
                z.object({
                  categories: z.array(z.string()),
                  value: z.number().nullable(),
                  reason: z.string().nullable(),
                }),
              ),
            }),
          ),
        }),
      ),
      errorCode: z.string().nullable(),
    })
    .nullable(),
  previous: z
    .object({
      id: z.string().uuid(),
      accountId: z.string().min(1).max(150),
      input: z.object({
        kind: z.enum(["activity", "demographics"]),
        from: z.number().optional(),
        to: z.number().optional(),
        timeZone: z.string(),
        metricType: z.enum(["total_value", "time_series"]),
        metrics: z.array(z.string()),
        breakdown: z.string().optional(),
        timeframe: z.string().optional(),
      }),
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
          semantics: z.enum(["[from,to)"]),
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
      values: z.array(
        z.object({
          provenance: z
            .object({
              receiptId: z.string(),
              operationId: z.string().nullable(),
              requestStartedAt: z.number(),
              responseReceivedAt: z.number().nullable(),
              requestedApiVersion: z.string(),
              actualApiVersion: z.string().nullable(),
              login: z.enum(["instagram_login"]),
              definitionVersion: z.string(),
              surface: z.enum(["instagram", "facebook", "combined", "unknown"]),
              distribution: z.enum(["organic", "includes_paid", "unknown"]),
            })
            .optional(),
          receipt: z
            .object({
              receiptId: z.string(),
              operationId: z.string().nullable(),
              requestStartedAt: z.number(),
              responseReceivedAt: z.number().nullable(),
              requestedApiVersion: z.string(),
              actualApiVersion: z.string().nullable(),
              login: z.enum(["instagram_login"]),
            })
            .optional(),
          unit: z.enum(["count"]),
          sourceField: z.string(),
          metric: z.string(),
          period: z.string(),
          metricType: z.enum(["total_value", "time_series"]),
          value: z.number().nullable(),
          reason: z.string().nullable(),
          description: z.string().nullable(),
          points: z.array(
            z.object({
              value: z.number().nullable(),
              endTime: z.number(),
              reason: z.string().nullable(),
            }),
          ),
          breakdowns: z.array(
            z.object({
              dimensions: z.array(z.string()),
              results: z.array(
                z.object({
                  categories: z.array(z.string()),
                  value: z.number().nullable(),
                  reason: z.string().nullable(),
                }),
              ),
            }),
          ),
        }),
      ),
      errorCode: z.string().nullable(),
    })
    .nullable(),
  comparable: z.boolean(),
  comparisons: z.array(
    z.object({
      metric: z.string(),
      current: z.number().nullable(),
      previous: z.number().nullable(),
      absoluteChange: z.number().nullable(),
      percentChange: z.number().nullable(),
      formula: z.string(),
      reason: z.string().nullable(),
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
      reason: z.string().nullable(),
    }),
  ),
  coverage: z.object({
    currentAvailable: z.boolean(),
    previousAvailable: z.boolean(),
    truncated: z.boolean(),
    requestedWindowComplete: z.boolean(),
    maturity: z
      .object({
        version: z.string(),
        sourceDelayMs: z.number(),
        periodEnded: z.boolean(),
        sourceDelayElapsed: z.boolean(),
        observedAfterDelay: z.boolean(),
        recheckDue: z.boolean(),
        matureByPolicy: z.boolean(),
        sourceFinal: z.literal(false),
      })
      .optional(),
    usefulMetrics: z.number().optional(),
    maturityTimeBasis: z
      .enum(["earliest_useful_response", "legacy_or_collection_timestamp"])
      .optional(),
    requestedMetrics: z.number().optional(),
    observedAt: z.number().nullable(),
  }),
  note: z.string(),
});
export const insightHistoryResponse = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      accountId: z.string().min(1).max(150),
      input: z.object({
        kind: z.enum(["activity", "demographics"]),
        from: z.number().optional(),
        to: z.number().optional(),
        timeZone: z.string(),
        metricType: z.enum(["total_value", "time_series"]),
        metrics: z.array(z.string()),
        breakdown: z.string().optional(),
        timeframe: z.string().optional(),
      }),
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
          semantics: z.enum(["[from,to)"]),
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
      values: z.array(
        z.object({
          provenance: z
            .object({
              receiptId: z.string(),
              operationId: z.string().nullable(),
              requestStartedAt: z.number(),
              responseReceivedAt: z.number().nullable(),
              requestedApiVersion: z.string(),
              actualApiVersion: z.string().nullable(),
              login: z.enum(["instagram_login"]),
              definitionVersion: z.string(),
              surface: z.enum(["instagram", "facebook", "combined", "unknown"]),
              distribution: z.enum(["organic", "includes_paid", "unknown"]),
            })
            .optional(),
          receipt: z
            .object({
              receiptId: z.string(),
              operationId: z.string().nullable(),
              requestStartedAt: z.number(),
              responseReceivedAt: z.number().nullable(),
              requestedApiVersion: z.string(),
              actualApiVersion: z.string().nullable(),
              login: z.enum(["instagram_login"]),
            })
            .optional(),
          unit: z.enum(["count"]),
          sourceField: z.string(),
          metric: z.string(),
          period: z.string(),
          metricType: z.enum(["total_value", "time_series"]),
          value: z.number().nullable(),
          reason: z.string().nullable(),
          description: z.string().nullable(),
          points: z.array(
            z.object({
              value: z.number().nullable(),
              endTime: z.number(),
              reason: z.string().nullable(),
            }),
          ),
          breakdowns: z.array(
            z.object({
              dimensions: z.array(z.string()),
              results: z.array(
                z.object({
                  categories: z.array(z.string()),
                  value: z.number().nullable(),
                  reason: z.string().nullable(),
                }),
              ),
            }),
          ),
        }),
      ),
      errorCode: z.string().nullable(),
    }),
  ),
  truncated: z.boolean(),
  nextCursor: z.string().nullable(),
  limits: z.array(z.string()),
});
export const audienceResponse = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      accountId: z.string().min(1).max(150),
      input: z.object({
        kind: z.enum(["activity", "demographics"]),
        from: z.number().optional(),
        to: z.number().optional(),
        timeZone: z.string(),
        metricType: z.enum(["total_value", "time_series"]),
        metrics: z.array(z.string()),
        breakdown: z.string().optional(),
        timeframe: z.string().optional(),
      }),
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
          semantics: z.enum(["[from,to)"]),
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
      values: z.array(
        z.object({
          provenance: z
            .object({
              receiptId: z.string(),
              operationId: z.string().nullable(),
              requestStartedAt: z.number(),
              responseReceivedAt: z.number().nullable(),
              requestedApiVersion: z.string(),
              actualApiVersion: z.string().nullable(),
              login: z.enum(["instagram_login"]),
              definitionVersion: z.string(),
              surface: z.enum(["instagram", "facebook", "combined", "unknown"]),
              distribution: z.enum(["organic", "includes_paid", "unknown"]),
            })
            .optional(),
          receipt: z
            .object({
              receiptId: z.string(),
              operationId: z.string().nullable(),
              requestStartedAt: z.number(),
              responseReceivedAt: z.number().nullable(),
              requestedApiVersion: z.string(),
              actualApiVersion: z.string().nullable(),
              login: z.enum(["instagram_login"]),
            })
            .optional(),
          unit: z.enum(["count"]),
          sourceField: z.string(),
          metric: z.string(),
          period: z.string(),
          metricType: z.enum(["total_value", "time_series"]),
          value: z.number().nullable(),
          reason: z.string().nullable(),
          description: z.string().nullable(),
          points: z.array(
            z.object({
              value: z.number().nullable(),
              endTime: z.number(),
              reason: z.string().nullable(),
            }),
          ),
          breakdowns: z.array(
            z.object({
              dimensions: z.array(z.string()),
              results: z.array(
                z.object({
                  categories: z.array(z.string()),
                  value: z.number().nullable(),
                  reason: z.string().nullable(),
                }),
              ),
            }),
          ),
        }),
      ),
      errorCode: z.string().nullable(),
    }),
  ),
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
              reason: z.string().nullable(),
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
export const contextResponse = z.object({
  context: z
    .object({
      confirmed: z.object({
        rubric: z.string().min(1).max(100).nullable().optional(),
        series: z.string().min(1).max(100).nullable().optional(),
        topics: z.array(z.string().min(1).max(100)).optional(),
        tags: z.array(z.string().min(1).max(100)).optional(),
        format: z.string().min(1).max(100).nullable().optional(),
        hook: z.string().min(1).max(100).nullable().optional(),
        callToAction: z.string().min(1).max(100).nullable().optional(),
        goal: z.string().min(1).max(100).nullable().optional(),
        sponsored: z.boolean().nullable().optional(),
        paidDistribution: z.boolean().nullable().optional(),
        brandPartnership: z.boolean().nullable().optional(),
        coauthor: z.boolean().nullable().optional(),
        notes: z.string().max(4000).nullable().optional(),
      }),
      proposal: z.object({
        rubric: z.string().min(1).max(100).nullable().optional(),
        series: z.string().min(1).max(100).nullable().optional(),
        topics: z.array(z.string().min(1).max(100)).optional(),
        tags: z.array(z.string().min(1).max(100)).optional(),
        format: z.string().min(1).max(100).nullable().optional(),
        hook: z.string().min(1).max(100).nullable().optional(),
        callToAction: z.string().min(1).max(100).nullable().optional(),
        goal: z.string().min(1).max(100).nullable().optional(),
        sponsored: z.boolean().nullable().optional(),
        paidDistribution: z.boolean().nullable().optional(),
        brandPartnership: z.boolean().nullable().optional(),
        coauthor: z.boolean().nullable().optional(),
        notes: z.string().max(4000).nullable().optional(),
      }),
      confirmedSource: z.enum(["manual"]),
      proposalSource: z.enum(["assistant_suggestion"]),
      updatedAt: z.number(),
    })
    .nullable(),
});
export const contextsResponse = z.object({
  items: z.array(
    z.object({
      mediaId: z.string().min(1).max(150),
      context: z.object({
        confirmed: z.object({
          rubric: z.string().min(1).max(100).nullable().optional(),
          series: z.string().min(1).max(100).nullable().optional(),
          topics: z.array(z.string().min(1).max(100)).optional(),
          tags: z.array(z.string().min(1).max(100)).optional(),
          format: z.string().min(1).max(100).nullable().optional(),
          hook: z.string().min(1).max(100).nullable().optional(),
          callToAction: z.string().min(1).max(100).nullable().optional(),
          goal: z.string().min(1).max(100).nullable().optional(),
          sponsored: z.boolean().nullable().optional(),
          paidDistribution: z.boolean().nullable().optional(),
          brandPartnership: z.boolean().nullable().optional(),
          coauthor: z.boolean().nullable().optional(),
          notes: z.string().max(4000).nullable().optional(),
        }),
        proposal: z.object({
          rubric: z.string().min(1).max(100).nullable().optional(),
          series: z.string().min(1).max(100).nullable().optional(),
          topics: z.array(z.string().min(1).max(100)).optional(),
          tags: z.array(z.string().min(1).max(100)).optional(),
          format: z.string().min(1).max(100).nullable().optional(),
          hook: z.string().min(1).max(100).nullable().optional(),
          callToAction: z.string().min(1).max(100).nullable().optional(),
          goal: z.string().min(1).max(100).nullable().optional(),
          sponsored: z.boolean().nullable().optional(),
          paidDistribution: z.boolean().nullable().optional(),
          brandPartnership: z.boolean().nullable().optional(),
          coauthor: z.boolean().nullable().optional(),
          notes: z.string().max(4000).nullable().optional(),
        }),
        confirmedSource: z.enum(["manual"]),
        proposalSource: z.enum(["assistant_suggestion"]),
        updatedAt: z.number(),
      }),
    }),
  ),
});
export const businessResponse = z.object({
  mediaId: z.string().min(1).max(150),
  records: z.array(
    z.object({
      id: z.string().uuid(),
      mediaId: z.string().min(1).max(150),
      kind: z.enum([
        "production_hours",
        "production_cost",
        "leads",
        "sales",
        "revenue",
        "profit",
        "clicks",
      ]),
      value: z.number().min(-9007199254740991).max(9007199254740991),
      unit: z.enum(["hours", "count", "money"]),
      currency: z.string().nullable(),
      from: z.number().int(),
      to: z.number().int(),
      source: z.string().min(1).max(1000),
      attribution: z.enum(["production", "tagged_link", "promo_code", "confirmed_manual"]),
      allocation: z.string().min(1).max(1000),
      recordedAt: z.number(),
    }),
  ),
  hours: z.number().nullable(),
  leadsPerHour: z.object({
    value: z.number().nullable(),
    inputs: z.object({ numerator: z.number().nullable(), denominator: z.number().nullable() }),
    formula: z.string(),
    reason: z.string().nullable(),
  }),
  salesPerHour: z.object({
    value: z.number().nullable(),
    inputs: z.object({ numerator: z.number().nullable(), denominator: z.number().nullable() }),
    formula: z.string(),
    reason: z.string().nullable(),
  }),
  currencies: z.array(
    z.object({
      currency: z.string(),
      cost: z.number().nullable(),
      revenue: z.number().nullable(),
      profit: z.number().nullable(),
      revenuePerCost: z.object({
        value: z.number().nullable(),
        inputs: z.object({ numerator: z.number().nullable(), denominator: z.number().nullable() }),
        formula: z.string(),
        reason: z.string().nullable(),
      }),
      returnOnCost: z.object({
        value: z.number().nullable(),
        inputs: z.object({ numerator: z.number().nullable(), denominator: z.number().nullable() }),
        formula: z.string(),
        reason: z.string().nullable(),
      }),
      profitPerHour: z.object({
        value: z.number().nullable(),
        inputs: z.object({ numerator: z.number().nullable(), denominator: z.number().nullable() }),
        formula: z.string(),
        reason: z.string().nullable(),
      }),
    }),
  ),
  limitations: z.array(z.string()),
});
export const businessImportResponse = z.object({
  imported: z.number(),
  source: z.string(),
  recordedAt: z.number(),
});
export const contentAnalysisResponse = z.object({
  input: z.object({
    accountId: z.string().min(1).max(150),
    ageDays: z.union([z.literal(1), z.literal(7), z.literal(30)]),
    metric: z.enum(["reach", "saves", "shares", "comments", "follows", "views"]),
    rankingMode: z.enum(["absolute", "per_100_reach", "per_100_views"]).optional(),
    productType: z.string().optional(),
    rubric: z.string().optional(),
    goal: z.string().optional(),
    format: z.string().optional(),
    timeZone: z.string(),
  }),
  items: z.array(
    z.object({
      media: MediaSchema,
      snapshot: z.union([MediaSnapshotSchema, z.null()]),
      absolute: z.number().nullable(),
      rankingValue: z.number().nullable().optional(),
      ranking: z
        .object({
          value: z.number().nullable(),
          reason: z.string().nullable(),
          formula: z.string(),
          mode: z.enum(["absolute", "per_100_reach", "per_100_views"]),
          denominatorMetric: z.string().nullable(),
          numerator: z.number().nullable(),
          denominator: z.number().nullable(),
          unit: z.string(),
        })
        .optional(),
      windowState: z.string().optional(),
      exclusion: z.string().nullable().optional(),
      comparabilityKey: z.string().optional(),
      sampleWarning: z.string().optional(),
      comparisonCriteria: z
        .object({
          productType: z.string(),
          mediaType: z.string(),
          definitionVersion: z.string().nullable(),
          surface: z.string(),
          ageDays: z.number(),
          toleranceHours: z.number(),
          promotion: z.object({
            paidDistribution: z.boolean().nullable(),
            brandPartnership: z.boolean().nullable(),
            coauthor: z.boolean().nullable(),
            legacySponsored: z.boolean().nullable(),
          }),
        })
        .optional(),
      rate: z.object({
        value: z.number().nullable(),
        inputs: z.object({ numerator: z.number().nullable(), denominator: z.number().nullable() }),
        formula: z.string(),
        reason: z.string().nullable(),
      }),
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
    }),
  ),
  business: z.array(
    z.object({
      mediaId: z.string().min(1).max(150),
      records: z.array(
        z.object({
          id: z.string().uuid(),
          mediaId: z.string().min(1).max(150),
          kind: z.enum([
            "production_hours",
            "production_cost",
            "leads",
            "sales",
            "revenue",
            "profit",
            "clicks",
          ]),
          value: z.number().min(-9007199254740991).max(9007199254740991),
          unit: z.enum(["hours", "count", "money"]),
          currency: z.string().nullable(),
          from: z.number().int(),
          to: z.number().int(),
          source: z.string().min(1).max(1000),
          attribution: z.enum(["production", "tagged_link", "promo_code", "confirmed_manual"]),
          allocation: z.string().min(1).max(1000),
          recordedAt: z.number(),
        }),
      ),
      hours: z.number().nullable(),
      leadsPerHour: z.object({
        value: z.number().nullable(),
        inputs: z.object({ numerator: z.number().nullable(), denominator: z.number().nullable() }),
        formula: z.string(),
        reason: z.string().nullable(),
      }),
      salesPerHour: z.object({
        value: z.number().nullable(),
        inputs: z.object({ numerator: z.number().nullable(), denominator: z.number().nullable() }),
        formula: z.string(),
        reason: z.string().nullable(),
      }),
      currencies: z.array(
        z.object({
          currency: z.string(),
          cost: z.number().nullable(),
          revenue: z.number().nullable(),
          profit: z.number().nullable(),
          revenuePerCost: z.object({
            value: z.number().nullable(),
            inputs: z.object({
              numerator: z.number().nullable(),
              denominator: z.number().nullable(),
            }),
            formula: z.string(),
            reason: z.string().nullable(),
          }),
          returnOnCost: z.object({
            value: z.number().nullable(),
            inputs: z.object({
              numerator: z.number().nullable(),
              denominator: z.number().nullable(),
            }),
            formula: z.string(),
            reason: z.string().nullable(),
          }),
          profitPerHour: z.object({
            value: z.number().nullable(),
            inputs: z.object({
              numerator: z.number().nullable(),
              denominator: z.number().nullable(),
            }),
            formula: z.string(),
            reason: z.string().nullable(),
          }),
        }),
      ),
      limitations: z.array(z.string()),
    }),
  ),
  efficiency: z.array(
    z.object({
      value: z.number().nullable(),
      inputs: z.object({ numerator: z.number().nullable(), denominator: z.number().nullable() }),
      formula: z.string(),
      reason: z.string().nullable(),
      mediaId: z.string().min(1).max(150),
      metric: z.string(),
      currency: z.string().nullable(),
    }),
  ),
  groups: z.array(
    z.object({
      productType: z.string().optional(),
      mediaType: z.string().optional(),
      rankingMode: z.enum(["absolute", "per_100_reach", "per_100_views"]).optional(),
      note: z.string().optional(),
      paired: z
        .object({
          n: z.number(),
          medianIndividualPer100: z.number().nullable(),
          excludedPairs: z.number().optional(),
          ratioOfSumsPer100: z.number().nullable(),
          numeratorSum: z.number(),
          denominatorSum: z.number(),
          denominatorMeaning: z.string(),
        })
        .optional(),
      apiVersion: z.string().optional(),
      examined: z.number().optional(),
      mediaIds: z.array(z.string().min(1).max(150)).optional(),
      pairedMediaIds: z.array(z.string().min(1).max(150)).optional(),
      excludedByReason: z.record(z.string(), z.number()).optional(),
      dimension: z.string().optional(),
      value: z.string().optional(),
      sampleSize: z.number(),
      median: z.number().nullable(),
      minimum: z.number().nullable(),
      maximum: z.number().nullable(),
      q25: z.number().nullable(),
      q75: z.number().nullable(),
      enoughData: z.boolean(),
    }),
  ),
  coverage: z.object({
    analysisCoverage: z
      .object({
        examined: z.number(),
        usable: z.number(),
        missingEligible: z.number(),
        excludedByReason: z.record(z.string(), z.number()),
        metric: z.string(),
        rankingMode: z.enum(["absolute", "per_100_reach", "per_100_views"]),
        open: z.number(),
        closed: z.number(),
      })
      .optional(),
    collectionObligations: z.object({ state: z.string(), note: z.string() }).optional(),
    examined: z.number(),
    observed: z.number(),
    missing: z.number(),
    truncated: z.boolean(),
    toleranceHours: z.number(),
  }),
  formulaVersion: z.string(),
  note: z.string(),
});
export const experimentResponse = z.object({
  id: z.string().uuid(),
  accountId: z.string().min(1).max(150),
  createdAt: z.number(),
  plan: z.object({
    question: z.string().min(1).max(4000),
    metric: z.enum(["views", "reach", "saves", "shares", "comments", "follows"]),
    ageDays: z.union([z.literal(1), z.literal(7), z.literal(30)]),
    decisionRule: z.string().min(1).max(4000),
    minimumSample: z.number().int().min(5).max(100).optional(),
    variants: z.array(
      z.object({ name: z.string().min(1).max(100), mediaIds: z.array(z.string().min(1).max(150)) }),
    ),
    retrospective: z.boolean(),
  }),
  assignments: z.array(z.object({ variant: z.string(), mediaId: z.string().min(1).max(150) })),
  conclusion: z
    .object({
      verdict: z.enum(["supported", "not_supported", "insufficient_data"]),
      reasoning: z.string().min(1).max(4000),
      nextCheck: z.string().min(1).max(4000),
      recordedAt: z.number(),
      source: z.enum(["manual"]),
    })
    .nullable(),
});
export const experimentListResponse = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      accountId: z.string().min(1).max(150),
      createdAt: z.number(),
      plan: z.object({
        question: z.string().min(1).max(4000),
        metric: z.enum(["views", "reach", "saves", "shares", "comments", "follows"]),
        ageDays: z.union([z.literal(1), z.literal(7), z.literal(30)]),
        decisionRule: z.string().min(1).max(4000),
        minimumSample: z.number().int().min(5).max(100).optional(),
        variants: z.array(
          z.object({
            name: z.string().min(1).max(100),
            mediaIds: z.array(z.string().min(1).max(150)),
          }),
        ),
        retrospective: z.boolean(),
      }),
      assignments: z.array(z.object({ variant: z.string(), mediaId: z.string().min(1).max(150) })),
      conclusion: z
        .object({
          verdict: z.enum(["supported", "not_supported", "insufficient_data"]),
          reasoning: z.string().min(1).max(4000),
          nextCheck: z.string().min(1).max(4000),
          recordedAt: z.number(),
          source: z.enum(["manual"]),
        })
        .nullable(),
    }),
  ),
  limit: z.number(),
});
export const experimentReportResponse = z.object({
  experiment: z.object({
    id: z.string().uuid(),
    accountId: z.string().min(1).max(150),
    createdAt: z.number(),
    plan: z.object({
      question: z.string().min(1).max(4000),
      metric: z.enum(["views", "reach", "saves", "shares", "comments", "follows"]),
      ageDays: z.union([z.literal(1), z.literal(7), z.literal(30)]),
      decisionRule: z.string().min(1).max(4000),
      minimumSample: z.number().int().min(5).max(100).optional(),
      variants: z.array(
        z.object({
          name: z.string().min(1).max(100),
          mediaIds: z.array(z.string().min(1).max(150)),
        }),
      ),
      retrospective: z.boolean(),
    }),
    assignments: z.array(z.object({ variant: z.string(), mediaId: z.string().min(1).max(150) })),
    conclusion: z
      .object({
        verdict: z.enum(["supported", "not_supported", "insufficient_data"]),
        reasoning: z.string().min(1).max(4000),
        nextCheck: z.string().min(1).max(4000),
        recordedAt: z.number(),
        source: z.enum(["manual"]),
      })
      .nullable(),
  }),
  variants: z.array(
    z.object({
      name: z.string(),
      publications: z.array(
        z.object({
          media: MediaSchema,
          snapshot: z.union([MediaSnapshotSchema, z.null()]),
          value: z.number().nullable(),
        }),
      ),
      sampleSize: z.number(),
      median: z.number().nullable(),
      minimum: z.number().nullable(),
      maximum: z.number().nullable(),
      q25: z.number().nullable(),
      q75: z.number().nullable(),
      enoughData: z.boolean(),
    }),
  ),
  decisionReady: z.boolean(),
  formulaVersion: z.string(),
  limitations: z.array(z.string()),
});
export const storySequenceResponse = z.object({
  sequence: z.object({
    id: z.string().uuid(),
    accountId: z.string().min(1).max(150),
    name: z.string().min(1).max(100),
    mediaIds: z.array(z.string().min(1).max(150)),
    source: z.enum(["manual"]),
    updatedAt: z.number(),
  }),
  items: z.array(
    z.object({ media: MediaSchema, snapshot: z.union([MediaSnapshotSchema, z.null()]) }),
  ),
  coverage: z.object({ available: z.number(), stories: z.number() }),
  note: z.string(),
});
export const commentsResponse = z.object({
  items: z.array(
    z.object({
      id: z.string().min(1).max(150),
      mediaId: z.string().min(1).max(150),
      parentId: z.string().min(1).max(150).nullable(),
      text: z.string(),
      publishedAt: z.number(),
      observedAt: z.number(),
      authorId: z.string().min(1).max(150).nullable().optional(),
      authorUsername: z.string().nullable().optional(),
      likeCount: z.number().nullable().optional(),
      hidden: z.boolean().nullable().optional(),
    }),
  ),
  nextCursor: z.string().nullable(),
  source: z.object({ provider: z.string(), permalink: z.string().url(), object: z.string() }),
  signals: z.object({
    sampleSize: z.number(),
    questions: z.array(
      z.object({
        commentId: z.string().min(1).max(150),
        mediaId: z.string().min(1).max(150),
        text: z.string(),
      }),
    ),
    recurringWords: z.array(
      z.object({
        word: z.string(),
        count: z.number(),
        examples: z.array(z.object({ commentId: z.string().min(1).max(150), text: z.string() })),
      }),
    ),
    method: z.string(),
    untrustedData: z.boolean(),
  }),
  coverage: z.object({
    sampled: z.number(),
    truncated: z.boolean(),
    completeHistory: z.boolean(),
    uniqueSaved: z.number().optional(),
    lastAttemptAt: z.number().nullable().optional(),
    lastCompleteAt: z.number().nullable().optional(),
    nextRefreshAt: z.number().nullable().optional(),
    omittedReplyBranches: z.number().optional(),
    unavailableUntil: z.number().optional(),
    errorCode: z.string().nullable().optional(),
  }),
  limitations: z.array(z.string()),
});
export const commentWebhookSubscriptionResponse = z.object({ subscribed: z.literal(true) });
export const commentCollectionResponse = z.object({
  receipt: z
    .object({
      receiptId: z.string(),
      operationId: z.string().nullable(),
      requestStartedAt: z.number(),
      responseReceivedAt: z.number().nullable(),
      requestedApiVersion: z.string(),
      actualApiVersion: z.string().nullable(),
      login: z.enum(["instagram_login"]),
    })
    .optional(),
  definitionVersion: z.string().optional(),
  id: z.string().uuid(),
  mediaId: z.string().min(1).max(150),
  parentId: z.string().min(1).max(150).nullable(),
  cursor: z.string().nullable(),
  limit: z.number(),
  status: z.enum(["running", "completed", "failed"]),
  persistedStatus: z.enum(["running", "completed", "failed"]).optional(),
  effectiveState: z.enum(["running", "completed", "failed", "expired"]).optional(),
  expiredAt: z.number().nullable().optional(),
  startedAt: z.number(),
  observedAt: z.number().nullable(),
  nextCursor: z.string().nullable(),
  collected: z.number(),
  commentIds: z.array(z.string().min(1).max(150)).optional(),
  errorCode: z.string().nullable(),
  expandedReplies: z.boolean().optional(),
  replyBranches: z
    .array(
      z.object({
        parentId: z.string().min(1).max(150),
        nextCursor: z.string().nullable(),
        status: z.enum(["exhausted", "partial", "omitted"]),
      }),
    )
    .optional(),
});
export const erasedCommentsResponse = z.object({
  erased: z.literal(true),
  mediaId: z.string().min(1).max(150),
});
export const reviewResponse = z.object({
  account: SocialAccountSchema,
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
  accountActivity: z.object({
    accountId: z.string().min(1).max(150),
    requestedPeriod: z.object({
      from: z.number(),
      to: z.number(),
      timeZone: z.string(),
      semantics: z.string(),
    }),
    current: z
      .object({
        id: z.string().uuid(),
        accountId: z.string().min(1).max(150),
        input: z.object({
          kind: z.enum(["activity", "demographics"]),
          from: z.number().optional(),
          to: z.number().optional(),
          timeZone: z.string(),
          metricType: z.enum(["total_value", "time_series"]),
          metrics: z.array(z.string()),
          breakdown: z.string().optional(),
          timeframe: z.string().optional(),
        }),
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
            semantics: z.enum(["[from,to)"]),
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
        values: z.array(
          z.object({
            provenance: z
              .object({
                receiptId: z.string(),
                operationId: z.string().nullable(),
                requestStartedAt: z.number(),
                responseReceivedAt: z.number().nullable(),
                requestedApiVersion: z.string(),
                actualApiVersion: z.string().nullable(),
                login: z.enum(["instagram_login"]),
                definitionVersion: z.string(),
                surface: z.enum(["instagram", "facebook", "combined", "unknown"]),
                distribution: z.enum(["organic", "includes_paid", "unknown"]),
              })
              .optional(),
            receipt: z
              .object({
                receiptId: z.string(),
                operationId: z.string().nullable(),
                requestStartedAt: z.number(),
                responseReceivedAt: z.number().nullable(),
                requestedApiVersion: z.string(),
                actualApiVersion: z.string().nullable(),
                login: z.enum(["instagram_login"]),
              })
              .optional(),
            unit: z.enum(["count"]),
            sourceField: z.string(),
            metric: z.string(),
            period: z.string(),
            metricType: z.enum(["total_value", "time_series"]),
            value: z.number().nullable(),
            reason: z.string().nullable(),
            description: z.string().nullable(),
            points: z.array(
              z.object({
                value: z.number().nullable(),
                endTime: z.number(),
                reason: z.string().nullable(),
              }),
            ),
            breakdowns: z.array(
              z.object({
                dimensions: z.array(z.string()),
                results: z.array(
                  z.object({
                    categories: z.array(z.string()),
                    value: z.number().nullable(),
                    reason: z.string().nullable(),
                  }),
                ),
              }),
            ),
          }),
        ),
        errorCode: z.string().nullable(),
      })
      .nullable(),
    previous: z
      .object({
        id: z.string().uuid(),
        accountId: z.string().min(1).max(150),
        input: z.object({
          kind: z.enum(["activity", "demographics"]),
          from: z.number().optional(),
          to: z.number().optional(),
          timeZone: z.string(),
          metricType: z.enum(["total_value", "time_series"]),
          metrics: z.array(z.string()),
          breakdown: z.string().optional(),
          timeframe: z.string().optional(),
        }),
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
            semantics: z.enum(["[from,to)"]),
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
        values: z.array(
          z.object({
            provenance: z
              .object({
                receiptId: z.string(),
                operationId: z.string().nullable(),
                requestStartedAt: z.number(),
                responseReceivedAt: z.number().nullable(),
                requestedApiVersion: z.string(),
                actualApiVersion: z.string().nullable(),
                login: z.enum(["instagram_login"]),
                definitionVersion: z.string(),
                surface: z.enum(["instagram", "facebook", "combined", "unknown"]),
                distribution: z.enum(["organic", "includes_paid", "unknown"]),
              })
              .optional(),
            receipt: z
              .object({
                receiptId: z.string(),
                operationId: z.string().nullable(),
                requestStartedAt: z.number(),
                responseReceivedAt: z.number().nullable(),
                requestedApiVersion: z.string(),
                actualApiVersion: z.string().nullable(),
                login: z.enum(["instagram_login"]),
              })
              .optional(),
            unit: z.enum(["count"]),
            sourceField: z.string(),
            metric: z.string(),
            period: z.string(),
            metricType: z.enum(["total_value", "time_series"]),
            value: z.number().nullable(),
            reason: z.string().nullable(),
            description: z.string().nullable(),
            points: z.array(
              z.object({
                value: z.number().nullable(),
                endTime: z.number(),
                reason: z.string().nullable(),
              }),
            ),
            breakdowns: z.array(
              z.object({
                dimensions: z.array(z.string()),
                results: z.array(
                  z.object({
                    categories: z.array(z.string()),
                    value: z.number().nullable(),
                    reason: z.string().nullable(),
                  }),
                ),
              }),
            ),
          }),
        ),
        errorCode: z.string().nullable(),
      })
      .nullable(),
    comparable: z.boolean(),
    comparisons: z.array(
      z.object({
        metric: z.string(),
        current: z.number().nullable(),
        previous: z.number().nullable(),
        absoluteChange: z.number().nullable(),
        percentChange: z.number().nullable(),
        formula: z.string(),
        reason: z.string().nullable(),
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
        reason: z.string().nullable(),
      }),
    ),
    coverage: z.object({
      currentAvailable: z.boolean(),
      previousAvailable: z.boolean(),
      truncated: z.boolean(),
      requestedWindowComplete: z.boolean(),
      maturity: z
        .object({
          version: z.string(),
          sourceDelayMs: z.number(),
          periodEnded: z.boolean(),
          sourceDelayElapsed: z.boolean(),
          observedAfterDelay: z.boolean(),
          recheckDue: z.boolean(),
          matureByPolicy: z.boolean(),
          sourceFinal: z.literal(false),
        })
        .optional(),
      usefulMetrics: z.number().optional(),
      maturityTimeBasis: z
        .enum(["earliest_useful_response", "legacy_or_collection_timestamp"])
        .optional(),
      requestedMetrics: z.number().optional(),
      observedAt: z.number().nullable(),
    }),
    note: z.string(),
  }),
  publicationLifetime: z.object({
    account: SocialAccountSchema,
    cohort: z.object({
      publishedFrom: z.number().int().nullable(),
      publishedTo: z.number().int().nullable(),
      productType: z.string().nullable(),
      mediaCount: z.number(),
      truncated: z.boolean(),
    }),
    totals: z.object({
      views: z.object({
        value: z.number().nullable(),
        knownSum: z.number(),
        available: z.number(),
        mediaCount: z.number(),
      }),
      likes: z.object({
        value: z.number().nullable(),
        knownSum: z.number(),
        available: z.number(),
        mediaCount: z.number(),
      }),
      comments: z.object({
        value: z.number().nullable(),
        knownSum: z.number(),
        available: z.number(),
        mediaCount: z.number(),
      }),
      saves: z.object({
        value: z.number().nullable(),
        knownSum: z.number(),
        available: z.number(),
        mediaCount: z.number(),
      }),
      shares: z.object({
        value: z.number().nullable(),
        knownSum: z.number(),
        available: z.number(),
        mediaCount: z.number(),
      }),
    }),
    snapshotRange: z.object({
      oldest: z.number().int().nullable(),
      newest: z.number().int().nullable(),
    }),
    note: z.string(),
  }),
  snapshotChanges: z.array(
    z.object({
      mediaId: z.string(),
      permalink: z.string().url(),
      intervals: z.array(
        z.object({
          from: z.number(),
          to: z.number(),
          fromSnapshotId: z.string(),
          toSnapshotId: z.string(),
          netChange: z.number().nullable(),
          perHour: z.number().nullable(),
          reason: z.string().nullable(),
          formula: z.string(),
        }),
      ),
      truncated: z.boolean(),
      resurgence: z.object({
        detected: z.boolean(),
        baselinePerHour: z.number().nullable(),
        minimumIntervals: z.number(),
        thresholdRatio: z.number(),
        minimumGain: z.number(),
        last: z
          .object({
            from: z.number(),
            to: z.number(),
            fromSnapshotId: z.string(),
            toSnapshotId: z.string(),
            netChange: z.number().nullable(),
            perHour: z.number().nullable(),
            reason: z.string().nullable(),
            formula: z.string(),
          })
          .nullable(),
        note: z.string(),
      }),
    }),
  ),
  signals: z.array(
    z.object({
      kind: z.string(),
      mediaId: z.string(),
      permalink: z.string().url(),
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
export const subscribeInstagramCommentsWebhookInput = z.object({});
export const updateMediaMetadataInput = z.object({
  title: z.string().min(1).max(200).nullable().optional(),
  durationSeconds: z.number().max(86400).nullable().optional(),
});
export const syncAccountPageInput = z.object({
  operationId: z.string().uuid(),
  cursor: z.string().min(1).max(4096).nullable().optional(),
  pageSize: z.number().int().min(1).max(3).optional(),
});
export const refreshMediaInput = z.object({ operationId: z.string().uuid() });
export const startFullCollectionInput = z.object({
  operationId: z.string().uuid(),
  stories: z.boolean().optional(),
});
export const startAccountCommentsCollectionInput = z.object({ operationId: z.string().uuid() });
export const configureCollectionScheduleInput = z.object({
  enabled: z.boolean(),
  discoveryMinutes: z.number().int().min(60).max(10080).optional(),
  timeZone: z.string().min(1).max(100).optional(),
});
export const controlCollectionInput = z.object({ action: z.enum(["resume", "cancel"]) });
export const advanceCollectionInput = z.object({});
export const collectAccountInsightsInput = z.object({
  operationId: z.string().uuid(),
  from: z.string(),
  to: z.string(),
  timeZone: z.string().min(1).max(100).optional(),
  metricType: z.enum(["total_value", "time_series"]).optional(),
  metrics: z
    .array(
      z.enum([
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
      ]),
    )
    .optional(),
  breakdown: z
    .enum(["media_product_type", "follow_type", "follower_type", "contact_button_type"])
    .optional(),
});
export const collectAudienceInsightsInput = z.object({
  operationId: z.string().uuid(),
  timeframe: z.enum(["this_month", "this_week"]).optional(),
  breakdown: z.enum(["age", "gender", "country", "city"]),
});
export const setMediaContextInput = z.object({
  mediaIds: z.array(z.string().min(1).max(150)),
  source: z.enum(["manual", "assistant_suggestion"]),
  replace: z.boolean().optional(),
  values: z.object({
    rubric: z.string().min(1).max(100).nullable().optional(),
    series: z.string().min(1).max(100).nullable().optional(),
    topics: z.array(z.string().min(1).max(100)).optional(),
    tags: z.array(z.string().min(1).max(100)).optional(),
    format: z.string().min(1).max(100).nullable().optional(),
    hook: z.string().min(1).max(100).nullable().optional(),
    callToAction: z.string().min(1).max(100).nullable().optional(),
    goal: z.string().min(1).max(100).nullable().optional(),
    sponsored: z.boolean().nullable().optional(),
    paidDistribution: z.boolean().nullable().optional(),
    brandPartnership: z.boolean().nullable().optional(),
    coauthor: z.boolean().nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
  }),
});
export const importBusinessRecordsInput = z.object({
  records: z.array(
    z.object({
      id: z.string().uuid(),
      mediaId: z.string().min(1).max(150),
      kind: z.enum([
        "production_hours",
        "production_cost",
        "leads",
        "sales",
        "revenue",
        "profit",
        "clicks",
      ]),
      value: z.number().min(-9007199254740991).max(9007199254740991),
      unit: z.enum(["hours", "count", "money"]),
      currency: z.string().nullable(),
      from: z.number().int(),
      to: z.number().int(),
      source: z.string().min(1).max(1000),
      attribution: z.enum(["production", "tagged_link", "promo_code", "confirmed_manual"]),
      allocation: z.string().min(1).max(1000),
    }),
  ),
});
export const createExperimentInput = z.object({
  operationId: z.string().uuid(),
  plan: z.object({
    question: z.string().min(1).max(4000),
    metric: z.enum(["views", "reach", "saves", "shares", "comments", "follows"]),
    ageDays: z.union([z.literal(1), z.literal(7), z.literal(30)]),
    decisionRule: z.string().min(1).max(4000),
    minimumSample: z.number().int().min(5).max(100).optional(),
    variants: z.array(
      z.object({ name: z.string().min(1).max(100), mediaIds: z.array(z.string().min(1).max(150)) }),
    ),
    retrospective: z.boolean(),
  }),
});
export const concludeExperimentInput = z.object({
  verdict: z.enum(["supported", "not_supported", "insufficient_data"]),
  reasoning: z.string().min(1).max(4000),
  nextCheck: z.string().min(1).max(4000),
});
export const setStorySequenceInput = z.object({
  operationId: z.string().uuid(),
  name: z.string().min(1).max(100),
  mediaIds: z.array(z.string().min(1).max(150)),
});
export const assignExperimentPublicationsInput = z.object({
  assignments: z.array(
    z.object({ variant: z.string().min(1).max(100), mediaId: z.string().min(1).max(150) }),
  ),
});
export const collectCommentsInput = z.object({
  operationId: z.string().uuid(),
  parentId: z.string().min(1).max(150).nullable().optional(),
  cursor: z.string().min(1).max(4096).nullable().optional(),
  limit: z.number().int().min(1).max(50).optional(),
  expandReplies: z.boolean().optional(),
});
