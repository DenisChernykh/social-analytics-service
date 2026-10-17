import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

const root = new URL("../../", import.meta.url);
const output = resolve(process.argv[2] ?? new URL("./preservation-production.json", import.meta.url).pathname);
const baseline = process.argv[3] ? JSON.parse(await readFile(resolve(process.argv[3]), "utf8")) : null;
const config = JSON.parse(await readFile(new URL("backend/wrangler.jsonc", root), "utf8"));
const profile = await readFile(`${homedir()}/Library/Preferences/.wrangler/config/social-analytics.toml`, "utf8");
const credential = profile.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
assert(credential, "Existing Cloudflare authentication unavailable");
const databaseId = config.d1_databases[0].database_id;
const sha = (data) => createHash("sha256").update(JSON.stringify(data)).digest("hex");
async function select(sql, params = []) {
  assert(/^SELECT\b/i.test(sql.trim()) && !/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|PRAGMA|ATTACH|REPLACE)\b/i.test(sql));
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.account_id}/d1/database/${databaseId}/query`, {
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  const data = await response.json();
  assert(response.ok && data.success, `D1 preservation read HTTP ${response.status}`);
  return data.result[0].results;
}
const ids = baseline?.historicalSnapshots.map((row) => row.id) ?? [];
assert(ids.length <= 20 && ids.every((id) => typeof id === "string" && /^[a-zA-Z0-9_:-]{1,300}$/.test(id)));
const rows = await select(baseline
  ? `SELECT id,media_id,observed_at,api_version,metrics_json,provenance_json FROM media_snapshots WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY observed_at,id`
  : "SELECT id,media_id,observed_at,api_version,metrics_json,provenance_json FROM media_snapshots ORDER BY observed_at,id LIMIT 12", ids);
const historicalSnapshots = rows.map((row) => ({ id: row.id, mediaId: row.media_id, observedAt: row.observed_at, rowSHA256: sha(row) }));
const policy = await select("SELECT id,account_id,effective_from,effective_to,version,enabled,policy_json FROM collection_policy_history ORDER BY id");
const schedules = await select("SELECT account_id,enabled,discovery_minutes,time_zone FROM collection_schedules ORDER BY account_id");
const jobs = await select("SELECT id,origin,status,pages,collected,media_processed,cursor FROM collection_jobs WHERE status='running' ORDER BY id");
const activeJobs = jobs.map(({ cursor, ...job }) => ({ ...job, cursorBytes: cursor?.length ?? 0, cursorSHA256: sha(cursor) }));
const evidence = { checkedAt: new Date().toISOString(), mode: "SELECT_only", databaseId, historicalSnapshots, policySHA256: sha(policy), policyRows: policy.length, scheduleSettingsSHA256: sha(schedules), activeJobs, comparison: null };
if (baseline) {
  assert.equal(databaseId, baseline.databaseId);
  assert.deepEqual(historicalSnapshots, baseline.historicalSnapshots, "Pinned historical facts changed or disappeared");
  assert.equal(evidence.policySHA256, baseline.policySHA256, "Recorded collection policy changed");
  assert.equal(evidence.scheduleSettingsSHA256, baseline.scheduleSettingsSHA256, "Schedule settings changed");
  const priorIds = baseline.activeJobs.map((job) => job.id);
  assert(priorIds.length <= 20 && priorIds.every((id) => /^[a-zA-Z0-9_-]{1,150}$/.test(id)));
  const current = priorIds.length ? await select(`SELECT id,origin,status,pages,collected,media_processed FROM collection_jobs WHERE id IN (${priorIds.map(() => "?").join(",")}) ORDER BY id`, priorIds) : [];
  assert.equal(current.length, priorIds.length, "A pre-release job disappeared");
  for (const job of current) {
    const prior = baseline.activeJobs.find((entry) => entry.id === job.id);
    assert.equal(job.origin, prior.origin);
    for (const key of ["pages", "collected", "media_processed"]) assert(job[key] >= prior[key], `${job.id}: ${key} regressed`);
    assert.notEqual(job.status, "cancelled", "A pre-release job was cancelled");
  }
  evidence.comparison = { pinnedHistoricalFactsIdentical: true, policyAndSettingsIdentical: true, priorJobsRetainedWithoutCounterReset: true, currentPriorJobs: current };
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ output, historicalFacts: rows.length, policyRows: policy.length, activeJobs: activeJobs.length, comparedWithBaseline: Boolean(baseline), comparison: evidence.comparison }));
