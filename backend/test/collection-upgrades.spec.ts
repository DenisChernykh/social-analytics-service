import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCollectionExecutor } from "../src/app/create-features";
import { activityPeriodPlan } from "../src/modules/account-insights/domain/periods";
import { D1Collection } from "../src/modules/collection/infrastructure/d1-collection";
import { quotaObservation } from "../src/modules/instagram/domain/request-policy";
import { D1RequestPolicy } from "../src/modules/instagram/infrastructure/d1-request-policy";
import { MetaClient } from "../src/modules/instagram/infrastructure/meta-client";
import type { InsightBatchQuery } from "../src/modules/instagram/public-contracts";
import { ApplicationError } from "../src/shared/application/application-error";
import { accountId, connect, fixture, sampleMedia } from "./helpers";

const day = 86_400_000;
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected test fixture value");
  return value;
}
const config = {
  clientId: "test-client",
  clientSecret: "test-secret",
  redirectUri: "https://example.test/callback",
  apiVersion: "v26.0",
};
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM accounts").run();
  await env.DB.prepare("DELETE FROM oauth_attempts").run();
});
async function ready() {
  const f = fixture();
  vi.mocked(f.transport.exchangeCode).mockResolvedValue({
    accessToken: "fake-token",
    scopes: [
      "instagram_business_basic",
      "instagram_business_manage_insights",
      "instagram_business_manage_comments",
    ],
  });
  await connect(f);
  await f.request(`/api/accounts/${accountId}/sync`, "POST", { operationId: crypto.randomUUID() });
  return {
    ...f,
    collector: createCollectionExecutor(env, { transport: () => f.transport }, f.now),
    store: new D1Collection(env.DB),
  };
}

describe("calendar period history", () => {
  it("adds a new completed day to a running backfill without replacing its current operation", async () => {
    const f = await ready();
    await f.collector.configure(accountId, {
      enabled: true,
      discoveryMinutes: 60,
      timeZone: "Asia/Yekaterinburg",
    });
    await env.DB.prepare(
      "UPDATE collection_schedules SET next_stories_at=?,next_discovery_at=?,next_catalogue_at=? WHERE account_id=?",
    )
      .bind(f.now() + 30 * day, f.now() + 30 * day, f.now() + 30 * day, accountId)
      .run();
    await f.collector.tick();
    const job = required(
      (await f.collector.status(accountId)).jobs.find((item) => item.origin === "activity"),
    );
    const pending = JSON.parse(required(job.cursor));
    expect(pending.length).toBeGreaterThan(10);
    await f.collector.advance(job.id); // save the current period, then lose only the job checkpoint
    await env.DB.prepare("UPDATE collection_jobs SET pages=?,collected=?,cursor=? WHERE id=?")
      .bind(job.pages, job.collected, job.cursor, job.id)
      .run();
    f.advance(day);
    const plan = activityPeriodPlan(f.now(), "Asia/Yekaterinburg", []);
    const newDay = required(
      plan.periods.filter((p) => p.kind === "day").sort((a, b) => b.to - a.to)[0],
    );
    await env.DB.prepare("UPDATE collection_jobs SET next_attempt_at=?")
      .bind(f.now() + 3600_000)
      .run();
    const before = vi.mocked(f.transport.structuredInsights).mock.calls.length;
    await f.collector.tick();
    expect(f.transport.structuredInsights).toHaveBeenCalledTimes(before);
    const replanned = await f.collector.job(job.id);
    expect(replanned.pages).toBe(job.pages);
    const periods = JSON.parse(required(replanned.cursor));
    expect(periods[0]).toEqual(pending[0]);
    expect(periods).toContainEqual(newDay);
    expect(
      new Set(periods.map((p: { from: number; to: number }) => `${p.from}:${p.to}`)).size,
    ).toBe(periods.length);
    await env.DB.prepare("UPDATE collection_jobs SET next_attempt_at=? WHERE id=?")
      .bind(f.now(), job.id)
      .run();
    await f.collector.advance(job.id);
    expect(f.transport.structuredInsights).toHaveBeenCalledTimes(before);
    await f.collector.advance(job.id);
    expect(
      vi
        .mocked(f.transport.structuredInsights)
        .mock.calls.slice(-12)
        .every(
          (call) => call[2].since === periods[1].from && call[2].until === periods[1].to - 1000,
        ),
    ).toBe(true);
    expect((await f.store.jobs(accountId)).filter((j) => j.origin === "activity")).toHaveLength(1);
  });
  it("does not rewrite a leased activity operation or overwrite a newer job page", async () => {
    const f = await ready();
    await f.collector.configure(accountId, { enabled: true, discoveryMinutes: 60 });
    await env.DB.prepare(
      "UPDATE collection_schedules SET next_stories_at=?,next_discovery_at=?,next_catalogue_at=? WHERE account_id=?",
    )
      .bind(f.now() + day, f.now() + day, f.now() + day, accountId)
      .run();
    await f.collector.tick();
    const job = required(
      (await f.collector.status(accountId)).jobs.find((item) => item.origin === "activity"),
    );
    const periods = JSON.parse(required(job.cursor));
    expect(await f.store.claim(job.id, "activity-test-lease", f.now())).not.toBeNull();
    expect(await f.store.replanActivity(job, periods.slice(1), f.now())).toBe(false);
    expect((await f.collector.job(job.id)).cursor).toBe(job.cursor);
    await env.DB.prepare("UPDATE collection_jobs SET lease_expires_at=? WHERE id=?")
      .bind(f.now(), job.id)
      .run();
    await f.collector.advance(job.id);
    const progressed = await f.collector.job(job.id);
    expect(progressed.pages).toBe(job.pages + 1);
    expect(await f.store.replanActivity(job, periods, f.now())).toBe(false);
    expect((await f.collector.job(job.id)).cursor).toBe(progressed.cursor);
  });
  it("brings discovery forward when enabled or made more frequent without postponing an existing deadline", async () => {
    const f = await ready();
    await f.collector.configure(accountId, { enabled: true, discoveryMinutes: 360 });
    const later = f.now() + 6 * 3600_000;
    await env.DB.prepare("UPDATE collection_schedules SET next_discovery_at=? WHERE account_id=?")
      .bind(later, accountId)
      .run();
    expect(
      await f.collector.configure(accountId, { enabled: true, discoveryMinutes: 60 }),
    ).toMatchObject({ nextDiscoveryAt: f.now() });
    await env.DB.prepare("UPDATE collection_schedules SET next_discovery_at=? WHERE account_id=?")
      .bind(later, accountId)
      .run();
    expect(
      await f.collector.configure(accountId, { enabled: true, discoveryMinutes: 60 }),
    ).toMatchObject({ nextDiscoveryAt: later });
    expect(
      await f.collector.configure(accountId, { enabled: true, discoveryMinutes: 360 }),
    ).toMatchObject({ nextDiscoveryAt: later });
    await f.collector.configure(accountId, { enabled: false, discoveryMinutes: 360 });
    expect(
      await f.collector.configure(accountId, { enabled: true, discoveryMinutes: 360 }),
    ).toMatchObject({ nextDiscoveryAt: f.now() });
  });
  it("plans completed local days, ISO weeks and calendar months and rereads delayed data", () => {
    const now = Date.parse("2026-10-08T04:00:00Z");
    const plan = activityPeriodPlan(now, "Asia/Yekaterinburg", []);
    const yesterday = required(
      plan.periods.find((p) => p.kind === "day" && p.to === Date.parse("2026-10-07T19:00:00Z")),
    );
    expect(yesterday).toEqual({
      kind: "day",
      timeZone: "Asia/Yekaterinburg",
      from: Date.parse("2026-10-06T19:00:00Z"),
      to: Date.parse("2026-10-07T19:00:00Z"),
    });
    expect(
      plan.periods.find(
        (period) => period.kind === "week" && period.to === Date.parse("2026-10-04T19:00:00Z"),
      )?.from,
    ).toBe(Date.parse("2026-09-27T19:00:00Z"));
    expect(
      plan.periods.find(
        (period) => period.kind === "month" && period.to === Date.parse("2026-09-30T19:00:00Z"),
      )?.from,
    ).toBe(Date.parse("2026-08-31T19:00:00Z"));
    expect(plan.periods.every((period) => period.from >= now - 90 * day && period.to <= now)).toBe(
      true,
    );
    const old = required(
      plan.periods.find((period) => period.kind === "day" && period.to < now - 3 * day),
    );
    const observed = [
      { ...yesterday, observedAt: now - 3600_000 },
      { ...old, observedAt: old.to + 48 * 3600_000 },
    ];
    const next = activityPeriodPlan(now, "Asia/Yekaterinburg", observed);
    expect(next.periods).toContainEqual(yesterday);
    expect(next.periods).not.toContainEqual(old);
    expect(next.coverage).toMatchObject({ observedIntervals: 2, recheckIntervals: 1 });
  });
  it("uses actual instants for DST days and leap-year months", () => {
    const spring = required(
      activityPeriodPlan(Date.parse("2026-03-09T16:00:00Z"), "America/New_York", []).periods.find(
        (p) => p.kind === "day" && p.from === Date.parse("2026-03-08T05:00:00Z"),
      ),
    );
    const autumn = required(
      activityPeriodPlan(Date.parse("2026-11-02T16:00:00Z"), "America/New_York", []).periods.find(
        (p) => p.kind === "day" && p.from === Date.parse("2026-11-01T04:00:00Z"),
      ),
    );
    expect(spring.to - spring.from).toBe(23 * 3600_000);
    expect(autumn.to - autumn.from).toBe(25 * 3600_000);
    const february = required(
      activityPeriodPlan(Date.parse("2024-03-05T12:00:00Z"), "UTC", []).periods.find(
        (period) => period.kind === "month" && period.from === Date.parse("2024-02-01T00:00:00Z"),
      ),
    );
    expect(february.to - february.from).toBe(29 * day);
  });
  it("saves exact periods as bounded jobs, replays a completed operation and skips an expired provider window", async () => {
    const f = await ready();
    await f.collector.configure(accountId, {
      enabled: true,
      discoveryMinutes: 60,
      timeZone: "Asia/Yekaterinburg",
    });
    await env.DB.prepare(
      "UPDATE collection_schedules SET next_stories_at=?,next_discovery_at=? WHERE account_id=?",
    )
      .bind(f.now() + day, f.now() + day, accountId)
      .run();
    await f.collector.tick();
    const job = required(
      (await f.collector.status(accountId)).jobs.find((job) => job.origin === "activity"),
    );
    expect(job).toMatchObject({ status: "running", pages: 1, collected: 1, errorCode: null });
    const initial = required(activityPeriodPlan(f.now(), "Asia/Yekaterinburg", []).periods[0]);
    const calls = vi.mocked(f.transport.structuredInsights).mock.calls;
    expect(calls).toHaveLength(12);
    expect(
      calls.every((call) => call[2].since === initial.from && call[2].until === initial.to - 1000),
    ).toBe(true);
    await env.DB.prepare("UPDATE collection_jobs SET pages=0,collected=0,cursor=? WHERE id=?")
      .bind(JSON.stringify([initial]), job.id)
      .run();
    expect(await f.collector.advance(job.id)).toMatchObject({ pages: 1, collected: 1 });
    expect(f.transport.structuredInsights).toHaveBeenCalledTimes(12);
    const expired = {
      kind: "day",
      from: f.now() - 92 * day,
      to: f.now() - 91 * day,
      timeZone: "UTC",
    };
    await env.DB.prepare(
      "UPDATE collection_jobs SET status='running',completed_at=NULL,cursor=? WHERE id=?",
    )
      .bind(JSON.stringify([expired]), job.id)
      .run();
    expect(await f.collector.advance(job.id)).toMatchObject({
      status: "completed",
      skippedPeriods: 1,
      collected: 1,
    });
    expect((await f.collector.status(accountId)).coverage.activity.observedIntervals).toBe(1);
  });
  it("reconciles the entire catalogue beyond a known first page", async () => {
    const f = await ready();
    vi.mocked(f.transport.mediaPage).mockImplementation(async (_token, _id, cursor) => ({
      media: [{ ...sampleMedia, id: cursor ? "17900000000000002" : sampleMedia.id }],
      nextCursor: cursor ? null : "older",
    }));
    await f.collector.configure(accountId, { enabled: true, discoveryMinutes: 60 });
    await env.DB.prepare(
      "UPDATE collection_schedules SET next_stories_at=?,next_discovery_at=?,next_insights_at=?,next_catalogue_at=? WHERE account_id=?",
    )
      .bind(f.now() + day, f.now() + day, f.now() + day, f.now(), accountId)
      .run();
    await f.collector.tick();
    const job = required(
      (await f.collector.status(accountId)).jobs.find((job) => job.origin === "catalogue"),
    );
    expect(job).toMatchObject({ status: "running", cursor: "older", pages: 1 });
    expect(await f.collector.advance(job.id)).toMatchObject({
      status: "completed",
      mediaProcessed: 2,
    });
    expect((await f.collector.status(accountId)).coverage.catalogue.lastFullPassAt).toBe(f.now());
  });
});

describe("bounded comment fallback and object availability", () => {
  it("probes at most two omitted branches, preserves authors and reports the remaining unknown branches", async () => {
    const f = await ready();
    vi.mocked(f.transport.comments).mockImplementation(async (_token, object, replies) => ({
      items: replies
        ? [
            {
              id: `${object}1`,
              text: "Reply",
              publishedAt: f.now(),
              parentId: object,
              authorId: "200",
              authorUsername: "author",
              likeCount: 2,
              hidden: false,
            },
          ]
        : Array.from({ length: 5 }, (_, i) => ({
            id: String(100 + i),
            text: "Root",
            publishedAt: f.now(),
            parentId: null,
          })),
      nextCursor: null,
      ...(!replies
        ? {
            replyBranches: Array.from({ length: 5 }, (_, i) => ({
              parentId: String(100 + i),
              status: "omitted" as const,
              nextCursor: null,
            })),
          }
        : {}),
    }));
    const job = await f.collector.start(accountId, crypto.randomUUID(), "comments");
    await f.collector.advance(job.id);
    await f.collector.advance(job.id);
    expect(await f.collector.advance(job.id)).toMatchObject({
      status: "completed",
      pages: 3,
      collected: 7,
    });
    expect(f.transport.comments).toHaveBeenCalledTimes(3);
    expect((await f.collector.status(accountId)).comments).toMatchObject({
      unverifiedReplyBranches: 3,
      partialPublications: 1,
    });
    const response = await f.request(`/api/media/${accountId}_${sampleMedia.id}/comments`);
    expect(await response.json()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          authorId: "200",
          authorUsername: "author",
          likeCount: 2,
          hidden: false,
        }),
      ]),
    });
  });
  it("continues past an unavailable publication but retains auth and quota failures as retryable work", async () => {
    const f = await ready();
    const older = { ...sampleMedia, id: "17900000000000002", timestamp: sampleMedia.timestamp - 1 };
    vi.mocked(f.transport.mediaPage).mockResolvedValue({ media: [older], nextCursor: null });
    await f.request(`/api/accounts/${accountId}/sync`, "POST", {
      operationId: crypto.randomUUID(),
    });
    vi.mocked(f.transport.comments).mockRejectedValueOnce(
      new ApplicationError("INSTAGRAM_OBJECT_UNAVAILABLE", "Object is unavailable"),
    );
    const job = await f.collector.start(accountId, crypto.randomUUID(), "comments");
    expect(await f.collector.advance(job.id)).toMatchObject({
      status: "running",
      skippedMedia: 1,
      mediaProcessed: 1,
      failures: 0,
    });
    expect(await f.collector.advance(job.id)).toMatchObject({
      status: "completed",
      skippedMedia: 1,
      mediaProcessed: 2,
    });
    expect((await f.collector.status(accountId)).comments.unavailablePublications).toBe(1);
    vi.mocked(f.transport.comments).mockRejectedValueOnce(
      new ApplicationError("INSTAGRAM_RATE_LIMITED", "Wait", 2 * day),
    );
    const retry = await f.collector.start(accountId, crypto.randomUUID(), "comments");
    expect(await f.collector.advance(retry.id)).toMatchObject({
      status: "running",
      skippedMedia: 0,
      pages: 0,
      nextAttemptAt: f.now() + 2 * day,
    });
  });
  it("counts discovery lag and missed age windows without inventing observations", async () => {
    const f = await ready();
    await env.DB.prepare(
      "UPDATE media SET published_at=?,first_discovered_at=?,discovery_source='collection' WHERE account_id=?",
    )
      .bind(f.now() - 2 * 3600_000, f.now(), accountId)
      .run();
    await env.DB.prepare("UPDATE accounts SET connected_at=? WHERE id=?")
      .bind(f.now() - day, accountId)
      .run();
    const status = await f.collector.status(accountId);
    expect(status.coverage.discovery).toMatchObject({
      measuredPublications: 1,
      averageLagMinutes: 120,
      overOneHour: 1,
    });
    expect(status.coverage.ageSnapshots[0]).toMatchObject({
      targetHours: 1,
      expected: 0,
      captured: 0,
      missed: 0,
      open: 0,
    });
  });
});

describe("structured batching and persisted request policy", () => {
  it("batches compatible metrics and isolates an unsupported field without losing values", async () => {
    const request = vi.fn<typeof fetch>(async (input) => {
      const metrics = (new URL(String(input)).searchParams.get("metric") ?? "").split(",");
      if (metrics.includes("reposts"))
        return Response.json(
          { error: { code: 100, message: "This media does not support the metrics: reposts." } },
          { status: 400 },
        );
      return Response.json({ data: metrics.map((name) => ({ name, total_value: { value: 7 } })) });
    });
    const client = new MetaClient(config, request);
    const values = await client.structuredInsightsBatch("fake-token", "123", {
      metrics: ["reach", "views", "reposts"],
      period: "day",
      metricType: "total_value",
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(values.map((value) => [value.metric, value.value, value.reason])).toEqual([
      ["reach", 7, null],
      ["views", 7, null],
      ["reposts", null, "not_supported"],
    ]);
  });
  it("uses three external requests for twelve account metrics and preserves missing batch entries", async () => {
    const f = await ready();
    f.transport.structuredInsightsBatch = vi.fn(
      async (_token: string, _id: string, query: InsightBatchQuery) =>
        query.metrics
          .filter((metric) => metric !== "comments")
          .map((metric) => ({
            metric,
            metricType: query.metricType,
            period: query.period,
            value: 5,
            reason: null,
            description: null,
            points: [],
            breakdowns: [],
          })),
    );
    vi.mocked(f.transport.profile).mockClear();
    const input = {
      operationId: crypto.randomUUID(),
      from: new Date(f.now() - 4 * day).toISOString(),
      to: new Date(f.now() - 3 * day).toISOString(),
      timeZone: "UTC",
      metricType: "total_value",
    };
    const response = await f.request(`/api/accounts/${accountId}/insights/collect`, "POST", input);
    expect(response.status).toBe(200);
    expect(f.transport.structuredInsightsBatch).toHaveBeenCalledTimes(2);
    expect(f.transport.profile).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({
      values: expect.arrayContaining([
        expect.objectContaining({ metric: "comments", value: null, reason: "not_returned" }),
      ]),
    });
  });
  it("caches explicit unsupported metrics only for the object and version, then expires them", async () => {
    const f = await ready();
    const policy = new D1RequestPolicy(env.DB);
    const request = vi.fn<typeof fetch>(async (input) => {
      const metrics = (new URL(String(input)).searchParams.get("metric") ?? "").split(",");
      return metrics.includes("reposts")
        ? Response.json(
            { error: { code: 100, message: "This media does not support the metrics: reposts." } },
            { status: 400 },
          )
        : Response.json({ data: [{ name: "reach", values: [{ value: 3 }] }] });
    });
    const client = new MetaClient(config, request, { policy, clock: f.now }).forAccount(accountId);
    await client.insights("fake-token", "123", ["reach", "reposts"]);
    expect(request).toHaveBeenCalledTimes(2);
    await client.insights("fake-token", "123", ["reach", "reposts"]);
    expect(request).toHaveBeenCalledTimes(3);
    await client.insights("fake-token", "456", ["reach", "reposts"]);
    expect(request).toHaveBeenCalledTimes(5);
    expect(
      await policy.unsupported(accountId, "v27.0", "123", "media:lifetime:scalar", f.now()),
    ).toEqual([]);
    f.advance(24 * 3600_000 + 1);
    await client.insights("fake-token", "123", ["reach", "reposts"]);
    expect(request).toHaveBeenCalledTimes(7);
  });
  it("does not persist generic metric errors or authorization failures as capability evidence", async () => {
    const f = await ready();
    const policy = new D1RequestPolicy(env.DB);
    const request = vi.fn<typeof fetch>(async () =>
      Response.json({ error: { code: 100, message: "Invalid range" } }, { status: 400 }),
    );
    const client = new MetaClient(config, request, { policy, clock: f.now }).forAccount(accountId);
    await expect(client.insights("fake-token", "123", ["reach"])).rejects.toMatchObject({
      code: "INSTAGRAM_INVALID_REQUEST",
    });
    expect(
      await policy.unsupported(accountId, "v26.0", "123", "media:lifetime:scalar", f.now()),
    ).toEqual([]);
    request.mockResolvedValueOnce(Response.json({ error: { code: 190 } }, { status: 401 }));
    await expect(client.insights("fake-token", "123", ["reach"])).rejects.toMatchObject({
      code: "INSTAGRAM_AUTH_EXPIRED",
    });
    expect(
      await policy.unsupported(accountId, "v26.0", "123", "media:lifetime:scalar", f.now()),
    ).toEqual([]);
  });
  it("honors Retry-After across client instances and exposes actual usage headers", async () => {
    const f = await ready();
    const request = vi.fn<typeof fetch>(async () =>
      Response.json(
        { error: { code: 4 } },
        {
          status: 429,
          headers: {
            "Retry-After": "3600",
            "x-app-usage": JSON.stringify({ call_count: 92, total_time: 40 }),
          },
        },
      ),
    );
    const client = new MetaClient(config, request, {
      policy: new D1RequestPolicy(env.DB),
      clock: f.now,
    }).forAccount(accountId);
    await expect(client.insights("fake-token", "123", ["reach"])).rejects.toMatchObject({
      code: "INSTAGRAM_RATE_LIMITED",
      retryAfterMs: 3600_000,
    });
    const next = new MetaClient(config, request, {
      policy: new D1RequestPolicy(env.DB),
      clock: f.now,
    }).forAccount(accountId);
    await expect(next.insights("fake-token", "456", ["reach"])).rejects.toMatchObject({
      code: "INSTAGRAM_RATE_LIMITED",
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(await new D1RequestPolicy(env.DB).status(accountId, "v26.0", f.now())).toMatchObject({
      recordedRequests: 1,
      usagePercent: 92,
      blockedUntil: f.now() + 3600_000,
    });
    const invalid = quotaObservation(
      { retryAfter: "garbage", appUsage: "bad json", businessUsage: null },
      f.now(),
    );
    expect(invalid).toMatchObject({
      usagePercent: null,
      retryAfterMs: 0,
      blockedUntil: 0,
      usageHeaders: { app: { state: "malformed" } },
    });
    expect(
      quotaObservation(
        {
          retryAfter: new Date(f.now() + 60_000).toUTCString(),
          appUsage: null,
          businessUsage: JSON.stringify({ account: [{ total_cputime: 100 }] }),
        },
        f.now(),
      ).blockedUntil,
    ).toBe(f.now() + 30 * 60_000);
  });
});

describe("rich publication metadata", () => {
  it("retains carousel children, optional-field availability and profile actions with provenance", async () => {
    const f = await ready();
    const request = vi.fn<typeof fetch>(async (input) => {
      const fields = new URL(String(input)).searchParams.get("fields") ?? "";
      if (fields.includes("is_ai_generated"))
        return Response.json(
          {
            error: {
              code: 100,
              message: "Tried accessing nonexisting field (is_ai_generated) on node type (IGMedia)",
            },
          },
          { status: 400 },
        );
      return Response.json({
        id: sampleMedia.id,
        caption: "Carousel",
        media_type: "CAROUSEL_ALBUM",
        media_product_type: "FEED",
        permalink: "https://www.instagram.com/p/test-carousel/",
        timestamp: new Date(f.now() - day).toISOString(),
        media_url: "https://example.test/photo.jpg",
        alt_text: "Photo description",
        is_comment_enabled: true,
        children: {
          data: [
            {
              id: "123",
              media_type: "IMAGE",
              media_url: "https://example.test/child.jpg",
              alt_text: "First photo",
            },
          ],
        },
      });
    });
    const client = new MetaClient(config, request);
    const media = await client.media("fake-token", sampleMedia.id);
    vi.mocked(f.transport.mediaPage).mockResolvedValue({ media: [media], nextCursor: null });
    vi.mocked(f.transport.structuredInsights).mockImplementation(async (_token, _id, query) => ({
      metric: query.metric,
      metricType: query.metricType,
      period: query.period,
      value: 9,
      reason: null,
      description: null,
      points: [],
      breakdowns: [
        {
          dimensions: ["action_type"],
          results: [{ categories: ["PROFILE_VISIT"], value: 5, reason: null }],
        },
      ],
    }));
    f.advance(1000);
    expect(
      (
        await f.request(`/api/accounts/${accountId}/sync`, "POST", {
          operationId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(200);
    expect(request).toHaveBeenCalledTimes(2);
    const report = await f.request(`/api/media/${accountId}_${sampleMedia.id}/statistics`);
    expect(await report.json()).toMatchObject({
      media: {
        metadata: {
          provider: "instagram_api",
          apiVersion: "v26.0",
          observedAt: f.now(),
          childrenComplete: true,
          unsupportedFields: ["is_ai_generated"],
          children: [{ id: "123", mediaType: "IMAGE", altText: "First photo" }],
        },
      },
      profileActivity: {
        total: { value: 9, sourceField: "profile_activity" },
        actions: { PROFILE_VISIT: { value: 5 } },
      },
    });
  });
});

describe("Story expiry scheduling", () => {
  it("prioritizes expiring Stories over an aged comment job and stops urgent rereads after a fresh snapshot", async () => {
    const f = await ready();
    const mediaId = `${accountId}_${sampleMedia.id}`;
    await env.DB.prepare("UPDATE media SET product_type='STORY',published_at=? WHERE id=?")
      .bind(f.now() - 24 * 3600_000 + 10 * 60_000, mediaId)
      .run();
    await env.DB.prepare("UPDATE media_snapshots SET observed_at=? WHERE media_id=?")
      .bind(f.now() - 3600_000, mediaId)
      .run();
    const comments = await f.collector.start(accountId, crypto.randomUUID(), "comments", true);
    const story = await f.collector.start(accountId, crypto.randomUUID(), "stories", true);
    await env.DB.prepare("UPDATE collection_jobs SET next_attempt_at=? WHERE id=?")
      .bind(f.now() - 24 * 3600_000, comments.id)
      .run();
    expect((await f.collector.tick())?.decision.selected?.id).toBe(story.id);
    expect(await f.store.nextStoryExpiry(accountId, f.now())).toBeNull();
    f.advance(5 * 60_000);
    expect(await f.store.nextStoryExpiry(accountId, f.now())).toBe(f.now() + 5 * 60_000);
    await env.DB.prepare("UPDATE media_snapshots SET observed_at=? WHERE media_id=?")
      .bind(f.now(), mediaId)
      .run();
    expect(await f.store.nextStoryExpiry(accountId, f.now())).toBeNull();
  });
});
