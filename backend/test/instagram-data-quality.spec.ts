import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app/create-app";
import { createScheduledOperations } from "../src/app/create-features";
import { periodMaturity } from "../src/modules/account-insights/domain/maturity";
import { calculateGrowth } from "../src/modules/analytics/domain/calculations";
import type { Metrics, Snapshot } from "../src/modules/analytics/domain/model";
import { D1Analytics } from "../src/modules/analytics/infrastructure/d1-analytics";
import { ageCoverage } from "../src/modules/collection/domain/coverage";
import { selectWork } from "../src/modules/collection/domain/selection";
import { D1Collection } from "../src/modules/collection/infrastructure/d1-collection";
import { Comments } from "../src/modules/community/application/comments";
import { D1Comments } from "../src/modules/community/infrastructure/d1-comments";
import { pairedAggregate } from "../src/modules/content/domain/analysis";
import { quotaObservation } from "../src/modules/instagram/domain/request-policy";
import { D1RequestPolicy } from "../src/modules/instagram/infrastructure/d1-request-policy";
import { MetaClient } from "../src/modules/instagram/infrastructure/meta-client";
import type { RequestBudget } from "../src/modules/instagram/public-contracts";
import { compatibleMeasurements } from "../src/shared/domain/measurement";
import { accountId, connect, fixture, sampleMedia, testKey } from "./helpers";

const day = 86_400_000,
  hour = 3_600_000,
  cron = 300_000;
const mediaId = `${accountId}_${sampleMedia.id}`;
const config = {
  clientId: "test",
  clientSecret: "fixture-secret",
  redirectUri: "https://example.test/callback",
  apiVersion: "v26.0",
};
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM accounts").run();
  await env.DB.prepare("DELETE FROM oauth_attempts").run();
});
async function ready() {
  const f = fixture();
  await connect(f);
  await f.request(`/api/accounts/${accountId}/sync`, "POST", { operationId: crypto.randomUUID() });
  return { ...f, store: new D1Collection(env.DB) };
}
function bound(f: ReturnType<typeof fixture>, http: typeof fetch, budget?: RequestBudget) {
  return new MetaClient(config, http, {
    accountId,
    policy: new D1RequestPolicy(env.DB),
    clock: f.now,
    budget,
  });
}
async function savedMetrics() {
  const row = await env.DB.prepare(
    "SELECT metrics_json FROM media_snapshots WHERE media_id=? LIMIT 1",
  )
    .bind(mediaId)
    .first<{ metrics_json: string }>();
  if (!row) throw new Error("fixture");
  return JSON.parse(row.metrics_json) as Metrics;
}
async function snapshot(id: string, object: string, at: number, metrics: Metrics) {
  await env.DB.prepare(
    "INSERT INTO media_snapshots(id,media_id,observed_at,api_version,metrics_json) VALUES(?,?,?,'v26.0',?)",
  )
    .bind(id, object, at, JSON.stringify(metrics))
    .run();
}

describe("P0/P1 request evidence and capability", () => {
  it("distinguishes header states and never aliases unknown units or refreshes an old quota", async () => {
    const f = fixture();
    await connect(f);
    expect(
      quotaObservation({ appUsage: null, businessUsage: null, retryAfter: null }, f.now())
        .usageHeaders.app.state,
    ).toBe("absent");
    expect(
      quotaObservation({ appUsage: "{invalid", businessUsage: null, retryAfter: null }, f.now())
        .usageHeaders.app,
    ).toEqual({ state: "malformed", sample: null });
    const started = f.now();
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json(
          {
            user_id: f.profile.userId,
            account_type: f.profile.accountType,
            username: f.profile.username,
            followers_count: f.profile.followersCount,
            media_count: f.profile.mediaCount,
          },
          200,
          { "x-app-usage": '{"call_count":37,"total_cputime":12}' },
        ),
      )
      .mockResolvedValueOnce(
        json(
          {
            user_id: f.profile.userId,
            account_type: f.profile.accountType,
            username: f.profile.username,
            followers_count: f.profile.followersCount,
            media_count: f.profile.mediaCount,
          },
          200,
          { "x-app-usage": '{"call_volume":42,"cpu_time":3,"Authorization":"secret"}' },
        ),
      );
    const client = bound(f, http);
    await client.profile("private-fixture-token");
    f.advance(2 * hour);
    await client.profile("private-fixture-token");
    const state = await new D1RequestPolicy(env.DB).status(accountId, "v26.0", f.now());
    expect(state).toMatchObject({
      usagePercent: 37,
      usageObservedAt: started,
      quotaFreshness: "stale",
      http: { attempts: 2, responses: 2, failuresBeforeResponse: 0 },
      usageHeaders: { app: { state: "unknown_schema" }, receivedAt: f.now() },
    });
    expect(state.usageHeaders?.app.sample).toBe('{"call_volume":42,"cpu_time":3}');
  });
  it("records pre-response/body timeouts independently from rate-limited responses and honors Retry-After even with unreadable bodies", async () => {
    const f = fixture();
    await connect(f);
    const bodyTimeout = json({});
    vi.spyOn(bodyTimeout, "json").mockImplementationOnce(async () => {
      f.advance(15_000);
      throw new DOMException("private response detail", "AbortError");
    });
    const http = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("private network detail"))
      .mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"))
      .mockResolvedValueOnce(bodyTimeout)
      .mockResolvedValueOnce(
        json({ error: { code: 4, message: "private error" } }, 429, { "Retry-After": "1200" }),
      )
      .mockResolvedValueOnce(
        new Response("{invalid", { status: 429, headers: { "Retry-After": "1200" } }),
      );
    const client = bound(f, http).forOperation("logical-retry");
    await expect(client.profile("private-token")).rejects.toMatchObject({
      code: "INSTAGRAM_UNAVAILABLE",
    });
    await expect(client.profile("private-token")).rejects.toMatchObject({
      code: "INSTAGRAM_UNAVAILABLE",
    });
    await expect(client.profile("private-token")).rejects.toMatchObject({
      code: "INSTAGRAM_UNAVAILABLE",
      receipt: { responseReceivedAt: f.now() + 15_000 },
    });
    await expect(client.profile("private-token")).rejects.toMatchObject({
      code: "INSTAGRAM_RATE_LIMITED",
      retryAfterMs: 1200_000,
    });
    await expect(bound(f, http).profile("private-token")).rejects.toMatchObject({
      code: "INSTAGRAM_RATE_LIMITED",
    });
    expect(http).toHaveBeenCalledTimes(4);
    f.advance(1_200_001);
    await expect(bound(f, http).profile("private-token")).rejects.toMatchObject({
      code: "INSTAGRAM_RATE_LIMITED",
      retryAfterMs: 1200_000,
    });
    const state = await new D1RequestPolicy(env.DB).status(accountId, "v26.0", f.now());
    expect(state.http).toMatchObject({
      attempts: 5,
      responses: 3,
      failuresBeforeResponse: 2,
      timeouts: 2,
      rateLimitedResponses: 2,
    });
    const attempts = await env.DB.prepare(
      "SELECT id,payload_json FROM instagram_http_attempts",
    ).all<{ id: string; payload_json: string }>();
    expect(new Set(attempts.results.map((a) => a.id)).size).toBe(5);
    const encoded = JSON.stringify(attempts.results);
    expect(encoded).not.toContain("private-token");
    expect(encoded).not.toContain("private error");
    expect(encoded).not.toContain("private network detail");
    expect(encoded).not.toContain("private response detail");
  });
  it("caches only explicit product rejection, distinguishes invalid breakdown, generic 100 and unavailable object", async () => {
    const f = fixture();
    await connect(f);
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json(
          {
            error: {
              code: 100,
              message: "This media does not support the follows metric for this media product type",
            },
          },
          400,
        ),
      )
      .mockResolvedValueOnce(
        json({ error: { code: 100, message: "Invalid breakdown for this combination" } }, 400),
      )
      .mockResolvedValueOnce(
        json({ error: { code: 100, message: "Source did not accept this request" } }, 400),
      )
      .mockResolvedValueOnce(
        json({ error: { code: 100, error_subcode: 33, message: "Unsupported get request" } }, 400),
      );
    const client = bound(f, http);
    expect(await client.insights("token", sampleMedia.id, ["follows"])).toMatchObject({
      follows: { value: null, reason: "not_supported" },
    });
    await expect(
      client.structuredInsights("token", sampleMedia.id, {
        metric: "reach",
        period: "day",
        metricType: "total_value",
        breakdown: "invalid",
      }),
    ).rejects.toMatchObject({ code: "INSTAGRAM_INVALID_BREAKDOWN" });
    await expect(client.insights("token", sampleMedia.id, ["reach"])).rejects.toMatchObject({
      code: "INSTAGRAM_SOURCE_ERROR",
    });
    await expect(client.media("token", sampleMedia.id)).rejects.toMatchObject({
      code: "INSTAGRAM_OBJECT_UNAVAILABLE",
    });
    const rows = await env.DB.prepare("SELECT metric,signature FROM instagram_metric_support").all<{
      metric: string;
      signature: string;
    }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toMatchObject({ metric: "follows" });
    expect(rows.results[0]?.signature).toContain("capability-v2");
  });
  it("ignores old broad cache evidence and preserves useful fields when the real HTTP budget is exhausted", async () => {
    const f = fixture();
    await connect(f);
    await env.DB.prepare(
      "INSERT INTO instagram_metric_support(id,account_id,api_version,object_id,signature,metric,observed_at,expires_at) VALUES('legacy',?,'v26.0',?,'media:lifetime:scalar','views',?,?)",
    )
      .bind(accountId, sampleMedia.id, f.now(), f.now() + day)
      .run();
    const budget = { maxAttempts: 2, attempts: 0, deadlineAt: f.now() + 90_000, reserveMs: 15_000 };
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({ error: { code: 100, message: "does not support the metrics: follows." } }, 400),
      )
      .mockResolvedValueOnce(json({ data: [{ name: "views", values: [{ value: 0 }] }] }));
    const client = bound(f, http, budget);
    expect(await client.insights("token", sampleMedia.id, ["views", "follows"])).toMatchObject({
      views: { value: 0, reason: null },
      follows: { reason: "not_supported" },
    });
    expect(
      await client.structuredInsights("token", sampleMedia.id, {
        metric: "profile_activity",
        period: "lifetime",
        metricType: "total_value",
        breakdown: "action_type",
      }),
    ).toMatchObject({ value: null, reason: "request_deferred", receipt: undefined });
    expect(http).toHaveBeenCalledTimes(2);
    expect(client.requestStats().attempts).toBe(2);
    expect(budget.attempts).toBe(2);
  });
});

describe("P1 genuine observations and obligations", () => {
  it("uses a pre-connection 30d observation, open-window zero, and excludes all-null and too-young data without inventing obligations", () => {
    const now = 200 * day,
      objects = [
        {
          id: "old",
          publishedAt: now - 31 * day,
          connectedAt: now - 2 * day,
          productType: "REELS",
        },
        {
          id: "zero",
          publishedAt: now - 7 * day,
          connectedAt: now - 10 * day,
          productType: "REELS",
        },
        {
          id: "null",
          publishedAt: now - 7 * day,
          connectedAt: now - 10 * day,
          productType: "REELS",
        },
        { id: "young", publishedAt: now - day, connectedAt: now - 10 * day, productType: "REELS" },
      ];
    const old = ageCoverage(
      objects,
      [{ mediaId: "old", observedAt: now - day, usable: true }],
      [],
      now,
      720,
      24,
    );
    expect(old.analysisCoverage.observed).toBe(1);
    expect(old.collectionObligations.expected).toBe(0);
    const seven = ageCoverage(
      objects,
      [
        { mediaId: "zero", observedAt: now, usable: true },
        { mediaId: "null", observedAt: now, usable: false },
      ],
      [],
      now,
      168,
      12,
    );
    expect(seven.analysisCoverage).toMatchObject({
      observed: 1,
      missingEligible: 1,
      open: 2,
      excludedByReason: { too_early: 1, connected_after_window: 1 },
    });
    expect(seven.collectionObligations).toMatchObject({
      expected: 0,
      missed: 0,
      policyHistoryUnknown: 2,
    });
    const seconds = ageCoverage(
      [
        {
          id: "few-seconds",
          publishedAt: now - 7 * day - 12 * hour,
          connectedAt: now - 1000,
          productType: "REELS",
        },
      ],
      [],
      [{ effectiveFrom: now - 1000, effectiveTo: null, enabled: true, version: "v2" }],
      now,
      168,
      12,
    );
    expect(seconds.collectionObligations.expected).toBe(0);
  });
  it("selects nearest usable values and valid pairs, keeping a genuine zero and deterministic equal-distance ties", async () => {
    const f = await ready(),
      metrics = await savedMetrics();
    await env.DB.prepare("DELETE FROM media_snapshots").run();
    await env.DB.prepare("UPDATE media SET published_at=? WHERE id=?")
      .bind(f.now() - 30 * day, mediaId)
      .run();
    const empty = structuredClone(metrics);
    for (const m of Object.values(empty)) {
      m.value = null;
      m.reason = "not_returned";
    }
    await snapshot("a-empty", mediaId, f.now(), empty);
    const zero = structuredClone(metrics);
    zero.saves.value = 0;
    zero.reach.value = 0;
    await snapshot("b-zero", mediaId, f.now() - hour, zero);
    const pair = structuredClone(metrics);
    pair.saves.value = 0;
    pair.reach.value = 100;
    await snapshot("c-pair", mediaId, f.now() + hour, pair);
    const repo = new D1Analytics(env.DB);
    expect((await repo.atAge([mediaId], 30, { metric: "saves" })).get(mediaId)?.id).toBe("b-zero");
    expect(
      (await repo.atAge([mediaId], 30, { metric: "saves", denominator: "reach" })).get(mediaId)?.id,
    ).toBe("c-pair");
  });
  it("walks more than 100 jobs using stable keys while statuses change and aggregates cover the full cutoff", async () => {
    const f = await ready();
    await env.DB.batch(
      Array.from({ length: 137 }, (_, i) =>
        env.DB.prepare(
          "INSERT INTO collection_jobs(id,account_id,origin,status,started_at,next_attempt_at) VALUES(?,?,'scheduled','running',?,?)",
        ).bind(
          `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
          accountId,
          f.now() - i * 1000,
          f.now(),
        ),
      ),
    );
    let cursor: string | undefined,
      all: string[] = [],
      cutoff = 0;
    do {
      const page = await f.store.jobPage(accountId, { limit: 20, cursor }, f.now());
      if (!cursor) {
        cutoff = page.cutoff;
        await env.DB.prepare(
          "UPDATE collection_jobs SET status='completed' WHERE id='00000000-0000-4000-8000-000000000100'",
        ).run();
        f.advance(1000);
        await env.DB.prepare(
          "INSERT INTO collection_jobs(id,account_id,origin,status,started_at,next_attempt_at) VALUES('00000000-0000-4000-8000-000000001000',?,'scheduled','running',?,?)",
        )
          .bind(accountId, f.now(), f.now())
          .run();
      }
      expect(page.cutoff).toBe(cutoff);
      expect(page.total).toBe(137);
      all.push(...page.items.map((j) => j.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(all).toHaveLength(137);
    expect(new Set(all).size).toBe(137);
    expect(all).not.toContain("00000000-0000-4000-8000-000000001000");
    expect(all).toContain("00000000-0000-4000-8000-000000000100");
    const status = await f.request(`/api/accounts/${accountId}/collection?limit=20`);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      jobsPage: { total: 138, hasMore: true, limit: 20 },
      capacity: { overload: "estimated_deficit" },
    });
  });
});

describe("P0 bounded scheduling and retry", () => {
  it("chooses urgent deadlines and reserves archive progress when measured demand permits it", () => {
    const now = 10 * hour;
    const archive = {
      kind: "job" as const,
      id: "comments",
      dueAt: now - hour,
      deadline: Number.MAX_SAFE_INTEGER,
      cost: 5,
      archive: true,
    };
    const discovery = {
      kind: "schedule" as const,
      id: "new",
      dueAt: now,
      deadline: now + cron,
      cost: 3,
      archive: false,
    };
    expect(selectWork([archive, discovery], now, 2).selected?.id).toBe("new");
    expect(selectWork([archive, { ...discovery, deadline: now + hour }], now, 2)).toMatchObject({
      reason: "archive_reserve",
      selected: { id: "comments" },
    });
  });
  it("performs the first useful discovery in its creation tick and serializes competing schedule claims", async () => {
    const f = await ready(),
      collector = createScheduledOperations(env, { transport: () => f.transport }, f.now);
    await collector.configure(accountId, { enabled: true, discoveryMinutes: 60 });
    await env.DB.prepare(
      "UPDATE collection_schedules SET next_stories_at=?,next_insights_at=?,next_catalogue_at=? WHERE account_id=?",
    )
      .bind(f.now() + day, f.now() + day, f.now() + day, accountId)
      .run();
    vi.mocked(f.transport.mediaPage).mockClear();
    await Promise.all([
      collector.tick(),
      createScheduledOperations(env, { transport: () => f.transport }, f.now).tick(),
    ]);
    expect(f.transport.mediaPage).toHaveBeenCalledTimes(1);
    const jobs = await f.store.jobs(accountId);
    expect(jobs.filter((j) => j.origin === "scheduled")).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      pages: 1,
      status: "completed",
      firstAttemptAt: f.now(),
      firstUsefulObservationAt: f.now(),
    });
    const snapshots = await env.DB.prepare(
      "SELECT COUNT(*) n FROM media_snapshots WHERE operation_id IS NOT NULL",
    ).first<{ n: number }>();
    expect(snapshots?.n).toBe(2);
  });
  it("retains logical operation identity across transport retry, separate attempts and one successful observation", async () => {
    const f = fixture();
    await connect(f);
    let failed = false;
    const http = vi.fn<typeof fetch>(async (url) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/me")) {
        if (!failed) {
          failed = true;
          throw new TypeError("fixture transport error");
        }
        return json({
          user_id: f.profile.userId,
          account_type: f.profile.accountType,
          username: f.profile.username,
          followers_count: f.profile.followersCount,
          media_count: f.profile.mediaCount,
        });
      }
      if (u.pathname.endsWith("/media"))
        return json({
          data: [
            {
              id: sampleMedia.id,
              caption: "fixture",
              media_type: "VIDEO",
              media_product_type: "REELS",
              permalink: sampleMedia.permalink,
              timestamp: new Date(f.now() - day).toISOString(),
              like_count: 10,
              comments_count: 2,
            },
          ],
        });
      return json({
        data: (u.searchParams.get("metric") ?? "")
          .split(",")
          .map((name) => ({ name, values: [{ value: name === "reach" ? 100 : 0 }] })),
      });
    });
    const app = createApp({ clock: f.now, instagram: { transport: () => bound(f, http) } }),
      request = (path: string, body: unknown) =>
        app.request(
          path,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${testKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
          env,
        );
    const id = crypto.randomUUID();
    expect((await request(`/api/accounts/${accountId}/sync`, { operationId: id })).status).toBe(
      502,
    );
    f.advance(cron);
    expect((await request(`/api/accounts/${accountId}/sync`, { operationId: id })).status).toBe(
      200,
    );
    const count = await env.DB.prepare(
      "SELECT COUNT(*) n FROM media_snapshots WHERE operation_id=?",
    )
      .bind(id)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
    const attempts = await env.DB.prepare(
      "SELECT id FROM instagram_http_attempts WHERE operation_id=?",
    )
      .bind(id)
      .all<{ id: string }>();
    expect(attempts.results.length).toBeGreaterThan(2);
    expect(new Set(attempts.results.map((a) => a.id)).size).toBe(attempts.results.length);
    const before = http.mock.calls.length;
    await request(`/api/accounts/${accountId}/sync`, { operationId: id });
    expect(http).toHaveBeenCalledTimes(before);
  });
});

describe("P1 provenance, maturity and comparable rankings", () => {
  it("keeps an early reading immature after the clock passes 48h; only a later revision changes observedAfterDelay", () => {
    expect(periodMaturity(10 * day, 10 * day + hour, 13 * day)).toMatchObject({
      sourceDelayElapsed: true,
      observedAfterDelay: false,
      recheckDue: true,
      matureByPolicy: false,
      sourceFinal: false,
    });
    expect(periodMaturity(10 * day, 12 * day + hour, 13 * day)).toMatchObject({
      observedAfterDelay: true,
      recheckDue: false,
      matureByPolicy: true,
      sourceFinal: false,
    });
  });
  it("uses native interactions without equating components, preserves real negative growth and rejects mismatched readings", async () => {
    const f = await ready();
    await env.DB.prepare(
      "UPDATE media_snapshots SET metrics_json=json_set(metrics_json,'$.totalInteractions.value',141)",
    ).run();
    const report = (await (await f.request(`/api/media/${mediaId}/statistics`)).json()) as {
      interactionComponents: { native: number; sum: number };
      calculated: { interactionBasis: string; engagementByReach: { value: number } };
    };
    expect(report.interactionComponents).toMatchObject({ native: 141, sum: 135 });
    expect(report.calculated.interactionBasis).toBe("native_total_interactions");
    expect(report.calculated.engagementByReach.value).toBeCloseTo(14.1);
    const metrics = await savedMetrics(),
      before = {
        id: "before",
        mediaId,
        observedAt: f.now() - hour,
        apiVersion: "v26.0",
        metrics,
      } as Snapshot,
      after = structuredClone(before);
    after.observedAt = f.now();
    after.metrics.views.value = 1995;
    expect(calculateGrowth(before, after).gain).toMatchObject({
      value: -5,
      reason: "counter_decreased",
    });
    const provenance = {
      receiptId: "one",
      operationId: "same",
      requestStartedAt: 0,
      responseReceivedAt: 1000,
      requestedApiVersion: "v26.0",
      actualApiVersion: "v26.0",
      login: "instagram_login" as const,
      definitionVersion: "v2",
      surface: "instagram" as const,
      distribution: "unknown" as const,
    };
    expect(
      compatibleMeasurements(
        { unit: "count", provenance },
        { unit: "count", provenance: { ...provenance, responseReceivedAt: 62000 } },
      ),
    ).toBe(false);
  });
  it("changes the leader, baseline and valid-pair statistics with the requested denominator; separates FEED media types", async () => {
    const f = await ready(),
      metrics = await savedMetrics();
    await env.DB.prepare("DELETE FROM media_snapshots").run();
    const rows = [
      { id: "A", saves: 20, reach: 1000, type: "IMAGE" },
      { id: "B", saves: 10, reach: 100, type: "IMAGE" },
      { id: "C", saves: 0, reach: 50, type: "IMAGE" },
      { id: "D", saves: null, reach: 100, type: "IMAGE" },
      { id: "E", saves: 5, reach: 0, type: "IMAGE" },
      { id: "F", saves: 50, reach: 100, type: "CAROUSEL_ALBUM" },
    ];
    for (const row of rows) {
      await env.DB.prepare(
        "INSERT INTO media(id,account_id,external_id,caption,search_text,media_type,product_type,permalink,published_at,updated_at) VALUES(?,?,?,'','',?,'FEED',?,?,?)",
      )
        .bind(
          row.id,
          accountId,
          row.id,
          row.type,
          `https://www.instagram.com/p/${row.id}/`,
          f.now() - 7 * day,
          f.now(),
        )
        .run();
      const m = structuredClone(metrics);
      m.saves.value = row.saves;
      m.saves.reason = row.saves === null ? "not_returned" : null;
      m.reach.value = row.reach;
      await snapshot(row.id, row.id, f.now(), m);
    }
    const result = async (mode: string) =>
      (await (
        await f.request(
          `/api/accounts/${accountId}/content-analysis?ageDays=7&metric=saves&productType=FEED&rankingMode=${mode}&timeZone=UTC`,
        )
      ).json()) as {
        input: { rankingMode: string };
        items: {
          media: { id: string };
          rankingValue: number | null;
          sampleSize: number;
          baseline: number | null;
        }[];
        groups: {
          dimension: string;
          mediaType: string;
          paired: { n: number; medianIndividualPer100: number; ratioOfSumsPer100: number };
        }[];
        coverage: {
          analysisCoverage: { observed: number; excludedByReason: Record<string, number> };
          excludedByReason: Record<string, number>;
        };
      };
    const absolute = await result("absolute"),
      relative = await result("per_100_reach");
    expect(absolute.items.filter((i) => ["A", "B"].includes(i.media.id))[0]?.media.id).toBe("A");
    expect(relative.items.filter((i) => ["A", "B"].includes(i.media.id))[0]?.media.id).toBe("B");
    expect(relative.input.rankingMode).toBe("per_100_reach");
    expect(relative.items.find((i) => i.media.id === "B")).toMatchObject({
      rankingValue: 10,
      sampleSize: 2,
      baseline: 1,
    });
    expect(relative.items.find((i) => i.media.id === "C")?.rankingValue).toBe(0);
    expect(relative.items.find((i) => i.media.id === "E")?.rankingValue).toBeNull();
    expect(relative.coverage.analysisCoverage.excludedByReason).toMatchObject({
      missing_inputs: 1,
      zero_denominator: 1,
    });
    const group = relative.groups.find((g) => g.dimension === "format" && g.mediaType === "IMAGE");
    expect(group?.paired).toMatchObject({ n: 3, medianIndividualPer100: 2, excludedPairs: 2 });
    expect(group?.paired.ratioOfSumsPer100).toBeCloseTo((100 * 30) / 1150);
    expect(relative.items.find((i) => i.media.id === "F")?.sampleSize).toBe(0);
    expect(
      pairedAggregate([
        { numerator: 20, denominator: 1000 },
        { numerator: 10, denominator: 100 },
        { numerator: 0, denominator: 50 },
      ]),
    ).toMatchObject({ n: 3, medianIndividualPer100: 2 });
  });
  it("cascades request evidence and policy history on local account erasure", async () => {
    const f = await ready();
    await bound(
      f,
      vi.fn<typeof fetch>(async () =>
        json({
          user_id: f.profile.userId,
          account_type: f.profile.accountType,
          username: f.profile.username,
          followers_count: f.profile.followersCount,
          media_count: f.profile.mediaCount,
        }),
      ),
    ).profile("token");
    await f.store.recordPolicy(accountId, true, f.now(), { version: "collection-v2" });
    await env.DB.prepare("DELETE FROM accounts WHERE id=?").bind(accountId).run();
    expect(
      (
        await env.DB.prepare("SELECT COUNT(*) n FROM instagram_http_attempts").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(0);
    expect(
      (
        await env.DB.prepare("SELECT COUNT(*) n FROM collection_policy_history").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(0);
  });
});

describe("P0/P1 full bounded portions and observation times", () => {
  it("bounds a real scheduled Meta portion with receipts and preserves the profile's own request time", async () => {
    const f = fixture();
    await connect(f);
    let calls = 0;
    const http = vi.fn<typeof fetch>(async (url) => {
      calls++;
      f.advance(250);
      const u = new URL(String(url));
      if (u.pathname.endsWith("/me"))
        return json({
          user_id: f.profile.userId,
          account_type: f.profile.accountType,
          username: f.profile.username,
          followers_count: 1000,
          media_count: 1,
        });
      if (u.pathname.endsWith("/media"))
        return json({
          data: [
            {
              id: sampleMedia.id,
              caption: "",
              media_type: "VIDEO",
              media_product_type: "REELS",
              permalink: sampleMedia.permalink,
              timestamp: new Date(f.now() - day).toISOString(),
              like_count: 10,
              comments_count: 2,
            },
          ],
        });
      return json(
        {
          data: (u.searchParams.get("metric") ?? "").split(",").map((name) => ({
            name,
            values: [{ value: name === "reach" ? 100 : name === "saved" ? 10 : 0 }],
          })),
        },
        200,
        { "x-app-usage": '{"call_volume":2,"cpu_time":1}' },
      );
    });
    const collector = createScheduledOperations(
      env,
      {
        transport: () =>
          bound(f, http, {
            maxAttempts: 6,
            attempts: 0,
            deadlineAt: f.now() + 90_000,
            reserveMs: 15_000,
          }),
      },
      f.now,
    );
    await collector.configure(accountId, { enabled: true, discoveryMinutes: 60 });
    await env.DB.prepare(
      "UPDATE collection_schedules SET next_stories_at=?,next_insights_at=?,next_catalogue_at=? WHERE account_id=?",
    )
      .bind(f.now() + day, f.now() + day, f.now() + day, accountId)
      .run();
    const start = f.now();
    await collector.tick();
    expect(calls).toBe(4);
    const job = (await new D1Collection(env.DB).jobs(accountId))[0];
    expect(job).toMatchObject({
      pages: 1,
      status: "completed",
      httpAttempts: 4,
      firstAttemptAt: start,
      firstUsefulObservationAt: start + 750,
      lastStepDurationMs: 1000,
      lastStepHttpAttempts: 4,
    });
    const profile = await env.DB.prepare(
      "SELECT observed_at,provenance_json FROM account_snapshots WHERE id IS NOT NULL",
    ).first<{ observed_at: number; provenance_json: string }>();
    expect(profile?.observed_at).toBe(start + 250);
    expect(JSON.parse(profile?.provenance_json ?? "{}").responseReceivedAt).toBe(start + 250);
    const report = (await (await f.request(`/api/media/${mediaId}/statistics`)).json()) as {
      calculated: { saveRate: { value: number } };
    };
    expect(report.calculated.saveRate.value).toBe(10);
  });
  it("keeps the last good field's original time after a later source error and does not fabricate a new snapshot", async () => {
    const f = await ready();
    const first = f.now();
    f.advance(hour);
    const http = vi.fn<typeof fetch>(async () =>
      json({ error: { code: 100, message: "Unclassified rejection" } }, 400),
    );
    await expect(
      bound(f, http)
        .forOperation("failed-later")
        .insights("private-token", sampleMedia.id, ["reach"]),
    ).rejects.toMatchObject({ code: "INSTAGRAM_SOURCE_ERROR" });
    const field = (await new D1Analytics(env.DB).metricFreshness(mediaId)).reach;
    expect(field).toMatchObject({
      lastKnownGood: { value: 1000, observedAt: first },
      lastAttempt: { status: "source_error", requestStartedAt: f.now() },
      currentReason: "source_error",
    });
    expect(await new D1Analytics(env.DB).snapshots(mediaId, 10)).toHaveLength(1);
  });
  it("fences an old sync generation when an expired operation ID is reused", async () => {
    const f = await ready(),
      store = new D1Analytics(env.DB),
      id = crypto.randomUUID(),
      start = f.now();
    const run = {
      id,
      accountId,
      inputCursor: null,
      pageSize: 1,
      status: "running" as const,
      startedAt: start,
      completedAt: null,
      nextCursor: null,
      mediaCount: 0,
      errorCode: null,
      kind: "page" as const,
      targetMediaId: null,
    };
    expect(await store.begin(run, start + 15 * 60_000)).toBe(true);
    f.advance(16 * 60_000);
    await store.fail(run, "SYNC_LEASE_EXPIRED", f.now());
    const resumed = { ...run, startedAt: f.now() };
    expect(await store.begin(resumed, f.now() + 15 * 60_000)).toBe(true);
    await expect(store.finish(run, f.profile, [], f.now())).rejects.toMatchObject({
      code: "SYNC_IN_PROGRESS",
    });
    await store.fail(run, "INTERNAL_ERROR", f.now());
    expect(await store.run(id)).toMatchObject({ status: "running", startedAt: resumed.startedAt });
    const lease = await env.DB.prepare("SELECT run_id FROM sync_leases WHERE account_id=?")
      .bind(accountId)
      .first<{ run_id: string }>();
    expect(lease?.run_id).toBe(id);
    await store.finish(resumed, f.profile, [], f.now());
    expect(await store.run(id)).toMatchObject({ status: "completed" });
  });
  it("uses a later compatible age pair rather than the closer incompatible pair", async () => {
    const f = await ready(),
      metrics = await savedMetrics();
    await env.DB.prepare("DELETE FROM media_snapshots").run();
    await env.DB.prepare("UPDATE media SET published_at=? WHERE id=?")
      .bind(f.now() - 30 * day, mediaId)
      .run();
    const p = {
      receiptId: "one",
      operationId: "fixture",
      requestStartedAt: f.now() - 2000,
      responseReceivedAt: f.now(),
      requestedApiVersion: "v26.0",
      actualApiVersion: "v26.0",
      login: "instagram_login" as const,
      definitionVersion: "v2",
      surface: "instagram" as const,
      distribution: "unknown" as const,
    };
    const bad = structuredClone(metrics);
    bad.saves.provenance = p;
    bad.reach.provenance = { ...p, responseReceivedAt: f.now() - 61_000 };
    await snapshot("bad", mediaId, f.now(), bad);
    const good = structuredClone(bad);
    good.reach.provenance = p;
    await snapshot("good", mediaId, f.now() - hour, good);
    expect(
      (
        await new D1Analytics(env.DB).atAge([mediaId], 30, {
          metric: "saves",
          denominator: "reach",
        })
      ).get(mediaId)?.id,
    ).toBe("good");
  });
});

describe("P1 calendar revisions and partial useful groups", () => {
  it("persists a later revision instead of making an early reading mature by moving the clock", async () => {
    const f = await ready(),
      to = f.now() - hour,
      from = to - day;
    vi.mocked(f.transport.structuredInsights).mockImplementation(async (_token, _id, input) => ({
      metric: input.metric,
      period: input.period,
      metricType: input.metricType,
      value: 0,
      reason: null,
      description: null,
      points: [],
      breakdowns: [],
    }));
    const body = {
      operationId: crypto.randomUUID(),
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      timeZone: "UTC",
      metricType: "total_value",
      metrics: ["reach"],
    };
    expect(
      (await f.request(`/api/accounts/${accountId}/insights/collect`, "POST", body)).status,
    ).toBe(200);
    f.advance(3 * day);
    const query = new URLSearchParams({ from: body.from, to: body.to, timeZone: "UTC" });
    const early = (await (
      await f.request(`/api/accounts/${accountId}/activity?${query}`)
    ).json()) as { coverage: { maturity: { observedAfterDelay: boolean; recheckDue: boolean } } };
    expect(early.coverage.maturity).toMatchObject({ observedAfterDelay: false, recheckDue: true });
    expect(
      (
        await f.request(`/api/accounts/${accountId}/insights/collect`, "POST", {
          ...body,
          operationId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(200);
    const late = (await (
      await f.request(`/api/accounts/${accountId}/activity?${query}`)
    ).json()) as {
      current: { values: { value: number }[] };
      coverage: { maturity: { observedAfterDelay: boolean; sourceFinal: boolean } };
    };
    expect(late.coverage.maturity).toMatchObject({ observedAfterDelay: true, sourceFinal: false });
    expect(late.current.values[0]?.value).toBe(0);
    const count = await env.DB.prepare(
      "SELECT COUNT(*) n,COUNT(DISTINCT signature) periods FROM account_insights WHERE account_id=?",
    )
      .bind(accountId)
      .first<{ n: number; periods: number }>();
    expect(count).toEqual({ n: 2, periods: 1 });
  });
  it("retains structured categories at null total and useful calendar fields when a later group rejects its breakdown", async () => {
    const f = await ready(),
      to = f.now() - day;
    vi.mocked(f.transport.structuredInsights).mockImplementation(async (_token, _id, input) => {
      if (input.breakdown === "follow_type")
        throw new (await import("../src/shared/application/application-error")).ApplicationError(
          "INSTAGRAM_INVALID_BREAKDOWN",
          "fixture",
        );
      return {
        metric: input.metric,
        period: input.period,
        metricType: input.metricType,
        value: null,
        reason: "not_returned",
        description: null,
        points: [],
        breakdowns: [
          { dimensions: ["age"], results: [{ categories: ["25-34"], value: 7, reason: null }] },
        ],
      };
    });
    const collected = await f.request(`/api/accounts/${accountId}/insights/collect`, "POST", {
      operationId: crypto.randomUUID(),
      from: new Date(to - day).toISOString(),
      to: new Date(to).toISOString(),
      timeZone: "UTC",
      metricType: "total_value",
      metrics: ["reach", "follows_and_unfollows"],
    });
    expect(collected.status).toBe(200);
    expect(await collected.json()).toMatchObject({
      coverageState: "partial",
      values: [
        { value: null, breakdowns: [{ results: [{ value: 7 }] }] },
        { value: null, reason: "invalid_breakdown" },
      ],
    });
  });
});

describe("P1 comment request evidence", () => {
  it("links a comment page to its receipt and preserves response time before later application work", async () => {
    const f = await ready();
    const operationId = crypto.randomUUID();
    const start = f.now();
    const client = bound(f, async () => {
      f.advance(250);
      return json({
        data: [
          {
            id: "201",
            text: "fixture",
            timestamp: new Date(start - day).toISOString(),
            like_count: 0,
          },
        ],
      });
    });
    const comments = new Comments(
      new D1Comments(env.DB),
      {
        media: async () => ({
          accountId,
          externalId: sampleMedia.id,
          permalink: sampleMedia.permalink,
        }),
        read: async () => {
          const page = await client
            .forOperation(operationId)
            .comments("fixture-token", sampleMedia.id, false, null, 1);
          f.advance(5000);
          return page;
        },
      },
      f.now,
    );
    const page = await comments.collect(mediaId, {
      operationId,
      parentId: null,
      cursor: null,
      limit: 1,
    });
    expect(page).toMatchObject({
      observedAt: start + 250,
      definitionVersion: "instagram-measurement-v2",
      receipt: { operationId, responseReceivedAt: start + 250 },
    });
    if (!page.receipt) throw new Error("Expected a saved comment-page receipt");
    expect(
      await env.DB.prepare("SELECT observed_at,like_count FROM comments WHERE id='201'").first(),
    ).toMatchObject({ observed_at: start + 250, like_count: 0 });
    expect(
      await env.DB.prepare(
        "SELECT json_extract(payload_json,'$.endpointFamily') family FROM instagram_http_attempts WHERE id=?",
      )
        .bind(page.receipt.receiptId)
        .first(),
    ).toMatchObject({ family: "comments" });
    expect(await (await f.request(`/api/comment-collections/${operationId}`)).json()).toMatchObject(
      { receipt: page.receipt, observedAt: start + 250 },
    );
  });
});

describe("P0 reserving useful work before optional metadata", () => {
  it("keeps base discovery and scalar observations in the same tick when optional fields are repeatedly rejected", async () => {
    const f = fixture();
    await connect(f);
    let calls = 0;
    const http = vi.fn<typeof fetch>(async (url) => {
      calls++;
      f.advance(250);
      const u = new URL(String(url));
      if (u.pathname.endsWith("/me"))
        return json({
          user_id: f.profile.userId,
          account_type: f.profile.accountType,
          username: f.profile.username,
          followers_count: 1000,
          media_count: 1,
        });
      if (u.pathname.endsWith("/media")) {
        const fields = u.searchParams.get("fields") ?? "";
        for (const field of ["media_audio_type", "alt_text"])
          if (fields.split(",").includes(field))
            return json(
              {
                error: {
                  code: 100,
                  message: `Tried accessing nonexisting field (${field}) on node type`,
                },
              },
              400,
            );
        return json({
          data: [
            {
              id: sampleMedia.id,
              caption: "",
              media_type: "VIDEO",
              media_product_type: "REELS",
              permalink: sampleMedia.permalink,
              timestamp: new Date(f.now() - day).toISOString(),
              like_count: 10,
              comments_count: 2,
            },
          ],
        });
      }
      return json({
        data: (u.searchParams.get("metric") ?? "")
          .split(",")
          .map((name) => ({ name, values: [{ value: name === "reach" ? 100 : 0 }] })),
      });
    });
    const collector = createScheduledOperations(
      env,
      {
        transport: () =>
          bound(f, http, {
            maxAttempts: 6,
            attempts: 0,
            deadlineAt: f.now() + 90_000,
            reserveMs: 15_000,
          }),
      },
      f.now,
    );
    await collector.configure(accountId, { enabled: true, discoveryMinutes: 60 });
    await env.DB.prepare(
      "UPDATE collection_schedules SET next_stories_at=?,next_insights_at=?,next_catalogue_at=? WHERE account_id=?",
    )
      .bind(f.now() + day, f.now() + day, f.now() + day, accountId)
      .run();
    const start = f.now();
    await collector.tick();
    expect(calls).toBe(6);
    expect((await new D1Collection(env.DB).jobs(accountId))[0]).toMatchObject({
      status: "completed",
      firstAttemptAt: start,
      firstUsefulObservationAt: start + 1250,
      lastStepHttpAttempts: 6,
      lastStepDurationMs: 1500,
    });
    expect((await savedMetrics()).reach.value).toBe(100);
  });
});
