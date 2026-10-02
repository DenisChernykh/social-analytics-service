import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import https from "node:https";
import { readLocalConfig } from "./local-config.mjs";

const config = await readLocalConfig();
if (!config.API_KEY) throw new Error("Run pnpm setup:local first.");
const wrangler = JSON.parse(
  await readFile(new URL("../backend/wrangler.jsonc", import.meta.url), "utf8"),
);
const base = new URL(
  process.env.SOCIAL_ANALYTICS_URL ||
    config.SOCIAL_ANALYTICS_URL ||
    wrangler.vars.INSTAGRAM_REDIRECT_URI,
).origin;
const [command, ...args] = process.argv.slice(2);

function request(method, path, body) {
  const url = new URL(path, base);
  if (url.origin !== base || url.protocol !== "https:")
    throw new Error("Use the configured HTTPS backend origin.");
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const connection = https.request(
      url,
      {
        method,
        rejectUnauthorized: !["localhost", "127.0.0.1"].includes(url.hostname),
        timeout: 180_000,
        headers: {
          Authorization: `Bearer ${config.API_KEY}`,
          ...(payload === null
            ? {}
            : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }),
        },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
          if (text.length > 5_000_000)
            connection.destroy(new Error("Response exceeded five megabytes."));
        });
        response.on("end", () => {
          try {
            const data = text ? JSON.parse(text) : null;
            if ((response.statusCode ?? 500) >= 400)
              reject(
                new Error(`${data?.code ?? "HTTP_ERROR"}: ${data?.detail ?? "Request failed"}`),
              );
            else resolve(data);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    connection.on("error", () => reject(new Error("The backend could not be reached.")));
    connection.on("timeout", () => connection.destroy(new Error("Request timed out.")));
    connection.end(payload);
  });
}

if (command === "connect") {
  const response = await request("POST", "/api/instagram/oauth/start");
  const url = new URL(response.authorizationUrl);
  if (url.origin !== "https://www.instagram.com" || url.pathname !== "/oauth/authorize")
    throw new Error("Unexpected OAuth destination.");
  const child = spawn(
    process.platform === "darwin" ? "open" : "xdg-open",
    process.platform === "darwin" ? ["-a", "Google Chrome", url.toString()] : [url.toString()],
    {
      stdio: "ignore",
    },
  );
  await new Promise((resolve, reject) => {
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("Open the OAuth URL using the API response in a browser.")),
    );
    child.on("error", reject);
  });
  console.log(
    "Instagram authorization was opened in your browser. Complete the consent there; no tokens are printed.",
  );
} else if (command === "accounts") {
  console.log(JSON.stringify(await request("GET", "/api/accounts"), null, 2));
} else if (command === "report" && args[0]) {
  console.log(
    JSON.stringify(
      await request(
        "GET",
        `/api/reports/media?${new URLSearchParams({ query: args[0], ...(args[1] ? { accountId: args[1] } : {}) })}`,
      ),
      null,
      2,
    ),
  );
} else if (command === "sync" && args[0]) {
  let cursor = null;
  let count = 0;
  for (let page = 0; page < 1000; page++) {
    const operationId = randomUUID();
    let run;
    try {
      run = await request("POST", `/api/accounts/${encodeURIComponent(args[0])}/sync`, {
        operationId,
        cursor,
        pageSize: 3,
      });
    } catch (error) {
      try {
        run = await request("GET", `/api/sync-runs/${operationId}`);
      } catch {
        throw error;
      }
    }
    if (run.status !== "completed")
      throw new Error(
        `Collection ${run.status}: ${run.errorCode ?? "inspect sync operation"}; operationId=${operationId}`,
      );
    count += run.mediaCount;
    console.log(`Collected ${count} media; operationId=${operationId}.`);
    if (!run.nextCursor) break;
    if (run.nextCursor === cursor) throw new Error("Instagram returned a repeated cursor.");
    cursor = run.nextCursor;
    if (page === 999) throw new Error("Reached the collection page limit.");
  }
} else if (
  command === "request" &&
  args[0] &&
  args[1]?.startsWith("/api/") &&
  !args[1].startsWith("/api/instagram/oauth")
) {
  const path = decodeURIComponent(new URL(args[1], base).pathname);
  if (!path.startsWith("/api/") || path.startsWith("/api/instagram/oauth")) {
    throw new Error("Use the connect command for OAuth; its state must not be printed.");
  }
  console.log(
    JSON.stringify(
      await request(args[0].toUpperCase(), args[1], args[2] ? JSON.parse(args[2]) : undefined),
      null,
      2,
    ),
  );
} else {
  console.log(
    "Usage: pnpm api accounts | connect | sync ACCOUNT_ID | report 'TITLE' [ACCOUNT_ID] | request METHOD /api/PATH [JSON]",
  );
  process.exitCode = 1;
}
