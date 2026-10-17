import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Public source and built artifacts only. Credentials/local configuration are
// deliberately outside this inventory. This is a local build, not deployment proof.
const root = new URL("../", import.meta.url).pathname;
const sha = (data) => createHash("sha256").update(data).digest("hex");
async function files(directory) {
  const result = [];
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) result.push(...(await files(path)));
    else result.push(path);
  }
  return result;
}
const inputs = [
  ...(await files("backend/src")),
  ...(await files("chatgpt/src")),
  ...(await files("backend/test")),
  ...(await readdir(join(root, "backend/migrations")))
    .filter((p) => p.endsWith(".sql"))
    .map((p) => `backend/migrations/${p}`),
  "AGENTS.md",
  "pnpm-lock.yaml",
  "package.json",
  "backend/package.json",
  "backend/wrangler.jsonc",
  "chatgpt/package.json",
  "chatgpt/plugin/plugin.json",
  "chatgpt/plugin/mcp.json",
  "chatgpt/plugin/skills/media-statistics/SKILL.md",
  "chatgpt/contract/openapi.json",
  "scripts/verify-instagram-data-quality.mjs",
  "scripts/verify-instagram-data-migrations.mjs",
  "scripts/instagram-data-build-manifest.mjs",
].sort();
const inventory = [];
for (const path of inputs) inventory.push({ path, sha256: sha(await readFile(join(root, path))) });
const artifacts = [];
for (const path of [
  "backend/dist/index.js",
  "chatgpt/dist/server/index.js",
  "chatgpt/plugin/plugin.json",
  "chatgpt/contract/openapi.json",
  "chatgpt/dist/social-analytics-plugin.zip",
]) {
  let bytes;
  try {
    bytes = await readFile(join(root, path));
  } catch (error) {
    if (path === "chatgpt/dist/social-analytics-plugin.zip" && error.code === "ENOENT") continue;
    throw error;
  }
  artifacts.push({ path, bytes: bytes.length, sha256: sha(bytes) });
}
const backend = JSON.parse(await readFile(join(root, "backend/wrangler.jsonc"), "utf8"));
const mcp = JSON.parse(await readFile(join(root, "chatgpt/package.json"), "utf8"));
let sitesRelease = null;
try {
  sitesRelease = JSON.parse(
    await readFile(join(root, "docs/instagram-data-sites-release-evidence.json"), "utf8"),
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const publishedMcp =
  sitesRelease?.deploymentStatus === "succeeded" &&
  sitesRelease.mcpVersion === mcp.version &&
  sitesRelease.mcpBundleSha256 ===
    artifacts.find((a) => a.path === "chatgpt/dist/server/index.js")?.sha256;
const manifest = {
  createdAt: new Date().toISOString(),
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  workingTree:
    "Includes pre-existing uncommitted work and this implementation; no root/backend commit or push. Authorized separate Sites source commit is recorded below.",
  backendRevision: backend.vars.BUILD_REVISION,
  mcpVersion: mcp.version,
  sourceInventorySha256: sha(JSON.stringify(inventory)),
  artifacts,
  inventory,
  deployment: {
    status: publishedMcp ? "backend_pending_mcp_published" : "not_deployed_by_this_task",
    cloudflareVersionId: null,
    sitesDeploymentId: publishedMcp ? sitesRelease.deploymentId : null,
    sitesSourceCommit: publishedMcp ? sitesRelease.sourceCommit : null,
    sitesVersionNumber: publishedMcp ? sitesRelease.versionNumber : null,
    sourceLinkage: publishedMcp
      ? "Only MCP published: native saved-version source commit and archive evidence recorded; backend awaits authorization. Health version alone is insufficient."
      : "Record actual deployment IDs and uploaded artifact digests after an authorized release; health version alone is insufficient.",
  },
};
await writeFile(
  join(root, "docs/instagram-data-build-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    backendRevision: manifest.backendRevision,
    mcpVersion: manifest.mcpVersion,
    sourceFiles: inventory.length,
    sourceInventorySha256: manifest.sourceInventorySha256,
    artifacts,
    deployment: manifest.deployment.status,
  }),
);
