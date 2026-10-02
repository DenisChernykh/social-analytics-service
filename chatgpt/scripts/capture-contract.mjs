import { writeFile } from "node:fs/promises";
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
await writeFile(
  new URL("../contract/openapi.json", import.meta.url),
  `${JSON.stringify(await response.json(), null, 2)}\n`,
);
console.log(
  "Captured OpenAPI from the local backend source without credentials or network access.",
);
