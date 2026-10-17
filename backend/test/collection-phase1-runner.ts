import { createApp } from "../src/app/create-app";
import type {
  Metrics,
  ProfileActivity,
  StoryInsights,
} from "../src/modules/analytics/domain/model";
import { D1Connections } from "../src/modules/instagram/infrastructure/d1-connections";
import { D1RequestPolicy } from "../src/modules/instagram/infrastructure/d1-request-policy";
import { MetaClient } from "../src/modules/instagram/infrastructure/meta-client";
import type { RuntimeBindings } from "../src/platform/config/runtime-config";
import { TokenCipher } from "../src/platform/crypto/secrets";
import {
  type CollectionCase,
  collectionFixture,
  phase1AccountId,
  phase1ApiKey,
  phase1EncryptionKey,
  phase1OperationId,
  phase1Profile,
} from "./collection-phase1-fixtures";

export async function scenarioRunner(database: D1Database, scenario: CollectionCase) {
  const fixture = collectionFixture(scenario);
  const budget = {
    maxAttempts: scenario.maxAttempts,
    attempts: 0,
    deadlineAt: fixture.now() + 120_000,
    reserveMs: 15_000,
  };
  const bindings = {
    DB: database,
    API_KEY: phase1ApiKey,
    TOKEN_ENCRYPTION_KEY: phase1EncryptionKey,
    INSTAGRAM_CLIENT_ID: "fixture",
    INSTAGRAM_CLIENT_SECRET: "fixture",
    INSTAGRAM_REDIRECT_URI: "https://example.test/callback",
    INSTAGRAM_API_VERSION: "v26.0",
    ENVIRONMENT: "development",
    BUILD_REVISION: "phase1-fixture",
  } as RuntimeBindings;
  await new D1Connections(database).save(
    phase1Profile,
    {
      accountId: phase1AccountId,
      encryptedToken: await new TokenCipher(phase1EncryptionKey).encrypt(
        "synthetic-token",
        phase1AccountId,
      ),
      expiresAt: fixture.now() + 60 * 86_400_000,
      refreshedAt: fixture.now(),
      scopes: ["instagram_business_basic", "instagram_business_manage_insights"],
    },
    fixture.now(),
  );
  const app = createApp({
    clock: fixture.now,
    instagram: {
      transport: (config) =>
        new MetaClient(config, fixture.http, {
          policy: new D1RequestPolicy(database),
          clock: fixture.now,
          budget,
        }),
    },
  });
  const request = (path: string, method = "GET", body?: unknown) =>
    app.request(
      path,
      {
        method,
        headers: {
          Authorization: `Bearer ${phase1ApiKey}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      bindings,
    );
  const collect = (operationId = phase1OperationId) =>
    request(`/api/accounts/${phase1AccountId}/sync`, "POST", {
      operationId,
      pageSize: fixture.media.length,
    });
  const resetBudget = () => {
    budget.attempts = 0;
    budget.deadlineAt = fixture.now() + 120_000;
  };
  return { ...fixture, budget, request, collect, resetBudget };
}

export type Phase1Report = {
  metrics: Metrics | null;
  storyInsights: StoryInsights | null;
  profileActivity: ProfileActivity | null;
  calculated: {
    saveRate: { value: number | null; reason: string | null };
    shareRate: { value: number | null; reason: string | null };
  } | null;
  observation: {
    receiptIds: string[];
    requestStartedAt: number;
    responseReceivedAt: number;
  } | null;
  source: { observedAt: number } | null;
};

export async function exerciseScenario(runner: Awaited<ReturnType<typeof scenarioRunner>>) {
  const statuses: number[] = [];
  let response = await runner.collect();
  statuses.push(response.status);
  let run = await response.json();
  if (statuses[0] !== 200 && runner.calls.some((call) => call.fields.includes("reach"))) {
    runner.advance(300_000);
    runner.resetBudget();
    response = await runner.collect();
    statuses.push(response.status);
    run = await response.json();
  }
  const callsBeforeRepeat = runner.calls.length;
  if (response.status === 200) {
    const repeated = await runner.collect();
    if (repeated.status !== 200 || runner.calls.length !== callsBeforeRepeat)
      throw new Error("Completed operation replay performed collection");
    await repeated.json();
  }
  const reports: Phase1Report[] = [];
  for (const item of runner.media) {
    const report = await runner.request(`/api/media/${phase1AccountId}_${item.id}/statistics`);
    if (report.status === 200) reports.push((await report.json()) as Phase1Report);
    else if (report.status !== 404) throw new Error(`Fixture report failed: ${report.status}`);
  }
  const reasons: Record<string, number> = {};
  const deferredFields: { media: number; field: string; reason: string }[] = [];
  let coreNumbers = 0,
    additionalNumbers = 0,
    structuredNumbers = 0;
  for (const [index, report] of reports.entries()) {
    for (const [key, metric] of Object.entries(report.metrics ?? {})) {
      if (metric.value !== null) {
        if (key === "facebookViews" || key === "crosspostedViews") additionalNumbers++;
        else coreNumbers++;
      }
      if (metric.reason) reasons[metric.reason] = (reasons[metric.reason] ?? 0) + 1;
      if (metric.reason === "request_deferred")
        deferredFields.push({ media: index, field: key, reason: "shared_http_budget_or_backoff" });
    }
    const structured = [
      ...(report.storyInsights
        ? [["navigationTotal", report.storyInsights.navigationTotal] as const]
        : []),
      ...Object.entries(report.storyInsights?.navigation ?? {}).map(
        ([key, metric]) => [`navigation.${key}`, metric] as const,
      ),
      ...(report.storyInsights ? [["replies", report.storyInsights.replies] as const] : []),
      ...(report.profileActivity
        ? [["profileActivity.total", report.profileActivity.total] as const]
        : []),
      ...Object.entries(report.profileActivity?.actions ?? {}).map(
        ([key, metric]) => [`profileActivity.${key}`, metric] as const,
      ),
    ];
    for (const [key, metric] of structured) {
      if (!metric) continue;
      if (metric.value !== null) structuredNumbers++;
      if (metric.reason) reasons[metric.reason] = (reasons[metric.reason] ?? 0) + 1;
      if (metric.reason === "request_deferred")
        deferredFields.push({ media: index, field: key, reason: "shared_http_budget_or_backoff" });
    }
  }
  return {
    statuses,
    run,
    attempts: runner.calls.length,
    coreNumbers,
    additionalNumbers,
    structuredNumbers,
    savesReachPairs: reports.filter((report) => report.calculated?.saveRate.value != null).length,
    sharesReachPairs: reports.filter((report) => report.calculated?.shareRate.value != null).length,
    deferred: deferredFields.length,
    deferredFields,
    reasons,
    requests: runner.calls,
    reports,
  };
}
