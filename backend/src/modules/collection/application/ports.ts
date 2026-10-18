import type { ActivityPeriod, ActivityPeriodPlan } from "../../account-insights";
import type { SyncRun } from "../../analytics/public-contracts";
import type { CommentCollection } from "../../community";
import type { InstagramApiStatus } from "../../instagram/public-contracts";
import type { DueAgeSnapshot } from "../domain/age-policy";
import type { CommentCheckpoint } from "../domain/comment-policy";
import type {
  CataloguePosition,
  CollectionJob,
  CollectionSchedule,
  CommentEvent,
} from "../domain/model";

export interface CollectionStore {
  job(id: string): Promise<CollectionJob | null>;
  jobs(accountId?: string): Promise<CollectionJob[]>;
  jobPage(
    accountId: string,
    input: { limit: number; cursor?: string },
    now: number,
  ): Promise<{
    items: CollectionJob[];
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
    cutoff: number;
    total: number;
    aggregates: {
      origin: string;
      status: string;
      count: number;
      due: number;
      oldestDue: number | null;
      atRiskFresh: number;
      freshDue: number;
      lastAttempt: number | null;
      lastSuccess: number | null;
      lastUsefulObservation: number | null;
    }[];
  }>;
  dataFreshness(accountId: string): Promise<
    {
      kind: string;
      objects: number;
      lastAttempt: number | null;
      lastCheck: number | null;
      lastSuccess: number | null;
      lastUsefulObservation: number | null;
      legacyProvenanceUnknown: number;
    }[]
  >;
  mediaRefreshStatus(
    accountId: string,
    now: number,
  ): Promise<{
    publications: number;
    missingSnapshots: number;
    staleSnapshots: number;
    ready: number;
    deferred: number;
    retries: { errorCode: string; count: number; nextAttemptAt: number | null }[];
  }>;
  diagnostics(
    accountId: string,
    now: number,
  ): Promise<{
    expiredSyncAttempts: number;
    expiredInsightAttempts: number;
    expiredCommentAttempts: number;
    leasesInUse: number;
  }>;
  claimSchedule(accountId: string, token: string, now: number): Promise<boolean>;
  releaseSchedule(accountId: string, token: string): Promise<void>;
  recordPolicy(accountId: string, enabled: boolean, now: number, policy: unknown): Promise<void>;
  pendingJobs(): Promise<CollectionJob[]>;
  nextWakeAt(now: number, idleCheckMs: number): Promise<number | null>;
  create(job: CollectionJob): Promise<void>;
  claim(id: string, token: string, now: number): Promise<CollectionJob | null>;
  save(job: CollectionJob, token: string, now: number, comment?: CommentCheckpoint): Promise<void>;
  control(id: string, status: "running" | "cancelled", now: number): Promise<void>;
  schedule(accountId: string): Promise<CollectionSchedule | null>;
  enabledSchedules(): Promise<CollectionSchedule[]>;
  saveSchedule(schedule: CollectionSchedule): Promise<void>;
  dueMedia(accountId: string, now: number): Promise<string | null>;
  dueAgeMedia(accountId: string, now: number): Promise<DueAgeSnapshot | null>;
  markUnavailable(mediaId: string, until: number, code: string): Promise<void>;
  nextStoryExpiry(accountId: string, now: number): Promise<number | null>;
  coverage(
    accountId: string,
    now: number,
  ): Promise<{
    discovery: {
      measuredPublications: number;
      inferredPublications: number;
      averageLagMinutes: number | null;
      maximumLagMinutes: number | null;
      overOneHour: number;
      measurementState?: "measured" | "not_measured";
      denominator?: number;
    };
    ageSnapshots: {
      targetHours: number;
      expected: number;
      captured: number;
      open: number;
      missed: number;
    }[];
    catalogue: { lastFullPassAt: number | null; currentJobId: string | null };
    analysisCoverage?: ReturnType<typeof import("../domain/coverage").ageCoverage>[];
    collectionCoverage?: ReturnType<typeof import("../domain/coverage").ageCoverage>[];
  }>;
  sawKnownMedia(operationId: string, startedAt: number): Promise<boolean>;
  finishSchedule(schedule: CollectionSchedule, version: number): Promise<void>;
  latestJob(accountId: string, origin: CollectionJob["origin"]): Promise<CollectionJob | null>;
  replanActivity(job: CollectionJob, periods: ActivityPeriod[], now: number): Promise<boolean>;
  nextCommentMedia(
    accountId: string,
    after: CataloguePosition | null,
    before: number,
    now?: number,
  ): Promise<CataloguePosition | null>;
  nextCommentRefresh(accountId: string, now: number): Promise<CataloguePosition | null>;
  commentGeneration(mediaId: string): Promise<number>;
  receiveCommentEvents(events: CommentEvent[], now: number): Promise<void>;
  confirmCommentSubscription(accountId: string, now: number): Promise<void>;
  commentStatus(
    accountId: string,
    now: number,
  ): Promise<{
    lastFullPassAt: number | null;
    publications: number;
    uniqueComments: number;
    stalePublications: number;
    partialPublications: number;
    pendingReplyBranches: number;
    unverifiedReplyBranches: number;
    unavailablePublications: number;
    currentPass: {
      id: string;
      status: string;
      mediaProcessed: number;
      remainingPublications: number;
      observations: number;
      errorCode: string | null;
    } | null;
    webhook: {
      subscriptionConfirmedAt: number | null;
      lastReceivedAt: number | null;
      lastEventAt: number | null;
      active: boolean;
    };
  }>;
}
export interface CollectionComments {
  requestStats?(): { attempts: number };
  enabled(accountId: string): Promise<boolean>;
  isRootComment(mediaId: string, id: string): Promise<boolean>;
  rootCommentIds(mediaId: string, ids: string[]): Promise<string[]>;
  savedCollection(id: string): Promise<CommentCollection | null>;
  collect(
    mediaId: string,
    input: {
      operationId: string;
      parentId: string | null;
      cursor: string | null;
      limit: number;
      expandReplies?: boolean;
      ownership?: { jobId: string; leaseToken: string };
    },
  ): Promise<CommentCollection>;
}
export type UsefulPortion = {
  collected: number;
  firstUsefulAt: number | null;
  lastUsefulAt: number | null;
};
export interface CollectionAnalytics {
  requestStats?(): { attempts: number };
  activity(
    accountId: string,
    operationId: string,
    period: ActivityPeriod,
  ): Promise<number | UsefulPortion>;
  activityPlan(accountId: string, timeZone: string, now: number): Promise<ActivityPeriodPlan>;
  apiStatus(accountId: string): Promise<InstagramApiStatus>;
  audience(
    accountId: string,
    operationId: string,
    dimension: "age" | "gender" | "country" | "city",
  ): Promise<number | UsefulPortion>;
  account(id: string): Promise<unknown>;
  refresh(mediaId: string, operationId: string): Promise<SyncRun>;
  page(
    accountId: string,
    operationId: string,
    cursor: string | null,
    stories: boolean,
  ): Promise<SyncRun>;
}
