import { ApplicationError } from "../../../shared/application/application-error";
import { objectFailureDelay } from "../../../shared/domain/source-failure";
import { definitionVersion, metricDefinitions } from "../domain/metric-definitions";

export { metricDefinitions } from "../domain/metric-definitions";

import type {
  InsightQuery,
  InstagramInsight,
  InstagramMedia,
  InstagramReader,
  StructuredInsight,
} from "../../instagram/public-contracts";
import type { AnalyticsSource, MediaStatistics } from "../application/ports";
import type {
  Account,
  Media,
  Metric,
  Metrics,
  ReportDefinition,
  StoryInsights,
} from "../domain/model";

export function instagramReportDefinition(productType: string): ReportDefinition {
  return {
    provider: "instagram_api",
    scope:
      productType === "STORY" ? "field_specific_story_lifetime" : "field_specific_media_lifetime",
    object: "media",
    aggregation: "lifetime",
    limitations: [
      "Recent source values may lag or be revised; account periods are rechecked after 48 hours by versioned service policy, not guaranteed finality.",
      "Surface/distribution are field-specific; Facebook/combined metrics are separate. Unknown paid distribution is not organic.",
      "Fields are collected sequentially within the observation window; their own receipt times apply. Deferred fields remain null, without values from older observations.",
      "Watch-time ratio is not a completion rate and can exceed 100%.",
      "Historical growth starts with the snapshots collected by this service.",
      ...(productType === "STORY"
        ? [
            "Only currently discoverable Stories can be collected; navigation counts actions, not unique viewers or completion.",
          ]
        : []),
    ],
  };
}

export const storyMetricFields: ReadonlySet<string> = new Set([
  "views",
  "reach",
  "shares",
  "reposts",
  "total_interactions",
  "facebook_views",
  "follows",
  "profile_visits",
]);

export class InstagramSource implements AnalyticsSource {
  private cachedReader: InstagramReader | undefined;
  constructor(
    private readonly createReader: () => InstagramReader,
    private readonly apiVersion: string,
    private readonly clock: () => number,
  ) {}
  private get reader() {
    this.cachedReader ??= this.createReader();
    return this.cachedReader;
  }
  requestStats() {
    return this.cachedReader?.requestStats?.() ?? { attempts: 0 };
  }
  beginOperation(operationId: string) {
    const reader = this.createReader();
    this.cachedReader = reader.forOperation?.(operationId) ?? reader;
  }
  async profile(accountId: string) {
    const profile = await this.reader.profile(accountId);
    return { ...profile, observedAt: profile.receipt?.responseReceivedAt ?? this.clock() };
  }
  async mediaPage(account: Account, cursor: string | null, limit: number) {
    const page = await this.reader.mediaPage(account.id, account.externalId, cursor, limit);
    return {
      items: page.media.map((item) => this.mapMedia(account, item)),
      nextCursor: page.nextCursor,
    };
  }
  async stories(account: Account, cursor: string | null, limit: number) {
    const page = await this.reader.stories(account.id, account.externalId, cursor, limit);
    return {
      items: page.media.map((item) => this.mapMedia(account, { ...item, productType: "STORY" })),
      nextCursor: page.nextCursor,
    };
  }
  async media(account: Account, externalId: string) {
    const item = await this.reader.media(account.id, externalId);
    if (item.id !== externalId) throw new Error("Unexpected media identity");
    return this.mapMedia(account, item);
  }
  private mapMedia(account: Account, item: InstagramMedia) {
    const provenance = () =>
      item.receipt
        ? {
            ...item.receipt,
            definitionVersion,
            surface: "instagram" as const,
            distribution: "unknown" as const,
          }
        : undefined;
    return {
      media: {
        id: `${account.id}_${item.id}`,
        accountId: account.id,
        externalId: item.id,
        caption: item.caption,
        title: null,
        mediaType: item.mediaType,
        productType: item.productType,
        permalink: item.permalink,
        publishedAt: item.timestamp,
        durationSeconds: null,
        durationSource: null,
        firstDiscoveredAt: this.clock(),
        discoverySource: "collection",
        metadata: item.metadata
          ? {
              ...item.metadata,
              provider: "instagram_api",
              apiVersion: this.apiVersion,
              observedAt: item.receipt?.responseReceivedAt ?? this.clock(),
            }
          : null,
      } as Media,
      initialMetrics: {
        likes: {
          provenance: provenance(),
          value: item.likeCount,
          sourceField: "like_count",
          unit: "count",
          reason: item.likeCount === null ? "not_returned" : null,
        },
        comments: {
          provenance: provenance(),
          value: item.commentsCount,
          sourceField: "comments_count",
          unit: "count",
          reason: item.commentsCount === null ? "not_returned" : null,
        },
      } as Partial<Metrics>,
    };
  }
  private async optionalStructured(
    accountId: string,
    objectId: string,
    query: InsightQuery,
    failure?: ApplicationError,
  ): Promise<StructuredInsight> {
    try {
      if (failure) throw failure;
      return await this.reader.structuredInsights(accountId, objectId, query);
    } catch (error) {
      if (!(error instanceof ApplicationError)) throw error;
      const reason =
        error.code === "INSTAGRAM_INVALID_BREAKDOWN"
          ? "invalid_breakdown"
          : error.code === "INSTAGRAM_INVALID_REQUEST"
            ? "invalid_request"
            : error.code === "INSTAGRAM_OBJECT_UNAVAILABLE"
              ? "object_unavailable"
              : ["INSTAGRAM_AUTH_EXPIRED", "INSTAGRAM_PERMISSION_REQUIRED"].includes(error.code)
                ? "permission_required"
                : ["REQUEST_BUDGET_EXHAUSTED", "INSTAGRAM_RATE_LIMITED"].includes(error.code)
                  ? "request_deferred"
                  : "source_error";
      return {
        metric: query.metric,
        period: query.period,
        metricType: query.metricType,
        value: null,
        reason,
        receipt: error.receipt,
        description: null,
        points: [],
        breakdowns: [],
      };
    }
  }
  private requestedMetrics(media: Media) {
    const isReel = media.productType === "REELS" || /\/reels?\//.test(media.permalink);
    return Object.entries(metricDefinitions).filter(([, definition]) =>
      media.productType === "STORY"
        ? storyMetricFields.has(definition.field)
        : definition.appliesTo === "all" ||
          (isReel ? definition.appliesTo === "reels" : definition.appliesTo === "feed"),
    );
  }
  async metrics(accountId: string, item: { media: Media; initialMetrics: Partial<Metrics> }) {
    const isReel = item.media.productType === "REELS" || /\/reels?\//.test(item.media.permalink);
    const isStory = item.media.productType === "STORY";
    const requested = this.requestedMetrics(item.media);
    const fields = [
      ...requested
        .filter(([, definition]) => definition.surface === "instagram")
        .map(([, definition]) => definition.field),
      ...(isStory ? ["replies"] : []),
    ];
    let response: Record<string, InstagramInsight>;
    let failure: ApplicationError | undefined;
    let collectionError: MediaStatistics["collectionError"];
    try {
      response = await this.reader.insights(accountId, item.media.externalId, fields);
    } catch (error) {
      if (!(error instanceof ApplicationError)) throw error;
      const delay = objectFailureDelay(error.code);
      // Auth, account-wide quota, transport failures and persistence errors
      // retain their retry semantics; only object-scoped failures are partial.
      if (delay === null) throw error;
      failure = error;
      collectionError = {
        code: error.code,
        retryAfterMs: Math.max(delay, error.retryAfterMs ?? 0),
      };
      const reason =
        error.code === "INSTAGRAM_OBJECT_UNAVAILABLE"
          ? "object_unavailable"
          : error.code === "INSTAGRAM_INVALID_REQUEST"
            ? "invalid_request"
            : error.code === "INSTAGRAM_INVALID_BREAKDOWN"
              ? "invalid_breakdown"
              : "source_error";
      response = Object.fromEntries(
        fields.map((field) => [field, { value: null, reason, receipt: error.receipt }]),
      );
    }
    if (!collectionError) {
      const reason = Object.values(response).find((value) =>
        ["source_error", "object_unavailable", "invalid_request", "invalid_breakdown"].includes(
          value.reason ?? "",
        ),
      )?.reason;
      const code =
        reason === "object_unavailable"
          ? "INSTAGRAM_OBJECT_UNAVAILABLE"
          : reason === "invalid_request"
            ? "INSTAGRAM_INVALID_REQUEST"
            : reason === "invalid_breakdown"
              ? "INSTAGRAM_INVALID_BREAKDOWN"
              : reason === "source_error"
                ? "INSTAGRAM_SOURCE_ERROR"
                : null;
      const delay = code ? objectFailureDelay(code) : null;
      if (code && delay !== null) collectionError = { code, retryAfterMs: delay };
    }
    const metrics = Object.fromEntries(
      Object.entries(metricDefinitions).map(([key, definition]) => {
        const applies = requested.some(([requestedKey]) => requestedKey === key);
        const result = applies
          ? definition.surface !== "instagram"
            ? { value: null, reason: "request_deferred" as const }
            : (response[definition.field] ?? { value: null, reason: "not_returned" as const })
          : { value: null, reason: "not_requested" as const };
        const fallback = item.initialMetrics[key as keyof Metrics];
        const metric: Metric =
          !isStory &&
          result.value === null &&
          result.reason !== "invalid_value" &&
          fallback?.value != null
            ? fallback
            : {
                value: result.value,
                reason: result.reason,
                sourceField: definition.field,
                unit: definition.unit,
                provenance: result.receipt
                  ? {
                      ...result.receipt,
                      definitionVersion,
                      surface: definition.surface,
                      distribution: definition.distribution,
                    }
                  : undefined,
              };
        if (metric.provenance && fallback === metric && !isStory)
          metric.provenance = { ...metric.provenance, distribution: "unknown" };
        return [key, metric];
      }),
    ) as Metrics;
    let navigationReceipt: import("../../instagram/public-contracts").ReceiptReference | undefined;
    let storyInsights: StoryInsights | null = null;
    if (isStory) {
      const navigation = await this.optionalStructured(
        accountId,
        item.media.externalId,
        {
          metric: "navigation",
          period: "lifetime",
          metricType: "total_value",
          breakdown: "story_navigation_action_type",
        },
        failure,
      );
      navigationReceipt = navigation.receipt;
      const navProvenance = navigation.receipt
        ? {
            ...navigation.receipt,
            definitionVersion,
            surface: "instagram" as const,
            distribution: "unknown" as const,
          }
        : undefined;
      const categories = new Map(
        navigation.breakdowns
          .filter(
            (group) =>
              group.dimensions.length === 1 &&
              group.dimensions[0] === "story_navigation_action_type",
          )
          .flatMap((group) => group.results.map((entry) => [entry.categories[0], entry] as const)),
      );
      storyInsights = {
        replies: {
          ...(response.replies ?? { value: null, reason: "not_returned" }),
          provenance: response.replies?.receipt
            ? {
                ...response.replies.receipt,
                definitionVersion,
                surface: "instagram",
                distribution: "unknown",
              }
            : undefined,
          sourceField: "replies",
          unit: "count",
        },
        navigationTotal: {
          value: navigation.value,
          reason: navigation.reason,
          provenance: navProvenance,
          sourceField: "navigation",
          unit: "count",
        },
        navigation: Object.fromEntries(
          [
            ...new Set(
              ["tap_forward", "tap_back", "tap_exit", "swipe_forward", ...categories.keys()].filter(
                (value): value is string => typeof value === "string",
              ),
            ),
          ].map((category) => [
            category,
            {
              value: categories.get(category)?.value ?? null,
              reason: categories.has(category)
                ? (categories.get(category)?.reason ?? null)
                : (navigation.reason ?? "not_returned"),
              unit: "count",
              provenance: navProvenance,
              sourceField: `navigation.story_navigation_action_type.${category}`,
            },
          ]),
        ),
      };
    }
    const activity = !isReel
      ? await this.optionalStructured(
          accountId,
          item.media.externalId,
          {
            metric: "profile_activity",
            period: "lifetime",
            metricType: "total_value",
            breakdown: "action_type",
          },
          failure,
        )
      : null;
    const profileActivity = activity
      ? {
          total: {
            value: activity.value,
            reason: activity.reason,
            provenance: activity.receipt
              ? {
                  ...activity.receipt,
                  definitionVersion,
                  surface: "instagram" as const,
                  distribution: "unknown" as const,
                }
              : undefined,
            sourceField: "profile_activity",
            unit: "count" as const,
          },
          actions: Object.fromEntries(
            activity.breakdowns
              .filter(
                (group) => group.dimensions.length === 1 && group.dimensions[0] === "action_type",
              )
              .flatMap((group) =>
                group.results
                  .filter((entry) => entry.categories.length === 1)
                  .map((entry) => [
                    entry.categories[0] as string,
                    {
                      value: entry.value,
                      reason: entry.reason,
                      provenance: activity.receipt
                        ? {
                            ...activity.receipt,
                            definitionVersion,
                            surface: "instagram" as const,
                            distribution: "unknown" as const,
                          }
                        : undefined,
                      sourceField: `profile_activity.action_type.${entry.categories[0]}`,
                      unit: "count" as const,
                    },
                  ]),
              ),
          ),
        }
      : null;
    return {
      collectionError,
      provenance: (() => {
        const refs = [
          ...Object.values(metrics).map((m) => m.provenance),
          navigationReceipt,
          activity?.receipt,
        ].filter((r): r is NonNullable<typeof r> => !!r && r.responseReceivedAt !== null);
        return refs.length
          ? {
              requestStartedAt: Math.min(...refs.map((r) => r.requestStartedAt)),
              responseReceivedAt: Math.max(...refs.map((r) => r.responseReceivedAt as number)),
              receiptIds: [...new Set(refs.map((r) => r.receiptId))],
              semantics: "sequential_requests_lifetime" as const,
              definitionVersion,
            }
          : null;
      })(),
      metrics,
      storyInsights,
      profileActivity,
      observedAt: this.clock(),
      apiVersion: this.apiVersion,
    };
  }

  async additionalMetrics(
    accountId: string,
    item: { media: Media; initialMetrics: Partial<Metrics> },
    current: MediaStatistics,
  ): Promise<MediaStatistics> {
    if (current.collectionError) return current;
    // At most two cross-surface fields: one batch and at most two isolated probes.
    // The reader keeps the same operation, budget, backoff and object capability scope.
    const requested = this.requestedMetrics(item.media).filter(
      ([, definition]) => definition.surface !== "instagram",
    );
    if (!requested.length) return current;
    let response: Record<string, InstagramInsight>;
    try {
      response = await this.reader.insights(
        accountId,
        item.media.externalId,
        requested.map(([, definition]) => definition.field),
      );
    } catch (error) {
      if (!(error instanceof ApplicationError)) throw error;
      let reason: InstagramInsight["reason"];
      switch (error.code) {
        case "REQUEST_BUDGET_EXHAUSTED":
        case "INSTAGRAM_RATE_LIMITED":
          reason = "request_deferred";
          break;
        case "INSTAGRAM_AUTH_EXPIRED":
        case "INSTAGRAM_PERMISSION_REQUIRED":
          reason = "permission_required";
          break;
        case "INSTAGRAM_INVALID_REQUEST":
          reason = "invalid_request";
          break;
        case "INSTAGRAM_INVALID_BREAKDOWN":
          reason = "invalid_breakdown";
          break;
        case "INSTAGRAM_OBJECT_UNAVAILABLE":
          reason = "object_unavailable";
          break;
        case "INSTAGRAM_UNAVAILABLE":
        case "INSTAGRAM_SOURCE_ERROR":
          reason = "source_error";
          break;
        default:
          throw error;
      }
      response = Object.fromEntries(
        requested.map(([, definition]) => [
          definition.field,
          { value: null, reason, receipt: error.receipt },
        ]),
      );
    }
    const additional = Object.fromEntries(
      requested.map(([key, definition]) => {
        const result = response[definition.field] ?? {
          value: null,
          reason: "not_returned" as const,
        };
        return [
          key,
          {
            value: result.value,
            reason: result.reason,
            sourceField: definition.field,
            unit: definition.unit,
            provenance: result.receipt
              ? {
                  ...result.receipt,
                  definitionVersion,
                  surface: definition.surface,
                  distribution: definition.distribution,
                }
              : undefined,
          } satisfies Metric,
        ];
      }),
    );
    const refs = Object.values(additional)
      .map((metric) => metric.provenance)
      .filter((ref): ref is NonNullable<typeof ref> => !!ref && ref.responseReceivedAt !== null);
    const previous = current.provenance;
    return {
      ...current,
      metrics: { ...current.metrics, ...additional },
      observedAt: this.clock(),
      provenance: refs.length
        ? {
            requestStartedAt: Math.min(
              ...refs.map((ref) => ref.requestStartedAt),
              ...(previous ? [previous.requestStartedAt] : []),
            ),
            responseReceivedAt: Math.max(
              ...refs.map((ref) => ref.responseReceivedAt as number),
              ...(previous ? [previous.responseReceivedAt] : []),
            ),
            receiptIds: [
              ...new Set([...(previous?.receiptIds ?? []), ...refs.map((ref) => ref.receiptId)]),
            ],
            semantics: "sequential_requests_lifetime",
            definitionVersion,
          }
        : previous,
    };
  }
}
