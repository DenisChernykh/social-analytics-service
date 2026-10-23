import { and, eq, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { collectionJobs, collectionSchedules } from "../../../platform/database/schema";
import { ApplicationError } from "../../../shared/application/application-error";
import { nextObjectFailureDelay } from "../../../shared/domain/source-failure";
import type { ActivityPeriod } from "../../account-insights";
import { metricKeys } from "../../analytics";
import type { CollectionStore } from "../application/ports";
import {
  ageSnapshotWindows,
  type DueAgeSnapshot,
  storyFinalSnapshotWindowMs,
  storyUrgentRetryIntervalMs,
} from "../domain/age-policy";
import { type CommentCheckpoint, commentRefreshDelay } from "../domain/comment-policy";
import { ageCoverage, type PolicyInterval } from "../domain/coverage";
import type {
  CataloguePosition,
  CollectionJob,
  CollectionSchedule,
  CommentEvent,
} from "../domain/model";
import { collectionRetryIntervalMs } from "../domain/model";
import {
  type JobAggregate,
  jobAggregates,
  type MediaStatusCounter,
  maximumTime,
  type TerminalJobCounter,
} from "../domain/status-counters";

// json_each virtual rows count towards D1 reads. Skip expanding documents
// without the marker; escaped JSON still takes the exact parser path so this
// prefilter cannot hide an escaped reason or turn unrelated text into a match.
const deferredMetrics = `CASE WHEN ${metricKeys.map((key) => `json_extract(s.metrics_json,'$.${key}.reason')='request_deferred'`).join(" OR ")} THEN 1
  WHEN instr(s.metrics_json,'request_deferred')>0 OR instr(s.metrics_json,char(92))>0
  THEN EXISTS (SELECT 1 FROM json_each(s.metrics_json) metric WHERE json_extract(metric.value,'$.reason')='request_deferred') ELSE 0 END`;

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
      )) as CollectionJob[];
  }
  async jobPage(accountId: string, input: { limit: number; cursor?: string }, now: number) {
    let cutoff = now,
      position: { createdAt: number; id: string } | null = null;
    if (input.cursor)
      try {
        const c = JSON.parse(atob(input.cursor));
        if (
          c.accountId !== accountId ||
          !Number.isSafeInteger(c.cutoff) ||
          !Number.isSafeInteger(c.createdAt) ||
          typeof c.id !== "string" ||
          c.id.length > 150
        )
          throw new Error("cursor");
        cutoff = c.cutoff;
        position = { createdAt: c.createdAt, id: c.id };
      } catch {
        throw new ApplicationError(
          "VALIDATION_FAILED",
          "Invalid collection jobs cursor or account.",
        );
      }
    const rows = await this.db
      .select()
      .from(collectionJobs)
      .where(
        and(
          eq(collectionJobs.accountId, accountId),
          lte(collectionJobs.startedAt, cutoff),
          position
            ? sql`(${collectionJobs.startedAt}<${position.createdAt} OR (${collectionJobs.startedAt}=${position.createdAt} AND ${collectionJobs.id}<${position.id}))`
            : undefined,
        ),
      )
      .orderBy(sql`${collectionJobs.startedAt} DESC`, sql`${collectionJobs.id} DESC`)
      .limit(input.limit + 1);
    const day = Math.floor(cutoff / 86_400_000);
    let counters = (await this.terminalCounters(accountId)).filter((c) => c.day <= day);
    // A cursor can precede jobs created later in its final day. Only that
    // boundary bucket needs a bounded createdAt-range query; older days use counters.
    if (counters.some((c) => c.day === day && (c.maxStartedAt ?? 0) > cutoff)) {
      const boundary = await this.database
        .prepare(`SELECT origin,status,COUNT(*) count,
        ? day,MAX(started_at) maxStartedAt,MAX(last_attempt_at) lastAttempt,
        MAX(last_success_at) lastSuccess,MAX(last_useful_observation_at) lastUsefulObservation,
        MAX(completed_at) lastCompletedAt,0 pendingParents FROM collection_jobs
        WHERE account_id=? AND status!='running' AND started_at>=? AND started_at<=?
        GROUP BY origin,status`)
        .bind(day, accountId, day * 86_400_000, cutoff)
        .all<TerminalJobCounter>();
      counters = [...counters.filter((c) => c.day < day), ...boundary.results];
    }
    const running = await this.database
      .prepare(`SELECT origin,status,COUNT(*) count,
      SUM(next_attempt_at<=?) due,MIN(next_attempt_at) oldestDue,
      SUM(origin IN ('scheduled','stories') AND started_at+900000<? AND first_attempt_at IS NULL) atRiskFresh,
      SUM(origin IN ('scheduled','stories','comments_refresh') AND next_attempt_at<=?) freshDue,
      MAX(last_attempt_at) lastAttempt,MAX(last_success_at) lastSuccess,MAX(last_useful_observation_at) lastUsefulObservation
      FROM collection_jobs INDEXED BY collection_running_account WHERE account_id=? AND status='running' AND started_at<=? GROUP BY origin,status`)
      .bind(now, now, now, accountId, cutoff)
      .all<JobAggregate>();
    const aggregates = jobAggregates(counters, running.results);
    const items = rows.slice(0, input.limit) as CollectionJob[],
      last = items.at(-1),
      hasMore = rows.length > input.limit;
    return {
      items,
      hasMore,
      limit: input.limit,
      cutoff,
      total: aggregates.reduce((n, a) => n + a.count, 0),
      aggregates,
      nextCursor:
        hasMore && last
          ? btoa(JSON.stringify({ accountId, cutoff, createdAt: last.startedAt, id: last.id }))
          : null,
    };
  }
  private async terminalCounters(accountId: string) {
    const row = await this.database
      .prepare("SELECT collection_jobs_json counters FROM accounts WHERE id=?")
      .bind(accountId)
      .first<{ counters: string }>();
    return Object.values(JSON.parse(row?.counters ?? "{}") as Record<string, TerminalJobCounter>);
  }
  async dataFreshness(accountId: string) {
    const rows = await this.database
      .prepare(
        "SELECT external_id,product_type,collection_status_json FROM media WHERE account_id=?",
      )
      .bind(accountId)
      .all<{ external_id: string; product_type: string; collection_status_json: string }>();
    const states = await this.database
      .prepare("SELECT object_freshness_json FROM instagram_api_state WHERE account_id=?")
      .bind(accountId)
      .all<{ object_freshness_json: string }>();
    const attempts = new Map<string, { lastAttempt: number | null; lastCheck: number | null }>();
    for (const state of states.results) {
      for (const [id, entry] of Object.entries(
        JSON.parse(state.object_freshness_json) as Record<
          string,
          { lastAttempt: number | null; lastCheck: number | null }
        >,
      )) {
        const previous = attempts.get(id);
        attempts.set(id, {
          lastAttempt: maximumTime(previous?.lastAttempt, entry.lastAttempt),
          lastCheck: maximumTime(previous?.lastCheck, entry.lastCheck),
        });
      }
    }
    const kinds = new Map<string, Awaited<ReturnType<CollectionStore["dataFreshness"]>>[number]>();
    for (const m of rows.results) {
      const observed = JSON.parse(m.collection_status_json) as MediaStatusCounter;
      const attempted = attempts.get(m.external_id);
      const previous = kinds.get(m.product_type);
      kinds.set(m.product_type, {
        kind: m.product_type,
        objects: (previous?.objects ?? 0) + 1,
        lastAttempt: maximumTime(previous?.lastAttempt, attempted?.lastAttempt),
        lastCheck: maximumTime(previous?.lastCheck, attempted?.lastCheck),
        lastSuccess: maximumTime(previous?.lastSuccess, observed.lastSuccess),
        lastUsefulObservation: maximumTime(previous?.lastUsefulObservation, observed.lastUseful),
        legacyProvenanceUnknown: (previous?.legacyProvenanceUnknown ?? 0) + (observed.legacy ?? 0),
      });
    }
    return [...kinds.values()].sort((a, b) => a.kind.localeCompare(b.kind));
  }
  async diagnostics(accountId: string, now: number) {
    const row = await this.database
      .prepare(`SELECT
      (SELECT COUNT(*) FROM sync_runs WHERE account_id=? AND status='running' AND lease_expires_at<=?) expiredSyncAttempts,
      (SELECT COUNT(*) FROM account_insights WHERE account_id=? AND json_extract(payload_json,'$.status')='running' AND json_extract(payload_json,'$.requestedAt')<=?) expiredInsightAttempts,
      (SELECT COUNT(*) FROM comment_collections c JOIN media m ON m.id=c.media_id WHERE m.account_id=? AND json_extract(c.result_json,'$.status')='running' AND json_extract(c.result_json,'$.startedAt')<=?) expiredCommentAttempts,
      ((SELECT COUNT(*) FROM collection_jobs INDEXED BY collection_running_account WHERE account_id=? AND status='running' AND lease_expires_at>?)
       +(SELECT COUNT(*) FROM collection_jobs INDEXED BY collection_terminal_leases WHERE account_id=? AND status!='running' AND lease_expires_at IS NOT NULL AND lease_expires_at>?)) leasesInUse`)
      .bind(
        accountId,
        now,
        accountId,
        now - 900_000,
        accountId,
        now - 900_000,
        accountId,
        now,
        accountId,
        now,
      )
      .first<{
        expiredSyncAttempts: number;
        expiredInsightAttempts: number;
        expiredCommentAttempts: number;
        leasesInUse: number;
      }>();
    return (
      row ?? {
        expiredSyncAttempts: 0,
        expiredInsightAttempts: 0,
        expiredCommentAttempts: 0,
        leasesInUse: 0,
      }
    );
  }
  async claimSchedule(accountId: string, token: string, now: number) {
    return (
      (
        await this.database
          .prepare(
            "UPDATE collection_schedules SET claim_token=?,claim_expires_at=? WHERE account_id=? AND enabled=1 AND retry_at<=? AND (claim_expires_at IS NULL OR claim_expires_at<=?)",
          )
          .bind(token, now + 900_000, accountId, now, now)
          .run()
      ).meta.changes === 1
    );
  }
  async releaseSchedule(accountId: string, token: string) {
    await this.database
      .prepare(
        "UPDATE collection_schedules SET claim_token=NULL,claim_expires_at=NULL WHERE account_id=? AND claim_token=?",
      )
      .bind(accountId, token)
      .run();
  }
  async recordPolicy(accountId: string, enabled: boolean, now: number, policy: unknown) {
    const previous = await this.database
      .prepare(
        `SELECT
 (SELECT enabled FROM collection_policy_history WHERE account_id=? AND effective_to IS NULL ORDER BY effective_from DESC LIMIT 1) enabled,
 (SELECT policy_json FROM collection_policy_history WHERE account_id=? AND effective_to IS NULL ORDER BY effective_from DESC LIMIT 1) policy_json,
 (SELECT expires_at FROM instagram_connections WHERE account_id=?) grantExpiresAt,
 (SELECT scopes FROM instagram_connections WHERE account_id=?) scopes,
 (SELECT json_extract(payload_json,'$.result') FROM instagram_http_attempts WHERE account_id=? ORDER BY requested_at DESC,id DESC LIMIT 1) lastResult`,
      )
      .bind(accountId, accountId, accountId, accountId, accountId)
      .first<{
        enabled: number | null;
        policy_json: string | null;
        grantExpiresAt: number | null;
        scopes: string | null;
        lastResult: string | null;
      }>();
    const availability =
      previous?.grantExpiresAt &&
      previous.grantExpiresAt > now &&
      JSON.parse(previous.scopes ?? "[]").includes("instagram_business_manage_insights")
        ? previous.lastResult === "permission_required"
          ? "unavailable"
          : "configured"
        : "unavailable";
    const policyJson = JSON.stringify({
      ...(policy as object),
      availability,
      grantExpiresAt: previous?.grantExpiresAt ?? null,
    });
    if (previous?.enabled === Number(enabled) && previous.policy_json === policyJson) return;
    await this.database.batch([
      this.database
        .prepare(
          "UPDATE collection_policy_history SET effective_to=? WHERE account_id=? AND effective_to IS NULL",
        )
        .bind(now, accountId),
      this.database
        .prepare(
          "INSERT INTO collection_policy_history(id,account_id,effective_from,effective_to,version,enabled,policy_json) VALUES(?,?,?,NULL,'collection-v2',?,?) ON CONFLICT(id) DO NOTHING",
        )
        .bind(crypto.randomUUID(), accountId, now, Number(enabled), policyJson),
    ]);
  }
  async create(job: CollectionJob) {
    await this.db.insert(collectionJobs).values(job).onConflictDoNothing();
  }
  async pendingJobs() {
    return (await this.db
      .select()
      .from(collectionJobs)
      .where(eq(collectionJobs.status, "running"))
      .orderBy(
        collectionJobs.nextAttemptAt,
        collectionJobs.startedAt,
        collectionJobs.id,
      )) as CollectionJob[];
  }
  async nextWakeAt(now: number, idleCheckMs: number) {
    const row = await this.database
      .prepare(`SELECT MIN(next_at) AS nextAt FROM (
      SELECT MAX(next_attempt_at,COALESCE(lease_expires_at,0)) AS next_at
        FROM collection_jobs WHERE status='running'
      UNION ALL
      SELECT MAX(retry_at,COALESCE(claim_expires_at,0),
        MIN(next_discovery_at,next_stories_at,next_insights_at,next_catalogue_at,?))
        FROM collection_schedules WHERE enabled=1
    )`)
      .bind(now + idleCheckMs)
      .first<{ nextAt: number | null }>();
    return row?.nextAt ?? null;
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
  async replanActivity(job: CollectionJob, periods: ActivityPeriod[], now: number) {
    const result = await this.database
      .prepare(
        `UPDATE collection_jobs SET cursor=? WHERE id=? AND origin='activity' AND status='running'
         AND pages=? AND attempt=? AND cursor IS ?
         AND (lease_expires_at IS NULL OR lease_expires_at<=?)`,
      )
      .bind(JSON.stringify(periods), job.id, job.pages, job.attempt, job.cursor, now)
      .run();
    return result.meta.changes > 0;
  }
  async nextCommentMedia(
    accountId: string,
    after: CataloguePosition | null,
    before: number,
    now = before,
  ) {
    const statement = this.database.prepare(
      `SELECT id,published_at AS publishedAt FROM media WHERE account_id=? AND product_type!='STORY' AND published_at<=? AND NOT EXISTS (SELECT 1 FROM comment_media_state s WHERE s.media_id=media.id AND s.unavailable_until>?) ${after ? "AND (published_at<? OR (published_at=? AND id<?))" : ""} ORDER BY published_at DESC,id DESC LIMIT 1`,
    );
    return (
      after
        ? statement.bind(accountId, before, now, after.publishedAt, after.publishedAt, after.id)
        : statement.bind(accountId, before, now)
    ).first<CataloguePosition>();
  }
  async claim(id: string, token: string, now: number) {
    const rows = await this.db
      .update(collectionJobs)
      .set({
        leaseToken: token,
        leaseExpiresAt: now + 15 * 60_000,
        firstAttemptAt: sql`CASE WHEN ${collectionJobs.latencyOrigin}='recorded_from_creation' THEN COALESCE(${collectionJobs.firstAttemptAt},${now}) ELSE NULL END`,
        lastAttemptAt: now,
      })
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
            `INSERT INTO comment_media_state (media_id,last_attempt_at,last_complete_at,next_refresh_at,last_comments_count,processed_generation,omitted_branches,error_code,unavailable_until)
       SELECT ?,?,?,?,(SELECT json_extract(metrics_json,'$.comments.value') FROM media_snapshots WHERE media_id=? ORDER BY observed_at DESC,id DESC LIMIT 1),?,?,?,?
       WHERE EXISTS (SELECT 1 FROM collection_jobs WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at>?)
       ON CONFLICT(media_id) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,
         last_complete_at=COALESCE(excluded.last_complete_at,comment_media_state.last_complete_at),
         next_refresh_at=CASE WHEN excluded.last_complete_at IS NOT NULL THEN excluded.next_refresh_at ELSE comment_media_state.next_refresh_at END,
         last_comments_count=CASE WHEN excluded.last_complete_at IS NOT NULL THEN excluded.last_comments_count ELSE comment_media_state.last_comments_count END,
         processed_generation=MAX(comment_media_state.processed_generation,excluded.processed_generation),
         omitted_branches=excluded.omitted_branches,error_code=excluded.error_code,unavailable_until=excluded.unavailable_until`,
          )
          .bind(
            comment.mediaId,
            now,
            comment.complete ? now : null,
            now + commentRefreshDelay(comment.publishedAt, now),
            comment.mediaId,
            comment.complete ? comment.eventGeneration : 0,
            comment.omittedBranches,
            comment.errorCode ?? job.errorCode,
            comment.unavailableUntil ?? 0,
            job.id,
            token,
            now,
          ),
      );
    if (job.automatic && job.lastSuccessAt !== null && job.errorCode === null)
      statements.push(
        this.database
          .prepare(`UPDATE collection_schedules SET last_success_at=MAX(COALESCE(last_success_at,0),?)
        WHERE account_id=? AND enabled=1 AND EXISTS (SELECT 1 FROM collection_jobs WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at>?)`)
          .bind(job.lastSuccessAt, job.accountId, job.id, token, now),
      );
    statements.push(
      this.database
        .prepare(
          "UPDATE collection_jobs SET status=?,cursor=?,pages=?,collected=?,media_processed=?,skipped_media=?,skipped_periods=?,attempt=?,failures=?,next_attempt_at=?,completed_at=?,last_success_at=?,error_code=?,first_useful_observation_at=?,last_useful_observation_at=?,http_attempts=?,http_attempts_since_at=?,last_step_duration_ms=?,last_step_http_attempts=?,lease_token=NULL,lease_expires_at=NULL WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at>?",
        )
        .bind(
          job.status,
          job.cursor,
          job.pages,
          job.collected,
          job.mediaProcessed,
          job.skippedMedia,
          job.skippedPeriods,
          job.attempt,
          job.failures,
          job.nextAttemptAt,
          job.completedAt,
          job.lastSuccessAt,
          job.errorCode,
          job.firstUsefulObservationAt ?? null,
          job.lastUsefulObservationAt ?? null,
          job.httpAttempts ?? 0,
          job.httpAttemptsSinceAt ?? null,
          job.lastStepDurationMs ?? null,
          job.lastStepHttpAttempts ?? null,
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
  async enabledSchedules() {
    return this.db
      .select()
      .from(collectionSchedules)
      .where(eq(collectionSchedules.enabled, true))
      .orderBy(collectionSchedules.retryAt, collectionSchedules.accountId);
  }
  async saveSchedule(schedule: CollectionSchedule) {
    await this.db
      .insert(collectionSchedules)
      .values(schedule)
      .onConflictDoUpdate({ target: collectionSchedules.accountId, set: schedule });
  }
  async mediaRefreshStatus(accountId: string, now: number) {
    const identityFrom = Math.floor(now / collectionRetryIntervalMs) * collectionRetryIntervalMs;
    const rows = await this.database
      .prepare(`SELECT error_code,COUNT(*) publications,
      SUM(missing) missingSnapshots,SUM(stale) staleSnapshots,
      SUM(until_at>? OR (due AND identity_wait)) deferred,
      SUM(until_at<=? AND due AND NOT identity_wait) ready,
      MIN(CASE WHEN until_at>? OR (due AND identity_wait)
        THEN MAX(until_at,CASE WHEN due AND identity_wait THEN ? ELSE 0 END) END) nextAttemptAt
      FROM (SELECT m.unavailable_code error_code,
        m.unavailable_until until_at,
        COALESCE(r.kind='media' AND r.status='completed'
          AND r.account_id=m.account_id AND r.target_media_id=m.id AND r.started_at>=?,0) identity_wait,
        json_extract(m.collection_status_json,'$.latest.id') IS NULL missing,
        json_extract(m.collection_status_json,'$.latest.id') IS NOT NULL AND json_extract(m.collection_status_json,'$.latest.at')<=? - CASE WHEN ?-m.published_at<2*86400000 THEN 3600000 WHEN ?-m.published_at<8*86400000 THEN 21600000 WHEN ?-m.published_at<31*86400000 THEN 86400000 ELSE 604800000 END stale,
        m.unavailable_code IS NOT NULL OR json_extract(m.collection_status_json,'$.latest.id') IS NULL OR
          COALESCE(json_extract(m.collection_status_json,'$.latest.deferred'),0) OR
          json_extract(m.collection_status_json,'$.latest.at')<=? - CASE WHEN ?-m.published_at<2*86400000 THEN 3600000 WHEN ?-m.published_at<8*86400000 THEN 21600000 WHEN ?-m.published_at<31*86400000 THEN 86400000 ELSE 604800000 END due
        FROM media m LEFT JOIN sync_runs r ON r.id=json_extract(m.collection_status_json,'$.latest.operationId')
        WHERE m.account_id=? AND m.product_type!='STORY') GROUP BY error_code`)
      .bind(
        now,
        now,
        now,
        identityFrom + collectionRetryIntervalMs,
        identityFrom,
        now,
        now,
        now,
        now,
        now,
        now,
        now,
        now,
        accountId,
      )
      .all<{
        error_code: string | null;
        publications: number;
        missingSnapshots: number;
        staleSnapshots: number;
        deferred: number;
        ready: number;
        nextAttemptAt: number | null;
      }>();
    return rows.results.reduce(
      (status, row) => ({
        publications: status.publications + row.publications,
        missingSnapshots: status.missingSnapshots + row.missingSnapshots,
        staleSnapshots: status.staleSnapshots + row.staleSnapshots,
        ready: status.ready + row.ready,
        deferred: status.deferred + row.deferred,
        retries: row.error_code
          ? [
              ...status.retries,
              {
                errorCode: row.error_code,
                count: row.publications,
                nextAttemptAt: row.nextAttemptAt,
              },
            ]
          : status.retries,
      }),
      {
        publications: 0,
        missingSnapshots: 0,
        staleSnapshots: 0,
        ready: 0,
        deferred: 0,
        retries: [] as { errorCode: string; count: number; nextAttemptAt: number | null }[],
      },
    );
  }
  async dueMedia(accountId: string, now: number) {
    const row = await this.database
      .prepare(`SELECT m.id FROM media m LEFT JOIN media_snapshots s ON s.id=(SELECT latest.id FROM media_snapshots latest WHERE latest.media_id=m.id ORDER BY latest.observed_at DESC LIMIT 1)
      WHERE m.account_id=? AND m.product_type!='STORY' AND m.unavailable_until<=? AND (m.unavailable_code IS NOT NULL OR (${deferredMetrics}) OR COALESCE(s.observed_at,0) <= ? - CASE WHEN ?-m.published_at < 2*86400000 THEN 3600000 WHEN ?-m.published_at < 8*86400000 THEN 21600000 WHEN ?-m.published_at < 31*86400000 THEN 86400000 ELSE 604800000 END)
      AND NOT EXISTS (SELECT 1 FROM sync_runs r WHERE r.id=s.operation_id AND r.account_id=m.account_id
        AND r.kind='media' AND r.target_media_id=m.id AND r.status='completed' AND r.started_at>=?)
      ORDER BY COALESCE(s.observed_at,0),m.published_at DESC LIMIT 1`)
      .bind(
        accountId,
        now,
        now,
        now,
        now,
        now,
        Math.floor(now / collectionRetryIntervalMs) * collectionRetryIntervalMs,
      )
      .first<{ id: string }>();
    return row?.id ?? null;
  }
  async dueAgeMedia(accountId: string, now: number) {
    return this.database
      .prepare(
        `WITH targets(hours,tolerance) AS (VALUES ${ageSnapshotWindows.map(() => "(?,?)").join(",")})
         SELECT m.id AS mediaId,t.hours AS targetHours,
           m.published_at+(t.hours+t.tolerance)*3600000 AS deadline
         FROM targets t CROSS JOIN media m
         WHERE m.account_id=? AND m.product_type!='STORY' AND m.unavailable_until<=?
           AND m.published_at BETWEEN ?-(t.hours+t.tolerance)*3600000 AND ?-t.hours*3600000
           AND NOT EXISTS (SELECT 1 FROM media_snapshots s WHERE s.media_id=m.id
             AND s.observed_at BETWEEN m.published_at+(t.hours-t.tolerance)*3600000
               AND m.published_at+(t.hours+t.tolerance)*3600000 AND json_extract(s.metrics_json,'$.reach.value') IS NOT NULL)
         ORDER BY deadline,m.published_at,m.id,t.hours LIMIT 1`,
      )
      .bind(
        ...ageSnapshotWindows.flatMap((t) => [t.targetHours, t.toleranceHours]),
        accountId,
        now,
        now,
        now,
      )
      .first<DueAgeSnapshot>();
  }
  async nextCommentRefresh(accountId: string, now: number) {
    // Filter due publications before probing job history. Without materialization,
    // SQLite can repeat those correlated lookups for every fresh publication.
    return this.database
      .prepare(
        `WITH candidates AS MATERIALIZED (
       SELECT m.id,m.account_id,m.published_at,CASE WHEN s.event_generation>s.processed_generation THEN 0 WHEN s.last_complete_at IS NOT NULL AND s.last_comments_count IS NOT (SELECT json_extract(metrics_json,'$.comments.value') FROM media_snapshots WHERE media_id=m.id ORDER BY observed_at DESC,id DESC LIMIT 1) THEN 1 ELSE 2 END AS priority,COALESCE(s.next_refresh_at,0) AS next_refresh_at
       FROM media m LEFT JOIN comment_media_state s ON s.media_id=m.id
       WHERE m.account_id=? AND m.product_type!='STORY' AND m.published_at<=?
         AND COALESCE(s.unavailable_until,0)<=?
         AND (s.media_id IS NOT NULL OR m.published_at>?-720*3600000 OR NOT EXISTS (SELECT 1 FROM collection_jobs WHERE account_id=m.account_id AND origin='comments' AND status='running'))
         AND (s.media_id IS NULL OR s.next_refresh_at<=? OR s.event_generation>s.processed_generation OR (s.last_complete_at IS NOT NULL AND s.last_comments_count IS NOT (SELECT json_extract(metrics_json,'$.comments.value') FROM media_snapshots WHERE media_id=m.id ORDER BY observed_at DESC,id DESC LIMIT 1)))
) SELECT m.id,m.published_at AS publishedAt FROM candidates m
       WHERE NOT EXISTS (SELECT 1 FROM collection_jobs WHERE target_media_id=m.id AND origin='comments_refresh' AND status='running')
         AND NOT EXISTS (SELECT 1 FROM collection_jobs WHERE target_media_id=m.id AND origin='comments_refresh' AND error_code IS NOT NULL AND next_attempt_at>?)
         AND NOT EXISTS (SELECT 1 FROM collection_jobs WHERE account_id=m.account_id AND target_media_id=m.id
           AND origin='comments_refresh' AND status='completed' AND started_at>=?)
       ORDER BY m.priority,CASE WHEN m.published_at>?-72*3600000 THEN 0 ELSE 1 END,m.next_refresh_at,m.published_at DESC,m.id LIMIT 1`,
      )
      .bind(
        accountId,
        now,
        now,
        now,
        now,
        now,
        Math.floor(now / collectionRetryIntervalMs) * collectionRetryIntervalMs,
        now,
      )
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
  async receiveCommentEvents(events: CommentEvent[], now: number) {
    if (!events.length) return;
    // A single signed batch consumes four queries, independently of event count.
    // All statements see the same unseen events; insert dedupe records last.
    const incoming = JSON.stringify(events);
    const eligible = `WITH incoming AS (SELECT DISTINCT json_extract(value,'$.id') AS id,json_extract(value,'$.accountId') AS account_id,json_extract(value,'$.externalMediaId') AS external_media_id,json_extract(value,'$.sentAt') AS sent_at FROM json_each(?)),
      eligible AS (SELECT e.* FROM incoming e WHERE NOT EXISTS (SELECT 1 FROM comment_webhook_events WHERE id=e.id) AND NOT EXISTS (SELECT 1 FROM media WHERE external_id=e.external_media_id AND account_id!=e.account_id))`;
    await this.database.batch([
      this.database
        .prepare(
          `${eligible} INSERT INTO comment_media_state (media_id,event_generation,last_webhook_at) SELECT m.id,COUNT(*),? FROM eligible e JOIN media m ON m.account_id=e.account_id AND m.external_id=e.external_media_id WHERE m.product_type!='STORY' GROUP BY m.id
         ON CONFLICT(media_id) DO UPDATE SET event_generation=comment_media_state.event_generation+excluded.event_generation,last_webhook_at=MAX(COALESCE(comment_media_state.last_webhook_at,0),excluded.last_webhook_at)`,
        )
        .bind(incoming, now),
      this.database
        .prepare(
          `${eligible} UPDATE collection_schedules SET next_discovery_at=MIN(next_discovery_at,?) WHERE enabled=1 AND EXISTS (SELECT 1 FROM eligible e WHERE e.account_id=collection_schedules.account_id AND NOT EXISTS (SELECT 1 FROM media WHERE account_id=e.account_id AND external_id=e.external_media_id))`,
        )
        .bind(incoming, now),
      this.database
        .prepare(
          `${eligible} INSERT INTO comment_webhook_state (account_id,last_received_at,last_event_at) SELECT account_id,?,MAX(sent_at) FROM eligible GROUP BY account_id ON CONFLICT(account_id) DO UPDATE SET last_received_at=MAX(COALESCE(comment_webhook_state.last_received_at,0),excluded.last_received_at),last_event_at=MAX(COALESCE(comment_webhook_state.last_event_at,0),excluded.last_event_at)`,
        )
        .bind(incoming, now),
      this.database
        .prepare(
          `${eligible} INSERT INTO comment_webhook_events (id,account_id,external_media_id,media_id,received_at) SELECT e.id,e.account_id,e.external_media_id,m.id,? FROM eligible e LEFT JOIN media m ON m.account_id=e.account_id AND m.external_id=e.external_media_id WHERE 1 ON CONFLICT(id) DO NOTHING`,
        )
        .bind(incoming, now),
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
    const counters = await this.terminalCounters(accountId);
    const lastFullPassAt = counters
      .filter((c) => c.origin === "comments" && c.status === "completed")
      .reduce<number | null>((at, c) => maximumTime(at, c.lastCompletedAt), null);
    const failedParents = counters
      .filter((c) => ["comments", "comments_refresh"].includes(c.origin) && c.status === "failed")
      .reduce((n, c) => n + c.pendingParents, 0);
    const unique = await this.database
      .prepare(
        "SELECT COALESCE(SUM(s.unique_saved),0) count FROM comment_media_state s JOIN media m ON m.id=s.media_id WHERE m.account_id=?",
      )
      .bind(accountId)
      .first<{ count: number }>();
    const row = await this.database
      .prepare(
        `SELECT COUNT(*) AS publications,
       SUM(CASE WHEN s.last_complete_at IS NULL OR s.next_refresh_at<=? OR s.event_generation>s.processed_generation THEN 1 ELSE 0 END) AS stalePublications,
       SUM(CASE WHEN s.error_code IS NOT NULL OR s.omitted_branches>0 THEN 1 ELSE 0 END) AS partialPublications,
       COALESCE(SUM(s.omitted_branches),0) AS unverifiedReplyBranches,
       SUM(CASE WHEN s.unavailable_until>? THEN 1 ELSE 0 END) AS unavailablePublications,
       (SELECT COALESCE(SUM(json_array_length(cursor,'$.parents')),0) FROM collection_jobs INDEXED BY collection_running_account WHERE account_id=? AND origin IN ('comments','comments_refresh') AND status='running') AS pendingReplyBranches
       FROM media m LEFT JOIN comment_media_state s ON s.media_id=m.id WHERE m.account_id=? AND m.product_type!='STORY'`,
      )
      .bind(now, now, accountId, accountId)
      .first<{
        publications: number;
        stalePublications: number | null;
        partialPublications: number | null;
        pendingReplyBranches: number;
        unverifiedReplyBranches: number;
        unavailablePublications: number;
      }>();
    const currentPass = await this.database
      .prepare(
        `SELECT j.id,j.status,j.media_processed AS mediaProcessed,MAX(0,(SELECT COUNT(*) FROM media WHERE account_id=j.account_id AND product_type!='STORY' AND published_at<=j.started_at)-j.media_processed) AS remainingPublications,j.collected AS observations,j.error_code AS errorCode FROM collection_jobs j WHERE j.id=COALESCE((SELECT id FROM collection_jobs WHERE account_id=? AND origin='comments' AND status='running' ORDER BY started_at DESC,id DESC LIMIT 1),(SELECT id FROM collection_jobs WHERE account_id=? AND origin='comments' AND status='failed' ORDER BY started_at DESC,id DESC LIMIT 1))`,
      )
      .bind(accountId, accountId)
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
      lastFullPassAt,
      publications: row?.publications ?? 0,
      uniqueComments: unique?.count ?? 0,
      stalePublications: row?.stalePublications ?? 0,
      partialPublications: row?.partialPublications ?? 0,
      pendingReplyBranches: (row?.pendingReplyBranches ?? 0) + failedParents,
      unverifiedReplyBranches: row?.unverifiedReplyBranches ?? 0,
      unavailablePublications: row?.unavailablePublications ?? 0,
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
        "SELECT 1 AS found FROM media_snapshots current WHERE current.operation_id=? AND EXISTS (SELECT 1 FROM media_snapshots previous WHERE previous.media_id=current.media_id AND previous.id!=current.id AND previous.observed_at<=?) LIMIT 1",
      )
      .bind(operationId, startedAt)
      .first();
    return row !== null;
  }
  async markUnavailable(mediaId: string, until: number, code: string, now: number) {
    const previous = await this.database
      .prepare(
        "SELECT unavailable_code errorCode,failure_retry_ms retryDelayMs FROM media WHERE id=?",
      )
      .bind(mediaId)
      .first<{ errorCode: string | null; retryDelayMs: number }>();
    const delay = nextObjectFailureDelay(code, Math.max(0, until - now), previous ?? undefined);
    await this.database
      .prepare(
        "UPDATE media SET unavailable_until=?,unavailable_code=?,failure_retry_ms=? WHERE id=?",
      )
      .bind(now + delay, code, delay, mediaId)
      .run();
  }
  async nextStoryExpiry(accountId: string, now: number) {
    const row = await this.database
      .prepare(`SELECT MIN(m.published_at+86400000) AS expiry FROM media m
      WHERE m.account_id=? AND m.product_type='STORY' AND m.published_at>?-86400000
        AND COALESCE((SELECT observed_at FROM media_snapshots WHERE media_id=m.id ORDER BY observed_at DESC LIMIT 1),0)<m.published_at+86400000-?
        AND NOT EXISTS (SELECT 1 FROM collection_jobs j WHERE j.account_id=?
          AND j.origin='stories' AND COALESCE(j.last_attempt_at,j.started_at)>?)`)
      .bind(accountId, now, storyFinalSnapshotWindowMs, accountId, now - storyUrgentRetryIntervalMs)
      .first<{ expiry: number | null }>();
    return row?.expiry ?? null;
  }
  async coverage(accountId: string, now: number) {
    const discovery = await this.database
      .prepare(`SELECT
      SUM(CASE WHEN m.discovery_source='collection' AND m.published_at>=a.connected_at THEN 1 ELSE 0 END) AS measuredPublications,
      SUM(CASE WHEN m.discovery_source='history_inferred' THEN 1 ELSE 0 END) AS inferredPublications,
      AVG(CASE WHEN m.discovery_source='collection' AND m.published_at>=a.connected_at THEN MAX(0,m.first_discovered_at-m.published_at)/60000.0 END) AS averageLagMinutes,
      MAX(CASE WHEN m.discovery_source='collection' AND m.published_at>=a.connected_at THEN MAX(0,m.first_discovered_at-m.published_at)/60000.0 END) AS maximumLagMinutes,
      SUM(CASE WHEN m.discovery_source='collection' AND m.published_at>=a.connected_at AND m.first_discovered_at-m.published_at>3600000 THEN 1 ELSE 0 END) AS overOneHour
      FROM media m JOIN accounts a ON a.id=m.account_id WHERE m.account_id=?`)
      .bind(accountId)
      .first<{
        measuredPublications: number | null;
        inferredPublications: number | null;
        averageLagMinutes: number | null;
        maximumLagMinutes: number | null;
        overOneHour: number | null;
      }>();
    const counters = await this.terminalCounters(accountId);
    const current = await this.database
      .prepare(
        "SELECT MAX(id) id FROM collection_jobs INDEXED BY collection_running_account WHERE account_id=? AND status='running' AND origin IN ('manual','catalogue')",
      )
      .bind(accountId)
      .first<{ id: string | null }>();
    const catalogue = {
      lastFullPassAt: counters
        .filter((c) => ["manual", "catalogue"].includes(c.origin) && c.status === "completed")
        .reduce<number | null>((latest, c) => maximumTime(latest, c.lastCompletedAt), null),
      currentJobId: current?.id ?? null,
    };
    const objects = await this.database
      .prepare(
        "SELECT m.id,m.published_at publishedAt,m.product_type productType,a.connected_at connectedAt,m.collection_status_json counters FROM media m JOIN accounts a ON a.id=m.account_id WHERE m.account_id=?",
      )
      .bind(accountId)
      .all<{
        id: string;
        publishedAt: number;
        productType: string;
        connectedAt: number;
        counters: string;
      }>();
    const observations = objects.results.flatMap((m) =>
      Object.values((JSON.parse(m.counters) as MediaStatusCounter).reachWindows ?? {})
        .filter((at): at is number => at !== null && at <= now)
        .map((observedAt) => ({ mediaId: m.id, observedAt, usable: true })),
    );
    const policies = await this.database
      .prepare(
        "SELECT effective_from effectiveFrom,effective_to effectiveTo,enabled,version,json_extract(policy_json,'$.availability') availability,json_extract(policy_json,'$.grantExpiresAt') grantExpiresAt FROM collection_policy_history WHERE account_id=? ORDER BY effective_from",
      )
      .bind(accountId)
      .all<PolicyInterval>();
    const windows = ageSnapshotWindows.map((w) => ({
      ...ageCoverage(
        objects.results,
        observations,
        policies.results,
        now,
        w.targetHours,
        w.toleranceHours,
      ),
      metric: "reach",
      rankingMode: "absolute",
    }));
    return {
      analysisCoverage: windows,
      collectionCoverage: windows,
      discovery: {
        measurementState: discovery?.measuredPublications
          ? ("measured" as const)
          : ("not_measured" as const),
        denominator: discovery?.measuredPublications ?? 0,
        measuredPublications: discovery?.measuredPublications ?? 0,
        inferredPublications: discovery?.inferredPublications ?? 0,
        averageLagMinutes: discovery?.averageLagMinutes ?? null,
        maximumLagMinutes: discovery?.maximumLagMinutes ?? null,
        overOneHour: discovery?.overOneHour ?? 0,
      },
      ageSnapshots: windows.map((w) => ({
        targetHours: w.targetHours,
        ...w.collectionObligations,
      })),
      catalogue,
    };
  }
  async finishSchedule(schedule: CollectionSchedule, version: number) {
    await this.db
      .update(collectionSchedules)
      .set({
        ...schedule,
        claimToken: sql`${collectionSchedules.claimToken}`,
        claimExpiresAt: sql`${collectionSchedules.claimExpiresAt}`,
        lastSuccessAt:
          schedule.lastSuccessAt === null
            ? sql`${collectionSchedules.lastSuccessAt}`
            : sql`MAX(COALESCE(${collectionSchedules.lastSuccessAt},0),${schedule.lastSuccessAt})`,
      })
      .where(
        and(
          eq(collectionSchedules.accountId, schedule.accountId),
          eq(collectionSchedules.enabled, true),
          eq(collectionSchedules.updatedAt, version),
          schedule.claimToken ? eq(collectionSchedules.claimToken, schedule.claimToken) : undefined,
        ),
      );
  }
}
