import { and, eq, gt, lt, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { collectionJobs, collectionSchedules } from "../../../platform/database/schema";
import type { CollectionStore } from "../application/ports";
import type { CataloguePosition, CollectionJob, CollectionSchedule } from "../domain/model";

export class D1Collection implements CollectionStore {
  private readonly db;
  constructor(private readonly database: D1Database) {
    this.db = drizzle(database);
  }
  async job(id: string) {
    return (
      ((await this.db.select().from(collectionJobs).where(eq(collectionJobs.id, id)).limit(1))[0] as
        | CollectionJob
        | undefined) ?? null
    );
  }
  async jobs(accountId?: string) {
    return (await this.db
      .select()
      .from(collectionJobs)
      .where(
        accountId ? eq(collectionJobs.accountId, accountId) : eq(collectionJobs.status, "running"),
      )
      .orderBy(
        sql`CASE WHEN ${collectionJobs.status}='running' THEN 0 ELSE 1 END`,
        collectionJobs.nextAttemptAt,
        collectionJobs.startedAt,
      )
      .limit(100)) as CollectionJob[];
  }
  async create(job: CollectionJob) {
    await this.db.insert(collectionJobs).values(job).onConflictDoNothing();
  }
  async nextJob(now: number) {
    // A small head start for short-lived Stories and discovery, with aging so
    // older catalogue/comments work still progresses. Leased jobs cannot hide
    // available work behind the status endpoint's 100-row display limit.
    const row = await this.database
      .prepare(
        `SELECT id FROM collection_jobs
         WHERE status='running' AND next_attempt_at<=?
           AND (lease_expires_at IS NULL OR lease_expires_at<=?)
         ORDER BY next_attempt_at - CASE origin WHEN 'stories' THEN 900000 WHEN 'scheduled' THEN 300000 ELSE 0 END,
           started_at,id LIMIT 1`,
      )
      .bind(now, now)
      .first<{ id: string }>();
    return row?.id ?? null;
  }
  async latestJob(accountId: string, origin: CollectionJob["origin"]) {
    return (
      ((
        await this.db
          .select()
          .from(collectionJobs)
          .where(and(eq(collectionJobs.accountId, accountId), eq(collectionJobs.origin, origin)))
          .orderBy(
            sql`CASE WHEN ${collectionJobs.status}='running' THEN 0 ELSE 1 END`,
            sql`${collectionJobs.startedAt} DESC`,
            sql`${collectionJobs.id} DESC`,
          )
          .limit(1)
      )[0] as CollectionJob | undefined) ?? null
    );
  }
  async nextCommentMedia(accountId: string, after: CataloguePosition | null, before: number) {
    const statement = this.database.prepare(
      `SELECT id,published_at AS publishedAt FROM media WHERE account_id=? AND product_type!='STORY' AND published_at<=? ${after ? "AND (published_at<? OR (published_at=? AND id<?))" : ""} ORDER BY published_at DESC,id DESC LIMIT 1`,
    );
    return (
      after
        ? statement.bind(accountId, before, after.publishedAt, after.publishedAt, after.id)
        : statement.bind(accountId, before)
    ).first<CataloguePosition>();
  }
  async claim(id: string, token: string, now: number) {
    const rows = await this.db
      .update(collectionJobs)
      .set({ leaseToken: token, leaseExpiresAt: now + 15 * 60_000 })
      .where(
        and(
          eq(collectionJobs.id, id),
          eq(collectionJobs.status, "running"),
          lte(collectionJobs.nextAttemptAt, now),
          sql`(${collectionJobs.leaseExpiresAt} IS NULL OR ${collectionJobs.leaseExpiresAt}<=${now})`,
        ),
      )
      .returning();
    return (rows[0] as CollectionJob | undefined) ?? null;
  }
  async save(job: CollectionJob, token: string, now: number) {
    await this.db
      .update(collectionJobs)
      .set({ ...job, leaseToken: null, leaseExpiresAt: null })
      .where(
        and(
          eq(collectionJobs.id, job.id),
          eq(collectionJobs.status, "running"),
          eq(collectionJobs.leaseToken, token),
          gt(collectionJobs.leaseExpiresAt, now),
        ),
      );
  }
  async control(id: string, status: "running" | "cancelled", now: number) {
    await this.database
      .prepare(
        "UPDATE collection_jobs SET status=?,next_attempt_at=?,failures=0,completed_at=?,lease_token=NULL,lease_expires_at=NULL WHERE id=? AND (lease_expires_at IS NULL OR lease_expires_at<=? OR ?='cancelled') AND status != 'completed'",
      )
      .bind(status, now, status === "cancelled" ? now : null, id, now, status)
      .run();
  }
  async schedule(accountId: string) {
    return (
      (
        await this.db
          .select()
          .from(collectionSchedules)
          .where(eq(collectionSchedules.accountId, accountId))
          .limit(1)
      )[0] ?? null
    );
  }
  async nextSchedule(now: number) {
    const rows = await this.db
      .select()
      .from(collectionSchedules)
      .where(
        and(
          eq(collectionSchedules.enabled, true),
          lt(collectionSchedules.failures, 5),
          lte(collectionSchedules.retryAt, now),
        ),
      )
      .orderBy(collectionSchedules.retryAt, collectionSchedules.nextDiscoveryAt)
      .limit(1);
    return rows[0] ?? null;
  }
  async saveSchedule(schedule: CollectionSchedule) {
    await this.db
      .insert(collectionSchedules)
      .values(schedule)
      .onConflictDoUpdate({ target: collectionSchedules.accountId, set: schedule });
  }
  async dueMedia(accountId: string, now: number) {
    const row = await this.database
      .prepare(`SELECT m.id FROM media m LEFT JOIN (SELECT media_id,MAX(observed_at) observed_at FROM media_snapshots GROUP BY media_id) s ON m.id=s.media_id
      WHERE m.account_id=? AND m.product_type!='STORY' AND COALESCE(s.observed_at,0) <= ? - CASE WHEN ?-m.published_at < 2*86400000 THEN 3600000 WHEN ?-m.published_at < 8*86400000 THEN 21600000 WHEN ?-m.published_at < 31*86400000 THEN 86400000 ELSE 604800000 END
      ORDER BY COALESCE(s.observed_at,0),m.published_at DESC LIMIT 1`)
      .bind(accountId, now, now, now, now)
      .first<{ id: string }>();
    return row?.id ?? null;
  }
  async sawKnownMedia(operationId: string, startedAt: number) {
    const row = await this.database
      .prepare(
        "SELECT 1 AS found FROM media_snapshots current WHERE substr(current.id,1,36)=? AND EXISTS (SELECT 1 FROM media_snapshots previous WHERE previous.media_id=current.media_id AND previous.id!=current.id AND previous.observed_at<=?) LIMIT 1",
      )
      .bind(operationId, startedAt)
      .first();
    return row !== null;
  }
  async finishSchedule(schedule: CollectionSchedule, version: number) {
    await this.db
      .update(collectionSchedules)
      .set(schedule)
      .where(
        and(
          eq(collectionSchedules.accountId, schedule.accountId),
          eq(collectionSchedules.enabled, true),
          eq(collectionSchedules.updatedAt, version),
        ),
      );
  }
}
