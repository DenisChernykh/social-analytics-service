export type CollectionJob = {
  id: string;
  accountId: string;
  origin: "manual" | "scheduled" | "stories" | "comments" | "comments_refresh" | "audience";
  targetMediaId?: string | null;
  automatic: boolean;
  status: "running" | "completed" | "failed" | "cancelled";
  cursor: string | null;
  pages: number;
  collected: number;
  mediaProcessed: number;
  attempt: number;
  failures: number;
  nextAttemptAt: number;
  startedAt: number;
  completedAt: number | null;
  lastSuccessAt: number | null;
  errorCode: string | null;
};
export type CataloguePosition = { id: string; publishedAt: number };
export type CommentPosition = {
  version?: 2;
  afterMedia: CataloguePosition | null;
  current: CataloguePosition | null;
  commentCursor: string | null;
  parents: string[];
  replyCursor: string | null;
  branchCursors?: Record<string, string | null>;
  omittedBranches?: number;
  eventGeneration?: number;
};
export type CollectionSchedule = {
  accountId: string;
  enabled: boolean;
  discoveryMinutes: number;
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
