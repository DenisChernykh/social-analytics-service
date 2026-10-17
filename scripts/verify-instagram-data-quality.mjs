import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readLocalConfig } from "./local-config.mjs";

// Local D1 + actual backend, OpenAPI/Zod adapter and SDK. Optional live mode
// permits only selected Meta GETs and fixed read-only Cloudflare D1 queries.
const live = process.argv.includes("--live-readonly");
const workspace = new URL("../", import.meta.url).pathname;
const backendRequire = createRequire(
  await realpath(join(workspace, "backend/node_modules/wrangler/package.json")),
);
const chatgptRequire = createRequire(join(workspace, "chatgpt/package.json"));
const { Miniflare, Log, LogLevel, convertV4MiniflareOptions } = backendRequire("miniflare");
const { build } = chatgptRequire("esbuild");
const config = JSON.parse(await readFile(join(workspace, "backend/wrangler.jsonc"), "utf8"));
const temp = await mkdtemp(join(tmpdir(), "social-analytics-quality-"));
const sourceCalls = [],
  localCalls = [];
let mf;
try {
  const entry = join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export {createApp} from ${JSON.stringify(join(workspace, "backend/src/app/create-app.ts"))};`,
      `export {MetaClient} from ${JSON.stringify(join(workspace, "backend/src/modules/instagram/infrastructure/meta-client.ts"))};`,
      `export {D1RequestPolicy} from ${JSON.stringify(join(workspace, "backend/src/modules/instagram/infrastructure/d1-request-policy.ts"))};`,
      `export {TokenCipher} from ${JSON.stringify(join(workspace, "backend/src/platform/crypto/secrets.ts"))};`,
      `export {createWorker} from ${JSON.stringify(join(workspace, "chatgpt/src/worker.ts"))};`,
      `export {Client} from ${JSON.stringify(chatgptRequire.resolve("@modelcontextprotocol/sdk/client/index.js"))};`,
      `export {StreamableHTTPClientTransport} from ${JSON.stringify(chatgptRequire.resolve("@modelcontextprotocol/sdk/client/streamableHttp.js"))};`,
    ].join("\n"),
  );
  await build({
    entryPoints: [entry],
    outfile: join(temp, "bundle.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    logLevel: "silent",
    banner: {
      js: 'import {createRequire as __createRequire} from "node:module"; const require=__createRequire(import.meta.url);',
    },
  });
  const {
    createApp,
    MetaClient,
    D1RequestPolicy,
    TokenCipher,
    createWorker,
    Client,
    StreamableHTTPClientTransport,
  } = await import(pathToFileURL(join(temp, "bundle.mjs")).href);
  mf = new Miniflare(
    convertV4MiniflareOptions({
      name: "local-verification",
      modules: true,
      script: "export default {fetch(){return new Response('local verification')}}",
      compatibilityDate: "2026-09-01",
      d1Databases: { DB: "quality-check" },
      log: new Log(LogLevel.NONE),
    }),
  );
  const database = await mf.getD1Database("DB");
  const { readdir } = await import("node:fs/promises");
  const migrations = (await readdir(join(workspace, "backend/migrations")))
    .filter((p) => /^\d+_.+\.sql$/.test(p))
    .sort();
  for (const migration of migrations) {
    const text = await readFile(join(workspace, "backend/migrations", migration), "utf8");
    for (const statement of text
      .replaceAll("--> statement-breakpoint", "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await database.prepare(statement).run();
  }
  const apiKey = "local-verification-key-not-a-production-credential";
  let encryptionKey = Buffer.alloc(32).toString("base64"),
    account,
    connection;
  let objects = [],
    historyObject;
  const now = Date.now();
  const fixtureObjects = [
    {
      alias: "R-recent",
      external_id: "17900000000000001",
      published_at: now - 24 * 3600000,
      media_type: "VIDEO",
      product_type: "REELS",
      views: 100,
      reach: 80,
      saved: 0,
      shares: 4,
      total_interactions: 20,
    },
    {
      alias: "R-old",
      external_id: "17900000000000002",
      published_at: now - 40 * 86400000,
      media_type: "VIDEO",
      product_type: "REELS",
      views: 2000,
      reach: 1000,
      saved: 20,
      shares: 5,
      total_interactions: 141,
    },
    {
      alias: "C-parent",
      external_id: "17900000000000003",
      published_at: now - 7 * 86400000,
      media_type: "CAROUSEL_ALBUM",
      product_type: "FEED",
      views: 300,
      reach: 250,
      saved: 4,
      shares: 1,
      total_interactions: 36,
    },
    {
      alias: "S-fixture",
      external_id: "17900000000000004",
      published_at: now - 3600000,
      media_type: "IMAGE",
      product_type: "STORY",
      views: 50,
      reach: 40,
      saved: null,
      shares: 0,
      total_interactions: 2,
    },
  ];
  if (!live)
    fixtureObjects.push(
      {
        alias: "Rank-A",
        external_id: "17900000000000005",
        published_at: now - 7 * 86400000,
        media_type: "VIDEO",
        product_type: "REELS",
        views: 1000,
        reach: 1000,
        saved: 20,
        shares: 5,
        total_interactions: 141,
      },
      {
        alias: "Rank-B",
        external_id: "17900000000000006",
        published_at: now - 7 * 86400000,
        media_type: "VIDEO",
        product_type: "REELS",
        views: 100,
        reach: 100,
        saved: 10,
        shares: 1,
        total_interactions: 123,
      },
    );
  const sourceResponse = (item) => ({
    id: item.external_id,
    caption: "",
    media_type: item.media_type,
    media_product_type: item.product_type,
    permalink: `https://www.instagram.com/${item.product_type === "REELS" ? "reel" : "p"}/fixture/`,
    timestamp: new Date(item.published_at).toISOString(),
    like_count: 100,
    comments_count: 12,
  });
  let liveFetch;
  if (live) {
    const local = await readLocalConfig();
    encryptionKey = local.TOKEN_ENCRYPTION_KEY;
    assert.ok(
      encryptionKey,
      "Local encryption configuration is required for read-only verification.",
    );
    const profilePath =
      process.env.WRANGLER_CONFIG_PATH ??
      join(process.env.HOME, "Library/Preferences/.wrangler/config/social-analytics.toml");
    const profile = await readFile(profilePath, "utf8"),
      credential = profile.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
    assert.ok(credential, "An already authenticated Cloudflare profile is required.");
    const sql = async (statement) => {
      assert.match(statement, /^SELECT\b/i);
      assert.ok(!/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|ATTACH)\b/i.test(statement));
      const r = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${config.account_id}/d1/database/${config.d1_databases[0].database_id}/query`,
        {
          method: "POST",
          redirect: "manual",
          headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
          body: JSON.stringify({ sql: statement }),
          signal: AbortSignal.timeout(30000),
        },
      );
      const data = await r.json();
      if (!r.ok || !data.success)
        throw new Error(
          `Cloudflare read HTTP ${r.status}; codes=${data.errors?.map((e) => e.code).join(",") ?? "unknown"}`,
        );
      return data.result[0].results;
    };
    [account] = await sql("SELECT * FROM accounts LIMIT 1");
    assert.ok(account, "No connected account");
    [connection] = await sql(
      "SELECT account_id,encrypted_token,expires_at,refreshed_at,scopes FROM instagram_connections LIMIT 1",
    );
    assert.equal(connection.account_id, account.id);
    [historyObject] = await sql(
      "SELECT m.id,m.external_id,m.published_at,m.media_type,m.product_type,m.permalink,s.id snapshot_id,s.observed_at,s.api_version,s.metrics_json FROM media m JOIN accounts a ON a.id=m.account_id JOIN media_snapshots s ON s.media_id=m.id WHERE m.product_type='REELS' AND m.published_at<a.connected_at AND abs(s.observed_at-m.published_at-2592000000)<=86400000 AND json_extract(s.metrics_json,'$.saves.value') IS NOT NULL AND json_extract(s.metrics_json,'$.reach.value')>0 ORDER BY abs(s.observed_at-m.published_at-2592000000),s.observed_at DESC LIMIT 1",
    );
    const selections = [
      [
        "R-recent",
        "SELECT id,external_id,published_at,media_type,product_type,permalink FROM media WHERE product_type='REELS' ORDER BY published_at DESC LIMIT 1",
      ],
      [
        "R-old",
        "SELECT m.id,m.external_id,m.published_at,m.media_type,m.product_type,m.permalink FROM media m WHERE m.product_type='REELS' AND EXISTS (SELECT 1 FROM media_snapshots s WHERE s.media_id=m.id AND json_extract(s.metrics_json,'$.reach.value')>0) ORDER BY m.published_at ASC LIMIT 1",
      ],
      [
        "C-parent",
        "SELECT id,external_id,published_at,media_type,product_type,permalink FROM media WHERE media_type='CAROUSEL_ALBUM' ORDER BY published_at DESC LIMIT 1",
      ],
    ];
    for (const [alias, statement] of selections) {
      const [object] = await sql(statement);
      if (object) objects.push({ ...object, alias });
    }
    const cipher = new TokenCipher(encryptionKey),
      token = await cipher.decrypt(connection.encrypted_token, account.id);
    let attempts = 0;
    liveFetch = async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://graph.instagram.com");
      assert.equal(init?.method ?? "GET", "GET");
      assert.ok(url.pathname.startsWith(`/${config.vars.INSTAGRAM_API_VERSION}/`));
      const parts = url.pathname.split("/").filter(Boolean);
      assert.ok(
        parts[1] === "me" ||
          parts[1] === account.external_id ||
          objects.some((o) => o.external_id === parts[1]),
      );
      assert.ok(
        ["me", "insights", "stories"].includes(parts.at(-1)) ||
          objects.some((o) => o.external_id === parts.at(-1)),
      );
      assert.ok(++attempts <= 40, "Bounded live read budget exceeded");
      const response = await fetch(url, {
        ...init,
        redirect: "manual",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
      const body = await response.clone().json();
      sourceCalls.push({
        objectId: parts[1],
        parameters: Object.fromEntries(url.searchParams),
        body,
        status: response.status,
        receivedAt: Date.now(),
        processedVersion:
          response.headers.get("facebook-api-version") ??
          response.headers.get("instagram-api-version"),
      });
      return response;
    };
    const storyResponse = await liveFetch(
      new URL(
        `https://graph.instagram.com/${config.vars.INSTAGRAM_API_VERSION}/${account.external_id}/stories?fields=id,timestamp,media_type,media_product_type,permalink&limit=1`,
      ),
    );
    const story = await storyResponse.json();
    if (storyResponse.ok && story.data?.[0]) {
      const s = story.data[0];
      objects.push({
        alias: "S-live",
        id: `${account.id}_${s.id}`,
        external_id: s.id,
        published_at: Date.parse(s.timestamp),
        media_type: s.media_type,
        product_type: "STORY",
        permalink: s.permalink,
      });
    }
  } else {
    account = {
      id: "ig_17841490000000001",
      external_id: "17841490000000001",
      username: "local_fixture",
      account_type: "MEDIA_CREATOR",
      connected_at: now - 2 * 86400000,
      last_synced_at: null,
    };
    connection = {
      account_id: account.id,
      encrypted_token: await new TokenCipher(encryptionKey).encrypt(
        "local-fixture-token",
        account.id,
      ),
      expires_at: now + 40 * 86400000,
      refreshed_at: now,
      scopes: JSON.stringify(["instagram_business_basic", "instagram_business_manage_insights"]),
    };
    objects = fixtureObjects.map((o) => ({
      ...o,
      id: `${account.id}_${o.external_id}`,
      permalink: sourceResponse(o).permalink,
    }));
  }
  await database
    .prepare(
      "INSERT INTO accounts(id,platform,external_id,username,account_type,connected_at,last_synced_at) VALUES(?,'instagram',?,?,?,?,?)",
    )
    .bind(
      account.id,
      account.external_id,
      account.username,
      account.account_type,
      account.connected_at,
      account.last_synced_at,
    )
    .run();
  await database
    .prepare(
      "INSERT INTO instagram_connections(account_id,encrypted_token,expires_at,refreshed_at,scopes) VALUES(?,?,?,?,?)",
    )
    .bind(
      connection.account_id,
      connection.encrypted_token,
      connection.expires_at,
      connection.refreshed_at,
      connection.scopes,
    )
    .run();
  for (const o of objects)
    await database
      .prepare(
        "INSERT INTO media(id,account_id,external_id,caption,search_text,media_type,product_type,permalink,published_at,updated_at) VALUES(?,?,?,'','',?,?,?,?,?)",
      )
      .bind(
        o.id,
        account.id,
        o.external_id,
        o.media_type,
        o.product_type,
        o.permalink,
        o.published_at,
        now,
      )
      .run();
  const sourceFetch = live
    ? liveFetch
    : async (input) => {
        const url = new URL(String(input)),
          parts = url.pathname.split("/").filter(Boolean),
          object = objects.find((o) => o.external_id === parts[1]);
        let body;
        if (parts[1] === "me")
          body = {
            user_id: account.external_id,
            username: account.username,
            account_type: account.account_type,
            followers_count: 1000,
            media_count: objects.length,
          };
        else if (parts.at(-1) === "insights")
          body = {
            data: (url.searchParams.get("metric") ?? "").split(",").map((name) =>
              name === "navigation"
                ? {
                    name,
                    period: "lifetime",
                    total_value: {
                      breakdowns: [
                        {
                          dimension_keys: ["story_navigation_action_type"],
                          results: [
                            { dimension_values: ["tap_forward"], value: 0 },
                            { dimension_values: ["tap_exit"], value: 2 },
                          ],
                        },
                      ],
                    },
                  }
                : name === "profile_activity"
                  ? {
                      name,
                      period: "lifetime",
                      total_value: {
                        breakdowns: [
                          {
                            dimension_keys: ["action_type"],
                            results: [{ dimension_values: ["profile_links_taps"], value: 0 }],
                          },
                        ],
                      },
                    }
                  : {
                      name,
                      period: "lifetime",
                      values: [
                        {
                          value:
                            object?.[name] ??
                            {
                              likes: 100,
                              comments: 12,
                              reposts: 0,
                              ig_reels_avg_watch_time: 15000,
                              ig_reels_video_view_total_time: 30000000,
                              reels_skip_rate: 25,
                              facebook_views: 0,
                              crossposted_views: 0,
                              replies: 0,
                            }[name] ??
                            null,
                        },
                      ],
                    },
            ),
          };
        else {
          assert.ok(object);
          body = sourceResponse(object);
        }
        sourceCalls.push({
          objectId: parts[1],
          parameters: Object.fromEntries(url.searchParams),
          body,
          status: 200,
          receivedAt: Date.now(),
          processedVersion: "v26.0",
        });
        return Response.json(body, {
          headers: {
            "x-app-usage": '{"call_volume":12,"cpu_time":4}',
            "instagram-api-version": "v26.0",
          },
        });
      };
  const bindings = {
    ...config.vars,
    DB: database,
    API_KEY: apiKey,
    TOKEN_ENCRYPTION_KEY: encryptionKey,
    INSTAGRAM_CLIENT_ID: "local-verification",
    INSTAGRAM_CLIENT_SECRET: "local-verification",
  };
  const app = createApp({
    instagram: {
      transport: (c) => new MetaClient(c, sourceFetch, { policy: new D1RequestPolicy(database) }),
    },
  });
  const worker = createWorker(async (request) => {
    localCalls.push({ method: request.method, path: new URL(request.url).pathname });
    return app.fetch(request, bindings);
  });
  const client = new Client({ name: "local-full-path-verification", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("https://local.example.test/mcp"), {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        request.headers.set("oai-authenticated-user-email", "owner@example.test");
        return worker.fetch(request, {
          SOCIAL_API_KEY: apiKey,
          SOCIAL_OWNER_EMAIL: "owner@example.test",
        });
      },
    }),
  );
  const results = [];
  try {
    for (const o of objects) {
      const refreshed = await client.callTool({
        name: "refresh_media",
        arguments: { mediaId: o.id, body: { operationId: randomUUID() } },
      });
      if (refreshed.isError) {
        results.push({
          alias: o.alias,
          status: "source_unavailable",
          code: refreshed.structuredContent?.code ?? "unknown",
        });
        continue;
      }
      const reportResult = await client.callTool({
        name: "get_media_report",
        arguments: { mediaId: o.id },
      });
      assert.notEqual(reportResult.isError, true, "New MCP must accept the backend report");
      const report = reportResult.structuredContent.data;
      const row = await database
        .prepare(
          "SELECT id,observed_at,metrics_json,provenance_json FROM media_snapshots WHERE media_id=? ORDER BY observed_at DESC,id DESC LIMIT 1",
        )
        .bind(o.id)
        .first();
      const saved = JSON.parse(row.metrics_json);
      assert.deepEqual(report.metrics, saved);
      assert.deepEqual(report.observation, JSON.parse(row.provenance_json));
      assert.equal(report.source.observedAt, row.observed_at);
      const verified = [],
        fieldEvidence = [];
      for (const [key, m] of Object.entries(saved)) {
        if (m.value === null || !m.provenance) continue;
        const receipt = await database
          .prepare("SELECT payload_json FROM instagram_http_attempts WHERE id=?")
          .bind(m.provenance.receiptId)
          .first();
        assert.ok(receipt, `Missing receipt for ${key}`);
        const proof = JSON.parse(receipt.payload_json);
        const match = sourceCalls.find(
          (call) =>
            call.objectId === o.external_id &&
            call.status === 200 &&
            call.parameters.metric === proof.parameters.metric &&
            call.parameters.fields === proof.parameters.fields &&
            call.receivedAt >= proof.requestStartedAt &&
            call.receivedAt <= proof.responseReceivedAt,
        );
        assert.ok(match, `No captured response for ${key}`);
        const field = match.body.data?.find((v) => v.name === m.sourceField),
          raw = field?.total_value?.value ?? field?.values?.[0]?.value ?? match.body[m.sourceField];
        assert.equal(m.value, raw, `Source → receipt → D1 → MCP mismatch for ${key}`);
        assert.equal(m.provenance.responseReceivedAt, proof.responseReceivedAt);
        fieldEvidence.push({
          metric: key,
          sourceField: m.sourceField,
          value: raw,
          unit: m.unit,
          parameters: proof.parameters,
          requestStartedAt: proof.requestStartedAt,
          responseReceivedAt: proof.responseReceivedAt,
          httpStatus: proof.httpStatus,
          actualApiVersion: proof.actualApiVersion,
          definitionVersion: m.provenance.definitionVersion,
          surface: m.provenance.surface,
          distribution: m.provenance.distribution,
          receiptVerified: true,
          d1EqualsMcp: true,
        });
        verified.push(key);
      }
      results.push({
        alias: o.alias,
        productType: o.product_type,
        mediaType: o.media_type,
        publicationAgeDays: Math.round(((Date.now() - o.published_at) / 86400000) * 10) / 10,
        verified,
        fieldEvidence,
        views: report.metrics.views.value,
        reach: report.metrics.reach.value,
        nativeInteractions: report.interactionComponents.native,
        componentSum: report.interactionComponents.sum,
        definition: report.observation?.definitionVersion ?? null,
        sourceVersions: [
          ...new Set(
            sourceCalls.filter((c) => c.objectId === o.external_id).map((c) => c.processedVersion),
          ),
        ],
        structuredNavigation: report.storyInsights?.navigation ?? null,
      });
    }
    let historyEvidence = null;
    if (live && historyObject) {
      const h = historyObject;
      if (!objects.some((o) => o.id === h.id)) {
        await database
          .prepare(
            "INSERT INTO media(id,account_id,external_id,caption,search_text,media_type,product_type,permalink,published_at,updated_at) VALUES(?,?,?,'','',?,?,?,?,?)",
          )
          .bind(
            h.id,
            account.id,
            h.external_id,
            h.media_type,
            h.product_type,
            h.permalink,
            h.published_at,
            now,
          )
          .run();
        objects.push({ ...h, alias: "R-history-30d" });
      }
      await database
        .prepare(
          "INSERT INTO media_snapshots(id,media_id,observed_at,api_version,metrics_json) VALUES(?,?,?,?,?)",
        )
        .bind(h.snapshot_id, h.id, h.observed_at, h.api_version, h.metrics_json)
        .run();
      const legacy = await client.callTool({
        name: "analyze_content",
        arguments: {
          accountId: account.id,
          productType: "REELS",
          metric: "saves",
          ageDays: 30,
          rankingMode: "per_100_reach",
          timeZone: "UTC",
        },
      });
      assert.notEqual(legacy.isError, true);
      const item = legacy.structuredContent.data.items.find((i) => i.media.id === h.id),
        source = JSON.parse(h.metrics_json);
      assert.equal(item.snapshot.id, h.snapshot_id);
      assert.equal(item.snapshot.observedAt, h.observed_at);
      assert.equal(item.rankingValue, (100 * source.saves.value) / source.reach.value);
      assert.equal(item.comparisonCriteria.definitionVersion, null);
      historyEvidence = {
        kind: "existing_real_D1_observation_to_new_backend_MCP_not_a_Meta_history_reconstruction",
        publishedBeforeConnection: h.published_at < account.connected_at,
        actualAgeDays: (h.observed_at - h.published_at) / 86400000,
        observedAt: h.observed_at,
        saves: source.saves.value,
        reach: source.reach.value,
        value: item.rankingValue,
        definitionVersion: item.comparisonCriteria.definitionVersion,
        analysisCoverage: legacy.structuredContent.data.coverage.analysisCoverage,
        collectionObligations: legacy.structuredContent.data.coverage.collectionObligations,
      };
    }
    const before = sourceCalls.length;
    const analysis = await client.callTool({
      name: "analyze_content",
      arguments: {
        accountId: account.id,
        productType: "REELS",
        metric: "saves",
        ageDays: live ? 1 : 7,
        rankingMode: "per_100_reach",
        timeZone: "UTC",
      },
    });
    assert.notEqual(analysis.isError, true, "Relative ranking must pass actual backend and MCP");
    const ranking = analysis.structuredContent.data;
    const rankingEvidence = {
      mode: ranking.input.rankingMode,
      coverage: ranking.coverage,
      items: ranking.items.map((i) => ({
        alias: objects.find((o) => o.id === i.media.id)?.alias ?? "fixture",
        value: i.rankingValue,
        n: i.sampleSize,
        baseline: i.baseline,
        reason: i.ranking.reason,
      })),
      groups: ranking.groups.map((g) => ({
        dimension: g.dimension,
        mediaType: g.mediaType,
        sampleSize: g.sampleSize,
        examined: g.examined,
        paired: g.paired,
        excludedByReason: g.excludedByReason,
      })),
    };
    if (!live) {
      const b = ranking.items.find(
          (i) => objects.find((o) => o.id === i.media.id)?.alias === "Rank-B",
        ),
        a = ranking.items.find((i) => objects.find((o) => o.id === i.media.id)?.alias === "Rank-A");
      assert.equal(b.rankingValue, 10);
      assert.equal(a.rankingValue, 2);
      assert.ok(ranking.items.indexOf(b) < ranking.items.indexOf(a));
      assert.equal(b.sampleSize, 1);
      const absolute = await client.callTool({
        name: "analyze_content",
        arguments: {
          accountId: account.id,
          productType: "REELS",
          metric: "saves",
          ageDays: 7,
          rankingMode: "absolute",
          timeZone: "UTC",
        },
      });
      assert.notEqual(absolute.isError, true);
      assert.equal(
        objects.find((o) => o.id === absolute.structuredContent.data.items[0].media.id)?.alias,
        "Rank-A",
      );
      rankingEvidence.absoluteLeader = "Rank-A";
      rankingEvidence.relativeLeader = "Rank-B";
    }

    let pagingVerification = null;
    if (!live) {
      // Local fixtures only: walk actual backend -> Zod -> MCP pages, not a
      // fabricated MCP response. Neither this branch nor status calls Meta.
      await database.batch(
        Array.from({ length: 137 }, (_, i) =>
          database
            .prepare(
              "INSERT INTO collection_jobs(id,account_id,origin,status,started_at,next_attempt_at) VALUES(?,?,'scheduled','running',?,?)",
            )
            .bind(
              `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
              account.id,
              now - i * 1000,
              now,
            ),
        ),
      );
      const jobs = [];
      let cursor,
        cutoff,
        jobPages = 0;
      do {
        const result = await client.callTool({
          name: "get_collection_status",
          arguments: { accountId: account.id, limit: 20, ...(cursor ? { cursor } : {}) },
        });
        assert.notEqual(result.isError, true);
        const page = result.structuredContent.data;
        cutoff ??= page.jobsPage.cutoff;
        assert.equal(page.jobsPage.cutoff, cutoff);
        const sql = await database
          .prepare("SELECT COUNT(*) n FROM collection_jobs WHERE account_id=? AND started_at<=?")
          .bind(account.id, cutoff)
          .first();
        assert.equal(page.jobsPage.total, sql.n);
        assert.equal(
          page.jobsPage.aggregates.reduce((n, a) => n + a.count, 0),
          sql.n,
        );
        jobs.push(...page.jobs.map((j) => j.id));
        jobPages++;
        cursor = page.jobsPage.nextCursor;
        assert.equal(page.jobsPage.hasMore, cursor !== null);
        if (jobPages === 1)
          await database
            .prepare("UPDATE collection_jobs SET status='completed' WHERE id=?")
            .bind("00000000-0000-4000-8000-000000000100")
            .run();
      } while (cursor);
      assert.equal(jobs.length, 137);
      assert.equal(new Set(jobs).size, 137);
      await database.batch(
        Array.from({ length: 130 }, (_, i) =>
          database
            .prepare(
              "INSERT INTO media(id,account_id,external_id,caption,search_text,media_type,product_type,permalink,published_at,updated_at) VALUES(?,?,?,'','',?,'FEED',?,?,?)",
            )
            .bind(
              `catalogue-fixture-${i}`,
              account.id,
              `17800000000000${String(i).padStart(3, "0")}`,
              i % 3 === 0 ? "CAROUSEL_ALBUM" : i % 3 === 1 ? "IMAGE" : "VIDEO",
              `https://www.instagram.com/p/catalogue-fixture-${i}/`,
              now - i * 1000,
              now,
            ),
        ),
      );
      const catalogue = [];
      let cataloguePages = 0;
      cursor = null;
      do {
        const result = await client.callTool({
          name: "search_media",
          arguments: { accountId: account.id, limit: 20, ...(cursor ? { cursor } : {}) },
        });
        assert.notEqual(result.isError, true);
        const page = result.structuredContent.data;
        catalogue.push(...page.items.map((m) => m.id));
        cataloguePages++;
        cursor = page.nextCursor;
      } while (cursor);
      const sql = await database
        .prepare("SELECT COUNT(*) n FROM media WHERE account_id=?")
        .bind(account.id)
        .first();
      assert.equal(catalogue.length, sql.n);
      assert.equal(new Set(catalogue).size, sql.n);
      pagingVerification = {
        mode: "local fixtures through actual backend and MCP SDK",
        jobs: {
          total: 137,
          pages: jobPages,
          unique: new Set(jobs).size,
          statusChangedBetweenPages: true,
          cutoff,
        },
        catalogue: { total: sql.n, pages: cataloguePages, unique: new Set(catalogue).size },
        sqlAggregatesAgree: true,
      };
    }
    const status = await client.callTool({
      name: "get_collection_status",
      arguments: { accountId: account.id, limit: 20 },
    });
    assert.notEqual(status.isError, true);
    assert.equal(sourceCalls.length, before, "A status read must never collect");
    assert.ok(status.structuredContent.data.coverage.analysisCoverage.length > 0);
    assert.ok(
      status.structuredContent.data.coverage.analysisCoverage.every(
        (window) => window.metric === "reach" && window.rankingMode === "absolute",
      ),
      "Status must identify the measured coverage metric through OpenAPI, Zod and MCP",
    );
    const summary = {
      mode: live ? "bounded-live-GET-local-D1-and-MCP" : "recorded-fixture-local-full-path",
      checkedAt: new Date().toISOString(),
      requestedApiVersion: config.vars.INSTAGRAM_API_VERSION,
      login: "instagram_login",
      verifiedBuild: {
        backendRevision: config.vars.BUILD_REVISION,
        mcpVersion: JSON.parse(await readFile(join(workspace, "chatgpt/package.json"), "utf8"))
          .version,
        bundleSha256: createHash("sha256")
          .update(await readFile(join(temp, "bundle.mjs")))
          .digest("hex"),
        deployment: "local ephemeral D1/backend/MCP; production code not deployed by this check",
      },
      migrations,
      objects: results,
      story: objects.some((o) => o.product_type === "STORY")
        ? "verified"
        : "No currently available Story; recorded fixture tests cover normalization separately",
      sourceRequests: sourceCalls.length,
      localBackendRequests: localCalls.length,
      ranking: rankingEvidence,
      existingHistory30d: historyEvidence,
      quota: status.structuredContent.data.api,
      jobsPage: status.structuredContent.data.jobsPage,
      coverage: status.structuredContent.data.coverage,
      pagingVerification,
    };
    // Only scalar diagnostics and de-identified examples; no names, captions,
    // raw headers, tokens, signed URLs or source object identifiers.
    const artifact = join(
      workspace,
      live
        ? "docs/instagram-data-implementation-live-evidence.json"
        : "docs/instagram-data-implementation-evidence.json",
    );
    await writeFile(artifact, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(
      JSON.stringify({
        mode: summary.mode,
        sourceRequests: summary.sourceRequests,
        objects: results.map((r) => ({
          alias: r.alias,
          status: r.status ?? "verified",
          verifiedFields: r.verified?.length ?? 0,
        })),
        artifact: live
          ? "docs/instagram-data-implementation-live-evidence.json"
          : "docs/instagram-data-implementation-evidence.json",
        story: summary.story,
      }),
    );
  } finally {
    await client.close();
  }
} finally {
  await mf?.dispose();
  await rm(temp, { recursive: true, force: true });
}
