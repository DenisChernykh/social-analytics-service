import type { RuntimeBindings } from "../../platform/config/runtime-config";
import { sha256 } from "../../platform/crypto/secrets";
import type { ReceiptReference } from "../../shared/domain/measurement";
import { type CommentWebhookPort, InstagramCommentWebhooks } from "./application/comment-webhooks";
import { createInstagramOperations, type InstagramModuleOptions } from "./index";
import { verifyWebhookSignature } from "./infrastructure/webhook-signature";
import { createCommentWebhooksHttp } from "./presentation/comment-webhooks";
import { createInstagramHttp } from "./presentation/http";

export type { ReceiptReference } from "../../shared/domain/measurement";

export type RequestBudget = {
  maxAttempts: number;
  attempts: number;
  deadlineAt: number;
  reserveMs: number;
};
export type InstagramProfile = {
  receipt?: ReceiptReference;
  userId: string;
  username: string;
  accountType: string;
  followersCount: number | null;
  mediaCount: number | null;
};
export type InstagramMedia = {
  receipt?: ReceiptReference;
  id: string;
  caption: string;
  mediaType: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  productType: string;
  permalink: string;
  timestamp: number;
  likeCount: number | null;
  commentsCount: number | null;
  metadata?: InstagramMediaMetadata;
};
export type InstagramMediaMetadata = {
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
};
export type InstagramApiStatus = {
  recordedRequests: number;
  sinceAt: number | null;
  usagePercent: number | null;
  usageObservedAt: number | null;
  blockedUntil: number;
  observedAt: number | null;
  cachedUnavailableMetrics: number;
  http?: {
    attempts: number;
    responses: number;
    failuresBeforeResponse: number;
    timeouts: number;
    rateLimitedResponses: number;
    sinceAt: number | null;
  };
  usageHeaders?: {
    app: { state: "absent" | "recognized" | "unknown_schema" | "malformed"; sample: string | null };
    business: {
      state: "absent" | "recognized" | "unknown_schema" | "malformed";
      sample: string | null;
    };
    receivedAt: number | null;
  };
  quotaFreshness?: "unknown" | "fresh" | "stale";
  quotaStaleAfterMs?: number;
};
export type InstagramInsight = {
  receipt?: ReceiptReference;
  value: number | null;
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
    | "before_account_conversion"
    | null;
};
export interface InstagramReader {
  requestStats?(): { attempts: number };
  forOperation?(operationId: string): InstagramReader;
  subscribeComments(accountId: string): Promise<void>;
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
  structuredInsightsBatch(
    accountId: string,
    objectId: string,
    query: InsightBatchQuery,
  ): Promise<StructuredInsight[]>;
  apiStatus(accountId: string): Promise<InstagramApiStatus>;
  comments(
    accountId: string,
    objectId: string,
    replies: boolean,
    cursor: string | null,
    limit: number,
    expandReplies?: boolean,
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
export type InsightBatchQuery = Omit<InsightQuery, "metric"> & { metrics: string[] };
export type StructuredInsight = {
  receipt?: ReceiptReference;
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
  receipt?: ReceiptReference;
  items: {
    id: string;
    text: string;
    publishedAt: number;
    parentId?: string | null;
    authorId?: string | null;
    authorUsername?: string | null;
    likeCount?: number | null;
    hidden?: boolean | null;
  }[];
  nextCursor: string | null;
  replyBranches?: {
    parentId: string;
    nextCursor: string | null;
    status: "exhausted" | "partial" | "omitted";
  }[];
};

export function createInstagramModule(options: InstagramModuleOptions = {}) {
  return { router: createInstagramHttp((env) => createInstagramOperations(env, options)) };
}
export function createCommentWebhookModule(options: {
  port: (env: RuntimeBindings) => Omit<CommentWebhookPort, "digest" | "verify">;
}) {
  return {
    router: createCommentWebhooksHttp(
      (env) =>
        new InstagramCommentWebhooks({
          ...options.port(env),
          digest: sha256,
          verify: (body, signature) =>
            verifyWebhookSignature(body, signature, env.INSTAGRAM_CLIENT_SECRET ?? ""),
        }),
    ),
  };
}
