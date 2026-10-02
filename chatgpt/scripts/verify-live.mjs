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
  return result.structuredContent.data;
}
try {
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
  console.log(
    JSON.stringify({
      backendRevision: health.revision,
      readToolsVerified: 9,
      matched: true,
      ambiguous: true,
      notFound: true,
      sourceTime: true,
      nullMetrics: true,
      formulas: true,
      credentialNotReturned: true,
    }),
  );
} catch {
  console.error("Live MCP verification failed; no upstream details printed.");
  process.exitCode = 1;
} finally {
  await client.close();
}
