import { and, eq, lt, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { collectionJobs, collectionSchedules } from "../../../platform/database/schema";
import type { CollectionStore } from "../application/ports";
import { ageSnapshotWindows, type DueAgeSnapshot } from "../domain/age-policy";
import { type CommentCheckpoint, commentRefreshDelay } from "../domain/comment-policy";
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
         ORDER BY next_attempt_at - CASE origin WHEN 'stories' THEN 900000 WHEN 'comments_refresh' THEN 600000 WHEN 'scheduled' THEN 300000 ELSE 0 END,
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
  async save(job: CollectionJob, token: string, now: number, comment?: CommentCheckpoint) {
    const statements: D1PreparedStatement[] = [];
    if (comment)
      statements.push(
        this.database
          .prepare(
            `INSERT INTO comment_media_state (media_id,last_attempt_at,last_complete_at,next_refresh_at,last_comments_count,processed_generation,omitted_branches,error_code)
       SELECT ?,?,?,?,(SELECT json_extract(metrics_json,'$.comments.value') FROM media_snapshots WHERE media_id=? ORDER BY observed_at DESC,id DESC LIMIT 1),?,?,?
       WHERE EXISTS (SELECT 1 FROM collection_jobs WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at>?)
       ON CONFLICT(media_id) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,
         last_complete_at=COALESCE(excluded.last_complete_at,comment_media_state.last_complete_at),
         next_refresh_at=CASE WHEN excluded.last_complete_at IS NOT NULL THEN excluded.next_refresh_at ELSE comment_media_state.next_refresh_at END,
         last_comments_count=CASE WHEN excluded.last_complete_at IS NOT NULL THEN excluded.last_comments_count ELSE comment_media_state.last_comments_count END,
         processed_generation=MAX(comment_media_state.processed_generation,excluded.processed_generation),
         omitted_branches=excluded.omitted_branches,error_code=excluded.error_code`,
          )
          .bind(
            comment.mediaId,
            now,
            comment.complete ? now : null,
            now + commentRefreshDelay(comment.publishedAt, now),
            comment.mediaId,
            comment.complete ? comment.eventGeneration : 0,
            comment.omittedBranches,
            job.errorCode,
            job.id,
            token,
            now,
          ),
      );
    statements.push(
      this.database
        .prepare(
          "UPDATE collection_jobs SET status=?,cursor=?,pages=?,collected=?,media_processed=?,attempt=?,failures=?,next_attempt_at=?,completed_at=?,last_success_at=?,error_code=?,lease_token=NULL,lease_expires_at=NULL WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at>?",
        )
        .bind(
          job.status,
          job.cursor,
          job.pages,
          job.collected,
          job.mediaProcessed,
          job.attempt,
          job.failures,
          job.nextAttemptAt,
          job.completedAt,
          job.lastSuccessAt,
          job.errorCode,
          job.id,
          token,
          now,
        ),
    );
    await this.database.batch(statements);
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
  async dueAgeMedia(accountId: string, now: number) {
    return this.database
      .prepare(
        `WITH targets(hours,tolerance) AS (VALUES ${ageSnapshotWindows.map(() => "(?,?)").join(",")})
         SELECT m.id AS mediaId,t.hours AS targetHours,
           m.published_at+(t.hours+t.tolerance)*3600000 AS deadline
         FROM media m CROSS JOIN targets t
         WHERE m.account_id=? AND m.product_type!='STORY'
           AND m.published_at+t.hours*3600000<=?
           AND m.published_at+(t.hours+t.tolerance)*3600000>=?
           AND NOT EXISTS (SELECT 1 FROM media_snapshots s WHERE s.media_id=m.id
             AND s.observed_at BETWEEN m.published_at+(t.hours-t.tolerance)*3600000
               AND m.published_at+(t.hours+t.tolerance)*3600000)
         ORDER BY deadline,m.published_at,m.id,t.hours LIMIT 1`,
      )
      .bind(
        ...ageSnapshotWindows.flatMap((t) => [t.targetHours, t.toleranceHours]),
        accountId,
        now,
        now,
      )
      .first<DueAgeSnapshot>();
  }
  async nextCommentRefresh(accountId: string, now: number) {
    return this.database
      .prepare(
        `SELECT m.id,m.published_at AS publishedAt FROM media m LEFT JOIN comment_media_state s ON s.media_id=m.id
       WHERE m.account_id=? AND m.product_type!='STORY' AND m.published_at<=?
         AND (s.media_id IS NOT NULL OR m.published_at>?-720*3600000 OR NOT EXISTS (SELECT 1 FROM collection_jobs WHERE account_id=m.account_id AND origin='comments' AND status='running'))
         AND (s.media_id IS NULL OR s.next_refresh_at<=? OR s.event_generation>s.processed_generation OR (s.last_complete_at IS NOT NULL AND s.last_comments_count IS NOT (SELECT json_extract(metrics_json,'$.comments.value') FROM media_snapshots WHERE media_id=m.id ORDER BY observed_at DESC,id DESC LIMIT 1)))
         AND NOT EXISTS (SELECT 1 FROM collection_jobs WHERE target_media_id=m.id AND origin='comments_refresh' AND status='running')
         AND NOT EXISTS (SELECT 1 FROM collection_jobs WHERE target_media_id=m.id AND origin='comments_refresh' AND error_code IS NOT NULL AND next_attempt_at>?)
       ORDER BY CASE WHEN s.event_generation>s.processed_generation THEN 0 WHEN s.last_complete_at IS NOT NULL AND s.last_comments_count IS NOT (SELECT json_extract(metrics_json,'$.comments.value') FROM media_snapshots WHERE media_id=m.id ORDER BY observed_at DESC,id DESC LIMIT 1) THEN 1 ELSE 2 END,
         CASE WHEN m.published_at>?-72*3600000 THEN 0 ELSE 1 END,COALESCE(s.next_refresh_at,0),m.published_at DESC,m.id LIMIT 1`,
      )
      .bind(accountId, now, now, now, now, now)
      .first<CataloguePosition>();
  }
  async commentGeneration(mediaId: string) {
    return (
      (
        await this.database
          .prepare(
            "SELECT event_generation AS generation FROM comment_media_state WHERE media_id=?",
          )
          .bind(mediaId)
          .first<{ generation: number }>()
      )?.generation ?? 0
    );
  }
  async receiveCommentEvent(
    accountId: string,
    externalMediaId: string,
    id: string,
    sentAt: number,
    now: number,
  ) {
    if (
      (await this.database
        .prepare("SELECT 1 FROM media WHERE external_id=? AND account_id!=? LIMIT 1")
        .bind(externalMediaId, accountId)
        .first()) !== null
    )
      return;
    await this.database.batch([
      this.database
        .prepare(
          `INSERT INTO comment_media_state (media_id,event_generation,last_webhook_at) SELECT m.id,1,? FROM media m WHERE m.account_id=? AND m.external_id=? AND m.product_type!='STORY' AND NOT EXISTS (SELECT 1 FROM comment_webhook_events WHERE id=?)
         ON CONFLICT(media_id) DO UPDATE SET event_generation=comment_media_state.event_generation+1,last_webhook_at=MAX(COALESCE(comment_media_state.last_webhook_at,0),excluded.last_webhook_at)`,
        )
        .bind(now, accountId, externalMediaId, id),
      this.database
        .prepare(
          "UPDATE collection_schedules SET next_discovery_at=MIN(next_discovery_at,?) WHERE account_id=? AND enabled=1 AND NOT EXISTS (SELECT 1 FROM media WHERE account_id=? AND external_id=?) AND NOT EXISTS (SELECT 1 FROM comment_webhook_events WHERE id=?)",
        )
        .bind(now, accountId, accountId, externalMediaId, id),
      this.database
        .prepare(
          "INSERT INTO comment_webhook_state (account_id,last_received_at,last_event_at) VALUES (?,?,?) ON CONFLICT(account_id) DO UPDATE SET last_received_at=MAX(COALESCE(comment_webhook_state.last_received_at,0),excluded.last_received_at),last_event_at=MAX(COALESCE(comment_webhook_state.last_event_at,0),excluded.last_event_at)",
        )
        .bind(accountId, now, sentAt),
      this.database
        .prepare(
          "INSERT INTO comment_webhook_events (id,account_id,external_media_id,media_id,received_at) VALUES (?,?,?,(SELECT id FROM media WHERE account_id=? AND external_id=?),?) ON CONFLICT(id) DO NOTHING",
        )
        .bind(id, accountId, externalMediaId, accountId, externalMediaId, now),
    ]);
  }
  async confirmCommentSubscription(accountId: string, now: number) {
    await this.database
      .prepare(
        "INSERT INTO comment_webhook_state (account_id,subscription_confirmed_at) VALUES (?,?) ON CONFLICT(account_id) DO UPDATE SET subscription_confirmed_at=excluded.subscription_confirmed_at",
      )
      .bind(accountId, now)
      .run();
  }
  async commentStatus(accountId: string, now: number) {
    const row = await this.database
      .prepare(
        `SELECT (SELECT MAX(completed_at) FROM collection_jobs WHERE account_id=? AND origin='comments' AND status='completed') AS lastFullPassAt,
       COUNT(*) AS publications,(SELECT COUNT(*) FROM comments c JOIN media cm ON cm.id=c.media_id WHERE cm.account_id=?) AS uniqueComments,
       SUM(CASE WHEN s.last_complete_at IS NULL OR s.next_refresh_at<=? OR s.event_generation>s.processed_generation THEN 1 ELSE 0 END) AS stalePublications,
       SUM(CASE WHEN s.error_code IS NOT NULL THEN 1 ELSE 0 END) AS partialPublications,
       (SELECT COALESCE(SUM(json_array_length(cursor,'$.parents')),0) FROM collection_jobs WHERE account_id=? AND origin IN ('comments','comments_refresh') AND status IN ('running','failed')) AS pendingReplyBranches
       FROM media m LEFT JOIN comment_media_state s ON s.media_id=m.id WHERE m.account_id=? AND m.product_type!='STORY'`,
      )
      .bind(accountId, accountId, now, accountId, accountId)
      .first<{
        lastFullPassAt: number | null;
        publications: number;
        uniqueComments: number;
        stalePublications: number | null;
        partialPublications: number | null;
        pendingReplyBranches: number;
      }>();
    const currentPass = await this.database
      .prepare(
        `SELECT j.id,j.status,j.media_processed AS mediaProcessed,MAX(0,(SELECT COUNT(*) FROM media WHERE account_id=j.account_id AND product_type!='STORY' AND published_at<=j.started_at)-j.media_processed) AS remainingPublications,j.collected AS observations,j.error_code AS errorCode FROM collection_jobs j WHERE j.account_id=? AND j.origin='comments' AND j.status IN ('running','failed') ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END,started_at DESC,id DESC LIMIT 1`,
      )
      .bind(accountId)
      .first<{
        id: string;
        status: string;
        mediaProcessed: number;
        remainingPublications: number;
        observations: number;
        errorCode: string | null;
      }>();
    const webhook = await this.database
      .prepare(
        "SELECT subscription_confirmed_at AS subscriptionConfirmedAt,last_received_at AS lastReceivedAt,last_event_at AS lastEventAt FROM comment_webhook_state WHERE account_id=?",
      )
      .bind(accountId)
      .first<{
        subscriptionConfirmedAt: number | null;
        lastReceivedAt: number | null;
        lastEventAt: number | null;
      }>();
    return {
      currentPass,
      lastFullPassAt: row?.lastFullPassAt ?? null,
      publications: row?.publications ?? 0,
      uniqueComments: row?.uniqueComments ?? 0,
      stalePublications: row?.stalePublications ?? 0,
      partialPublications: row?.partialPublications ?? 0,
      pendingReplyBranches: row?.pendingReplyBranches ?? 0,
      webhook: {
        subscriptionConfirmedAt: webhook?.subscriptionConfirmedAt ?? null,
        lastReceivedAt: webhook?.lastReceivedAt ?? null,
        lastEventAt: webhook?.lastEventAt ?? null,
        active: webhook?.subscriptionConfirmedAt != null && webhook.lastReceivedAt != null,
      },
    };
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
