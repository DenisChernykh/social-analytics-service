import { randomBytes } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";
import { readLocalConfig, variablesPath } from "./local-config.mjs";

const values = await readLocalConfig();
values.API_KEY ||= randomBytes(32).toString("base64url");
values.TOKEN_ENCRYPTION_KEY ||= randomBytes(32).toString("base64");
values.INSTAGRAM_CLIENT_ID ||= "";
values.INSTAGRAM_CLIENT_SECRET ||= "";
await writeFile(
  variablesPath,
  `${Object.entries(values)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n")}\n`,
  { mode: 0o600 },
);
await chmod(variablesPath, 0o600);
console.log(
  "Local keys are ready in backend/.dev.vars (permissions 0600). Existing keys were preserved; no secrets were printed.",
);
