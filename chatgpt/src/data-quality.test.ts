import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { BackendFetch } from "./backend-client.ts";
import { createWorker } from "./worker.ts";

const environment = {
  SOCIAL_API_KEY: "local-fixture-key",
  SOCIAL_OWNER_EMAIL: "owner@example.test",
};
const spec = JSON.parse(
  await readFile(new URL("../contract/openapi.json", import.meta.url), "utf8"),
);
function sample(schema: Record<string, unknown>): unknown {
  if (schema.$ref)
    return sample(spec.components.schemas[String(schema.$ref).split("/").at(-1) ?? ""]);
  if ("const" in schema) return schema.const;
  if (schema.enum) return (schema.enum as unknown[])[0];
  const union = schema.anyOf ?? schema.oneOf;
  if (union)
    return sample((union as Record<string, unknown>[]).find((s) => s.type !== "null") ?? {});
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes("object"))
    return Object.fromEntries(
      Object.entries(schema.properties ?? {})
        .filter(([k]) => ((schema.required as string[]) ?? []).includes(k))
        .map(([k, v]) => [k, sample(v as Record<string, unknown>)]),
    );
  if (types.includes("array")) return [];
  if (types.includes("boolean")) return false;
  if (types.includes("integer") || types.includes("number")) return 0;
  if (types.includes("null")) return null;
  return schema.format === "uri"
    ? "https://www.instagram.com/reel/fixture/"
    : schema.format === "uuid"
      ? "00000000-0000-4000-8000-000000000001"
      : "fixture";
}
function response(operationId: string): Record<string, unknown> {
  for (const path of Object.values(spec.paths) as Record<
    string,
    {
      operationId: string;
      responses: Record<string, { content: Record<string, { schema: Record<string, unknown> }> }>;
    }
  >[])
    for (const op of Object.values(path))
      if (op.operationId === operationId)
        return sample(op.responses["200"].content["application/json"].schema) as Record<
          string,
          unknown
        >;
  throw new Error(`No schema ${operationId}`);
}
async function connect(fetchBackend: BackendFetch) {
  const worker = createWorker(fetchBackend),
    client = new Client({ name: "data-quality-verification", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("https://site.example.test/mcp"), {
      fetch: async (input, init) => {
        const request = new Request(input as RequestInfo, init);
        request.headers.set("oai-authenticated-user-email", environment.SOCIAL_OWNER_EMAIL);
        return worker.fetch(request, environment);
      },
    }),
  );
  return client;
}
const receipt = {
  receiptId: "receipt-1",
  operationId: "logical-1",
  requestStartedAt: 1000,
  responseReceivedAt: 1200,
  requestedApiVersion: "v26.0",
  actualApiVersion: "v26.0",
  login: "instagram_login",
};

test("MCP retains unknown quota states, true accounting epochs and jobs continuation without hidden collection", async () => {
  const status = response("getCollectionStatus");
  status.jobs = [];
  status.api = {
    recordedRequests: 9,
    sinceAt: 100,
    usagePercent: null,
    usageObservedAt: null,
    blockedUntil: 0,
    observedAt: 1200,
    cachedUnavailableMetrics: 0,
    http: {
      attempts: 10,
      responses: 9,
      failuresBeforeResponse: 1,
      timeouts: 0,
      rateLimitedResponses: 0,
      sinceAt: 1000,
    },
    usageHeaders: {
      app: { state: "unknown_schema", sample: '{"call_volume":12,"cpu_time":4}' },
      business: { state: "absent", sample: null },
      receivedAt: 1200,
    },
    quotaFreshness: "unknown",
    quotaStaleAfterMs: 3600000,
  };
  status.jobsPage = {
    nextCursor: "page-2",
    hasMore: true,
    limit: 20,
    cutoff: 1500,
    total: 137,
    calculatedAt: 1500,
    semantics: "Stable IDs; live states",
    aggregates: [],
  };
  const calls: URL[] = [];
  const client = await connect(async (request) => {
    assert.equal(request.method, "GET");
    calls.push(new URL(request.url));
    return Response.json({ ...status, ignoredSecret: environment.SOCIAL_API_KEY });
  });
  try {
    const result = await client.callTool({
      name: "get_collection_status",
      arguments: { accountId: "ig_fixture", limit: 20, cursor: "page-1" },
    });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    const data = (result.structuredContent as { data: typeof status }).data;
    assert.deepEqual(data.api, status.api);
    assert.deepEqual(data.jobsPage, status.jobsPage);
    assert.equal(calls[0].searchParams.get("cursor"), "page-1");
    assert.equal(calls.length, 1);
    assert.ok(!JSON.stringify(result).includes(environment.SOCIAL_API_KEY));
  } finally {
    await client.close();
  }
});

test("MCP preserves independent analysis coverage, unknown obligations, denominator zero and relative ranking n", async () => {
  const ranking = response("analyzeContent");
  ranking.input = {
    accountId: "ig_fixture",
    metric: "saves",
    ageDays: 7,
    rankingMode: "per_100_reach",
    timeZone: "UTC",
  };
  ranking.items = [];
  ranking.groups = [];
  ranking.coverage = {
    examined: 126,
    observed: 4,
    missing: 1,
    truncated: false,
    toleranceHours: 12,
    analysisCoverage: {
      examined: 126,
      usable: 4,
      missingEligible: 1,
      excludedByReason: { connected_after_window: 120, zero_denominator: 1 },
      metric: "saves",
      rankingMode: "per_100_reach",
      open: 1,
      closed: 125,
    },
    collectionObligations: { state: "not_evaluated", note: "See saved policy intervals in status" },
  };
  const client = await connect(async (request) => {
    assert.equal(new URL(request.url).searchParams.get("rankingMode"), "per_100_reach");
    return Response.json(ranking);
  });
  try {
    const result = await client.callTool({
      name: "analyze_content",
      arguments: {
        accountId: "ig_fixture",
        metric: "saves",
        rankingMode: "per_100_reach",
        ageDays: 7,
      },
    });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    assert.deepEqual(
      (result.structuredContent as { data: { coverage: unknown } }).data.coverage,
      ranking.coverage,
    );
  } finally {
    await client.close();
  }
});

test("New MCP fails explicitly when old backend ignores relative ranking; default absolute still reads legacy data", async () => {
  const ranking = response("analyzeContent");
  ranking.input = { accountId: "ig_fixture", metric: "saves", ageDays: 7, timeZone: "UTC" };
  const client = await connect(async () => Response.json(ranking));
  try {
    const unsupported = await client.callTool({
      name: "analyze_content",
      arguments: { accountId: "ig_fixture", rankingMode: "per_100_reach", metric: "saves" },
    });
    assert.equal(unsupported.isError, true);
    assert.equal((unsupported.structuredContent as { code: string })?.code, "FEATURE_UNAVAILABLE");
    const legacy = await client.callTool({
      name: "analyze_content",
      arguments: { accountId: "ig_fixture" },
    });
    assert.notEqual(legacy.isError, true, JSON.stringify(legacy));
  } finally {
    await client.close();
  }
});

test("review_account rejects both relative modes before backend access and preserves default/absolute reads", async () => {
  const review = response("reviewAccount");
  const calls: string[] = [];
  const client = await connect(async (request) => {
    calls.push(request.url);
    return Response.json(review);
  });
  try {
    const period = {
      accountId: "ig_fixture",
      from: "2026-10-01T00:00:00Z",
      to: "2026-10-08T00:00:00Z",
    };
    for (const rankingMode of ["per_100_reach", "per_100_views"]) {
      const result = await client.callTool({
        name: "review_account",
        arguments: { ...period, rankingMode },
      });
      assert.equal(result.isError, true);
      assert.equal((result.structuredContent as { code: string })?.code, "FEATURE_UNAVAILABLE");
      assert.match(JSON.stringify(result.content), /analyze_content/);
    }
    assert.equal(calls.length, 0);
    for (const args of [period, { ...period, rankingMode: "absolute" }]) {
      const result = await client.callTool({ name: "review_account", arguments: args });
      assert.notEqual(result.isError, true, JSON.stringify(result));
    }
    assert.equal(calls.length, 2);
    assert.ok(calls.every((url) => new URL(url).searchParams.get("rankingMode") === "absolute"));
  } finally {
    await client.close();
  }
});

test("MCP does not freshen lastKnownGood after a failure and retains field-level Facebook scope", async () => {
  const report = response("getMediaStatistics");
  report.observation = {
    requestStartedAt: 1000,
    responseReceivedAt: 1200,
    receiptIds: ["receipt-1"],
    semantics: "sequential_requests_lifetime",
    definitionVersion: "instagram-measurement-v2",
  };
  const metrics = report.metrics as Record<string, unknown>;
  metrics.facebookViews = {
    value: 0,
    reason: null,
    unit: "count",
    sourceField: "facebook_views",
    provenance: {
      ...receipt,
      definitionVersion: "instagram-measurement-v2",
      surface: "facebook",
      distribution: "unknown",
    },
  };
  (report.media as Record<string, unknown>).context = {
    confirmed: { rubric: null, paidDistribution: null, brandPartnership: true, coauthor: false },
    proposal: { rubric: "proposed", paidDistribution: true },
    confirmedSource: "manual",
    proposalSource: "assistant_suggestion",
    updatedAt: 1200,
  };
  report.freshness = {
    views: {
      lastAttempt: {
        receiptId: "receipt-2",
        requestStartedAt: 3000,
        responseReceivedAt: 3200,
        failedAt: null,
        status: "invalid_breakdown",
        httpStatus: 400,
        graphCode: 100,
        graphSubcode: null,
      },
      lastKnownGood: {
        value: 42,
        observedAt: 1200,
        receiptId: "receipt-1",
        definitionVersion: "instagram-measurement-v2",
        sourceField: "views",
        unit: "count",
      },
      currentReason: "invalid_breakdown",
    },
  };
  const client = await connect(async () => Response.json(report));
  try {
    const result = await client.callTool({
      name: "get_media_report",
      arguments: { mediaId: "ig_media" },
    });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    const data = (result.structuredContent as { data: Record<string, unknown> }).data;
    assert.deepEqual(data.freshness, report.freshness);
    assert.deepEqual(
      (data.media as Record<string, unknown>).context,
      (report.media as Record<string, unknown>).context,
    );
    assert.deepEqual(
      (data.metrics as Record<string, unknown>).facebookViews,
      metrics.facebookViews,
    );
  } finally {
    await client.close();
  }
});

test("MCP retains a comment-page receipt and its response time", async () => {
  const collection = response("getCommentCollection");
  collection.receipt = receipt;
  collection.observedAt = receipt.responseReceivedAt;
  collection.definitionVersion = "instagram-measurement-v2";
  const client = await connect(async () => Response.json(collection));
  try {
    const result = await client.callTool({
      name: "get_comment_status",
      arguments: { operationId: "00000000-0000-4000-8000-000000000201" },
    });
    assert.notEqual(result.isError, true);
    const data = (result.structuredContent as { data: Record<string, unknown> }).data;
    assert.deepEqual(data.receipt, receipt);
    assert.equal(data.observedAt, receipt.responseReceivedAt);
    assert.equal(data.definitionVersion, "instagram-measurement-v2");
  } finally {
    await client.close();
  }
});

test("MCP preserves the distinction between elapsed source delay and a later reading", async () => {
  const result = response("getAccountActivity");
  (result.coverage as Record<string, unknown>).maturity = {
    version: "account-delay-v1",
    sourceDelayMs: 172800000,
    periodEnded: true,
    sourceDelayElapsed: true,
    observedAfterDelay: false,
    recheckDue: true,
    matureByPolicy: false,
    sourceFinal: false,
  };
  const client = await connect(async () => Response.json(result));
  try {
    const r = await client.callTool({
      name: "get_account_activity",
      arguments: {
        accountId: "ig_fixture",
        from: "2026-10-01T00:00:00Z",
        to: "2026-10-02T00:00:00Z",
      },
    });
    assert.notEqual(r.isError, true, JSON.stringify(r));
    assert.deepEqual(
      (
        (r.structuredContent as { data: Record<string, unknown> }).data.coverage as Record<
          string,
          unknown
        >
      ).maturity,
      (result.coverage as Record<string, unknown>).maturity,
    );
  } finally {
    await client.close();
  }
});
