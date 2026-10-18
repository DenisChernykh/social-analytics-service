import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCollectionExecutor } from "../src/app/create-features";
import { D1Collection } from "../src/modules/collection/infrastructure/d1-collection";
import { ApplicationError } from "../src/shared/application/application-error";
import { accountId, connect, fixture, sampleMedia } from "./helpers";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM accounts").run();
  await env.DB.prepare("DELETE FROM oauth_attempts").run();
});

async function ready() {
  const f = fixture();
  await connect(f);
  return {
    ...f,
    collector: createCollectionExecutor(env, { transport: () => f.transport }, f.now),
    store: new D1Collection(env.DB),
  };
}

async function onlyRefresh(f: Awaited<ReturnType<typeof ready>>) {
  await f.collector.configure(accountId, { enabled: true, discoveryMinutes: 60 });
  const future = f.now() + 30 * 86400_000;
  await env.DB.prepare(
    "UPDATE collection_schedules SET next_discovery_at=?,next_stories_at=?,next_insights_at=?,next_catalogue_at=? WHERE account_id=?",
  )
    .bind(future, future, future, future, accountId)
    .run();
}

describe("collection fault isolation", () => {
  it("persists available metadata and failure provenance, then continues the catalogue beyond an insight refusal", async () => {
    const f = await ready();
    const bad = {
      ...sampleMedia,
      id: "old-carousel",
      productType: "FEED",
      mediaType: "CAROUSEL_ALBUM" as const,
    };
    vi.mocked(f.transport.mediaPage)
      .mockResolvedValueOnce({ media: [bad], nextCursor: "next-publication" })
      .mockResolvedValueOnce({ media: [sampleMedia], nextCursor: null });
    const error = new ApplicationError("INSTAGRAM_SOURCE_ERROR", "Do not persist provider payload");
    error.receipt = {
      receiptId: "failed-insights-receipt",
      operationId: "failed-page",
      requestStartedAt: f.now(),
      responseReceivedAt: f.now(),
      requestedApiVersion: "v26.0",
      actualApiVersion: "v26.0",
      login: "instagram_login",
    };
    vi.mocked(f.transport.insights).mockRejectedValueOnce(error);
    const job = await f.collector.start(accountId, crypto.randomUUID(), "catalogue");
    expect(await f.collector.advance(job.id)).toMatchObject({
      status: "running",
      pages: 1,
      cursor: "next-publication",
    });
    const report = (await (
      await f.request(`/api/media/${accountId}_${bad.id}/statistics`)
    ).json()) as { metrics: Record<string, unknown> };
    expect(report.metrics.likes).toMatchObject({ value: 100, sourceField: "like_count" });
    expect(report.metrics.reach).toMatchObject({
      value: null,
      reason: "source_error",
      provenance: { receiptId: "failed-insights-receipt" },
    });
    expect(JSON.stringify(report)).not.toContain("Do not persist provider payload");
    expect(
      await env.DB.prepare(
        "SELECT unavailable_until,unavailable_code FROM media WHERE external_id=?",
      )
        .bind(bad.id)
        .first(),
    ).toEqual({ unavailable_until: f.now() + 300_000, unavailable_code: "INSTAGRAM_SOURCE_ERROR" });
    expect(f.transport.structuredInsights).not.toHaveBeenCalled();
    expect(await f.collector.advance(job.id)).toMatchObject({
      status: "completed",
      pages: 2,
      mediaProcessed: 2,
    });
    expect(
      await env.DB.prepare(
        "SELECT coverage_state FROM sync_runs WHERE next_cursor='next-publication'",
      ).first("coverage_state"),
    ).toBe("partial");
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM media_snapshots").first("n")).toBe(2);
    const refresh = await f.store.mediaRefreshStatus(accountId, f.now());
    expect(refresh).toMatchObject({ publications: 2, missingSnapshots: 0, deferred: 1 });
    f.advance(300_000);
    // A partial snapshot must not hide failed insights for the next full week.
    expect(await f.store.dueMedia(accountId, f.now())).toBe(`${accountId}_${bad.id}`);
  });

  it("isolates metadata refusal to its publication and refreshes another overdue archive item on the next alarm portion", async () => {
    const f = await ready();
    const bad = { ...sampleMedia, id: "bad", timestamp: f.now() - 100 * 86400_000 };
    const good = { ...sampleMedia, id: "good", timestamp: bad.timestamp - 1000 };
    vi.mocked(f.transport.mediaPage).mockResolvedValue({ media: [bad, good], nextCursor: null });
    await f.request(`/api/accounts/${accountId}/sync`, "POST", {
      operationId: crypto.randomUUID(),
    });
    f.advance(8 * 86400_000);
    await onlyRefresh(f);
    vi.mocked(f.transport.media).mockImplementation(async (_token, id) => {
      if (id === bad.id) throw new ApplicationError("INSTAGRAM_SOURCE_ERROR", "Object refusal");
      return good;
    });
    await f.collector.tick();
    expect((await f.collector.status(accountId)).schedule).toMatchObject({
      failures: 0,
      errorCode: null,
      retryAt: f.now() + 1000,
    });
    expect(await f.store.mediaRefreshStatus(accountId, f.now())).toMatchObject({
      publications: 2,
      missingSnapshots: 0,
      staleSnapshots: 2,
      deferred: 1,
      ready: 1,
      retries: [
        { errorCode: "INSTAGRAM_SOURCE_ERROR", count: 1, nextAttemptAt: f.now() + 300_000 },
      ],
    });
    f.advance(1000);
    await f.collector.tick();
    expect(vi.mocked(f.transport.media).mock.calls.map((call) => call[1])).toEqual(["bad", "good"]);
    expect(await f.store.mediaRefreshStatus(accountId, f.now())).toMatchObject({
      staleSnapshots: 1,
      deferred: 1,
      ready: 0,
    });
    f.advance(300_000);
    expect(await f.store.dueMedia(accountId, f.now())).toBe(`${accountId}_${bad.id}`);
  });

  it.each(["INSTAGRAM_AUTH_EXPIRED", "INSTAGRAM_RATE_LIMITED"] as const)(
    "keeps %s account-wide and does not turn it into a successful partial snapshot",
    async (code) => {
      const f = await ready();
      await f.request(`/api/accounts/${accountId}/sync`, "POST", {
        operationId: crypto.randomUUID(),
      });
      f.advance(8 * 86400_000);
      await onlyRefresh(f);
      vi.mocked(f.transport.insights).mockRejectedValueOnce(
        new ApplicationError(code, "Account failure"),
      );
      await f.collector.tick();
      expect((await f.collector.status(accountId)).schedule).toMatchObject({
        errorCode: code,
        retryAt: f.now() + (code === "INSTAGRAM_RATE_LIMITED" ? 900_000 : 300_000),
      });
      expect(await env.DB.prepare("SELECT COUNT(*) n FROM media_snapshots").first("n")).toBe(1);
      expect(
        await env.DB.prepare("SELECT unavailable_until FROM media").first("unavailable_until"),
      ).toBe(0);
    },
  );

  it("retains a successful core value and retries a returned per-field source error without labeling it unsupported", async () => {
    const f = await ready();
    const original = vi.mocked(f.transport.insights).getMockImplementation();
    vi.mocked(f.transport.insights).mockImplementation(async (...args) => ({
      ...(await original?.(...args)),
      reach: { value: null, reason: "source_error" },
    }));
    const run = (await (
      await f.request(`/api/accounts/${accountId}/sync`, "POST", {
        operationId: crypto.randomUUID(),
      })
    ).json()) as { coverageState: string };
    expect(run.coverageState).toBe("partial");
    const report = (await (
      await f.request(`/api/media/${accountId}_${sampleMedia.id}/statistics`)
    ).json()) as { metrics: Record<string, unknown> };
    expect(report.metrics.reach).toMatchObject({ value: null, reason: "source_error" });
    expect(report.metrics.views).toMatchObject({ value: 2000 });
    expect(await f.store.mediaRefreshStatus(accountId, f.now())).toMatchObject({ deferred: 1 });
  });

  it("resumes a legacy terminal source failure with the same cursor and operation ID without changing public replay behavior", async () => {
    const f = await ready();
    await f.request(`/api/accounts/${accountId}/sync`, "POST", {
      operationId: crypto.randomUUID(),
    });
    const job = await f.collector.start(accountId, crypto.randomUUID(), "catalogue");
    await env.DB.prepare(
      "UPDATE collection_jobs SET pages=210,collected=210,media_processed=210,cursor='saved-position' WHERE id=?",
    )
      .bind(job.id)
      .run();
    vi.mocked(f.transport.mediaPage).mockRejectedValueOnce(
      new ApplicationError("INSTAGRAM_SOURCE_ERROR", "Legacy source failure"),
    );
    await f.collector.advance(job.id);
    const failed = await env.DB.prepare("SELECT id FROM sync_runs WHERE status='failed'").first<{
      id: string;
    }>();
    if (!failed) throw new Error("Missing saved failed page");
    const calls = vi.mocked(f.transport.mediaPage).mock.calls.length;
    await f.request(`/api/accounts/${accountId}/sync`, "POST", {
      operationId: failed.id,
      cursor: "saved-position",
      pageSize: 1,
    });
    expect(f.transport.mediaPage).toHaveBeenCalledTimes(calls);
    await env.DB.prepare("UPDATE collection_jobs SET status='failed',failures=5 WHERE id=?")
      .bind(job.id)
      .run();
    expect(await f.collector.control(job.id, "resume")).toMatchObject({
      pages: 210,
      cursor: "saved-position",
    });
    expect(await f.collector.advance(job.id)).toMatchObject({
      status: "completed",
      pages: 211,
      collected: 211,
      mediaProcessed: 211,
    });
    expect(
      await env.DB.prepare("SELECT status FROM sync_runs WHERE id=?")
        .bind(failed.id)
        .first("status"),
    ).toBe("completed");
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM media_snapshots").first("n")).toBe(2);
  });

  it("stops both new and legacy cached cursor loops immediately and allows the next scheduled Stories pass", async () => {
    const f = await ready();
    const story = { ...sampleMedia, productType: "STORY", timestamp: f.now() - 3600_000 };
    vi.mocked(f.transport.stories).mockResolvedValue({ media: [story], nextCursor: "loop" });
    const job = await f.collector.start(accountId, crypto.randomUUID(), "stories", true);
    await f.collector.advance(job.id);
    expect(await f.collector.advance(job.id)).toMatchObject({
      status: "failed",
      pages: 1,
      cursor: "loop",
      errorCode: "INSTAGRAM_PAGINATION_STALLED",
      effectiveState: "incomplete",
      waitingReason: "pagination_stalled",
    });
    const calls = vi.mocked(f.transport.stories).mock.calls.length;
    await env.DB.prepare(
      "UPDATE collection_jobs SET status='running',failures=4,error_code='INSTAGRAM_UNAVAILABLE',next_attempt_at=? WHERE id=?",
    )
      .bind(f.now(), job.id)
      .run();
    expect(await f.collector.advance(job.id)).toMatchObject({
      status: "failed",
      errorCode: "INSTAGRAM_PAGINATION_STALLED",
      effectiveState: "incomplete",
    });
    expect(f.transport.stories).toHaveBeenCalledTimes(calls);
    await onlyRefresh(f);
    await env.DB.prepare("UPDATE collection_schedules SET next_stories_at=? WHERE account_id=?")
      .bind(f.now(), accountId)
      .run();
    vi.mocked(f.transport.stories).mockResolvedValue({ media: [], nextCursor: null });
    await f.collector.tick();
    const jobs = (await f.collector.status(accountId)).jobs.filter((j) => j.origin === "stories");
    expect(jobs).toHaveLength(2);
    expect(jobs.find((j) => j.id !== job.id)).toMatchObject({ status: "completed" });
    expect(jobs.find((j) => j.id === job.id)).toMatchObject({
      pages: 1,
      cursor: "loop",
      effectiveState: "incomplete",
    });
  });
});
