import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCollectionExecutor } from "../src/app/create-features";
import { activityPeriodPlan } from "../src/modules/account-insights/domain/periods";
import { D1Collection } from "../src/modules/collection/infrastructure/d1-collection";
import { ApplicationError } from "../src/shared/application/application-error";
import { accountId, connect, fixture, sampleMedia } from "./helpers";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM accounts").run();
  await env.DB.prepare("DELETE FROM oauth_attempts").run();
});

async function ready() {
  const f = fixture();
  vi.mocked(f.transport.exchangeCode).mockResolvedValue({
    accessToken: "fake-short-token",
    scopes: [
      "instagram_business_basic",
      "instagram_business_manage_insights",
      "instagram_business_manage_comments",
    ],
  });
  await connect(f);
  await f.request(`/api/accounts/${accountId}/sync`, "POST", { operationId: crypto.randomUUID() });
  const collector = createCollectionExecutor(env, { transport: () => f.transport }, f.now);
  return { ...f, collector, store: new D1Collection(env.DB) };
}

async function resetJob(id: string, now: number) {
  await env.DB.prepare(
    "UPDATE collection_jobs SET status='running',pages=0,collected=0,media_processed=0,cursor=NULL,last_success_at=NULL,completed_at=NULL,next_attempt_at=? WHERE id=?",
  )
    .bind(now, id)
    .run();
}

describe("one-step scheduling and atomic ownership", () => {
  it("finds work beyond 100 leased or backoff jobs and atomically grants only one owner", async () => {
    const f = await ready();
    const template = await f.collector.start(accountId, crypto.randomUUID(), "comments", true);
    await env.DB.batch(
      Array.from({ length: 105 }, (_, i) =>
        env.DB.prepare(
          "INSERT INTO collection_jobs (id,account_id,origin,automatic,status,pages,collected,media_processed,attempt,failures,next_attempt_at,started_at,lease_token,lease_expires_at) VALUES (?,?,'comments',1,'running',0,0,0,0,0,?,?,'other',?)",
        ).bind(`leased-${i}`, accountId, f.now() - 1000, f.now() - 1000, f.now() + 900_000),
      ),
    );
    const backoff = await f.collector.start(accountId, crypto.randomUUID(), "stories", true);
    await env.DB.prepare("UPDATE collection_jobs SET next_attempt_at=? WHERE id=?")
      .bind(f.now() + 60_000, backoff.id)
      .run();
    expect(await f.collector.nextWakeAt()).toBe(f.now() + 1000);
    const claims = await Promise.all([
      f.store.claim(template.id, "owner-a", f.now()),
      f.store.claim(template.id, "owner-b", f.now()),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await f.collector.nextWakeAt()).toBe(f.now() + 60_000);
    const owner = claims[0] ? "owner-a" : "owner-b";
    await f.store.save({ ...template, pages: 99 }, "not-the-owner", f.now());
    expect((await f.collector.job(template.id)).pages).toBe(0);
    // After expiration, an old owner cannot overwrite the new owner's progress.
    f.advance(900_000);
    expect(await f.store.claim(template.id, "new-owner", f.now())).not.toBeNull();
    await f.store.save({ ...template, pages: 99 }, owner, f.now());
    expect((await f.collector.job(template.id)).pages).toBe(0);
  });

  it("gives Stories a bounded head start while aging keeps comments from starving", async () => {
    const f = await ready();
    const comments = await f.collector.start(accountId, crypto.randomUUID(), "comments", true);
    const story = await f.collector.start(accountId, crypto.randomUUID(), "stories", true);
    expect((await f.collector.tick())?.decision.selected?.id).toBe(story.id);
    await env.DB.prepare("UPDATE collection_jobs SET next_attempt_at=? WHERE id=?")
      .bind(f.now() - 16 * 60_000, comments.id)
      .run();
    expect((await f.collector.tick())?.decision.selected?.id).toBe(comments.id);
  });

  it("does not create duplicate automatic Stories jobs when an earlier pass is still running", async () => {
    const f = await ready();
    await f.collector.configure(accountId, { enabled: true, discoveryMinutes: 360 });
    const story = await f.collector.start(accountId, crypto.randomUUID(), "stories", true);
    await env.DB.prepare("UPDATE collection_jobs SET next_attempt_at=? WHERE id=?")
      .bind(f.now() + 2 * 3600_000, story.id)
      .run();
    await env.DB.prepare(
      "UPDATE collection_schedules SET next_discovery_at=?,next_insights_at=? WHERE account_id=?",
    )
      .bind(f.now() + 86_400_000, f.now() + 86_400_000, accountId)
      .run();
    f.advance(600_000 - (f.now() % 600_000));
    await f.collector.tick();
    expect(
      (await f.collector.status(accountId)).jobs.filter((j) => j.origin === "stories"),
    ).toHaveLength(1);
    expect(f.transport.stories).not.toHaveBeenCalled();
    expect((await f.collector.status(accountId)).schedule.nextStoriesAt).toBe(f.now() + 3600_000);
  });

  it("does not disable a schedule after repeated conflicts with an active sync", async () => {
    const f = await ready();
    await f.collector.configure(accountId, { enabled: true, discoveryMinutes: 360 });
    const farFuture = f.now() + 86_400_000;
    await env.DB.prepare(
      "UPDATE collection_schedules SET next_stories_at=?,next_insights_at=?,next_discovery_at=? WHERE account_id=?",
    )
      .bind(farFuture, farFuture, farFuture, accountId)
      .run();
    await env.DB.prepare("DELETE FROM media_snapshots").run();
    // This case exercises media-sync conflicts; comment refresh does not use
    // the media sync lease.
    await env.DB.prepare("UPDATE instagram_connections SET scopes=? WHERE account_id=?")
      .bind(
        JSON.stringify(["instagram_business_basic", "instagram_business_manage_insights"]),
        accountId,
      )
      .run();
    await env.DB.prepare(
      "INSERT INTO sync_leases (account_id,run_id,expires_at) VALUES (?,'active',?)",
    )
      .bind(accountId, farFuture)
      .run();
    for (let i = 0; i < 7; i++) {
      await f.collector.tick();
      const { schedule } = await f.collector.status(accountId);
      expect(schedule).toMatchObject({
        enabled: true,
        failures: 0,
        errorCode: "SYNC_IN_PROGRESS",
        retryAt: f.now() + 300_000,
      });
      f.advance(300_000);
    }
    await env.DB.prepare("DELETE FROM sync_leases").run();
    await f.collector.tick();
    expect((await f.collector.status(accountId)).schedule).toMatchObject({
      failures: 0,
      errorCode: null,
      lastSuccessAt: f.now(),
    });
  });
});

describe("recovery without inventing upstream failures", () => {
  it("replays a completed comment page after interruption without repeating the source request", async () => {
    const f = await ready();
    const job = await f.collector.start(accountId, crypto.randomUUID(), "comments", true);
    await f.collector.advance(job.id);
    await resetJob(job.id, f.now());
    expect(await f.collector.advance(job.id)).toMatchObject({
      status: "completed",
      pages: 1,
      mediaProcessed: 1,
      errorCode: null,
    });
    expect(f.transport.comments).toHaveBeenCalledTimes(1);
  });

  it("waits for a running comment operation, then retries an expired one under the same logical operation ID", async () => {
    const f = await ready();
    const job = await f.collector.start(accountId, crypto.randomUUID(), "comments", true);
    await f.collector.advance(job.id);
    await resetJob(job.id, f.now());
    await env.DB.prepare(
      "UPDATE comment_collections SET result_json=json_set(result_json,'$.status','running','$.observedAt',NULL)",
    ).run();
    expect(await f.collector.advance(job.id)).toMatchObject({
      pages: 0,
      attempt: 0,
      failures: 0,
      errorCode: "SYNC_IN_PROGRESS",
    });
    expect(f.transport.comments).toHaveBeenCalledTimes(1);
    f.advance(16 * 60_000);
    expect(await f.collector.advance(job.id)).toMatchObject({
      status: "completed",
      pages: 1,
      failures: 0,
      errorCode: null,
    });
    expect(f.transport.comments).toHaveBeenCalledTimes(2);
    const ids = await env.DB.prepare("SELECT COUNT(*) total FROM comment_collections").first<{
      total: number;
    }>();
    expect(ids?.total).toBe(1);
  });

  it("preserves SYNC_LEASE_EXPIRED and recovers a catalogue page on the next slot", async () => {
    const f = await ready();
    const job = await f.collector.start(accountId, crypto.randomUUID(), "scheduled", true);
    await f.collector.advance(job.id);
    await resetJob(job.id, f.now());
    // Simulate termination after reserving the page but before its result was saved.
    await env.DB.prepare(
      "UPDATE sync_runs SET status='running',completed_at=NULL WHERE kind='page'",
    ).run();
    f.advance(900_000);
    const calls = vi.mocked(f.transport.mediaPage).mock.calls.length;
    expect(await f.collector.advance(job.id)).toMatchObject({
      status: "completed",
      pages: 1,
      failures: 0,
      errorCode: null,
    });
    expect(f.transport.mediaPage).toHaveBeenCalledTimes(calls + 1);
  });

  it("preserves saved authorization failures when a page result is replayed", async () => {
    const f = await ready();
    const job = await f.collector.start(accountId, crypto.randomUUID(), "scheduled", true);
    await f.collector.advance(job.id);
    await resetJob(job.id, f.now());
    await env.DB.prepare(
      "UPDATE sync_runs SET status='failed',error_code='INSTAGRAM_AUTH_EXPIRED' WHERE kind='page'",
    ).run();
    vi.mocked(f.transport.profile).mockRejectedValueOnce(
      new ApplicationError("INSTAGRAM_AUTH_EXPIRED", "Reconnect"),
    );
    expect(await f.collector.advance(job.id)).toMatchObject({
      pages: 0,
      failures: 0,
      errorCode: "INSTAGRAM_AUTH_EXPIRED",
    });
  });

  it("resumes an interrupted exact-period job with the same logical operation ID after expiration", async () => {
    const f = await ready();
    await f.collector.configure(accountId, { enabled: true, discoveryMinutes: 60 });
    await env.DB.prepare(
      "UPDATE collection_schedules SET next_stories_at=?,next_discovery_at=? WHERE account_id=?",
    )
      .bind(f.now() + 86_400_000, f.now() + 86_400_000, accountId)
      .run();
    await f.collector.tick();
    const job = (await f.collector.status(accountId)).jobs.find((job) => job.origin === "activity");
    if (!job) throw new Error("Expected activity job");
    const originalCalls = vi.mocked(f.transport.structuredInsights).mock.calls.length;
    expect(originalCalls).toBe(12);
    await env.DB.prepare(
      "UPDATE account_insights SET payload_json=json_set(payload_json,'$.status','running','$.observedAt',NULL)",
    ).run();
    const initialPeriod = activityPeriodPlan(f.now(), "UTC", []).periods[0];
    await env.DB.prepare(
      "UPDATE collection_jobs SET pages=0,collected=0,cursor=?,last_success_at=NULL WHERE id=?",
    )
      .bind(JSON.stringify([initialPeriod]), job.id)
      .run();
    expect(await f.collector.advance(job.id)).toMatchObject({
      errorCode: "SYNC_IN_PROGRESS",
      failures: 0,
      pages: 0,
    });
    f.advance(16 * 60_000);
    expect(await f.collector.advance(job.id)).toMatchObject({
      errorCode: null,
      pages: 1,
      lastSuccessAt: f.now(),
    });
    expect(f.transport.structuredInsights).toHaveBeenCalledTimes(originalCalls * 2);
    expect(
      (
        await env.DB.prepare("SELECT COUNT(*) total FROM account_insights").first<{
          total: number;
        }>()
      )?.total,
    ).toBe(1);
  });

  it("does not share an Instagram reader across scheduled invocations", async () => {
    const f = await ready();
    const factory = vi.fn(() => f.transport);
    for (let i = 0; i < 2; i++) {
      const collector = createCollectionExecutor(env, { transport: factory }, f.now);
      const job = await collector.start(accountId, crypto.randomUUID(), "comments", true);
      await collector.advance(job.id);
    }
    expect(factory).toHaveBeenCalledTimes(2);
    expect(f.transport.comments).toHaveBeenCalledTimes(2);
    expect(sampleMedia.id).toBe(vi.mocked(f.transport.comments).mock.calls[0]?.[1]);
  });
});
