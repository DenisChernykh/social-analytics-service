import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { D1RequestPolicy } from "../src/modules/instagram/infrastructure/d1-request-policy";
import { MetaClient } from "../src/modules/instagram/infrastructure/meta-client";
import { Review } from "../src/modules/reviews/application/review";
import { collectionCases, phase1AccountId, phase1OperationId } from "./collection-phase1-fixtures";
import { exerciseScenario, type Phase1Report, scenarioRunner } from "./collection-phase1-runner";

function namedCase(name: string) {
  const scenario = collectionCases.find((scenario) => scenario.name === name);
  if (!scenario) throw new Error(`Missing fixture ${name}`);
  return scenario;
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM accounts").run();
});

describe("Core-first collection through real HTTP policy, D1 and reports", () => {
  it("recognizes confirmed pre-conversion media without retrying fields or blocking metadata", async () => {
    const runner = await scenarioRunner(env.DB, {
      name: "feed_pre_conversion",
      productType: "FEED",
      maxAttempts: 6,
      beforeConversion: true,
    });
    const result = await exerciseScenario(runner);
    expect(result.run).toMatchObject({ status: "completed", coverageState: "partial" });
    expect(result.reports[0]?.metrics?.reach).toMatchObject({
      value: null,
      reason: "before_account_conversion",
    });
    expect(result.reports[0]?.metrics?.likes).toMatchObject({
      value: 100,
      sourceField: "like_count",
    });
    expect(result.reports[0]?.metrics?.comments).toMatchObject({ value: 10 });
    expect(runner.calls.filter((call) => call.family === "scalar")).toHaveLength(1);
    expect(
      await env.DB.prepare("SELECT unavailable_code FROM media").first("unavailable_code"),
    ).toBeNull();
    const client = new MetaClient(
      {
        clientId: "fixture",
        clientSecret: "fixture",
        redirectUri: "https://example.com/callback",
        apiVersion: "v26.0",
      },
      vi.fn(() => {
        throw new Error("Cached restriction must not request Meta");
      }),
      { policy: new D1RequestPolicy(env.DB), accountId: phase1AccountId, clock: runner.now },
    );
    expect(
      await client.insights("fixture", runner.media[0]?.id as string, [
        "reach",
        "views",
        "facebook_views",
      ]),
    ).toMatchObject({
      reach: { value: null, reason: "before_account_conversion" },
      views: { value: null, reason: "before_account_conversion" },
      facebook_views: { value: null, reason: "before_account_conversion" },
    });
    const before = runner.calls.length;
    runner.advance(300_000);
    runner.resetBudget();
    expect((await runner.collect(crypto.randomUUID())).status).toBe(200);
    expect(runner.calls.slice(before).map((call) => call.family)).toEqual(["profile", "catalog"]);
    runner.advance(24 * 3_600_000 + 1);
    runner.resetBudget();
    expect((await runner.collect(crypto.randomUUID())).status).toBe(200);
    expect(runner.calls.filter((call) => call.family === "scalar")).toHaveLength(2);
  });
  it.each(collectionCases)("collects $name under the shared budget", async (scenario) => {
    const runner = await scenarioRunner(env.DB, scenario);
    const result = await exerciseScenario(runner);
    expect(result.statuses.at(-1)).toBe(200);
    const expectedCore: Record<string, number> = {
      reels_supported: 11,
      feed_supported: 10,
      feed_source_refusal: 4,
      story_supported: 7,
      reels_optional_rejected: 11,
      feed_restrictions: 8,
      story_restrictions: 5,
      partial_source_error: 11,
      page_budget_exhausted: 22,
      retry_after_failure: 11,
      zero_missing: 9,
      zero_denominator_deferred: 11,
      pre_insights_budget: 2,
    };
    expect(result.coreNumbers).toBe(expectedCore[scenario.name]);
    expect(runner.budget.attempts).toBeLessThanOrEqual(scenario.maxAttempts);
    const receipts = await env.DB.prepare(
      "SELECT id,payload_json FROM instagram_http_attempts",
    ).all<{ id: string; payload_json: string }>();
    expect(receipts.results).toHaveLength(result.attempts);
    expect(new Set(receipts.results.map((row) => row.id)).size).toBe(result.attempts);
    for (const report of result.reports) {
      for (const metric of Object.values(report.metrics ?? {})) {
        if (metric.provenance) expect(metric.provenance.operationId).toBe(phase1OperationId);
        if (metric.value !== null) expect(metric.reason).toBeNull();
      }
    }
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM media_snapshots").first("n")).toBe(
      scenario.mediaCount ?? 1,
    );
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM account_snapshots").first("n")).toBe(1);
  });

  it("retains a real Graph 100/2108006 receipt and a partial snapshot without declaring metrics unsupported", async () => {
    const runner = await scenarioRunner(env.DB, namedCase("feed_source_refusal"));
    const result = await exerciseScenario(runner);
    expect(result.run).toMatchObject({
      status: "completed",
      coverageState: "partial",
      mediaCount: 1,
    });
    expect(result.reports[0]?.metrics?.reach).toMatchObject({
      value: null,
      reason: "source_error",
      provenance: { operationId: phase1OperationId },
    });
    expect(result.reports[0]?.metrics?.likes).toMatchObject({
      value: 100,
      sourceField: "like_count",
    });
    expect(
      await env.DB.prepare(
        "SELECT json_extract(payload_json,'$.graphSubcode') subcode FROM instagram_http_attempts WHERE json_extract(payload_json,'$.httpStatus')=400",
      ).first("subcode"),
    ).toBe(2108006);
    expect(
      await env.DB.prepare("SELECT unavailable_code FROM media").first("unavailable_code"),
    ).toBe("INSTAGRAM_SOURCE_ERROR");
    expect(runner.calls.filter((call) => call.family === "scalar")).toHaveLength(4);
    expect(result.reports[0]?.metrics?.views).toMatchObject({ value: 2000, reason: null });
    expect(result.reports[0]?.metrics?.saves).toMatchObject({ value: 20, reason: null });
    expect(result.attempts).toBeLessThanOrEqual(6);
    expect(runner.calls.filter((call) => call.family === "structured")).toHaveLength(0);
  });

  it("protects every page publication and its same-observation pairs before any optional probe", async () => {
    const scenario = collectionCases.find((scenario) => scenario.name === "page_budget_exhausted");
    if (!scenario) throw new Error("Missing fixture");
    const runner = await scenarioRunner(env.DB, scenario);
    const result = await exerciseScenario(runner);
    const scalar = runner.calls.filter((call) => call.family === "scalar");
    expect(scalar.slice(0, 2).map((call) => call.objectId)).toEqual(
      runner.media.map((item) => item.id),
    );
    expect(
      scalar
        .slice(0, 2)
        .every(
          (call) =>
            call.fields.includes("ig_reels_avg_watch_time") &&
            call.fields.includes("reels_skip_rate") &&
            !call.fields.includes("facebook_views"),
        ),
    ).toBe(true);
    expect(result).toMatchObject({
      attempts: 6,
      savesReachPairs: 2,
      sharesReachPairs: 2,
      coreNumbers: 22,
      additionalNumbers: 1,
      deferred: 2,
    });
    expect(result.run).toMatchObject({
      nextCursor: "phase1-next",
      mediaCount: 2,
      coverageState: "partial",
    });
    for (const report of result.reports) {
      expect(report.metrics?.reach.provenance?.receiptId).toBe(
        report.metrics?.saves.provenance?.receiptId,
      );
      expect(report.metrics?.reach.provenance?.receiptId).toBe(
        report.metrics?.shares.provenance?.receiptId,
      );
      expect(report.calculated?.saveRate.value).toBe(2);
    }
  });

  it("gives every page object its core attempt before probing a refused field within the same six-request budget", async () => {
    const runner = await scenarioRunner(env.DB, {
      ...namedCase("feed_source_refusal"),
      mediaCount: 2,
    });
    const result = await exerciseScenario(runner);
    const scalar = runner.calls.filter((call) => call.family === "scalar");
    expect(scalar.slice(0, 2).map((call) => call.objectId)).toEqual(runner.media.map((m) => m.id));
    expect(scalar.slice(0, 2).every((call) => call.fields.length > 1)).toBe(true);
    expect(result.attempts).toBe(6);
    expect(result.reports).toHaveLength(2);
    expect(result.reports.every((report) => report.metrics?.likes.value === 100)).toBe(true);
    expect(result.reports.every((report) => report.metrics?.reach.value === null)).toBe(true);
    expect(result.reports[0]?.metrics?.views.value).toBe(2000);
  });

  it("keeps supported watch/skip and cross-surface values with distinct receipts and an honest observation window", async () => {
    const runner = await scenarioRunner(env.DB, namedCase("reels_supported"));
    const result = await exerciseScenario(runner);
    expect(result).toMatchObject({
      attempts: 4,
      coreNumbers: 11,
      additionalNumbers: 2,
      deferred: 0,
    });
    const report = result.reports[0];
    if (!report) throw new Error("Missing report");
    expect(report.metrics?.averageWatchTimeMs.value).toBe(15000);
    expect(report.metrics?.totalWatchTimeMs.value).toBe(30_000_000);
    expect(report.metrics?.skipRate.value).toBe(25);
    expect(report.metrics?.facebookViews.value).toBe(80);
    expect(report.metrics?.facebookViews.provenance?.receiptId).not.toBe(
      report.metrics?.reach.provenance?.receiptId,
    );
    expect(report.metrics?.facebookViews.provenance?.surface).toBe("facebook");
    expect(report.metrics?.crosspostedViews.provenance?.surface).toBe("combined");
    expect(report.observation?.receiptIds).toContain(report.metrics?.reach.provenance?.receiptId);
    expect(report.observation?.receiptIds).toContain(
      report.metrics?.facebookViews.provenance?.receiptId,
    );
    expect(report.observation?.responseReceivedAt).toBe(
      report.metrics?.facebookViews.provenance?.responseReceivedAt,
    );
  });

  it("preserves a successful additional field if the following isolated request has a source error", async () => {
    const runner = await scenarioRunner(env.DB, {
      name: "additional_partial",
      productType: "REELS",
      maxAttempts: 5,
      sourceError: ["crossposted_views"],
    });
    const result = await exerciseScenario(runner);
    expect(result).toMatchObject({
      statuses: [200],
      attempts: 5,
      coreNumbers: 11,
      additionalNumbers: 1,
    });
    expect(result.reports[0]?.metrics?.facebookViews).toMatchObject({ value: 80, reason: null });
    expect(result.reports[0]?.metrics?.crosspostedViews).toMatchObject({
      value: null,
      reason: "source_error",
      provenance: { operationId: phase1OperationId },
    });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM instagram_metric_support").first("n"),
    ).toBe(0);
  });

  it("caches a single-field optional refusal only for that object and reuses it without a new HTTP probe", async () => {
    const runner = await scenarioRunner(env.DB, {
      name: "feed_capability",
      productType: "FEED",
      maxAttempts: 6,
      unsupported: ["facebook_views"],
    });
    await exerciseScenario(runner);
    const support = await env.DB.prepare(
      "SELECT metric,object_id FROM instagram_metric_support",
    ).all<{ metric: string; object_id: string }>();
    expect(support.results).toEqual([{ metric: "facebook_views", object_id: runner.media[0]?.id }]);
    const before = runner.calls.filter((call) => call.fields.includes("facebook_views")).length;
    runner.advance(60_000);
    runner.resetBudget();
    expect((await runner.collect("00000000-0000-4000-8000-000000000702")).status).toBe(200);
    expect(runner.calls.filter((call) => call.fields.includes("facebook_views"))).toHaveLength(
      before,
    );
    const http = vi.fn<typeof fetch>(async () =>
      Response.json({ data: [{ name: "facebook_views", values: [{ value: 80 }] }] }),
    );
    const client = new MetaClient(
      {
        clientId: "fixture",
        clientSecret: "fixture",
        redirectUri: "https://example.test/callback",
        apiVersion: "v26.0",
      },
      http,
      { accountId: phase1AccountId, policy: new D1RequestPolicy(env.DB), clock: runner.now },
    );
    expect(
      (await client.insights("synthetic-token", "17900000000001999", ["facebook_views"]))
        .facebook_views?.value,
    ).toBe(80);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("keeps an independently successful optional field after a parameter rejection without caching the error", async () => {
    const runner = await scenarioRunner(env.DB, {
      name: "invalid_additional",
      productType: "REELS",
      maxAttempts: 5,
      invalidAdditional: "crossposted_views",
    });
    const result = await exerciseScenario(runner);
    expect(result).toMatchObject({ attempts: 5, coreNumbers: 11, additionalNumbers: 1 });
    expect(result.reports[0]?.metrics?.facebookViews.value).toBe(80);
    expect(result.reports[0]?.metrics?.crosspostedViews).toMatchObject({
      value: null,
      reason: "invalid_request",
      provenance: { operationId: phase1OperationId },
    });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM instagram_metric_support").first("n"),
    ).toBe(0);
  });

  it("attaches the actual receipt to an invalid optional response while retaining core values", async () => {
    const runner = await scenarioRunner(env.DB, {
      name: "malformed_additional",
      productType: "REELS",
      maxAttempts: 6,
      malformedAdditional: true,
    });
    const result = await exerciseScenario(runner);
    expect(result).toMatchObject({ attempts: 4, coreNumbers: 11, additionalNumbers: 0 });
    const field = result.reports[0]?.metrics?.facebookViews;
    expect(field).toMatchObject({
      value: null,
      reason: "source_error",
      provenance: { operationId: phase1OperationId },
    });
    expect(
      await env.DB.prepare("SELECT id FROM instagram_http_attempts WHERE id=?")
        .bind(field?.provenance?.receiptId)
        .first(),
    ).not.toBeNull();
  });

  it("retains history and never fills deferred current fields with values from an older snapshot", async () => {
    const runner = await scenarioRunner(env.DB, namedCase("reels_supported"));
    await exerciseScenario(runner);
    const old = await env.DB.prepare("SELECT metrics_json,observed_at FROM media_snapshots").first<{
      metrics_json: string;
      observed_at: number;
    }>();
    runner.advance(60_000);
    runner.resetBudget();
    runner.budget.maxAttempts = 3;
    expect((await runner.collect("00000000-0000-4000-8000-000000000703")).status).toBe(200);
    const report = (await (
      await runner.request(`/api/media/${phase1AccountId}_${runner.media[0]?.id}/statistics`)
    ).json()) as Phase1Report;
    expect(report.metrics?.facebookViews).toMatchObject({
      value: null,
      reason: "request_deferred",
    });
    expect(report.metrics?.reach.provenance?.operationId).toBe(
      "00000000-0000-4000-8000-000000000703",
    );
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM media_snapshots").first("n")).toBe(2);
    expect(
      await env.DB.prepare(
        "SELECT metrics_json,observed_at FROM media_snapshots ORDER BY observed_at ASC LIMIT 1",
      ).first(),
    ).toEqual(old);
  });

  it("honors quota backoff after the core response while persisting those useful fields", async () => {
    const runner = await scenarioRunner(env.DB, {
      ...namedCase("reels_supported"),
      coreQuotaPercent: 95,
    });
    const result = await exerciseScenario(runner);
    expect(result).toMatchObject({ attempts: 3, coreNumbers: 11, deferred: 2 });
    const state = await new D1RequestPolicy(env.DB).status(phase1AccountId, "v26.0", runner.now());
    expect(state.usagePercent).toBe(95);
    expect(state.blockedUntil).toBeGreaterThan(runner.now());
    runner.resetBudget();
    const attempts = runner.calls.length;
    expect((await runner.collect("00000000-0000-4000-8000-000000000704")).status).toBe(429);
    expect(runner.calls).toHaveLength(attempts);
  });

  it("keeps zeros numeric, missing values null and rejects zero denominators", async () => {
    const runner = await scenarioRunner(env.DB, namedCase("zero_denominator_deferred"));
    const result = await exerciseScenario(runner);
    expect(result.reports[0]?.metrics?.saves).toMatchObject({ value: 0, reason: null });
    expect(result.reports[0]?.metrics?.facebookViews).toMatchObject({
      value: null,
      reason: "request_deferred",
    });
    expect(result.reports[0]?.calculated?.saveRate).toMatchObject({
      value: null,
      reason: "zero_denominator",
    });
    expect(result.reports[0]?.calculated?.shareRate).toMatchObject({
      value: null,
      reason: "zero_denominator",
    });
    expect(result.savesReachPairs).toBe(0);
  });

  it("keeps Story core and marks navigation/profile continuation deferred after quota backoff", async () => {
    const runner = await scenarioRunner(env.DB, {
      ...namedCase("story_supported"),
      coreQuotaPercent: 95,
    });
    const result = await exerciseScenario(runner);
    expect(result).toMatchObject({ statuses: [200], attempts: 3, coreNumbers: 7 });
    const report = result.reports[0];
    expect(report?.storyInsights?.replies.value).toBe(0);
    expect(report?.storyInsights?.navigationTotal?.reason).toBe("request_deferred");
    expect(report?.profileActivity?.total?.reason).toBe("request_deferred");
    expect(report?.metrics?.facebookViews.reason).toBe("request_deferred");
  });
});

describe("review_account ranking contract", () => {
  it("rejects relative modes before reading evidence; absolute and omitted still execute", async () => {
    const evidence = {
      account: vi.fn(async () => ({}) as never),
      activity: vi.fn(async () => ({})),
      summary: vi.fn(async () => ({})),
      ranking: vi.fn(async () => ({ items: [], coverage: {} })),
      history: vi.fn(async () => ({ items: [], truncated: false })),
    };
    const review = new Review(evidence, () => 100_000);
    const input = { from: 0, to: 1000, timeZone: "UTC", ageDays: 7 as const };
    for (const rankingMode of ["per_100_reach", "per_100_views"] as const)
      await expect(
        review.execute(phase1AccountId, { ...input, rankingMode }),
      ).rejects.toMatchObject({ code: "FEATURE_UNAVAILABLE" });
    expect(evidence.account).not.toHaveBeenCalled();
    expect(evidence.ranking).not.toHaveBeenCalled();
    await expect(review.execute(phase1AccountId, input)).resolves.toMatchObject({
      formulaVersion: "review-v2",
    });
    await expect(
      review.execute(phase1AccountId, { ...input, rankingMode: "absolute" }),
    ).resolves.toMatchObject({ formulaVersion: "review-v2" });
  });
  it("documents the query in current OpenAPI and returns a clear 409 through the backend", async () => {
    const runner = await scenarioRunner(env.DB, namedCase("reels_supported"));
    for (const mode of ["per_100_reach", "per_100_views"]) {
      const response = await runner.request(
        `/api/accounts/${phase1AccountId}/review?from=2026-10-01T00:00:00Z&to=2026-10-08T00:00:00Z&rankingMode=${mode}`,
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: "FEATURE_UNAVAILABLE",
        detail: expect.stringContaining("absolute only"),
      });
    }
    expect(runner.calls).toHaveLength(0);
    const spec = (await (await runner.request("/openapi.json")).json()) as {
      paths: Record<
        string,
        { get: { parameters: { name: string; schema: { enum?: string[]; default?: string } }[] } }
      >;
    };
    expect(
      spec.paths["/api/accounts/{accountId}/review"]?.get.parameters.find(
        (param) => param.name === "rankingMode",
      )?.schema,
    ).toMatchObject({ enum: ["absolute", "per_100_reach", "per_100_views"], default: "absolute" });
  });
});
