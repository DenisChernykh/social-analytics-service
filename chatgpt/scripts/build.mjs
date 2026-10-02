import { cp, mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/.openai", { recursive: true });
await build({
  entryPoints: ["src/worker.ts"],
  outfile: "dist/server/index.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2024",
  minify: true,
});
await cp(".openai/hosting.json", "dist/.openai/hosting.json");
console.log("Social Analytics: Sites MCP bundle ready.");
