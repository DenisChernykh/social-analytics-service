import type { Account, AccountSnapshot, Media, Metrics, Snapshot, SyncRun } from "../domain/model";

export type MediaFilter = {
  accountId?: string;
  words: string[];
  productType?: string;
  from?: number;
  to?: number;
  limit: number;
  cursor?: string;
};
export interface AnalyticsRepository {
  accounts(): Promise<Account[]>;
  account(id: string): Promise<Account | null>;
  media(id: string): Promise<Media | null>;
  search(filter: MediaFilter): Promise<{ items: Media[]; nextCursor: string | null }>;
  snapshots(mediaId: string, limit: number): Promise<Snapshot[]>;
  latest(mediaIds: string[]): Promise<Map<string, Snapshot>>;
  history(
    mediaId: string,
    from: number | undefined,
    to: number | undefined,
    cursor: string | undefined,
    limit: number,
  ): Promise<{ items: Snapshot[]; nextCursor: string | null }>;
  accountHistory(accountId: string, limit: number): Promise<AccountSnapshot[]>;
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

export interface AnalyticsSource {
  profile(accountId: string): Promise<{
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
  ): Promise<{ metrics: Metrics; observedAt: number; apiVersion: string }>;
}
