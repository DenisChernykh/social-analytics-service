export type InstagramProfile = {
  userId: string;
  username: string;
  accountType: string;
  followersCount: number | null;
  mediaCount: number | null;
};
export type InstagramMedia = {
  id: string;
  caption: string;
  mediaType: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  productType: string;
  permalink: string;
  timestamp: number;
  likeCount: number | null;
  commentsCount: number | null;
};
export type InstagramInsight = {
  value: number | null;
  reason: "not_returned" | "not_supported" | "permission_required" | "invalid_value" | null;
};
export interface InstagramReader {
  profile(accountId: string): Promise<InstagramProfile>;
  mediaPage(
    accountId: string,
    userId: string,
    cursor: string | null,
    limit: number,
  ): Promise<{ media: InstagramMedia[]; nextCursor: string | null }>;
  insights(
    accountId: string,
    mediaId: string,
    fields: string[],
  ): Promise<Record<string, InstagramInsight>>;
  media(accountId: string, mediaId: string): Promise<InstagramMedia>;
  stories(
    accountId: string,
    userId: string,
    cursor: string | null,
    limit: number,
  ): Promise<{ media: InstagramMedia[]; nextCursor: string | null }>;
  structuredInsights(
    accountId: string,
    objectId: string,
    query: InsightQuery,
  ): Promise<StructuredInsight>;
  comments(
    accountId: string,
    objectId: string,
    replies: boolean,
    cursor: string | null,
    limit: number,
  ): Promise<CommentPage>;
}

export type InsightQuery = {
  metric: string;
  period: "day" | "lifetime";
  metricType: "total_value" | "time_series";
  since?: number;
  until?: number;
  breakdown?: string;
  timeframe?: string;
};
export type StructuredInsight = {
  metric: string;
  period: string;
  metricType: "total_value" | "time_series";
  value: number | null;
  reason: InstagramInsight["reason"] | "insufficient_audience";
  description: string | null;
  points: { value: number | null; endTime: number; reason: InstagramInsight["reason"] }[];
  breakdowns: {
    dimensions: string[];
    results: { categories: string[]; value: number | null; reason: InstagramInsight["reason"] }[];
  }[];
};
export type CommentPage = {
  items: { id: string; text: string; publishedAt: number; parentId?: string | null }[];
  nextCursor: string | null;
};
