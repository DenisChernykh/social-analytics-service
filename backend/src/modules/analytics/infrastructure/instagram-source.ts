import type { InstagramMedia, InstagramReader } from "../../instagram/public-contracts";
import type { AnalyticsSource } from "../application/ports";
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
      productType === "STORY" ? "organic_instagram_story_lifetime" : "organic_instagram_lifetime",
    object: "media",
    aggregation: "lifetime",
    limitations: [
      "Instagram insights may lag behind by up to 48 hours.",
      "Metrics cover organic Instagram activity; paid and cross-platform totals are separate.",
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

export const metricDefinitions = {
  views: { field: "views", unit: "count", appliesTo: "all" },
  reach: { field: "reach", unit: "count", appliesTo: "all" },
  likes: { field: "likes", unit: "count", appliesTo: "all" },
  comments: { field: "comments", unit: "count", appliesTo: "all" },
  saves: { field: "saved", unit: "count", appliesTo: "all" },
  shares: { field: "shares", unit: "count", appliesTo: "all" },
  reposts: { field: "reposts", unit: "count", appliesTo: "all" },
  totalInteractions: { field: "total_interactions", unit: "count", appliesTo: "all" },
  totalWatchTimeMs: {
    field: "ig_reels_video_view_total_time",
    unit: "milliseconds",
    appliesTo: "reels",
  },
  averageWatchTimeMs: {
    field: "ig_reels_avg_watch_time",
    unit: "milliseconds",
    appliesTo: "reels",
  },
  skipRate: { field: "reels_skip_rate", unit: "percent", appliesTo: "reels" },
  facebookViews: { field: "facebook_views", unit: "count", appliesTo: "reels" },
  crosspostedViews: { field: "crossposted_views", unit: "count", appliesTo: "reels" },
  follows: { field: "follows", unit: "count", appliesTo: "feed" },
  profileVisits: { field: "profile_visits", unit: "count", appliesTo: "feed" },
} as const;

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
  profile(accountId: string) {
    return this.reader.profile(accountId);
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
      } as Media,
      initialMetrics: {
        likes: {
          value: item.likeCount,
          sourceField: "like_count",
          unit: "count",
          reason: item.likeCount === null ? "not_returned" : null,
        },
        comments: {
          value: item.commentsCount,
          sourceField: "comments_count",
          unit: "count",
          reason: item.commentsCount === null ? "not_returned" : null,
        },
      } as Partial<Metrics>,
    };
  }
  async metrics(accountId: string, item: { media: Media; initialMetrics: Partial<Metrics> }) {
    const isReel = item.media.productType === "REELS" || /\/reels?\//.test(item.media.permalink);
    const isStory = item.media.productType === "STORY";
    const requested = Object.entries(metricDefinitions).filter(([, definition]) =>
      isStory
        ? ["views", "reach"].includes(definition.field)
        : definition.appliesTo === "all" ||
          (isReel ? definition.appliesTo === "reels" : definition.appliesTo === "feed"),
    );
    const response = await this.reader.insights(
      accountId,
      item.media.externalId,
      requested.map(([, definition]) => definition.field),
    );
    const metrics = Object.fromEntries(
      Object.entries(metricDefinitions).map(([key, definition]) => {
        const applies = requested.some(([requestedKey]) => requestedKey === key);
        const result = applies
          ? (response[definition.field] ?? { value: null, reason: "not_returned" as const })
          : { value: null, reason: "not_supported" as const };
        const fallback = item.initialMetrics[key as keyof Metrics];
        const metric: Metric =
          !isStory &&
          result.value === null &&
          result.reason !== "invalid_value" &&
          fallback?.value != null
            ? fallback
            : { ...result, sourceField: definition.field, unit: definition.unit };
        return [key, metric];
      }),
    ) as Metrics;
    let storyInsights: StoryInsights | null = null;
    if (isStory) {
      const replies = await this.reader.insights(accountId, item.media.externalId, ["replies"]);
      const navigation = await this.reader.structuredInsights(accountId, item.media.externalId, {
        metric: "navigation",
        period: "lifetime",
        metricType: "total_value",
        breakdown: "story_navigation_action_type",
      });
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
          ...(replies.replies ?? { value: null, reason: "not_returned" }),
          sourceField: "replies",
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
              reason: categories.get(category)?.reason ?? navigation.reason ?? "not_returned",
              unit: "count",
              sourceField: `navigation.story_navigation_action_type.${category}`,
            },
          ]),
        ),
      };
    }
    return { metrics, storyInsights, observedAt: this.clock(), apiVersion: this.apiVersion };
  }
}
