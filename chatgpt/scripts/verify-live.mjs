import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readLocalConfig } from "../../scripts/local-config.mjs";
import { BACKEND_ORIGIN } from "../src/backend-client.ts";
import { createWorker } from "../src/worker.ts";

// Read secrets in memory; print only aggregate verification receipts, never responses/cursors.
const config = await readLocalConfig();
assert.ok(config.API_KEY, "Backend local key missing");
const owner = "verification@example.test";
const env = { SOCIAL_API_KEY: config.API_KEY, SOCIAL_OWNER_EMAIL: owner };
const worker = createWorker(fetch);
const client = new Client({ name: "social-live-verification", version: "1" });
const verifiedTools = new Set();
let lastTool;
await client.connect(
  new StreamableHTTPClientTransport(new URL("https://verification.example.test/mcp"), {
    fetch: (input, init) => {
      const request = new Request(input, init);
      request.headers.set("oai-authenticated-user-email", owner);
      return worker.fetch(request, env);
    },
  }),
);
async function call(name, args = {}) {
  lastTool = name;
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, `Tool ${name} failed`);
  assert.ok(!JSON.stringify(result).includes(config.API_KEY), "Credential leaked");
  verifiedTools.add(name);
  return result.structuredContent.data;
}
try {
  const discovery = await client.listTools();
  assert.equal(discovery.tools.length, 45);
  const health = await fetch(`${BACKEND_ORIGIN}/health`, { redirect: "error" }).then((r) =>
    r.json(),
  );
  const accounts = (await call("list_accounts")).accounts;
  assert.ok(accounts.length);
  const accountId = accounts[0].id;
  const catalog = await call("search_media", { accountId, productType: "REELS", limit: 5 });
  assert.ok(catalog.items.length > 1);
  const media = catalog.items[0];
  const resolved = await call("resolve_media_report", { query: media.permalink, accountId });
  assert.equal(resolved.status, "matched");
  const report = await call("get_media_report", { mediaId: media.id });
  assert.equal(report.media.id, media.id);
  assert.ok(report.source?.observedAt);
  assert.ok(report.source.ageSeconds >= 0);
  assert.ok(Object.values(report.metrics).some((metric) => metric.value === null && metric.reason));
  assert.ok(report.calculated.engagementByReach.formula);
  const ambiguous = await call("resolve_media_report", { query: "а", accountId });
  assert.equal(ambiguous.status, "ambiguous");
  assert.ok(ambiguous.candidates.length > 1);
  const absent = await call("resolve_media_report", {
    query: "verification-absent-9a7f532e",
    accountId,
  });
  assert.equal(absent.status, "not_found");
  await call("get_media_history", { mediaId: media.id });
  await call("compare_media", { mediaId: media.id });
  await call("get_account_summary", { accountId });
  await call("get_account_history", { accountId });
  await call("describe_metrics");
  const collection = await call("get_collection_status", { accountId });
  assert.equal(typeof collection.schedule.enabled, "boolean");
  assert.equal(collection.policy.runBudget, 1);
  assert.equal(collection.policy.commentPageSize, 5);
  assert.equal(collection.policy.commentPolicy.fullReconciliationDays, 30);
  assert.deepEqual(collection.policy.ageIntervalsHours, [1, 6, 24, 72, 168, 336, 720]);
  assert.equal(typeof collection.comments.uniqueComments, "number");
  assert.equal(typeof collection.comments.pendingReplyBranches, "number");
  assert.equal(typeof collection.comments.webhook.active, "boolean");
  const panel = await call("open_social_analytics", { accountId });
  assert.equal(panel.selectedAccountId, accountId);
  assert.equal(typeof panel.history.beginningKnown, "boolean");
  const choices = await call("choose_media", { query: "а", accountId });
  assert.equal(choices.resolution.status, "ambiguous");
  assert.equal(choices.resolution.report, null);
  const resources = await client.listResources();
  const widget = await client.readResource({ uri: resources.resources[0].uri });
  assert.equal(widget.contents[0].mimeType, "text/html;profile=mcp-app");
  if (collection.jobs[0]) await call("get_collection_job", { jobId: collection.jobs[0].id });
  const observations = [];
  let insightCursor;
  let pair;
  do {
    const history = await call("get_insight_history", {
      accountId,
      limit: 100,
      ...(insightCursor ? { cursor: insightCursor } : {}),
    });
    observations.push(...history.items);
    const suitable = observations.filter(
      (item) =>
        item.status === "completed" &&
        item.input.metricType === "total_value" &&
        item.input.breakdown === undefined &&
        typeof item.input.from === "number" &&
        typeof item.input.to === "number",
    );
    for (const current of suitable) {
      const previous = suitable.find(
        (item) =>
          item.id !== current.id &&
          item.apiVersion === current.apiVersion &&
          (item.definitionVersion ?? null) === (current.definitionVersion ?? null) &&
          [...item.input.metrics].sort().join(",") ===
            [...current.input.metrics].sort().join(",") &&
          item.input.timeZone === current.input.timeZone &&
          item.input.to <= current.input.from &&
          item.input.to - item.input.from === current.input.to - current.input.from,
      );
      if (previous) {
        pair = { current, previous };
        break;
      }
    }
    insightCursor = history.nextCursor;
  } while (!pair && insightCursor);
  assert.ok(pair, "Two compatible saved activity intervals are required");
  const period = {
    from: new Date(pair.current.input.from).toISOString(),
    to: new Date(pair.current.input.to).toISOString(),
    timeZone: pair.current.input.timeZone,
    compareFrom: new Date(pair.previous.input.from).toISOString(),
    compareTo: new Date(pair.previous.input.to).toISOString(),
  };
  const activity = await call("get_account_activity", { accountId, ...period });
  assert.equal(activity.comparable, true);
  await call("get_insight_status", { operationId: pair.current.id });
  const audience = await call("get_audience", {
    accountId,
    timeframe: "this_month",
    breakdown: "age",
  });
  assert.ok(audience.items.length);
  await call("analyze_content", { accountId });
  await call("get_business_results", { mediaId: media.id });
  await call("list_experiments", { accountId });
  const comments = await call("get_comments", { mediaId: media.id });
  assert.equal(comments.signals.untrustedData, true);
  await call("review_account", { accountId, ...period });
  console.log(
    JSON.stringify({
      backendRevision: health.revision,
      advertisedTools: discovery.tools.length,
      readToolsVerified: verifiedTools.size,
      matched: true,
      ambiguous: true,
      notFound: true,
      sourceTime: true,
      nullMetrics: true,
      formulas: true,
      credentialNotReturned: true,
      periodComparison: true,
      audienceDefinition: true,
      untrustedCommentTexts: true,
      optionalUiResource: true,
      explicitPublicationChoice: true,
    }),
  );
} catch {
  console.error(
    JSON.stringify({
      check: "live-mcp-verification-failed",
      lastTool,
      verifiedReadTools: verifiedTools.size,
    }),
  );
  process.exitCode = 1;
} finally {
  await client.close();
}
