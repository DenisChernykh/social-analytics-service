import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const destination = process.argv[2];
if (!destination || !resolve(destination).startsWith("/private/tmp/social-analytics-sites-"))
  throw new Error("Use a fresh /private/tmp/social-analytics-sites-* publication checkout.");
await mkdir(destination); // Fail rather than overwrite a previous published source.
const root = new URL("../../", import.meta.url);
await cp(new URL("../", import.meta.url), `${destination}/chatgpt`, {
  recursive: true,
  filter: (source) =>
    !/(?:^|\/)(node_modules|dist|\.git|\.dev\.vars|\.env)(?:\/|$)/.test(source) &&
    !source.endsWith("/verify-live.mjs"),
});
await mkdir(`${destination}/.openai`);
await cp(
  new URL("../.openai/hosting.json", import.meta.url),
  `${destination}/.openai/hosting.json`,
);
await cp(new URL("pnpm-lock.yaml", root), `${destination}/pnpm-lock.yaml`);
const original = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
await writeFile(
  `${destination}/package.json`,
  JSON.stringify(
    {
      ...original,
      scripts: {
        build: "pnpm --dir chatgpt build && node build-sites.mjs",
        check: "pnpm --dir chatgpt check",
      },
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  `${destination}/pnpm-workspace.yaml`,
  "packages:\n  - chatgpt\nminimumReleaseAge: 1440\nallowBuilds:\n  esbuild: true\n",
);
await writeFile(
  `${destination}/build-sites.mjs`,
  'import { cp, rm } from "node:fs/promises"; await rm("dist", {recursive:true,force:true}); await cp("chatgpt/dist", "dist", {recursive:true});\n',
);
await writeFile(`${destination}/.gitignore`, "node_modules/\ndist/\n.dev.vars*\n.env*\n");
console.log("Publication source prepared without backend source, credentials or data.");
