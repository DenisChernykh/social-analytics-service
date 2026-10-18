import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const directory = fileURLToPath(new URL("../../", import.meta.url));
const bundled = await build({
  stdin: {
    contents:
      'import { createApp } from "./backend/src/app/create-app.ts"; export default createApp();',
    resolveDir: directory,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  target: "node24",
});
const { default: app } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const response = await app.request("/openapi.json", undefined, { BUILD_REVISION: "contract" });
if (!response.ok) throw new Error("Cannot capture the local backend contract");
const contract = await response.json();
const path = new URL("../contract/openapi.json", import.meta.url);
if (process.argv.includes("--check")) {
  assert.deepEqual(
    JSON.parse(await readFile(path, "utf8")),
    contract,
    "Backend OpenAPI changed. Run pnpm --dir chatgpt contract:generate and verify the MCP bundle before release.",
  );
  console.log("Checked MCP OpenAPI against the local backend source without network access.");
} else {
  await writeFile(path, `${JSON.stringify(contract, null, 2)}\n`);
  console.log(
    "Captured OpenAPI from the local backend source without credentials or network access.",
  );
}
