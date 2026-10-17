import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readLocalConfig } from "../../scripts/local-config.mjs";

const output = resolve(process.argv[2]);
const config = JSON.parse(await readFile(new URL("../../backend/wrangler.jsonc", import.meta.url), "utf8"));
const local = await readLocalConfig();
assert(local.API_KEY, "Existing backend authentication unavailable");
const origin = new URL(config.vars.INSTAGRAM_REDIRECT_URI).origin;
async function get(path, authenticated = true, expected = 200) {
  assert(/^\/(health|openapi\.json|api\/(accounts|collection-jobs))\b/.test(path));
  const response = await fetch(new URL(path, origin), {
    redirect: "manual", signal: AbortSignal.timeout(30000),
    headers: authenticated ? { Authorization: `Bearer ${local.API_KEY}` } : {},
  });
  assert.equal(response.status, expected, `Backend GET HTTP ${response.status}`);
  return response.json();
}
const health = await get("/health", false);
assert.equal(health.revision, config.vars.BUILD_REVISION);
const unauthenticated = await get("/api/accounts", false, 401);
const contract = await get("/openapi.json", false);
const localContract = JSON.parse(await readFile(new URL("../../chatgpt/contract/openapi.json", import.meta.url), "utf8"));
assert.deepEqual(contract, localContract, "Production OpenAPI differs from checked MCP contract");
const accounts = await get("/api/accounts");
assert.equal(accounts.accounts.length, 1);
const collection = await get(`/api/accounts/${encodeURIComponent(accounts.accounts[0].id)}/collection?limit=1`);
const job = collection.jobs[0] ? await get(`/api/collection-jobs/${encodeURIComponent(collection.jobs[0].id)}`) : null;
const evidence = {
  checkedAt: new Date().toISOString(), mode: "GET_only", health,
  unauthenticatedCode: unauthenticated.code, openapiMatchesCheckedContract: true,
  collection: { accountCount: accounts.accounts.length, returnedJobs: collection.jobs.length, capacity: collection.capacity },
  job: job ? { id: job.id, status: job.status, pages: job.pages } : null,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence));
