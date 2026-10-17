import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

// Read-only release evidence. Credentials remain in memory; no raw source
// payloads, tokens, comment text or collection cursors are written or printed.
const output = resolve(process.argv[2]);
const config = JSON.parse(await readFile(new URL("../../backend/wrangler.jsonc", import.meta.url), "utf8"));
const profile = await readFile(`${homedir()}/Library/Preferences/.wrangler/config/social-analytics.toml`, "utf8");
const credential = profile.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
assert(credential, "Existing Cloudflare authentication unavailable");
const account = config.account_id;
const database = config.d1_databases[0].database_id;
const worker = `/accounts/${account}/workers/scripts/${config.name}`;
const sha = (value) => createHash("sha256").update(value).digest("hex");
async function cf(path, sql) {
  assert(path.startsWith(worker) || path === `/accounts/${account}/d1/database/${database}/query`);
  if (sql) assert(/^SELECT\b/i.test(sql) && !/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|PRAGMA|ATTACH|REPLACE)\b/i.test(sql));
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method: sql ? "POST" : "GET", redirect: "manual", signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
    ...(sql ? { body: JSON.stringify({ sql }) } : {}),
  });
  assert(response.ok, `Cloudflare read HTTP ${response.status}`);
  const data = await response.json();
  assert(data.success, "Cloudflare read failed");
  return data.result;
}
const query = async (sql) => (await cf(`/accounts/${account}/d1/database/${database}/query`, sql))[0].results;
const origin = new URL(config.vars.INSTAGRAM_REDIRECT_URI).origin;
const healthResponse = await fetch(`${origin}/health`, { redirect: "manual", signal: AbortSignal.timeout(30000) });
assert.equal(healthResponse.status, 200);
const health = await healthResponse.json();
const [settings, scriptSettings, schedules, deployments, migrations, counts, collectionSchedules, jobs, recentReceipts] = await Promise.all([
  cf(`${worker}/settings`), cf(`${worker}/script-settings`), cf(`${worker}/schedules`), cf(`${worker}/deployments`),
  query("SELECT id,name,applied_at FROM d1_migrations ORDER BY id"),
  query(`SELECT (SELECT COUNT(*) FROM media) media,(SELECT COUNT(*) FROM media_snapshots) mediaSnapshots,
    (SELECT MAX(observed_at) FROM media_snapshots) lastMediaSnapshot,
    (SELECT COUNT(*) FROM comments) comments,(SELECT COUNT(*) FROM account_insights) accountInsights,
    (SELECT COUNT(*) FROM instagram_http_attempts) httpAttempts,
    (SELECT MAX(received_at) FROM instagram_http_attempts) lastHttpResponse`),
  query("SELECT account_id,enabled,next_discovery_at,next_stories_at,next_insights_at,next_catalogue_at,retry_at,failures,error_code,claim_expires_at,last_success_at FROM collection_schedules ORDER BY account_id"),
  query("SELECT id,origin,status,pages,collected,media_processed,attempt,failures,next_attempt_at,last_success_at,error_code,lease_expires_at,last_step_duration_ms,last_step_http_attempts FROM collection_jobs ORDER BY started_at DESC,id DESC LIMIT 20"),
  query("SELECT requested_at,received_at,json_extract(payload_json,'$.endpointFamily') family,json_extract(payload_json,'$.httpStatus') httpStatus,json_extract(payload_json,'$.result') result,json_extract(payload_json,'$.graphCode') graphCode,json_extract(payload_json,'$.graphSubcode') graphSubcode FROM instagram_http_attempts ORDER BY requested_at DESC LIMIT 12"),
]);
const contentResponse = await fetch(`https://api.cloudflare.com/client/v4${worker}/content/v2`, {
  headers: { Authorization: `Bearer ${credential}` }, redirect: "manual", signal: AbortSignal.timeout(30000),
});
assert(contentResponse.ok, "Cannot read active Worker bundle");
let bundle;
if (contentResponse.headers.get("content-type")?.includes("multipart")) {
  const parts = await contentResponse.formData();
  const modules = [...parts.values()].filter((part) => typeof part !== "string" && part.name.endsWith(".js"));
  assert.equal(modules.length, 1);
  bundle = Buffer.from(await modules[0].arrayBuffer());
} else bundle = Buffer.from(await contentResponse.arrayBuffer());
assert(/^\d+\.\d+\.\d+$/.test(health.revision));
await mkdir(dirname(output), { recursive: true });
const bundlePath = resolve(dirname(output), `active-${health.revision}.js`);
await writeFile(bundlePath, bundle);
const publicVars = new Set(["ENVIRONMENT", "INSTAGRAM_API_VERSION", "INSTAGRAM_REDIRECT_URI", "BUILD_REVISION", "COLLECTION_RUNNER_ENABLED"]);
const evidence = {
  checkedAt: new Date().toISOString(), mode: "GET_and_SELECT_only", health,
  deployments: deployments.deployments.map(({ id, created_on, versions }) => ({ id, created_on, versions })),
  settings: {
    usageModel: settings.usage_model, migrationTag: settings.migration_tag ?? null,
    observability: scriptSettings.observability ?? null, logpush: scriptSettings.logpush ?? null,
    bindings: settings.bindings.map((binding) => ({ type: binding.type, name: binding.name,
      ...(binding.type === "plain_text" && publicVars.has(binding.name) ? { text: binding.text } : {}),
      ...(binding.type === "d1" ? { id: binding.id } : {}),
      ...(binding.type === "durable_object_namespace" ? { namespaceId: binding.namespace_id, className: binding.class_name } : {}),
    })), schedules,
  },
  bundle: { path: bundlePath, bytes: bundle.length, sha256: sha(bundle) }, migrations, counts: counts[0],
  collectionSchedules, jobs, recentReceipts,
};
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ output, health, deployment: evidence.deployments[0], counts: evidence.counts,
  schedules: collectionSchedules.map(({ account_id, enabled, failures, error_code }) => ({ accountId: account_id, enabled, failures, errorCode: error_code })),
  jobs: jobs.map(({ origin, status, pages, failures, error_code }) => ({ origin, status, pages, failures, errorCode: error_code })),
  bundleSHA256: evidence.bundle.sha256,
}));
