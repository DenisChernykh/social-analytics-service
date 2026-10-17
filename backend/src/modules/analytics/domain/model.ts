import type { ContentContext } from "../../../shared/domain/content";
import type {
  MeasurementProvenance,
  ObservationProvenance,
} from "../../../shared/domain/measurement";

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
  provenance?: MeasurementProvenance | null;
  value: number | null;
  unit: "count" | "milliseconds" | "percent";
  sourceField: string;
  reason:
    | "not_requested"
    | "not_returned"
    | "not_supported"
    | "permission_required"
    | "invalid_value"
    | "invalid_request"
    | "invalid_breakdown"
    | "object_unavailable"
    | "source_error"
    | "request_deferred"
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
  firstDiscoveredAt?: number | null;
  discoverySource?: "collection" | "history_inferred" | null;
  availability?: { unavailableUntil: number; errorCode: string | null };
  metadata?: {
    provider: "instagram_api";
    apiVersion: string;
    observedAt: number;
    mediaUrl: string | null;
    thumbnailUrl: string | null;
    altText: string | null;
    commentsEnabled: boolean | null;
    sharedToFeed: boolean | null;
    audioType: string | null;
    aiGenerated: boolean | null;
    children:
      | {
          id: string;
          mediaType: string;
          mediaUrl: string | null;
          thumbnailUrl: string | null;
          altText: string | null;
        }[]
      | null;
    childrenComplete: boolean | null;
    unsupportedFields: string[];
  } | null;
};
export type Snapshot = {
  provenance?: ObservationProvenance | null;
  id: string;
  mediaId: string;
  observedAt: number;
  apiVersion: string;
  metrics: Metrics;
  storyInsights?: StoryInsights | null;
  profileActivity?: ProfileActivity | null;
};
export type AccountSnapshot = {
  provenance?: import("../../../shared/domain/measurement").ReceiptReference | null;
  observedAt: number;
  followersCount: number | null;
  mediaCount: number | null;
};
export type SyncRun = {
  usefulValues?: number | null;
  coverageState?: "complete" | "partial" | "empty" | null;
  firstUsefulAt?: number | null;
  lastUsefulAt?: number | null;
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
  navigationTotal?: Metric;
  navigation: Record<string, Metric>;
};
export type ProfileActivity = { total: Metric; actions: Record<string, Metric> };
export type ReportDefinition = {
  provider: string;
  scope: string;
  object: "media";
  aggregation: "lifetime";
  limitations: string[];
};

export type FieldFreshness = {
  lastAttempt: {
    receiptId: string;
    requestStartedAt: number;
    responseReceivedAt: number | null;
    failedAt: number | null;
    status: string;
    httpStatus: number | null;
    graphCode: number | null;
    graphSubcode: number | null;
  } | null;
  lastKnownGood: {
    value: number;
    observedAt: number;
    receiptId: string | null;
    definitionVersion: string | null;
    sourceField: string;
    unit: string;
  } | null;
  currentReason: string | null;
};
