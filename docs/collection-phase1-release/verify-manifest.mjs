import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const manifest = JSON.parse(await readFile(new URL("./release-manifest.json", import.meta.url), "utf8"));
const checkout = resolve(process.argv[2] ?? new URL("../../tmp/phase1-release/candidate", import.meta.url).pathname);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
for (const [file, expected] of Object.entries(manifest.sourceFilesSHA256)) {
  assert.equal(sha(await readFile(resolve(checkout, file))), expected, `Release source changed: ${file}`);
}
for (const { path, sha256 } of manifest.artifacts) {
  assert.equal(sha(await readFile(resolve(checkout, path))), sha256, `Release artifact changed: ${path}`);
}
const config = JSON.parse(await readFile(resolve(checkout, "backend/wrangler.jsonc"), "utf8"));
assert.equal(config.vars.BUILD_REVISION, manifest.backendRevision);
assert.equal(config.d1_databases[0].database_id, manifest.production.databaseId);
assert.deepEqual(config.triggers.crons, ["*/5 * * * *"]);
assert.equal(config.observability.logs.invocation_logs, false);
assert.equal(config.observability.logs.enabled, false);
assert.equal(JSON.parse(await readFile(resolve(checkout, "chatgpt/package.json"), "utf8")).version, manifest.mcpVersion);
console.log(JSON.stringify({ checkout, sourceFilesVerified: Object.keys(manifest.sourceFilesSHA256).length, artifactsVerified: manifest.artifacts.length, revision: manifest.backendRevision, mcp: manifest.mcpVersion, migrationsRequired: false }));
