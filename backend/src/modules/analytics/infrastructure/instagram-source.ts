import type { InstagramReader } from "../../instagram/public-contracts";
import type { AnalyticsSource } from "../application/ports";
import type { Account, Media, Metric, Metrics } from "../domain/model";

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
      items: page.media.map((item) => ({
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
      })),
      nextCursor: page.nextCursor,
    };
  }
  async metrics(accountId: string, item: { media: Media; initialMetrics: Partial<Metrics> }) {
    const isReel = item.media.productType === "REELS" || /\/reels?\//.test(item.media.permalink);
    const requested = Object.entries(metricDefinitions).filter(
      ([, definition]) =>
        definition.appliesTo === "all" ||
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
          result.value === null && result.reason !== "invalid_value" && fallback?.value != null
            ? fallback
            : { ...result, sourceField: definition.field, unit: definition.unit };
        return [key, metric];
      }),
    ) as Metrics;
    return { metrics, observedAt: this.clock(), apiVersion: this.apiVersion };
  }
}
