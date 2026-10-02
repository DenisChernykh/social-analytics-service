import { and, desc, eq, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  accountSnapshots,
  accounts,
  mediaSnapshots,
  media as mediaTable,
  syncRuns,
} from "../../../platform/database/schema";
import { ApplicationError } from "../../../shared/application/application-error";
import type { AnalyticsRepository, MediaFilter } from "../application/ports";
import type { Account, Media, Metrics, Snapshot, SyncRun } from "../domain/model";
import { normalizeSearch } from "../domain/search";

type Cursor = { time: number; id: string };
function encodeCursor(cursor: Cursor): string {
  return btoa(JSON.stringify(cursor));
}
function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  try {
    const cursor = JSON.parse(atob(value)) as Cursor;
    if (
      !Number.isSafeInteger(cursor.time) ||
      typeof cursor.id !== "string" ||
      cursor.id.length > 200
    )
      throw new Error("Invalid cursor");
    return cursor;
  } catch {
    throw new ApplicationError("VALIDATION_FAILED", "The pagination cursor is invalid.");
  }
}
function mapMedia(row: typeof mediaTable.$inferSelect): Media {
  return {
    id: row.id,
    accountId: row.accountId,
    externalId: row.externalId,
    caption: row.caption,
    title: row.title,
    mediaType: row.mediaType as Media["mediaType"],
    productType: row.productType,
    permalink: row.permalink,
    publishedAt: row.publishedAt,
    durationSeconds: row.durationSeconds,
    durationSource: row.durationSource as Media["durationSource"],
  };
}
function mapSnapshot(row: typeof mediaSnapshots.$inferSelect): Snapshot {
  return {
    id: row.id,
    mediaId: row.mediaId,
    observedAt: row.observedAt,
    apiVersion: row.apiVersion,
    metrics: JSON.parse(row.metricsJson) as Metrics,
  };
}

export class D1Analytics implements AnalyticsRepository {
  private readonly db;
  constructor(private readonly database: D1Database) {
    this.db = drizzle(database);
  }
  async accounts() {
    return (await this.db.select().from(accounts).orderBy(accounts.username)) as Account[];
  }
  async account(id: string) {
    return (
      ((await this.db.select().from(accounts).where(eq(accounts.id, id)).limit(1))[0] as
        | Account
        | undefined) ?? null
    );
  }
  async media(id: string) {
    const row = (await this.db.select().from(mediaTable).where(eq(mediaTable.id, id)).limit(1))[0];
    return row ? mapMedia(row) : null;
  }
  async search(filter: MediaFilter) {
    const cursor = decodeCursor(filter.cursor);
    const conditions = filter.words.map((word) =>
      or(
        sql`instr(${mediaTable.searchText}, ${word}) > 0`,
        sql`instr(${mediaTable.titleSearch}, ${word}) > 0`,
      ),
    );
    if (filter.accountId) conditions.push(eq(mediaTable.accountId, filter.accountId));
    if (filter.productType) conditions.push(eq(mediaTable.productType, filter.productType));
    if (filter.from !== undefined) conditions.push(gte(mediaTable.publishedAt, filter.from));
    if (filter.to !== undefined) conditions.push(lte(mediaTable.publishedAt, filter.to));
    if (cursor)
      conditions.push(
        or(
          lt(mediaTable.publishedAt, cursor.time),
          and(eq(mediaTable.publishedAt, cursor.time), lt(mediaTable.id, cursor.id)),
        ),
      );
    const rows = await this.db
      .select()
      .from(mediaTable)
      .where(and(...conditions))
      .orderBy(desc(mediaTable.publishedAt), desc(mediaTable.id))
      .limit(filter.limit + 1);
    const items = rows.slice(0, filter.limit).map(mapMedia);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > filter.limit && last
          ? encodeCursor({ time: last.publishedAt, id: last.id })
          : null,
    };
  }
  async snapshots(mediaId: string, limit: number) {
    return (
      await this.db
        .select()
        .from(mediaSnapshots)
        .where(eq(mediaSnapshots.mediaId, mediaId))
        .orderBy(desc(mediaSnapshots.observedAt), desc(mediaSnapshots.id))
        .limit(limit)
    ).map(mapSnapshot);
  }
  async latest(mediaIds: string[]) {
    const result = new Map<string, Snapshot>();
    for (let start = 0; start < mediaIds.length; start += 50) {
      const ids = mediaIds.slice(start, start + 50);
      const rows = await this.db
        .select()
        .from(mediaSnapshots)
        .where(
          and(
            inArray(mediaSnapshots.mediaId, ids),
            sql`not exists (
        select 1 from media_snapshots newer where newer.media_id = ${mediaSnapshots.mediaId}
        and (newer.observed_at > ${mediaSnapshots.observedAt} or (newer.observed_at = ${mediaSnapshots.observedAt} and newer.id > ${mediaSnapshots.id}))
      )`,
          ),
        );
      for (const row of rows) result.set(row.mediaId, mapSnapshot(row));
    }
    return result;
  }
  async history(
    mediaId: string,
    from: number | undefined,
    to: number | undefined,
    value: string | undefined,
    limit: number,
  ) {
    const cursor = decodeCursor(value);
    const conditions = [eq(mediaSnapshots.mediaId, mediaId)];
    if (from !== undefined) conditions.push(gte(mediaSnapshots.observedAt, from));
    if (to !== undefined) conditions.push(lte(mediaSnapshots.observedAt, to));
    if (cursor)
      conditions.push(
        or(
          lt(mediaSnapshots.observedAt, cursor.time),
          and(eq(mediaSnapshots.observedAt, cursor.time), lt(mediaSnapshots.id, cursor.id)),
        ) as NonNullable<(typeof conditions)[number]>,
      );
    const rows = await this.db
      .select()
      .from(mediaSnapshots)
      .where(and(...conditions))
      .orderBy(desc(mediaSnapshots.observedAt), desc(mediaSnapshots.id))
      .limit(limit + 1);
    const items = rows.slice(0, limit).map(mapSnapshot);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > limit && last ? encodeCursor({ time: last.observedAt, id: last.id }) : null,
    };
  }
  async accountHistory(accountId: string, limit: number) {
    const rows = await this.db
      .select()
      .from(accountSnapshots)
      .where(eq(accountSnapshots.accountId, accountId))
      .orderBy(desc(accountSnapshots.observedAt), desc(accountSnapshots.id))
      .limit(limit);
    return rows.map((row) => ({
      observedAt: row.observedAt,
      followersCount: row.followersCount,
      mediaCount: row.mediaCount,
    }));
  }
  async updateMedia(
    id: string,
    input: { title?: string | null; durationSeconds?: number | null },
    now: number,
  ) {
    await this.db
      .update(mediaTable)
      .set({
        updatedAt: now,
        ...(input.title !== undefined
          ? { title: input.title, titleSearch: normalizeSearch(input.title ?? "") }
          : {}),
        ...(input.durationSeconds !== undefined
          ? {
              durationSeconds: input.durationSeconds,
              durationSource: input.durationSeconds === null ? null : "manual",
            }
          : {}),
      })
      .where(eq(mediaTable.id, id));
  }
  async run(id: string) {
    return (
      ((await this.db.select().from(syncRuns).where(eq(syncRuns.id, id)).limit(1))[0] as
        | SyncRun
        | undefined) ?? null
    );
  }
  async begin(run: SyncRun, leaseExpiresAt: number) {
    const result = await this.database
      .prepare(`INSERT INTO sync_leases (account_id,run_id,expires_at) VALUES (?,?,?)
      ON CONFLICT(account_id) DO UPDATE SET run_id=excluded.run_id,expires_at=excluded.expires_at
      WHERE sync_leases.expires_at <= ?`)
      .bind(run.accountId, run.id, leaseExpiresAt, run.startedAt)
      .run();
    if (result.meta.changes !== 1) return false;
    await this.db.batch([
      this.db
        .update(syncRuns)
        .set({ status: "failed", completedAt: run.startedAt, errorCode: "SYNC_LEASE_EXPIRED" })
        .where(
          and(
            eq(syncRuns.accountId, run.accountId),
            eq(syncRuns.status, "running"),
            lte(syncRuns.leaseExpiresAt, run.startedAt),
          ),
        ),
      this.db
        .insert(syncRuns)
        .values({ ...run, leaseExpiresAt })
        .onConflictDoNothing(),
    ]);
    return true;
  }
  async finish(
    run: SyncRun,
    profile: {
      username: string;
      accountType: string;
      followersCount: number | null;
      mediaCount: number | null;
    },
    items: Array<{ media: Media; snapshot: Snapshot }>,
    now: number,
  ) {
    const guard =
      "EXISTS (SELECT 1 FROM sync_leases WHERE account_id=? AND run_id=? AND expires_at>?)";
    const fence = [run.accountId, run.id, now];
    const statements: D1PreparedStatement[] = [];
    for (const item of items) {
      const media = item.media;
      statements.push(
        this.database
          .prepare(`INSERT INTO media (id,account_id,external_id,caption,search_text,media_type,product_type,permalink,published_at,updated_at)
        SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard}
        ON CONFLICT(id) DO UPDATE SET caption=excluded.caption,search_text=excluded.search_text,media_type=excluded.media_type,
        product_type=excluded.product_type,permalink=excluded.permalink,published_at=excluded.published_at,updated_at=excluded.updated_at`)
          .bind(
            media.id,
            media.accountId,
            media.externalId,
            media.caption,
            normalizeSearch(`${media.caption} ${media.permalink}`),
            media.mediaType,
            media.productType,
            media.permalink,
            media.publishedAt,
            now,
            ...fence,
          ),
      );
      const snapshot = item.snapshot;
      statements.push(
        this.database
          .prepare(`INSERT INTO media_snapshots (id,media_id,observed_at,api_version,metrics_json)
        SELECT ?,?,?,?,? WHERE ${guard} ON CONFLICT(id) DO NOTHING`)
          .bind(
            snapshot.id,
            snapshot.mediaId,
            snapshot.observedAt,
            snapshot.apiVersion,
            JSON.stringify(snapshot.metrics),
            ...fence,
          ),
      );
    }
    statements.push(
      this.database
        .prepare(`INSERT INTO account_snapshots (id,account_id,observed_at,followers_count,media_count)
      SELECT ?,?,?,?,? WHERE ${guard} ON CONFLICT(id) DO NOTHING`)
        .bind(run.id, run.accountId, now, profile.followersCount, profile.mediaCount, ...fence),
    );
    statements.push(
      this.database
        .prepare(
          `UPDATE accounts SET username=?,account_type=?,last_synced_at=? WHERE id=? AND ${guard}`,
        )
        .bind(profile.username, profile.accountType, now, run.accountId, ...fence),
    );
    const completedIndex = statements.length;
    statements.push(
      this.database
        .prepare(
          `UPDATE sync_runs SET status='completed',completed_at=?,next_cursor=?,media_count=? WHERE id=? AND ${guard}`,
        )
        .bind(now, run.nextCursor, run.mediaCount, run.id, ...fence),
    );
    statements.push(
      this.database
        .prepare("DELETE FROM sync_leases WHERE account_id=? AND run_id=?")
        .bind(run.accountId, run.id),
    );
    const results = await this.database.batch(statements);
    if (results[completedIndex]?.meta.changes !== 1)
      throw new ApplicationError(
        "SYNC_IN_PROGRESS",
        "The sync lease expired; start a new sync operation.",
      );
  }
  async fail(run: SyncRun, code: string, now: number) {
    await this.database.batch([
      this.database
        .prepare(
          "UPDATE sync_runs SET status='failed',completed_at=?,error_code=? WHERE id=? AND account_id=? AND status='running'",
        )
        .bind(now, code, run.id, run.accountId),
      this.database
        .prepare("DELETE FROM sync_leases WHERE account_id=? AND run_id=?")
        .bind(run.accountId, run.id),
    ]);
  }
}
