import type { SyncRun } from "../../analytics/public-contracts";
import type { CommentCollection } from "../../community";
import type { DueAgeSnapshot } from "../domain/age-policy";
import type { CommentCheckpoint } from "../domain/comment-policy";
import type { CataloguePosition, CollectionJob, CollectionSchedule } from "../domain/model";

export interface CollectionStore {
  job(id: string): Promise<CollectionJob | null>;
  jobs(accountId?: string): Promise<CollectionJob[]>;
  nextJob(now: number): Promise<string | null>;
  create(job: CollectionJob): Promise<void>;
  claim(id: string, token: string, now: number): Promise<CollectionJob | null>;
  save(job: CollectionJob, token: string, now: number, comment?: CommentCheckpoint): Promise<void>;
  control(id: string, status: "running" | "cancelled", now: number): Promise<void>;
  schedule(accountId: string): Promise<CollectionSchedule | null>;
  nextSchedule(now: number): Promise<CollectionSchedule | null>;
  saveSchedule(schedule: CollectionSchedule): Promise<void>;
  dueMedia(accountId: string, now: number): Promise<string | null>;
  dueAgeMedia(accountId: string, now: number): Promise<DueAgeSnapshot | null>;
  sawKnownMedia(operationId: string, startedAt: number): Promise<boolean>;
  finishSchedule(schedule: CollectionSchedule, version: number): Promise<void>;
  latestJob(accountId: string, origin: CollectionJob["origin"]): Promise<CollectionJob | null>;
  nextCommentMedia(
    accountId: string,
    after: CataloguePosition | null,
    before: number,
  ): Promise<CataloguePosition | null>;
  nextCommentRefresh(accountId: string, now: number): Promise<CataloguePosition | null>;
  commentGeneration(mediaId: string): Promise<number>;
  receiveCommentEvent(
    accountId: string,
    externalMediaId: string,
    id: string,
    sentAt: number,
    now: number,
  ): Promise<void>;
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
export interface CollectionAnalytics {
  activity(accountId: string, operationId: string, now: number): Promise<void>;
  audience(
    accountId: string,
    operationId: string,
    dimension: "age" | "gender" | "country" | "city",
  ): Promise<number>;
  account(id: string): Promise<unknown>;
  refresh(mediaId: string, operationId: string): Promise<SyncRun>;
  page(
    accountId: string,
    operationId: string,
    cursor: string | null,
    stories: boolean,
  ): Promise<SyncRun>;
}
