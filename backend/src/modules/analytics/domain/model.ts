import type { ContentContext } from "../../../shared/domain/content";

export const metricKeys = [
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
] as const;
export type MetricKey = (typeof metricKeys)[number];
export type Metric = {
  value: number | null;
  unit: "count" | "milliseconds" | "percent";
  sourceField: string;
  reason:
    | "not_returned"
    | "not_supported"
    | "permission_required"
    | "invalid_value"
    | "insufficient_audience"
    | null;
};
export type Metrics = Record<MetricKey, Metric>;

export type Account = {
  id: string;
  platform: string;
  externalId: string;
  username: string;
  accountType: string;
  connectedAt: number;
  lastSyncedAt: number | null;
};
export type Media = {
  id: string;
  accountId: string;
  externalId: string;
  caption: string;
  title: string | null;
  mediaType: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  productType: string;
  permalink: string;
  publishedAt: number;
  durationSeconds: number | null;
  durationSource: "manual" | null;
  context?: ContentContext | null;
};
export type Snapshot = {
  id: string;
  mediaId: string;
  observedAt: number;
  apiVersion: string;
  metrics: Metrics;
  storyInsights?: StoryInsights | null;
};
export type AccountSnapshot = {
  observedAt: number;
  followersCount: number | null;
  mediaCount: number | null;
};
export type SyncRun = {
  id: string;
  accountId: string;
  inputCursor: string | null;
  pageSize: number;
  status: "running" | "completed" | "failed";
  startedAt: number;
  completedAt: number | null;
  nextCursor: string | null;
  mediaCount: number;
  errorCode: string | null;
  kind?: "page" | "media" | "stories";
  targetMediaId?: string | null;
};

export type StoryInsights = {
  replies: Metric;
  navigation: Record<string, Metric>;
};
export type ReportDefinition = {
  provider: string;
  scope: string;
  object: "media";
  aggregation: "lifetime";
  limitations: string[];
};
