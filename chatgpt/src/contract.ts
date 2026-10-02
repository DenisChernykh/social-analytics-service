// Generated from contract/openapi.json. Unknown response fields are stripped.
import { z } from "zod";
export const accountsResponse = z.object({
  accounts: z.array(
    z.object({
      id: z.string().min(1).max(150),
      platform: z.enum(["instagram"]),
      externalId: z.string(),
      username: z.string(),
      accountType: z.string(),
      connectedAt: z.number().int(),
      lastSyncedAt: z.number().int().nullable(),
    }),
  ),
});
export const searchResponse = z.object({
  items: z.array(
    z.object({
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
    }),
  ),
  nextCursor: z.string().nullable(),
});
export const resolveResponse = z.object({
  status: z.enum(["matched", "ambiguous", "not_found"]),
  candidates: z.array(
    z.object({
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
    }),
  ),
  moreMatches: z.boolean(),
  report: z
    .object({
      media: z.object({
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
      }),
      account: z.object({
        id: z.string().min(1).max(150),
        platform: z.enum(["instagram"]),
        externalId: z.string(),
        username: z.string(),
        accountType: z.string(),
        connectedAt: z.number().int(),
        lastSyncedAt: z.number().int().nullable(),
      }),
      source: z
        .object({
          provider: z.enum(["instagram_api"]),
          apiVersion: z.string(),
          observedAt: z.number().int(),
          ageSeconds: z.number(),
          scope: z.enum(["organic_instagram_lifetime"]),
        })
        .nullable(),
      metrics: z
        .object({
          views: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          reach: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          likes: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          comments: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          saves: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          shares: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          totalInteractions: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          totalWatchTimeMs: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          averageWatchTimeMs: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          skipRate: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          reposts: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          facebookViews: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          crosspostedViews: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          follows: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          profileVisits: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
        })
        .nullable(),
      calculated: z
        .object({
          engagementByReach: z.object({
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
          }),
          engagementByViews: z.object({
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
          }),
          saveRate: z.object({
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
          }),
          shareRate: z.object({
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
          }),
          viewsPerReachedAccount: z.object({
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
          }),
          averageWatchRatio: z.object({
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
          }),
        })
        .nullable(),
      growth: z.object({
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
        gain: z.object({
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
        }),
        perHour: z.object({
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
        }),
        percent: z.object({
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
        }),
      }),
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
    })
    .nullable(),
});
export const mediaResponse = z.object({
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
});
export const reportResponse = z
  .object({
    media: z.object({
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
    }),
    account: z.object({
      id: z.string().min(1).max(150),
      platform: z.enum(["instagram"]),
      externalId: z.string(),
      username: z.string(),
      accountType: z.string(),
      connectedAt: z.number().int(),
      lastSyncedAt: z.number().int().nullable(),
    }),
    source: z
      .object({
        provider: z.enum(["instagram_api"]),
        apiVersion: z.string(),
        observedAt: z.number().int(),
        ageSeconds: z.number(),
        scope: z.enum(["organic_instagram_lifetime"]),
      })
      .nullable(),
    metrics: z
      .object({
        views: z.object({
          value: z.number().nullable(),
          unit: z.enum(["count", "milliseconds", "percent"]),
          sourceField: z.string(),
          reason: z
            .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
            .nullable(),
        }),
        reach: z.object({
          value: z.number().nullable(),
          unit: z.enum(["count", "milliseconds", "percent"]),
          sourceField: z.string(),
          reason: z
            .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
            .nullable(),
        }),
        likes: z.object({
          value: z.number().nullable(),
          unit: z.enum(["count", "milliseconds", "percent"]),
          sourceField: z.string(),
          reason: z
            .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
            .nullable(),
        }),
        comments: z.object({
          value: z.number().nullable(),
          unit: z.enum(["count", "milliseconds", "percent"]),
          sourceField: z.string(),
          reason: z
            .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
            .nullable(),
        }),
        saves: z.object({
          value: z.number().nullable(),
          unit: z.enum(["count", "milliseconds", "percent"]),
          sourceField: z.string(),
          reason: z
            .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
            .nullable(),
        }),
        shares: z.object({
          value: z.number().nullable(),
          unit: z.enum(["count", "milliseconds", "percent"]),
          sourceField: z.string(),
          reason: z
            .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
            .nullable(),
        }),
        totalInteractions: z.object({
          value: z.number().nullable(),
          unit: z.enum(["count", "milliseconds", "percent"]),
          sourceField: z.string(),
          reason: z
            .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
            .nullable(),
        }),
        totalWatchTimeMs: z.object({
          value: z.number().nullable(),
          unit: z.enum(["count", "milliseconds", "percent"]),
          sourceField: z.string(),
          reason: z
            .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
            .nullable(),
        }),
        averageWatchTimeMs: z.object({
          value: z.number().nullable(),
          unit: z.enum(["count", "milliseconds", "percent"]),
          sourceField: z.string(),
          reason: z
            .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
            .nullable(),
        }),
        skipRate: z.object({
          value: z.number().nullable(),
          unit: z.enum(["count", "milliseconds", "percent"]),
          sourceField: z.string(),
          reason: z
            .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
            .nullable(),
        }),
        reposts: z.object({
          value: z.number().nullable(),
          unit: z.enum(["count", "milliseconds", "percent"]),
          sourceField: z.string(),
          reason: z
            .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
            .nullable(),
        }),
        facebookViews: z.object({
          value: z.number().nullable(),
          unit: z.enum(["count", "milliseconds", "percent"]),
          sourceField: z.string(),
          reason: z
            .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
            .nullable(),
        }),
        crosspostedViews: z.object({
          value: z.number().nullable(),
          unit: z.enum(["count", "milliseconds", "percent"]),
          sourceField: z.string(),
          reason: z
            .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
            .nullable(),
        }),
        follows: z.object({
          value: z.number().nullable(),
          unit: z.enum(["count", "milliseconds", "percent"]),
          sourceField: z.string(),
          reason: z
            .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
            .nullable(),
        }),
        profileVisits: z.object({
          value: z.number().nullable(),
          unit: z.enum(["count", "milliseconds", "percent"]),
          sourceField: z.string(),
          reason: z
            .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
            .nullable(),
        }),
      })
      .nullable(),
    calculated: z
      .object({
        engagementByReach: z.object({
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
        }),
        engagementByViews: z.object({
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
        }),
        saveRate: z.object({
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
        }),
        shareRate: z.object({
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
        }),
        viewsPerReachedAccount: z.object({
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
        }),
        averageWatchRatio: z.object({
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
        }),
      })
      .nullable(),
    growth: z.object({
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
      gain: z.object({
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
      }),
      perHour: z.object({
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
      }),
      percent: z.object({
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
      }),
    }),
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
  })
  .nullable();
export const historyResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      mediaId: z.string().min(1).max(150),
      observedAt: z.number().int(),
      apiVersion: z.string(),
      metrics: z
        .object({
          views: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          reach: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          likes: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          comments: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          saves: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          shares: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          totalInteractions: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          totalWatchTimeMs: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          averageWatchTimeMs: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          skipRate: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          reposts: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          facebookViews: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          crosspostedViews: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          follows: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
          profileVisits: z.object({
            value: z.number().nullable(),
            unit: z.enum(["count", "milliseconds", "percent"]),
            sourceField: z.string(),
            reason: z
              .enum(["not_returned", "not_supported", "permission_required", "invalid_value"])
              .nullable(),
          }),
        })
        .nullable(),
    }),
  ),
  nextCursor: z.string().nullable(),
  growth: z.object({
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
    gain: z.object({
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
    }),
    perHour: z.object({
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
    }),
    percent: z.object({
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
    }),
  }),
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
  account: z.object({
    id: z.string().min(1).max(150),
    platform: z.enum(["instagram"]),
    externalId: z.string(),
    username: z.string(),
    accountType: z.string(),
    connectedAt: z.number().int(),
    lastSyncedAt: z.number().int().nullable(),
  }),
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
  followerNetChange: z.number().nullable(),
  note: z.string(),
});
export const syncResponse = z.object({
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
export const metricsResponse = z.object({
  source: z.enum(["instagram_api"]),
  metrics: z.record(
    z.string(),
    z.object({ field: z.string(), unit: z.string(), appliesTo: z.string() }),
  ),
  note: z.string(),
});
