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
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, `Tool ${name} failed`);
  assert.ok(!JSON.stringify(result).includes(config.API_KEY), "Credential leaked");
  verifiedTools.add(name);
  return result.structuredContent.data;
}
try {
  const discovery = await client.listTools();
  assert.equal(discovery.tools.length, 44);
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
  const to = new Date();
  to.setUTCHours(0, 0, 0, 0);
  to.setUTCDate(to.getUTCDate() - 2);
  const from = new Date(to.getTime() - 7 * 86_400_000);
  const previousFrom = new Date(from.getTime() - 7 * 86_400_000);
  const period = {
    from: from.toISOString(),
    to: to.toISOString(),
    timeZone: "UTC",
    compareFrom: previousFrom.toISOString(),
    compareTo: from.toISOString(),
  };
  const activity = await call("get_account_activity", { accountId, ...period });
  assert.equal(activity.comparable, true);
  const insightHistory = await call("get_insight_history", { accountId, limit: 2 });
  assert.ok(insightHistory.items.length);
  await call("get_insight_status", { operationId: insightHistory.items[0].id });
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
  console.error("Live MCP verification failed; no upstream details printed.");
  process.exitCode = 1;
} finally {
  await client.close();
}
