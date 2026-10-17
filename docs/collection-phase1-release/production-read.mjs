import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { readLocalConfig } from "../../scripts/local-config.mjs";

// GETs, analytics queries and SELECTs only. No tail, collection, DDL or DML.
const root = new URL("../../", import.meta.url);
const output = resolve(process.argv[2] ?? new URL("./production.json", import.meta.url).pathname);
const config = JSON.parse(await readFile(new URL("backend/wrangler.jsonc", root), "utf8"));
const profile = await readFile(`${homedir()}/Library/Preferences/.wrangler/config/social-analytics.toml`, "utf8");
const credential = profile.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
assert(credential, "Existing Cloudflare authentication unavailable");
const local = await readLocalConfig();
assert(local.API_KEY, "Existing backend authentication unavailable");
const account = config.account_id;
const database = config.d1_databases[0].database_id;
const workerPath = `/accounts/${account}/workers/scripts/${config.name}`;
const origin = new URL(config.vars.INSTAGRAM_REDIRECT_URI).origin;
const sha = (value) => createHash("sha256").update(value).digest("hex");
async function cf(path, body) {
  assert(path === "/graphql" || path.startsWith(workerPath) || path === `/accounts/${account}/d1/database/${database}/query`);
  if (body) {
    if (path === "/graphql") assert(!/\bmutation\b/i.test(body.query));
    else {
      assert(path.endsWith("/query"));
      assert(/^SELECT\b/i.test(body.sql.trim()));
      assert(!/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|PRAGMA|ATTACH|REPLACE)\b/i.test(body.sql));
    }
  }
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method: body ? "POST" : "GET", redirect: "manual",
    headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok || result.success === false || result.errors?.length) {
    throw new Error(`Cloudflare HTTP ${response.status}: ${JSON.stringify(result.errors?.map(({ code, message }) => ({ code, message })))}`);
  }
  return result;
}
async function sql(statement, params = []) {
  const response = await cf(`/accounts/${account}/d1/database/${database}/query`, { sql: statement, params });
  return response.result[0];
}
async function get(path, authenticated = true, expected = 200) {
  assert(/^\/(health|openapi\.json|api\/(accounts|media|collection-jobs))\b/.test(path));
  const url = new URL(path, origin);
  assert.equal(url.origin, origin);
  const response = await fetch(url, {
    redirect: "manual", signal: AbortSignal.timeout(30000),
    headers: authenticated ? { Authorization: `Bearer ${local.API_KEY}` } : {},
  });
  assert.equal(response.status, expected, `Backend read HTTP ${response.status}`);
  return response.json();
}
const checkedAt = new Date().toISOString();
const data = { checkedAt, mode: "read_only", failures: [] };
async function capture(name, operation) {
  try { data[name] = await operation(); }
  catch (error) { data.failures.push({ check: name, message: error.message }); }
}
await capture("health", () => get("/health", false));
await capture("unauthenticated", async () => ({ code: (await get("/api/accounts", false, 401)).code }));
await capture("deployment", async () => {
  const result = (await cf(`${workerPath}/deployments`)).result;
  return result.deployments.map(({ id, created_on, versions }) => ({ id, created_on, versions }));
});
await capture("settings", async () => {
  const settings = (await cf(`${workerPath}/settings`)).result;
  const script = (await cf(`${workerPath}/script-settings`)).result;
  return {
    usageModel: settings.usage_model, limits: settings.limits ?? null,
    logpush: script.logpush, observability: script.observability ?? null, tailConsumers: script.tail_consumers ?? null,
    bindings: settings.bindings.filter((binding) => binding.type === "d1" || binding.type === "plain_text"),
    schedules: (await cf(`${workerPath}/schedules`)).result,
  };
});
await capture("bundle", async () => {
  const response = await fetch(`https://api.cloudflare.com/client/v4${workerPath}/content/v2`, {
    headers: { Authorization: `Bearer ${credential}` }, redirect: "manual", signal: AbortSignal.timeout(30000),
  });
  assert(response.ok, `Bundle HTTP ${response.status}`);
  let bytes;
  if (response.headers.get("content-type")?.includes("multipart")) {
    const parts = await response.formData();
    const modules = [...parts.values()].filter((part) => typeof part !== "string" && part.name.endsWith(".js"));
    assert.equal(modules.length, 1);
    bytes = Buffer.from(await modules[0].arrayBuffer());
  } else bytes = Buffer.from(await response.arrayBuffer());
  await mkdir(new URL("tmp/phase1-release/", root), { recursive: true });
  assert(/^\d+\.\d+\.\d+$/.test(data.health.revision));
  await writeFile(new URL(`tmp/phase1-release/production-${data.health.revision}.js`, root), bytes);
  return { bytes: bytes.length, sha256: sha(bytes) };
});
await capture("openapi", async () => {
  const contract = await get("/openapi.json", false);
  await writeFile(new URL(`tmp/phase1-release/production-openapi-${data.health.revision}.json`, root), `${JSON.stringify(contract, null, 2)}\n`);
  return { openapi: contract.openapi, sha256: sha(JSON.stringify(contract)), reviewRankingMode: contract.paths["/api/accounts/{accountId}/review"].get.parameters.find((parameter) => parameter.name === "rankingMode") ?? null };
});
const version = data.deployment?.[0]?.versions?.[0]?.version_id;
const start = process.argv[3] ?? "2026-10-09T06:30:00Z";
assert(Number.isFinite(Date.parse(start)) && Date.parse(start) % 300000 === 0, "Use an aligned five-minute UTC start");
const knownFirstCron = process.argv[3] ? null : Date.parse("2026-10-09T06:30:42Z");
const availableEnd = Math.floor((Date.now() - 5 * 60000) / 60000) * 60000;
const dayEnd = (knownFirstCron ?? Date.parse(start)) + 86400000;
const end = new Date(Math.min(availableEnd, Date.parse(start) + 86400000)).toISOString();
assert(version, "Cannot inspect a version-specific window without current deployment identity");
assert.equal(data.health?.revision, process.argv[4] ?? "0.2.16", "Unexpected production revision");
assert.equal(data.deployment[0].versions.length, 1, "Use a single-version deployment for this verification");
assert.equal(data.deployment[0].versions[0].percentage, 100);
assert(Date.parse(data.deployment[0].created_on) <= Date.parse(start), "Window starts before the selected version became active");
data.window = { start, end, firstCron: knownFirstCron === null ? null : new Date(knownFirstCron).toISOString(), full24hAvailable: availableEnd >= dayEnd, full24hNotBefore: new Date(dayEnd).toISOString(), version, scope: "Scheduled dataset uses script/time; deployment history must prove no intervening version. Mixed dataset is explicitly version-filtered. D1 includes diagnostic reads." };
await capture("analytics", async () => {
  const filter = `scriptName:"${config.name}",datetime_geq:"${start}",datetime_lt:"${end}"`;
  const query = `{viewer {accounts(filter:{accountTag:"${account}"}) {scheduled:workersInvocationsScheduled(limit:2000,filter:{${filter}},orderBy:[scheduledDatetime_ASC]) {cpuTimeUs cron datetime scheduledDatetime status} mixed:workersInvocationsAdaptive(limit:2000,filter:{${filter},scriptVersion:"${version}"}) {dimensions{datetimeMinute status scriptVersion usageModel} sum{requests errors cpuTimeUs subrequests wallTime duration} max{cpuTime duration wallTime memoryUsageBytes} quantiles{cpuTimeP50 cpuTimeP95 cpuTimeP99 durationP50 wallTimeP50 memoryUsageBytesP50}}}}}`;
  const result = (await cf("/graphql", { query })).data.viewer.accounts[0];
  const rows = result.scheduled;
  data.window.firstCron = rows[0]?.scheduledDatetime ?? data.window.firstCron;
  const values = rows.map((row) => row.cpuTimeUs / 1000).sort((a, b) => a - b);
  const quantile = (p) => values[Math.max(0, Math.ceil(p * values.length) - 1)] ?? null;
  const counts = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  const slots = new Map();
  for (const row of rows) {
    const slot = Math.floor(Date.parse(row.scheduledDatetime) / 300000) * 300000;
    slots.set(slot, (slots.get(slot) ?? 0) + 1);
  }
  const expected = [];
  for (let slot = Date.parse(start); slot < Date.parse(end); slot += 300000) expected.push(slot);
  return { query, ...result, summary: {
    invocations: rows.length, statuses: counts,
    cpuMs: { p50: quantile(0.5), p95: quantile(0.95), p99: quantile(0.99), max: values.at(-1) ?? null },
    expectedSlots: expected.length, missingSlots: expected.filter((slot) => !slots.has(slot)).map((slot) => new Date(slot).toISOString()),
    duplicateSlots: [...slots].filter(([, count]) => count > 1),
    mixedInvocations: result.mixed.reduce((sum, row) => sum + row.sum.requests, 0),
    mixedErrors: result.mixed.reduce((sum, row) => sum + row.sum.errors, 0),
  } };
});
await capture("d1Analytics", async () => {
  const query = `{viewer {accounts(filter:{accountTag:"${account}"}) {d1AnalyticsAdaptiveGroups(limit:100,filter:{datetime_geq:"${start}",datetime_lt:"${end}",databaseId:"${database}"}) {sum {readQueries writeQueries rowsRead rowsWritten} quantiles {queryBatchTimeMsP50 queryBatchTimeMsP95 queryBatchTimeMsP99}}}}}`;
  return { query, groups: (await cf("/graphql", { query })).data.viewer.accounts[0].d1AnalyticsAdaptiveGroups };
});
await capture("migrations", () => sql("SELECT id,name,applied_at FROM d1_migrations ORDER BY id"));
await capture("databaseCounts", () => sql(`SELECT
 (SELECT COUNT(*) FROM accounts) accounts, (SELECT COUNT(*) FROM media) media,
 (SELECT COUNT(*) FROM media_snapshots) mediaSnapshots, (SELECT COUNT(*) FROM account_snapshots) accountSnapshots,
 (SELECT COUNT(*) FROM comments) comments, (SELECT COUNT(*) FROM account_insights) accountInsights,
 (SELECT COUNT(*) FROM collection_jobs) jobs, (SELECT COUNT(*) FROM collection_jobs WHERE status='running') runningJobs,
 (SELECT COUNT(*) FROM instagram_http_attempts) receipts,
 (SELECT COUNT(*) FROM collection_policy_history) policyHistory`));
await capture("httpWindow", () => sql(`SELECT json_extract(payload_json,'$.result') result,
 json_extract(payload_json,'$.httpStatus') httpStatus, json_extract(payload_json,'$.graphCode') graphCode,
 json_extract(payload_json,'$.requestedApiVersion') requestedVersion, json_extract(payload_json,'$.actualApiVersion') actualVersion,
 COUNT(*) attempts, SUM(received_at IS NOT NULL) responses
 FROM instagram_http_attempts WHERE requested_at>=? AND requested_at<? GROUP BY result,httpStatus,graphCode,requestedVersion,actualVersion`, [Date.parse(start), Date.parse(end)]));
await capture("activeJobs", async () => {
  const result = await sql("SELECT id,origin,status,cursor,pages,collected,media_processed,attempt,failures,next_attempt_at,started_at,last_success_at,error_code,lease_expires_at,last_step_http_attempts,last_step_duration_ms FROM collection_jobs WHERE status='running' ORDER BY id");
  result.results = result.results.map(({ cursor, ...job }) => {
    let queue;
    try { const parsed = JSON.parse(cursor); queue = { keys: Object.keys(parsed), periods: parsed.periods?.length, head: parsed.head, offset: parsed.offset }; } catch { /* Opaque cursor, retained only as a digest. */ }
    return { ...job, cursorBytes: cursor?.length ?? 0, cursorSHA256: cursor === null ? null : sha(cursor), queue };
  });
  return result;
});
await capture("collection", async () => {
  const accounts = await get("/api/accounts");
  assert.equal(accounts.accounts.length, 1, "Expected one owner account");
  const accountId = accounts.accounts[0].id;
  const first = await get(`/api/accounts/${encodeURIComponent(accountId)}/collection?limit=100`);
  const jobs = [...first.jobs];
  let page = first, pages = 1;
  while (page.jobsPage?.hasMore) {
    assert(pages < 30);
    page = await get(`/api/accounts/${encodeURIComponent(accountId)}/collection?${new URLSearchParams({ limit: "100", cursor: page.jobsPage.nextCursor })}`);
    jobs.push(...page.jobs); pages++;
  }
  assert.equal(jobs.length, new Set(jobs.map((job) => job.id)).size);
  const db = await sql("SELECT COUNT(*) n FROM collection_jobs WHERE account_id=? AND started_at<=?", [accountId, first.jobsPage.cutoff]);
  assert.equal(jobs.length, db.results[0].n);
  const counts = {};
  for (const job of jobs) counts[job.status] = (counts[job.status] ?? 0) + 1;
  const { usageHeaders, ...quota } = first.quota ?? first.api ?? {};
  return {
    pages, total: jobs.length, cutoff: first.jobsPage.cutoff, counts, dbCount: db.results[0].n,
    active: jobs.filter((job) => job.status === "running").map(({ cursor, ...job }) => ({ ...job, cursorBytes: cursor?.length ?? 0, cursorSHA256: cursor === null ? null : sha(cursor) })),
    schedule: first.schedule, policy: first.policy, capacity: first.capacity, diagnostics: first.diagnostics,
    coverage: first.coverage, comments: first.comments, freshness: first.freshness, dataFreshness: first.dataFreshness,
    quota: { ...quota, usageHeaders: usageHeaders ? { appState: usageHeaders.app.state, businessState: usageHeaders.business.state, receivedAt: usageHeaders.receivedAt } : null },
  };
});
await capture("savedReports", async () => {
  const rows = await sql(`SELECT s.media_id,s.observed_at,s.metrics_json,s.provenance_json,m.media_type,m.product_type
    FROM media_snapshots s JOIN media m ON m.id=s.media_id WHERE s.observed_at>=?
    ORDER BY s.observed_at DESC LIMIT 12`, [Date.parse(start)]);
  const selected = new Map();
  for (const row of rows.results) if (!selected.has(row.product_type)) selected.set(row.product_type, row);
  const reports = [];
  for (const row of selected.values()) {
    const report = await get(`/api/media/${encodeURIComponent(row.media_id)}/statistics`);
    const core = Object.entries(report.metrics ?? {}).filter(([field]) => !["facebookViews", "crosspostedViews"].includes(field));
    const reach = report.metrics?.reach?.provenance;
    const attempts = reach?.operationId ? await sql(`SELECT id,object_id,requested_at,received_at,
      json_extract(payload_json,'$.endpointFamily') family,
      json_extract(payload_json,'$.parameters.metric') metrics,
      json_extract(payload_json,'$.result') result
      FROM instagram_http_attempts WHERE operation_id=? ORDER BY requested_at,id LIMIT 30`, [reach.operationId]) : { results: [] };
    reports.push({
      mediaId: row.media_id, productType: row.product_type, mediaType: row.media_type,
      observedAt: report.source?.observedAt, matchesSQLObservation: report.source?.observedAt === row.observed_at,
      metrics: report.metrics, calculated: report.calculated,
      observation: report.observation, storyInsights: report.storyInsights, profileActivity: report.profileActivity,
      coreNumbers: core.filter(([, metric]) => metric.value !== null).length,
      savesReachUsable: Number.isFinite(report.calculated?.saveRate.value),
      sharesReachUsable: Number.isFinite(report.calculated?.shareRate.value),
      attempts: attempts.results,
    });
  }
  return { limit: 12, scope: "Latest saved observations in this window; no collection requested. Missing product types are unverified.", reports };
});
data.finishedAt = new Date().toISOString();
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, `${JSON.stringify(data, null, 2)}\n`);
console.log(JSON.stringify({ output, health: data.health, window: data.window, cron: data.analytics?.summary, d1: data.d1Analytics?.groups, counts: data.databaseCounts?.results, collection: data.collection ? { total: data.collection.total, counts: data.collection.counts, active: data.collection.active.map(({ origin, pages, collected, failures, errorCode }) => ({ origin, pages, collected, failures, errorCode })) } : null, failures: data.failures }, null, 2));
