export type CollectionJob = {
  latencyOrigin?: "recorded_from_creation" | null;
  httpAttemptsSinceAt?: number | null;
  firstAttemptAt?: number | null;
  lastAttemptAt?: number | null;
  firstUsefulObservationAt?: number | null;
  lastUsefulObservationAt?: number | null;
  httpAttempts?: number;
  lastStepDurationMs?: number | null;
  lastStepHttpAttempts?: number | null;
  leaseToken?: string | null;
  leaseExpiresAt?: number | null;
  id: string;
  accountId: string;
  origin:
    | "manual"
    | "scheduled"
    | "stories"
    | "comments"
    | "comments_refresh"
    | "audience"
    | "activity"
    | "catalogue";
  targetMediaId?: string | null;
  automatic: boolean;
  status: "running" | "completed" | "failed" | "cancelled";
  cursor: string | null;
  pages: number;
  collected: number;
  mediaProcessed: number;
  skippedMedia: number;
  skippedPeriods: number;
  attempt: number;
  failures: number;
  nextAttemptAt: number;
  startedAt: number;
  completedAt: number | null;
  lastSuccessAt: number | null;
  errorCode: string | null;
};
export type CataloguePosition = { id: string; publishedAt: number };
export type CommentEvent = {
  accountId: string;
  externalMediaId: string;
  id: string;
  sentAt: number;
};
export type CommentPosition = {
  version?: 2;
  afterMedia: CataloguePosition | null;
  current: CataloguePosition | null;
  commentCursor: string | null;
  parents: string[];
  replyCursor: string | null;
  branchCursors?: Record<string, string | null>;
  omittedBranches?: number;
  omittedProbeCount?: number;
  unverifiedParents?: string[];
  eventGeneration?: number;
};
export type CollectionSchedule = {
  claimToken?: string | null;
  claimExpiresAt?: number | null;
  accountId: string;
  enabled: boolean;
  discoveryMinutes: number;
  timeZone: string;
  nextCatalogueAt: number;
  nextDiscoveryAt: number;
  nextStoriesAt: number;
  nextInsightsAt: number;
  updatedAt: number;
  lastSuccessAt: number | null;
  errorCode: string | null;
  failures: number;
  retryAt: number;
};
export function retryDelay(failures: number): number {
  return Math.min(24 * 60, 15 * 2 ** Math.min(failures, 7)) * 60_000;
}
