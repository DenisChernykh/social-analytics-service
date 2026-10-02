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
  reason: z
    .enum([
      "not_returned",
      "not_supported",
      "permission_required",
      "invalid_value",
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
  metrics: MediaMetricsSchema,
  storyInsights: z
    .object({ replies: SourceMetricSchema, navigation: z.record(z.string(), SourceMetricSchema) })
    .nullable(),
  calculated: z
    .object({
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
  observedAt: z.number().int(),
  apiVersion: z.string(),
  metrics: MediaMetricsSchema,
  storyInsights: z
    .object({ replies: SourceMetricSchema, navigation: z.record(z.string(), SourceMetricSchema) })
    .nullable()
    .optional(),
});
const SyncRunSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().min(1).max(150),
  inputCursor: z.string().nullable(),
  pageSize: z.number().int(),
  status: z.enum(["running", "completed", "failed"]),
  startedAt: z.number().int(),
  completedAt: z.number().int().nullable(),
  nextCursor: z.string().nullable(),
  mediaCount: z.number().int(),
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
      origin: z.enum(["manual", "scheduled", "stories", "comments", "audience"]),
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
    }),
  ),
  policy: z.object({
    runBudget: z.number(),
    pageSize: z.number(),
    storyPageSize: z.number(),
    commentPageSize: z.number(),
    cronMinutes: z.number(),
    ageIntervalsHours: z.array(z.number()),
    maximumConsecutiveFailures: z.number(),
  }),
  note: z.string(),
});
export const collectionJobResponse = z.object({
  id: z.string().uuid(),
  accountId: z.string().min(1).max(150),
  origin: z.enum(["manual", "scheduled", "stories", "comments", "audience"]),
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
export const scheduleResponse = z.object({
  accountId: z.string().min(1).max(150),
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
  requestedAt: z.number(),
  observedAt: z.number().nullable(),
  apiVersion: z.string(),
  provider: z.string(),
  scope: z.enum(["instagram_account_period", "instagram_audience_timeframe"]),
  aggregation: z.enum(["period", "timeframe"]),
  object: z.enum(["account", "audience"]),
  values: z.array(
    z.object({
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
      requestedAt: z.number(),
      observedAt: z.number().nullable(),
      apiVersion: z.string(),
      provider: z.string(),
      scope: z.enum(["instagram_account_period", "instagram_audience_timeframe"]),
      aggregation: z.enum(["period", "timeframe"]),
      object: z.enum(["account", "audience"]),
      values: z.array(
        z.object({
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
      requestedAt: z.number(),
      observedAt: z.number().nullable(),
      apiVersion: z.string(),
      provider: z.string(),
      scope: z.enum(["instagram_account_period", "instagram_audience_timeframe"]),
      aggregation: z.enum(["period", "timeframe"]),
      object: z.enum(["account", "audience"]),
      values: z.array(
        z.object({
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
      requestedAt: z.number(),
      observedAt: z.number().nullable(),
      apiVersion: z.string(),
      provider: z.string(),
      scope: z.enum(["instagram_account_period", "instagram_audience_timeframe"]),
      aggregation: z.enum(["period", "timeframe"]),
      object: z.enum(["account", "audience"]),
      values: z.array(
        z.object({
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
      requestedAt: z.number(),
      observedAt: z.number().nullable(),
      apiVersion: z.string(),
      provider: z.string(),
      scope: z.enum(["instagram_account_period", "instagram_audience_timeframe"]),
      aggregation: z.enum(["period", "timeframe"]),
      object: z.enum(["account", "audience"]),
      values: z.array(
        z.object({
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
      apiVersion: z.string().optional(),
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
  coverage: z.object({ sampled: z.number(), truncated: z.boolean(), completeHistory: z.boolean() }),
  limitations: z.array(z.string()),
});
export const commentCollectionResponse = z.object({
  id: z.string().uuid(),
  mediaId: z.string().min(1).max(150),
  parentId: z.string().min(1).max(150).nullable(),
  cursor: z.string().nullable(),
  limit: z.number(),
  status: z.enum(["running", "completed", "failed"]),
  startedAt: z.number(),
  observedAt: z.number().nullable(),
  nextCursor: z.string().nullable(),
  collected: z.number(),
  commentIds: z.array(z.string().min(1).max(150)).optional(),
  errorCode: z.string().nullable(),
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
        requestedAt: z.number(),
        observedAt: z.number().nullable(),
        apiVersion: z.string(),
        provider: z.string(),
        scope: z.enum(["instagram_account_period", "instagram_audience_timeframe"]),
        aggregation: z.enum(["period", "timeframe"]),
        object: z.enum(["account", "audience"]),
        values: z.array(
          z.object({
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
        requestedAt: z.number(),
        observedAt: z.number().nullable(),
        apiVersion: z.string(),
        provider: z.string(),
        scope: z.enum(["instagram_account_period", "instagram_audience_timeframe"]),
        aggregation: z.enum(["period", "timeframe"]),
        object: z.enum(["account", "audience"]),
        values: z.array(
          z.object({
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
      ]),
    )
    .optional(),
  breakdown: z.enum(["media_product_type", "follow_type"]).optional(),
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
});
