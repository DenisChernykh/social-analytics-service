import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readLocalConfig } from "./local-config.mjs";

const config = await readLocalConfig();
const names = ["API_KEY", "TOKEN_ENCRYPTION_KEY", "INSTAGRAM_CLIENT_ID", "INSTAGRAM_CLIENT_SECRET"];
if (names.some((name) => !config[name])) {
  throw new Error("Configure the four required values in backend/.dev.vars first.");
}
const values = Object.fromEntries(names.map((name) => [name, config[name]]));
const child = spawn(
  "pnpm",
  ["exec", "wrangler", "secret", "bulk", "--profile", "social-analytics"],
  {
    cwd: fileURLToPath(new URL("../backend", import.meta.url)),
    env: { ...process.env, WRANGLER_LOG: "none" },
    stdio: ["pipe", "ignore", "ignore"],
  },
);
child.stdin.on("error", () => {});
child.stdin.end(JSON.stringify(values));
await new Promise((resolve, reject) => {
  child.on("error", () => reject(new Error("Wrangler could not be started.")));
  child.on("exit", (code) =>
    code === 0
      ? resolve()
      : reject(
          new Error(
            "Secret upload failed; verify the social-analytics auth profile and Worker configuration. No secret values were printed.",
          ),
        ),
  );
});
console.log(
  "The four backend secrets were uploaded to the configured Worker; no values were printed.",
);
