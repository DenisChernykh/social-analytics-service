import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readLocalConfig } from "./local-config.mjs";

const config = await readLocalConfig();
assert(config.API_KEY, "Configure the local API key first.");
const wrangler = JSON.parse(
  await readFile(new URL("../backend/wrangler.jsonc", import.meta.url), "utf8"),
);
const origin = new URL(wrangler.vars.INSTAGRAM_REDIRECT_URI).origin;
const flags = new Set(process.argv.slice(2));
async function request(method, path, body, authenticated = true, expected = 200) {
  const url = new URL(path, origin);
  assert.equal(url.origin, origin);
  assert.equal(url.protocol, "https:");
  assert(!url.pathname.startsWith("/api/instagram/oauth"), "OAuth values must not be printed.");
  const response = await fetch(url, {
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(180_000),
    headers: {
      ...(authenticated ? { Authorization: `Bearer ${config.API_KEY}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(
    response.status,
    expected,
    `Unexpected status ${response.status}; ${data?.code ?? "HTTP_ERROR"}.`,
  );
  return data;
}
const output = (check, result) => console.log(JSON.stringify({ check, ...result }));
const accountPath = (accountId, suffix) =>
  `/api/accounts/${encodeURIComponent(accountId)}/${suffix}`;
const mediaPath = (mediaId, suffix) => `/api/media/${encodeURIComponent(mediaId)}/${suffix}`;
const availability = (collection) => ({
  status: collection.status,
  apiVersion: collection.apiVersion,
  scope: collection.scope,
  values: collection.values.map((value) => ({
    metric: value.metric,
    scalarAvailable: value.value !== null,
    reason: value.reason,
    points: value.points.length,
    breakdownDimensions: value.breakdowns.map((group) => group.dimensions),
    categories: value.breakdowns.reduce((sum, group) => sum + group.results.length, 0),
  })),
});

const health = await request("GET", "/health", undefined, false);
assert.equal(health.revision, wrangler.vars.BUILD_REVISION);
const contract = await request("GET", "/openapi.json", undefined, false);
assert.equal(contract.openapi, "3.1.0");
for (const path of [
  "/api/media/{mediaId}/refresh",
  "/api/accounts/{accountId}/activity",
  "/api/accounts/{accountId}/review",
  "/api/accounts/{accountId}/collection",
  "/api/media/{mediaId}/comments",
  "/api/media/context/batch",
])
  assert(contract.paths[path], `Missing documented path: ${path}`);
await request("GET", "/api/accounts", undefined, false, 401);
const accounts = await request("GET", "/api/accounts");
const account = accounts.accounts[0];
assert(account, "Connect an owner account first.");
const accountId = account.id;
const status = await request("GET", accountPath(accountId, "collection"));
output("deployment", {
  revision: health.revision,
  platforms: [...new Set(accounts.accounts.map((item) => item.platform))],
  automaticCollectionEnabled: status.schedule.enabled,
});
const catalogue = await request(
  "GET",
  `/api/media?${new URLSearchParams({ accountId, limit: "2" })}`,
);
const media = catalogue.items[0];
assert(media, "Collect an owner publication first.");
const report = await request("GET", mediaPath(media.id, "statistics"));
output("saved-report", {
  snapshotAvailable: report.completeness.snapshotAvailable,
  provider: report.source?.provider ?? null,
  scope: report.source?.scope ?? null,
});

if (flags.has("--refresh")) {
  const before = await request("GET", mediaPath(media.id, "history"));
  const operationId = randomUUID();
  const refreshed = await request("POST", mediaPath(media.id, "refresh"), { operationId });
  const repeated = await request("POST", mediaPath(media.id, "refresh"), { operationId });
  assert.equal(refreshed.status, "completed");
  assert.deepEqual(repeated, refreshed);
  const after = await request("GET", mediaPath(media.id, "history"));
  assert.equal(after.items.length, Math.min(20, before.items.length + 1));
  output("single-media-refresh", {
    status: refreshed.status,
    idempotent: true,
    snapshots: after.items.length,
  });
}

const to = new Date();
to.setUTCHours(0, 0, 0, 0);
to.setUTCDate(to.getUTCDate() - 2);
const from = new Date(to.getTime() - 7 * 86_400_000);
const previousFrom = new Date(from.getTime() - 7 * 86_400_000);
const period = { from: from.toISOString(), to: to.toISOString(), timeZone: "UTC" };
if (flags.has("--insights")) {
  for (const [label, input] of [
    ["account-total", { ...period, metricType: "total_value" }],
    [
      "account-previous",
      {
        from: previousFrom.toISOString(),
        to: from.toISOString(),
        timeZone: "UTC",
        metricType: "total_value",
      },
    ],
    ["account-time-series", { ...period, metricType: "time_series", metrics: ["reach", "views"] }],
    [
      "account-content-breakdown",
      {
        ...period,
        metricType: "total_value",
        metrics: ["views", "reach", "total_interactions"],
        breakdown: "media_product_type",
      },
    ],
    [
      "account-audience-breakdown",
      {
        ...period,
        metricType: "total_value",
        metrics: ["views", "reach"],
        breakdown: "follow_type",
      },
    ],
  ]) {
    const collection = await request("POST", accountPath(accountId, "insights/collect"), {
      operationId: randomUUID(),
      ...input,
    });
    output(label, availability(collection));
  }
  const comparison = await request(
    "GET",
    `${accountPath(accountId, "activity")}?${new URLSearchParams({ ...period, compareFrom: previousFrom.toISOString(), compareTo: from.toISOString() })}`,
  );
  assert.equal(comparison.comparable, true);
  output("period-comparison", {
    comparable: comparison.comparable,
    currentAvailable: comparison.coverage.currentAvailable,
    previousAvailable: comparison.coverage.previousAvailable,
    metrics: comparison.comparisons.length,
  });
}
if (flags.has("--audience")) {
  for (const breakdown of ["age", "gender", "country", "city"]) {
    const collection = await request("POST", accountPath(accountId, "audience/collect"), {
      operationId: randomUUID(),
      timeframe: "last_30_days",
      breakdown,
    });
    output(`audience-${breakdown}`, availability(collection));
  }
}
if (flags.has("--stories")) {
  const operationId = randomUUID();
  await request("POST", accountPath(accountId, "collection"), { operationId, stories: true });
  let job = await request("POST", `/api/collection-jobs/${operationId}/advance`, {});
  for (
    let page = 0;
    page < 9 && job.status === "running" && job.nextAttemptAt <= Date.now();
    page++
  )
    job = await request("POST", `/api/collection-jobs/${operationId}/advance`, {});
  output("story-discovery", {
    status: job.status,
    observations: job.collected,
    pages: job.pages,
    errorCode: job.errorCode,
  });
  const stories = await request(
    "GET",
    `/api/media?${new URLSearchParams({ accountId, productType: "STORY", limit: "10" })}`,
  );
  if (stories.items.length) {
    const story = await request("GET", mediaPath(stories.items[0].id, "statistics"));
    output("story-metrics", {
      viewsAvailable: story.metrics?.views.value != null,
      reachAvailable: story.metrics?.reach.value != null,
      navigation: Object.entries(story.storyInsights?.navigation ?? {}).map(
        ([category, value]) => ({
          category,
          available: value.value !== null,
          reason: value.reason,
        }),
      ),
    });
  }
}
if (flags.has("--comments")) {
  const connections = await request("GET", "/api/instagram/connections");
  const connection = connections.connections.find((item) => item.accountId === accountId);
  const granted = connection?.scopes.includes("instagram_business_manage_comments") ?? false;
  if (!granted) {
    const problem = await request(
      "POST",
      mediaPath(media.id, "comments/collect"),
      { operationId: randomUUID(), limit: 5 },
      true,
      403,
    );
    assert.equal(problem.code, "INSTAGRAM_PERMISSION_REQUIRED");
    output("comments", { consentGranted: false, safePermissionError: true });
  } else {
    const collected = await request("POST", mediaPath(media.id, "comments/collect"), {
      operationId: randomUUID(),
      limit: 5,
    });
    output("comments", {
      consentGranted: true,
      status: collected.status,
      collected: collected.collected,
      hasMore: collected.nextCursor !== null,
    });
  }
}
const analysis = await request("GET", accountPath(accountId, "content-analysis"));
const review = await request(
  "GET",
  `${accountPath(accountId, "review")}?${new URLSearchParams(period)}`,
);
output("read-only-analysis", {
  examined: analysis.coverage.examined,
  matchedAgeObserved: analysis.coverage.observed,
  missingAgeSnapshots: analysis.coverage.missing,
  truncated: analysis.coverage.truncated,
  reviewFormula: review.formulaVersion,
  reviewGrowthExamined: review.coverage.growthExamined,
});
