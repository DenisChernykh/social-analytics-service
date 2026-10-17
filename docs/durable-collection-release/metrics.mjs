import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

// GraphQL reads only. Invocation logs stay disabled; credentials stay in memory.
const output = resolve(process.argv[2]);
const release = JSON.parse(await readFile(resolve(process.argv[3]), "utf8"));
const config = JSON.parse(await readFile(new URL("../../backend/wrangler.jsonc", import.meta.url), "utf8"));
const profile = await readFile(`${homedir()}/Library/Preferences/.wrangler/config/social-analytics.toml`, "utf8");
const credential = profile.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
assert(credential, "Existing Cloudflare authentication unavailable");
assert.equal(release.deployments[0].versions.length, 1);
assert.equal(release.deployments[0].versions[0].percentage, 100);
const version = release.deployments[0].versions[0].version_id;
const namespace = release.settings.bindings.find((b) => b.name === "COLLECTION_RUNNER")?.namespaceId;
assert(namespace && /^[a-f0-9]+$/.test(namespace));
const start = release.deployments[0].created_on;
const end = new Date().toISOString();
assert(Number.isFinite(Date.parse(start)) && Date.parse(start) < Date.parse(end));
const window = `datetime_geq:${JSON.stringify(start)},datetime_lt:${JSON.stringify(end)}`;
const account = `accountTag:${JSON.stringify(config.account_id)}`;
const script = `scriptName:${JSON.stringify(config.name)}`;
const ns = `namespaceId:${JSON.stringify(namespace)}`;
const queries = {
  invocations: `durableObjectsInvocationsAdaptiveGroups(limit:1000,filter:{${window},${script},${ns},scriptVersion:${JSON.stringify(version)}}){dimensions{datetimeMinute type status namespaceId scriptVersion} sum{requests errors wallTime}}`,
  periodic: `durableObjectsPeriodicGroups(limit:1000,filter:{${window},${ns}}){dimensions{datetimeMinute namespaceId} count sum{cpuTime activeTime duration exceededCpuErrors exceededMemoryErrors fatalInternalErrors subrequests} max{memoryUsageBytes}}`,
  cron: `workersInvocationsScheduled(limit:1000,filter:{${window},${script}},orderBy:[scheduledDatetime_ASC]){cpuTimeUs cron datetime scheduledDatetime status}`,
};
const evidence = {
  checkedAt: end, mode: "GraphQL_read_only", namespace, version,
  window: { start, end, complete: false, note: "Recent metrics may still be ingesting. Cron and periodic datasets use namespace/script and time; verify no intervening deployment." },
  units: { periodicCpuTime: "microseconds (sum over periodic samples, not CPU per alarm)", periodicActiveTime: "microseconds", periodicDuration: "GB*s", cronCpuTimeUs: "microseconds" },
  queries, results: {}, failures: [],
};
await Promise.all(Object.entries(queries).map(async ([name, selection]) => {
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `{viewer{accounts(filter:{${account}}){${selection}}}}` }),
  });
  assert(response.ok, `Metrics HTTP ${response.status}`);
  const result = await response.json();
  if (result.errors?.length) evidence.failures.push({ name, messages: result.errors.map((error) => error.message) });
  else evidence.results[name] = result.data.viewer.accounts[0];
}));
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ output, window: evidence.window, results: evidence.results, failures: evidence.failures }));
