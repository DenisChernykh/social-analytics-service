import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { activityMetrics } from "../src/modules/account-insights/domain/model";
import { D1Insights } from "../src/modules/account-insights/infrastructure/d1-insights";
import type { JobAggregate } from "../src/modules/collection/domain/status-counters";
import { D1Collection } from "../src/modules/collection/infrastructure/d1-collection";
import type { HttpAttempt } from "../src/modules/instagram/application/ports";
import { quotaObservation } from "../src/modules/instagram/domain/request-policy";
import { D1RequestPolicy } from "../src/modules/instagram/infrastructure/d1-request-policy";
import { accountId, connect, fixture, sampleMedia } from "./helpers";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM accounts").run();
});
async function ready() {
  const f = fixture();
  await connect(f);
  await f.request(`/api/accounts/${accountId}/sync`, "POST", { operationId: crypto.randomUUID() });
  return { ...f, mediaId: `${accountId}_${sampleMedia.id}`, store: new D1Collection(env.DB) };
}
async function snapshot(
  mediaId: string,
  id: string,
  at: number,
  metrics: unknown,
  provenance: string | null = null,
) {
  return env.DB.prepare(
    "INSERT INTO media_snapshots(id,media_id,observed_at,api_version,metrics_json,provenance_json) VALUES(?,?,?,'v26.0',?,?) ON CONFLICT(id) DO NOTHING",
  )
    .bind(id, mediaId, at, JSON.stringify(metrics), provenance)
    .run();
}
async function job(at: number, status: string, origin = "stories", next = at) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO collection_jobs(id,account_id,origin,status,started_at,next_attempt_at,last_attempt_at,last_success_at,last_useful_observation_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      id,
      accountId,
      origin,
      status,
      at,
      next,
      at,
      status === "completed" ? at : null,
      status === "completed" ? at : null,
      status === "running" ? null : at,
    )
    .run();
  return id;
}
async function oldJobAggregates(now: number, cutoff = now) {
  return (
    await env.DB.prepare(`SELECT origin,status,COUNT(*) count,SUM(status='running' AND next_attempt_at<=?) due,
    MIN(CASE WHEN status='running' THEN next_attempt_at END) oldestDue,
    SUM(status='running' AND origin IN ('scheduled','stories') AND started_at+900000<? AND first_attempt_at IS NULL) atRiskFresh,
    SUM(status='running' AND origin IN ('scheduled','stories','comments_refresh') AND next_attempt_at<=?) freshDue,
    MAX(last_attempt_at) lastAttempt,MAX(last_success_at) lastSuccess,MAX(last_useful_observation_at) lastUsefulObservation
    FROM collection_jobs WHERE account_id=? AND started_at<=? GROUP BY origin,status`)
      .bind(now, now, now, accountId, cutoff)
      .all<JobAggregate>()
  ).results.sort((a, b) => a.origin.localeCompare(b.origin) || a.status.localeCompare(b.status));
}

describe("materialized collection status", () => {
  it("keeps private counters out of the account API and isolates accounts with the same external media ID", async () => {
    const f = await ready();
    const response = (await (await f.request("/api/accounts")).json()) as {
      accounts: Record<string, unknown>[];
    };
    expect(Object.keys(response.accounts[0] ?? {}).sort()).toEqual([
      "accountType",
      "connectedAt",
      "externalId",
      "id",
      "lastSyncedAt",
      "platform",
      "username",
    ]);
    await env.DB.prepare(
      "INSERT INTO accounts(id,platform,external_id,username,account_type,connected_at) VALUES('other-account','instagram','other','fixture','MEDIA_CREATOR',?)",
    )
      .bind(f.now())
      .run();
    await env.DB.prepare(
      "INSERT INTO media(id,account_id,external_id,caption,search_text,media_type,product_type,permalink,published_at,updated_at) SELECT 'other-media','other-account',external_id,'','','IMAGE','FEED',permalink,published_at,updated_at FROM media WHERE id=?",
    )
      .bind(f.mediaId)
      .run();
    await snapshot("other-media", "foreign-snapshot", f.now() + 5000, { reach: { value: 500 } });
    await env.DB.prepare(
      "INSERT INTO comments(id,media_id,text,published_at,observed_at) VALUES('foreign-comment','other-media','fixture',1,1)",
    ).run();
    await env.DB.prepare(
      "INSERT INTO collection_jobs(id,account_id,origin,status,started_at,next_attempt_at) VALUES('foreign-job','other-account','stories','completed',?,?)",
    )
      .bind(f.now(), f.now())
      .run();
    await env.DB.prepare(
      "INSERT INTO instagram_api_state(id,account_id,api_version,since_at,observed_at,object_freshness_json) VALUES('foreign-state','other-account','v26.0',?,?,?)",
    )
      .bind(
        f.now(),
        f.now(),
        JSON.stringify({
          [sampleMedia.id]: { lastAttempt: f.now() + 5000, lastCheck: f.now() + 5000 },
        }),
      )
      .run();
    expect((await f.store.dataFreshness(accountId))[0]).toMatchObject({
      objects: 1,
      lastAttempt: null,
      lastSuccess: f.now(),
    });
    expect((await f.store.jobPage(accountId, { limit: 20 }, f.now())).total).toBe(0);
    expect((await f.store.commentStatus(accountId, f.now())).uniqueComments).toBe(0);
  });

  it("advances retry, job and lease deadlines and source age without a database write", async () => {
    const f = await ready();
    const at = f.now();
    await env.DB.prepare(
      "UPDATE media SET published_at=?,unavailable_code='INSTAGRAM_SOURCE_ERROR',unavailable_until=? WHERE id=?",
    )
      .bind(at, at + 300000, f.mediaId)
      .run();
    await job(at, "running", "stories", at + 1000);
    const terminal = await job(at, "failed", "activity");
    await env.DB.prepare("UPDATE collection_jobs SET lease_expires_at=? WHERE id=?")
      .bind(at + 5000, terminal)
      .run();
    await env.DB.prepare(
      "INSERT INTO account_insights(id,account_id,signature,observed_at,payload_json) VALUES('running-insight',?,'fixture',?,?)",
    )
      .bind(accountId, at, JSON.stringify({ status: "running", requestedAt: at }))
      .run();
    expect(
      (await f.store.jobPage(accountId, { limit: 20 }, at)).aggregates.find(
        (r) => r.status === "running",
      )?.due,
    ).toBe(0);
    expect(await f.store.diagnostics(accountId, at)).toMatchObject({
      leasesInUse: 1,
      expiredInsightAttempts: 0,
    });
    expect(await f.store.mediaRefreshStatus(accountId, at)).toMatchObject({
      ready: 0,
      deferred: 1,
    });
    f.advance(300001);
    expect(
      (await f.store.jobPage(accountId, { limit: 20 }, f.now())).aggregates.find(
        (r) => r.status === "running",
      )?.due,
    ).toBe(1);
    expect(await f.store.mediaRefreshStatus(accountId, f.now())).toMatchObject({
      ready: 1,
      deferred: 0,
    });
    expect(await f.store.diagnostics(accountId, f.now())).toMatchObject({
      leasesInUse: 0,
      expiredInsightAttempts: 0,
    });
    f.advance(600000);
    expect((await f.store.diagnostics(accountId, f.now())).expiredInsightAttempts).toBe(1);
    await env.DB.prepare("UPDATE media SET unavailable_code=NULL,unavailable_until=0 WHERE id=?")
      .bind(f.mediaId)
      .run();
    expect((await f.store.mediaRefreshStatus(accountId, f.now())).staleSnapshots).toBe(0);
    f.advance(2700000);
    expect((await f.store.mediaRefreshStatus(accountId, f.now())).staleSnapshots).toBe(1);
  });
  it("keeps out-of-order/replayed/corrected observations and zeroes accurate, and rolls counters back atomically", async () => {
    const f = await ready();
    await env.DB.prepare("UPDATE media SET published_at=? WHERE id=?")
      .bind(f.now() - 3_600_000, f.mediaId)
      .run();
    await snapshot(f.mediaId, "future", f.now() + 1000, { reach: { value: null } });
    await snapshot(
      f.mediaId,
      "zero",
      f.now() - 1000,
      { reach: { value: 0 }, futureMetric: { value: 0 } },
      "{}",
    );
    await snapshot(f.mediaId, "older", f.now() - 2000, { reach: { value: null } });
    await snapshot(f.mediaId, "zero", f.now() - 1000, { reach: { value: 0 } }, "{}");
    const counters = await env.DB.prepare("SELECT collection_status_json FROM media WHERE id=?")
      .bind(f.mediaId)
      .first<string>("collection_status_json");
    const raw = await env.DB.prepare(
      "SELECT MAX(observed_at) latest,SUM(provenance_json IS NULL) legacy FROM media_snapshots WHERE media_id=?",
    )
      .bind(f.mediaId)
      .first<{ latest: number; legacy: number }>();
    expect(JSON.parse(counters ?? "{}")).toMatchObject({
      lastSuccess: raw?.latest,
      legacy: raw?.legacy,
      reachWindows: { "1": f.now() - 1000 },
    });
    expect(
      (await f.store.coverage(accountId, f.now())).analysisCoverage?.[0]?.analysisCoverage.observed,
    ).toBe(1);
    const before = await env.DB.prepare("SELECT collection_status_json FROM media WHERE id=?")
      .bind(f.mediaId)
      .first("collection_status_json");
    await expect(
      env.DB.batch([
        env.DB.prepare(
          "INSERT INTO media_snapshots(id,media_id,observed_at,api_version,metrics_json) VALUES('rollback',?,?,'v26.0','{}')",
        ).bind(f.mediaId, f.now() + 5000),
        env.DB.prepare(
          "INSERT INTO comments(id,media_id,text,published_at,observed_at) VALUES('invalid','missing','',1,1)",
        ),
      ]),
    ).rejects.toThrow();
    expect(
      await env.DB.prepare("SELECT collection_status_json FROM media WHERE id=?")
        .bind(f.mediaId)
        .first("collection_status_json"),
    ).toBe(before);
    await env.DB.prepare("DELETE FROM media_snapshots WHERE id='future'").run();
    await env.DB.prepare(
      "UPDATE media_snapshots SET metrics_json='{}',provenance_json='{}' WHERE id='zero'",
    ).run();
    expect((await f.store.dataFreshness(accountId))[0]?.lastUsefulObservation).toBe(f.now()); // Original useful snapshot.
    await env.DB.prepare("UPDATE media SET published_at=? WHERE id=?")
      .bind(f.now() - 10 * 3_600_000, f.mediaId)
      .run();
    expect(
      (await f.store.coverage(accountId, f.now())).analysisCoverage?.[0]?.analysisCoverage.observed,
    ).toBe(0);
  });

  it("keeps terminal totals exact across cursor cutoffs, midnight, resume, cancellation and deletion", async () => {
    const f = await ready();
    const now = Math.floor(f.now() / 86_400_000) * 86_400_000 + 10000;
    const completed = await job(now - 2000, "completed");
    const failed = await job(now - 1000, "failed", "comments");
    await job(now - 1000, "running", "scheduled", now + 1000);
    await job(now - 86_400_001, "completed", "catalogue");
    const page = await f.store.jobPage(accountId, { limit: 1 }, now);
    expect(page.aggregates).toEqual(await oldJobAggregates(now));
    expect(page.nextCursor).not.toBeNull();
    await job(now + 1, "completed");
    await env.DB.prepare("UPDATE collection_jobs SET status='running',next_attempt_at=? WHERE id=?")
      .bind(now, failed)
      .run();
    await env.DB.prepare("UPDATE collection_jobs SET status='cancelled' WHERE id=?")
      .bind(completed)
      .run();
    const continuation = await f.store.jobPage(
      accountId,
      { limit: 1, cursor: page.nextCursor as string },
      now + 2000,
    );
    expect(continuation.aggregates).toEqual(await oldJobAggregates(now + 2000, now));
    expect(continuation.total).toBe(4);
    await env.DB.prepare("DELETE FROM collection_jobs WHERE id=?").bind(completed).run();
    expect((await f.store.jobPage(accountId, { limit: 20 }, now + 2000)).aggregates).toEqual(
      await oldJobAggregates(now + 2000),
    );
  });

  it("counts comment identities once across upserts, moves, deletions and failed reply jobs", async () => {
    const f = await ready();
    const second = `${f.mediaId}2`;
    await env.DB.prepare(
      "INSERT INTO media(id,account_id,external_id,caption,search_text,media_type,product_type,permalink,published_at,updated_at) SELECT ?,account_id,?,'','','IMAGE','FEED',permalink,published_at,updated_at FROM media WHERE id=?",
    )
      .bind(second, `${sampleMedia.id}2`, f.mediaId)
      .run();
    const insert = () =>
      env.DB.prepare(
        "INSERT INTO comments(id,media_id,text,published_at,observed_at) VALUES('one',?,'new',1,1) ON CONFLICT(id) DO UPDATE SET text='updated'",
      )
        .bind(f.mediaId)
        .run();
    await insert();
    await insert();
    expect((await f.store.commentStatus(accountId, f.now())).uniqueComments).toBe(1);
    await env.DB.prepare("UPDATE comments SET media_id=? WHERE id='one'").bind(second).run();
    expect(
      await env.DB.prepare("SELECT unique_saved FROM comment_media_state WHERE media_id=?")
        .bind(f.mediaId)
        .first("unique_saved"),
    ).toBe(0);
    expect((await f.store.commentStatus(accountId, f.now())).uniqueComments).toBe(1);
    const failed = await job(f.now(), "failed", "comments");
    await env.DB.prepare("UPDATE collection_jobs SET cursor=? WHERE id=?")
      .bind(JSON.stringify({ parents: ["a", "b"] }), failed)
      .run();
    expect((await f.store.commentStatus(accountId, f.now())).pendingReplyBranches).toBe(2);
    await env.DB.prepare("UPDATE collection_jobs SET status='running' WHERE id=?")
      .bind(failed)
      .run();
    expect((await f.store.commentStatus(accountId, f.now())).pendingReplyBranches).toBe(2);
    await env.DB.prepare("DELETE FROM comments WHERE id='one'").run();
    expect((await f.store.commentStatus(accountId, f.now())).uniqueComments).toBe(0);
  });

  it("keeps only eligible latest activity periods with API/time-zone isolation and repairs corrections", async () => {
    const f = await ready();
    const store = new D1Insights(env.DB);
    const payload = (observedAt: number, extra: Record<string, unknown> = {}) => ({
      status: "completed",
      apiVersion: "v26.0",
      input: {
        kind: "activity",
        from: f.now() - 86_400_000,
        to: f.now(),
        timeZone: "UTC",
        metricType: "total_value",
        metrics: activityMetrics,
      },
      values: [],
      observedAt,
      ...extra,
    });
    const save = async (id: string, at: number, body: unknown) =>
      env.DB.prepare(
        "INSERT INTO account_insights(id,account_id,signature,observed_at,payload_json) VALUES(?,?,'fixture',?,?) ON CONFLICT(id) DO UPDATE SET observed_at=excluded.observed_at,payload_json=excluded.payload_json",
      )
        .bind(id, accountId, at, JSON.stringify(body))
        .run();
    await save("early", f.now(), payload(f.now()));
    await save("later", f.now() + 1000, payload(f.now() + 1000));
    await save(
      "deferred",
      f.now() + 2000,
      payload(f.now() + 2000, { values: [{ reason: "request_deferred" }] }),
    );
    await save("other-api", f.now() + 3000, payload(f.now() + 3000, { apiVersion: "v27.0" }));
    expect(await store.periodObservations(accountId, "UTC", "v26.0", 0)).toEqual([
      { from: f.now() - 86_400_000, to: f.now(), observedAt: f.now() + 1000 },
    ]);
    expect(await store.periodObservations(accountId, "Asia/Yekaterinburg", "v26.0", 0)).toEqual([]);
    await save("later", f.now() + 1000, payload(f.now() + 1000, { status: "failed" }));
    expect((await store.periodObservations(accountId, "UTC", "v26.0", 0))[0]?.observedAt).toBe(
      f.now(),
    );
    await env.DB.prepare("DELETE FROM account_insights WHERE id='early'").run();
    expect(await store.periodObservations(accountId, "UTC", "v26.0", 0)).toEqual([]);
  });

  it("updates HTTP freshness inside the existing accounting writes and retains it after receipt pruning", async () => {
    const f = await ready();
    const policy = new D1RequestPolicy(env.DB);
    const attempt = (at: number): HttpAttempt => ({
      id: crypto.randomUUID(),
      accountId,
      operationId: null,
      objectId: sampleMedia.id,
      endpointFamily: "insights",
      parameters: {},
      requestStartedAt: at,
      responseReceivedAt: null,
      failedAt: null,
      requestedApiVersion: "v26.0",
      actualApiVersion: null,
      login: "instagram_login",
      httpStatus: null,
      graphCode: null,
      graphSubcode: null,
      result: "pending",
      sample: null,
    });
    const successful = attempt(f.now());
    await policy.beginAttempt(successful);
    successful.responseReceivedAt = f.now() + 1000;
    successful.httpStatus = 200;
    successful.result = "success";
    await policy.finishAttempt(
      successful,
      quotaObservation({ retryAfter: null, appUsage: null, businessUsage: null }, f.now()),
    );
    const failed = attempt(f.now() + 2000);
    await policy.beginAttempt(failed);
    failed.failedAt = f.now() + 3000;
    failed.result = "timeout";
    await policy.finishAttempt(
      failed,
      quotaObservation({ retryAfter: null, appUsage: null, businessUsage: null }, f.now()),
    );
    expect((await f.store.dataFreshness(accountId))[0]).toMatchObject({
      lastAttempt: f.now() + 2000,
      lastCheck: f.now() + 1000,
    });
    await env.DB.prepare("DELETE FROM instagram_http_attempts WHERE account_id=?")
      .bind(accountId)
      .run();
    expect((await f.store.dataFreshness(accountId))[0]).toMatchObject({
      lastAttempt: f.now() + 2000,
      lastCheck: f.now() + 1000,
    });
  });
});
