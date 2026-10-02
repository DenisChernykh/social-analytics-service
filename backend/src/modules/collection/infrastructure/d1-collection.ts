import { and, eq, gt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { collectionJobs, collectionSchedules } from "../../../platform/database/schema";
import type { CollectionStore } from "../application/ports";
import type { CollectionJob, CollectionSchedule } from "../domain/model";

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
  async claim(id: string, token: string, now: number) {
    const result = await this.database
      .prepare(
        "UPDATE collection_jobs SET lease_token=?,lease_expires_at=? WHERE id=? AND status='running' AND next_attempt_at<=? AND (lease_expires_at IS NULL OR lease_expires_at<=?)",
      )
      .bind(token, now + 15 * 60_000, id, now, now)
      .run();
    return result.meta.changes === 1;
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
  async schedules() {
    return this.db
      .select()
      .from(collectionSchedules)
      .where(eq(collectionSchedules.enabled, true))
      .orderBy(collectionSchedules.retryAt, collectionSchedules.nextDiscoveryAt)
      .limit(100);
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
