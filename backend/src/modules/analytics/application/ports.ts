import type {
  Account,
  AccountSnapshot,
  Media,
  Metrics,
  ProfileActivity,
  Snapshot,
  StoryInsights,
  SyncRun,
} from "../domain/model";

export type MediaFilter = {
  accountId?: string;
  words: string[];
  productType?: string;
  from?: number;
  to?: number;
  limit: number;
  cursor?: string;
  query?: string;
  exactTitle?: string;
  rubric?: string;
  goal?: string;
  format?: string;
};
export type AccountHistoryInput = {
  from?: number;
  to?: number;
  cursor?: string;
  limit: number;
};
export interface AnalyticsRepository {
  accounts(): Promise<Account[]>;
  account(id: string): Promise<Account | null>;
  media(id: string): Promise<Media | null>;
  selectedMedia(ids: string[]): Promise<Media[]>;
  search(filter: MediaFilter): Promise<{ items: Media[]; nextCursor: string | null }>;
  snapshots(mediaId: string, limit: number): Promise<Snapshot[]>;
  metricFreshness(
    mediaId: string,
  ): Promise<Record<import("../domain/model").MetricKey, import("../domain/model").FieldFreshness>>;
  latest(mediaIds: string[]): Promise<Map<string, Snapshot>>;
  atAge(
    mediaIds: string[],
    ageDays: number,
    selection?: { metric: import("../domain/model").MetricKey; denominator?: "reach" | "views" },
  ): Promise<Map<string, Snapshot>>;
  history(
    mediaId: string,
    from: number | undefined,
    to: number | undefined,
    cursor: string | undefined,
    limit: number,
  ): Promise<{ items: Snapshot[]; nextCursor: string | null }>;
  accountHistory(
    accountId: string,
    input: AccountHistoryInput,
  ): Promise<{
    items: AccountSnapshot[];
    nextCursor: string | null;
    totalObservations: number;
    first: AccountSnapshot | null;
    last: AccountSnapshot | null;
  }>;
  updateMedia(
    id: string,
    input: { title?: string | null; durationSeconds?: number | null },
    now: number,
  ): Promise<void>;
  run(id: string): Promise<SyncRun | null>;
  begin(run: SyncRun, leaseExpiresAt: number): Promise<boolean>;
  finish(
    run: SyncRun,
    profile: {
      observedAt?: number;
      receipt?: import("../../instagram/public-contracts").ReceiptReference;
      username: string;
      accountType: string;
      followersCount: number | null;
      mediaCount: number | null;
    },
    items: Array<{ media: Media; snapshot: Snapshot }>,
    now: number,
  ): Promise<void>;
  fail(run: SyncRun, code: string, now: number): Promise<void>;
}

export type MediaStatistics = {
  provenance?: import("../../../shared/domain/measurement").ObservationProvenance | null;
  metrics: Metrics;
  observedAt: number;
  apiVersion: string;
  storyInsights?: StoryInsights | null;
  profileActivity?: ProfileActivity | null;
};
export interface AnalyticsSource {
  requestStats?(): { attempts: number };
  beginOperation?(operationId: string): void;
  media(
    account: Account,
    externalId: string,
  ): Promise<{ media: Media; initialMetrics: Partial<Metrics> }>;
  profile(accountId: string): Promise<{
    receipt?: import("../../instagram/public-contracts").ReceiptReference;
    observedAt?: number;
    userId: string;
    username: string;
    accountType: string;
    followersCount: number | null;
    mediaCount: number | null;
  }>;
  mediaPage(
    account: Account,
    cursor: string | null,
    limit: number,
  ): Promise<{
    items: Array<{ media: Media; initialMetrics: Partial<Metrics> }>;
    nextCursor: string | null;
  }>;
  metrics(
    accountId: string,
    item: { media: Media; initialMetrics: Partial<Metrics> },
  ): Promise<MediaStatistics>;
  additionalMetrics?(
    accountId: string,
    item: { media: Media; initialMetrics: Partial<Metrics> },
    current: MediaStatistics,
  ): Promise<MediaStatistics>;
  stories(
    account: Account,
    cursor: string | null,
    limit: number,
  ): Promise<{
    items: Array<{ media: Media; initialMetrics: Partial<Metrics> }>;
    nextCursor: string | null;
  }>;
}
