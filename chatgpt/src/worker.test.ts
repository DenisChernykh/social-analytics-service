import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { BACKEND_ORIGIN, type BackendFetch, createBackendClient } from "./backend-client.ts";
import { createWorker } from "./worker.ts";

const env = {
  SOCIAL_API_KEY: "test-secret-must-not-escape",
  SOCIAL_OWNER_EMAIL: "owner@example.test",
};
const media = {
  id: "ig_media_1",
  accountId: "ig_1",
  externalId: "1",
  caption: "Название <script>data</script>",
  title: null,
  mediaType: "VIDEO",
  productType: "REELS",
  permalink: "https://www.instagram.com/reel/test/",
  publishedAt: 1000,
  durationSeconds: null,
  durationSource: null,
};
async function connect(fetchBackend: BackendFetch, owner = env.SOCIAL_OWNER_EMAIL) {
  const worker = createWorker(fetchBackend);
  const client = new Client({ name: "verification", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL("https://site.example.test/mcp"), {
    fetch: async (input, init) => {
      const request = new Request(input as RequestInfo, init);
      if (owner) request.headers.set("oai-authenticated-user-email", owner);
      return worker.fetch(request, env);
    },
  });
  await client.connect(transport);
  return client;
}
test("MCP discovery lists focused tools and correct mutation annotations", async () => {
  const client = await connect(async () => {
    throw new Error("Discovery must not call backend");
  });
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 41);
    assert.equal(
      tools.find((t) => t.name === "set_collection_schedule")?.annotations?.readOnlyHint,
      false,
    );
    assert.equal(
      tools.find((t) => t.name === "erase_comments")?.annotations?.destructiveHint,
      true,
    );
    assert.equal(tools.find((t) => t.name === "get_media_report")?.annotations?.readOnlyHint, true);
    assert.equal(
      tools.find((t) => t.name === "sync_account_page")?.annotations?.readOnlyHint,
      false,
    );
    assert.equal(
      tools.find((t) => t.name === "sync_account_page")?.annotations?.idempotentHint,
      true,
    );
  } finally {
    await client.close();
  }
});
test("Ambiguous/not-found results preserve candidates without silently selecting", async () => {
  const calls: Request[] = [];
  const client = await connect(async (request) => {
    calls.push(request);
    const status =
      new URL(request.url).searchParams.get("query") === "unknown" ? "not_found" : "ambiguous";
    return Response.json({
      status,
      candidates: status === "ambiguous" ? [media, { ...media, id: "ig_media_2" }] : [],
      moreMatches: false,
      report: null,
      ignoredSecret: env.SOCIAL_API_KEY,
    });
  });
  try {
    for (const [query, status] of [
      ["Название", "ambiguous"],
      ["unknown", "not_found"],
    ]) {
      const result = await client.callTool({ name: "resolve_media_report", arguments: { query } });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      assert.equal((result.structuredContent as { data: { status: string } }).data.status, status);
      assert.ok(!JSON.stringify(result).includes(env.SOCIAL_API_KEY));
    }
    assert.equal(calls.length, 2);
    assert.equal(calls[0].headers.get("Authorization"), `Bearer ${env.SOCIAL_API_KEY}`);
    assert.equal(new URL(calls[0].url).origin, BACKEND_ORIGIN);
  } finally {
    await client.close();
  }
});
test("Missing or different owner cannot read data or mutate metadata", async () => {
  for (const owner of ["", "another@example.test"]) {
    let calls = 0;
    const client = await connect(async () => {
      calls++;
      return Response.json({});
    }, owner);
    try {
      for (const action of [
        { name: "list_accounts", arguments: {} },
        { name: "set_media_metadata", arguments: { mediaId: media.id, title: "Alias" } },
      ]) {
        const result = await client.callTool(action);
        assert.equal(result.isError, true);
        assert.equal((result.structuredContent as { code: string }).code, "FORBIDDEN");
      }
      assert.equal(calls, 0);
    } finally {
      await client.close();
    }
  }
});
test("Untrusted upstream errors are safe and no request token is reflected", async () => {
  const client = await connect(async () => new Response(env.SOCIAL_API_KEY, { status: 503 }));
  try {
    const result = await client.callTool({ name: "list_accounts", arguments: {} });
    assert.equal(result.isError, true);
    assert.ok(!JSON.stringify(result).includes(env.SOCIAL_API_KEY));
  } finally {
    await client.close();
  }
});
test("Sync forwards exact operation parameters and performs no automatic retry", async () => {
  const operationId = randomUUID();
  let calls = 0;
  const client = await connect(async (request) => {
    calls++;
    assert.equal(request.method, "POST");
    assert.deepEqual(await request.json(), { operationId, cursor: "page-2", pageSize: 2 });
    throw new Error(env.SOCIAL_API_KEY);
  });
  try {
    const result = await client.callTool({
      name: "sync_account_page",
      arguments: { accountId: "ig_1", operationId, cursor: "page-2", pageSize: 2 },
    });
    assert.equal(result.isError, true);
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(result).includes(env.SOCIAL_API_KEY));
  } finally {
    await client.close();
  }
});
test("Refresh, selected context and opt-in schedule call their precise backend routes", async () => {
  const operationId = randomUUID();
  const calls: { method: string; path: string; body: unknown }[] = [];
  const client = await connect(async (request) => {
    calls.push({
      method: request.method,
      path: new URL(request.url).pathname,
      body: await request.json(),
    });
    return new Response(null, { status: 503 });
  });
  try {
    for (const action of [
      { name: "refresh_media", arguments: { mediaId: media.id, body: { operationId } } },
      {
        name: "set_media_context",
        arguments: {
          body: {
            mediaIds: [media.id],
            source: "assistant_suggestion",
            values: { rubric: "Наблюдение" },
          },
        },
      },
      {
        name: "set_collection_schedule",
        arguments: { accountId: "ig_1", body: { enabled: false, discoveryMinutes: 120 } },
      },
    ]) {
      const result = await client.callTool(action);
      assert.equal(result.isError, true);
    }
    assert.deepEqual(calls, [
      { method: "POST", path: `/api/media/${media.id}/refresh`, body: { operationId } },
      {
        method: "PATCH",
        path: "/api/media/context/batch",
        body: {
          mediaIds: [media.id],
          source: "assistant_suggestion",
          values: { rubric: "Наблюдение" },
        },
      },
      {
        method: "PATCH",
        path: "/api/accounts/ig_1/collection/schedule",
        body: { enabled: false, discoveryMinutes: 120 },
      },
    ]);
  } finally {
    await client.close();
  }
});
test("A collection request never enables recurring collection and status uses only GET", async () => {
  const operationId = randomUUID();
  const calls: { method: string; path: string; body: unknown }[] = [];
  const client = await connect(async (request) => {
    calls.push({
      method: request.method,
      path: new URL(request.url).pathname,
      body: request.method === "GET" ? null : await request.json(),
    });
    return new Response(null, { status: 503 });
  });
  try {
    await client.callTool({
      name: "collect_all",
      arguments: { accountId: "ig_1", body: { operationId } },
    });
    await client.callTool({ name: "get_collection_status", arguments: { accountId: "ig_1" } });
    await client.callTool({ name: "get_collection_job", arguments: { jobId: operationId } });
    assert.deepEqual(calls, [
      {
        method: "POST",
        path: "/api/accounts/ig_1/collection",
        body: { operationId },
      },
      { method: "GET", path: "/api/accounts/ig_1/collection", body: null },
      { method: "GET", path: `/api/collection-jobs/${operationId}`, body: null },
    ]);
  } finally {
    await client.close();
  }
});
test("Invalid arguments, cross-origin requests and oversized input never reach backend", async () => {
  const worker = createWorker(async () => {
    throw new Error("Must not call");
  });
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  const foreign = await worker.fetch(
    new Request("https://site.example.test/mcp", {
      method: "POST",
      headers: { ...headers, Origin: "https://other.test" },
      body: "{}",
    }),
    env,
  );
  assert.equal(foreign.status, 403);
  const big = await worker.fetch(
    new Request("https://site.example.test/mcp", {
      method: "POST",
      headers,
      body: "x".repeat(65537),
    }),
    env,
  );
  assert.equal(big.status, 413);
  const client = await connect(async () => {
    throw new Error("Must not call");
  });
  try {
    const result = await client.callTool({
      name: "get_media_report",
      arguments: { mediaId: "../instagram/oauth" },
    });
    assert.equal(result.isError, true);
  } finally {
    await client.close();
  }
});
test("Contract retains null, zero, formulas, time and drops unknown response keys", async () => {
  const { reportResponse } = await import("./contract.ts");
  const schemas = JSON.parse(
    await readFile(new URL("../contract/openapi.json", import.meta.url), "utf8"),
  ).components.schemas;
  function sample(schema: Record<string, unknown>): unknown {
    if (schema.$ref) return sample(schemas[String(schema.$ref).split("/").at(-1) ?? ""]);
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (schema.enum) return (schema.enum as unknown[])[0];
    if (types.includes("object")) {
      if (schema.properties)
        return Object.fromEntries(
          Object.entries(schema.properties as Record<string, Record<string, unknown>>).map(
            ([key, value]) => [key, sample(value)],
          ),
        );
      return {};
    }
    if (types.includes("array")) return [];
    if (types.includes("boolean")) return true;
    if (types.includes("integer") || types.includes("number")) return 0;
    return schema.format === "uri" ? "https://www.instagram.com/reel/test/" : "source";
  }
  const report = sample(schemas.MediaReport) as Record<string, unknown>;
  report.media = media;
  const metrics = report.metrics as Record<string, unknown>;
  metrics.reposts = { value: null, unit: "count", sourceField: "reposts", reason: "not_supported" };
  const client = await connect(async () => Response.json(report));
  try {
    const result = await client.callTool({
      name: "get_media_report",
      arguments: { mediaId: media.id },
    });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    assert.deepEqual(
      (result.structuredContent as { data: unknown }).data,
      reportResponse.parse(report),
    );
  } finally {
    await client.close();
  }
});
test("Backend credential cannot leave the pinned HTTPS origin", async () => {
  const client = createBackendClient(env.SOCIAL_API_KEY, async () => {
    throw new Error("Must not call");
  });
  const { accountsResponse } = await import("./contract.ts");
  await assert.rejects(
    client.request("https://other.test/api/accounts", accountsResponse),
    /маршрут/,
  );
  await assert.rejects(client.request("/api/instagram/oauth/start", accountsResponse), /маршрут/);
});
