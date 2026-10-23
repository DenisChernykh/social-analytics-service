import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(new URL("../package.json", import.meta.url));
const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = createRequire(
  require.resolve("wrangler"),
)("miniflare");
const { build } = createRequire(new URL("../../chatgpt/package.json", import.meta.url))("esbuild");
const baseline = "52b8be296d4fbe803f0045778187d8b2002477e4";
const now = Date.parse("2026-10-23T08:00:00Z");
const accountId = "status-benchmark";
const metrics = [
  "views",
  "reach",
  "accounts_engaged",
  "total_interactions",
  "likes",
  "comments",
  "saves",
  "shares",
  "replies",
  "profile_links_taps",
  "follows_and_unfollows",
  "reposts",
];
const mf = new Miniflare(
  convertV4MiniflareOptions({
    name: "status-counter-benchmark",
    modules: true,
    compatibilityDate: "2026-09-01",
    d1Databases: { DB: "status-counter-benchmark" },
    log: new Log(LogLevel.NONE),
    script: `export default {async fetch(request,env){const {sql,params=[],batch}=await request.json();try{return Response.json(batch?await env.DB.batch(batch.map(s=>env.DB.prepare(s.sql).bind(...s.params))):await env.DB.prepare(sql).bind(...params).all())}catch(error){return Response.json({error:String(error)}, {status:500})}}};`,
  }),
);
let measured = [];
async function query(sql, params = []) {
  const response = await mf.dispatchFetch("http://fixture/sql", {
    method: "POST",
    body: JSON.stringify({ sql, params }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  if (result.meta)
    measured.push({ sql, rowsRead: result.meta.rows_read, rowsWritten: result.meta.rows_written });
  return result;
}
function statement(sql, params = []) {
  return {
    sql,
    params,
    bind: (...values) => statement(sql, values),
    all: () => query(sql, params),
    run: () => query(sql, params),
    first: async (column) => {
      const row = (await query(sql, params)).results[0];
      return row ? (column ? row[column] : row) : null;
    },
    raw: async (options) => {
      const rows = (await query(sql, params)).results;
      return options?.columnNames
        ? [Object.keys(rows[0] ?? {}), ...rows.map(Object.values)]
        : rows.map(Object.values);
    },
  };
}
const db = {
  prepare: statement,
  batch: async (statements) => {
    const response = await mf.dispatchFetch("http://fixture/sql", {
      method: "POST",
      body: JSON.stringify({ batch: statements.map(({ sql, params }) => ({ sql, params })) }),
    });
    const results = await response.json();
    if (!response.ok) throw new Error(results.error);
    for (const [i, result] of results.entries())
      measured.push({
        sql: statements[i].sql,
        rowsRead: result.meta.rows_read,
        rowsWritten: result.meta.rows_written,
      });
    return results;
  },
};
async function reader(historical) {
  const entry = `import {D1Collection} from './backend/src/modules/collection/infrastructure/d1-collection.ts';
  import {D1Insights} from './backend/src/modules/account-insights/infrastructure/d1-insights.ts';
  import {D1RequestPolicy} from './backend/src/modules/instagram/infrastructure/d1-request-policy.ts';
  import {quotaObservation} from './backend/src/modules/instagram/domain/request-policy.ts';
  export async function writeHttp(db,account,now) {const p=new D1RequestPolicy(db);const a={id:crypto.randomUUID(),accountId:account,operationId:null,objectId:'10000',endpointFamily:'insights',parameters:{},requestStartedAt:now-100,responseReceivedAt:null,failedAt:null,requestedApiVersion:'v26.0',actualApiVersion:null,login:'instagram_login',httpStatus:null,graphCode:null,graphSubcode:null,result:'pending',sample:null};await p.beginAttempt(a);a.responseReceivedAt=now-90;a.httpStatus=200;a.result='success';await p.finishAttempt(a,quotaObservation({retryAfter:null,appUsage:null,businessUsage:null},now));}
  export async function read(db,account,now) {const s=new D1Collection(db);return {
    jobs:await s.jobPage(account,{limit:20},now),dataFreshness:await s.dataFreshness(account),
    diagnostics:await s.diagnostics(account,now),mediaRefresh:await s.mediaRefreshStatus(account,now),
    comments:await s.commentStatus(account,now),coverage:await s.coverage(account,now),
    periods:await new D1Insights(db).periodObservations(account,'UTC','v26.0',now-90*86400000),
    api:await new D1RequestPolicy(db).status(account,'v26.0',now)}};`;
  const result = await build({
    stdin: { contents: entry, resolveDir: root, loader: "ts" },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node24",
    plugins: historical
      ? [
          {
            name: "verified-baseline",
            setup(builder) {
              builder.onLoad(
                {
                  filter:
                    /\/modules\/(?:collection\/infrastructure\/d1-collection|account-insights\/infrastructure\/d1-insights|instagram\/infrastructure\/d1-request-policy)\.ts$/,
                },
                (args) => ({
                  contents: execFileSync(
                    "git",
                    ["show", `${baseline}:${relative(root, args.path)}`],
                    { cwd: root, encoding: "utf8" },
                  ),
                  resolveDir: dirname(args.path),
                  loader: "ts",
                }),
              );
            },
          },
        ]
      : [],
  });
  return await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}
const summary = () => ({
  queries: measured.length,
  rowsRead: measured.reduce((n, q) => n + q.rowsRead, 0),
  rowsWritten: measured.reduce((n, q) => n + q.rowsWritten, 0),
});
async function migrate(file) {
  for (const sql of (
    await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8")
  ).split("--> statement-breakpoint"))
    if (sql.trim()) await query(sql);
}
try {
  const migrations = (await readdir(new URL("../migrations/", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of migrations.filter((f) => f < "0016_")) await migrate(file);
  await query(
    "INSERT INTO accounts(id,platform,external_id,username,account_type,connected_at) VALUES(?,'instagram','123','fixture','MEDIA_CREATOR',?)",
    [accountId, now - 90 * 86400000],
  );
  const media = Array.from({ length: 250 }, (_, i) => ({
    id: `media-${i}`,
    externalId: String(10000 + i),
    publishedAt: now - 60 * 86400000 + i * 3600000,
    product: i >= 245 ? "STORY" : "FEED",
  }));
  await query(
    "INSERT INTO media(id,account_id,external_id,caption,search_text,media_type,product_type,permalink,published_at,updated_at,first_discovered_at,discovery_source) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.externalId'),'','','IMAGE',json_extract(value,'$.product'),'https://example.test/',json_extract(value,'$.publishedAt'),?,json_extract(value,'$.publishedAt')+300000,'collection' FROM json_each(?)",
    [accountId, now, JSON.stringify(media)],
  );
  const snapshotMetrics = JSON.stringify(
    Object.fromEntries(
      [
        "views",
        "reach",
        "likes",
        "comments",
        "saves",
        "shares",
        "reposts",
        "totalInteractions",
        "totalWatchTimeMs",
        "averageWatchTimeMs",
        "skipRate",
        "facebookViews",
        "crosspostedViews",
        "follows",
        "profileVisits",
      ].map((key, i) => [key, { value: i, reason: null }]),
    ),
  );
  const snapshots = media.flatMap((m) =>
    Array.from({ length: 30 }, (_, i) => ({
      id: `${m.id}-snapshot-${i}`,
      mediaId: m.id,
      at: m.publishedAt + i * 3600000,
      legacy: i % 2 === 0,
    })),
  );
  await query(
    "INSERT INTO media_snapshots(id,media_id,observed_at,api_version,metrics_json,provenance_json) SELECT json_extract(value,'$.id'),json_extract(value,'$.mediaId'),json_extract(value,'$.at'),'v26.0',?,CASE WHEN json_extract(value,'$.legacy') THEN NULL ELSE '{}' END FROM json_each(?)",
    [snapshotMetrics, JSON.stringify(snapshots)],
  );
  const attempts = media.flatMap((m) =>
    Array.from({ length: 30 }, (_, i) => ({
      id: `${m.id}-attempt-${i}`,
      objectId: m.externalId,
      at: now - 50000 + i,
      result: i % 3 === 0 ? "source_error" : "success",
    })),
  );
  await query(
    "INSERT INTO instagram_http_attempts(id,account_id,object_id,requested_at,received_at,payload_json) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.objectId'),json_extract(value,'$.at'),json_extract(value,'$.at')+1,json_object('result',json_extract(value,'$.result'),'requestedApiVersion','v26.0') FROM json_each(?)",
    [accountId, JSON.stringify(attempts)],
  );
  await query(
    "INSERT INTO instagram_api_state(id,account_id,api_version,since_at,observed_at) VALUES(?,?,'v26.0',?,?)",
    [JSON.stringify([accountId, "v26.0"]), accountId, now, now],
  );
  const insights = Array.from({ length: 1600 }, (_, i) => ({
    id: `insight-${i}`,
    at: now - 10000 + i,
    from: now - ((i % 90) + 1) * 86400000,
    to: now - (i % 90) * 86400000,
  }));
  await query(
    "INSERT INTO account_insights(id,account_id,signature,observed_at,payload_json) SELECT json_extract(value,'$.id'),?,'fixture',json_extract(value,'$.at'),json_object('status','completed','apiVersion','v26.0','input',json_object('kind','activity','from',json_extract(value,'$.from'),'to',json_extract(value,'$.to'),'timeZone','UTC','metricType','total_value','metrics',json(?)),'values',json('[]')) FROM json_each(?)",
    [accountId, JSON.stringify(metrics), JSON.stringify(insights)],
  );
  const jobs = Array.from({ length: 1200 }, (_, i) => ({
    id: `job-${String(i).padStart(4, "0")}`,
    at: now - Math.floor(i / 10) * 86400000 - 100000 + i,
    origin: ["stories", "manual", "comments", "activity", "catalogue", "audience"][i % 6],
    status: i < 3 ? "running" : i % 19 === 0 ? "failed" : "completed",
  }));
  await query(
    "INSERT INTO collection_jobs(id,account_id,origin,status,started_at,next_attempt_at,last_attempt_at,last_success_at,last_useful_observation_at,completed_at,cursor) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.origin'),json_extract(value,'$.status'),json_extract(value,'$.at'),json_extract(value,'$.at'),json_extract(value,'$.at'),json_extract(value,'$.at'),json_extract(value,'$.at'),CASE WHEN json_extract(value,'$.status')!='running' THEN json_extract(value,'$.at') END,'{\"parents\":[\"pending\"]}' FROM json_each(?)",
    [accountId, JSON.stringify(jobs)],
  );
  const comments = Array.from({ length: 3000 }, (_, i) => ({
    id: `comment-${i}`,
    mediaId: media[i % 250].id,
  }));
  await query(
    "INSERT INTO comments(id,media_id,text,published_at,observed_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.mediaId'),'fixture',?,? FROM json_each(?)",
    [now, now, JSON.stringify(comments)],
  );
  const oldReader = await reader(true),
    newReader = await reader(false);
  async function sampleWrites(prefix) {
    await query(
      "INSERT INTO media_snapshots(id,media_id,observed_at,api_version,metrics_json,provenance_json) VALUES(?,'media-0',?,'v26.0',?,'{}')",
      [`${prefix}-snapshot`, now - 100, snapshotMetrics],
    );
    await query(
      "INSERT INTO account_insights(id,account_id,signature,observed_at,payload_json) SELECT ?,account_id,signature,observed_at,payload_json FROM account_insights WHERE id='insight-0'",
      [`${prefix}-insight`],
    );
    await query(
      "INSERT INTO collection_jobs(id,account_id,origin,status,started_at,next_attempt_at,completed_at) VALUES(?,?,'manual','completed',?,?,?)",
      [`${prefix}-job`, accountId, now - 100, now - 100, now - 90],
    );
    await query(
      "INSERT INTO comments(id,media_id,text,published_at,observed_at) VALUES(?,'media-0','fixture',?,?)",
      [`${prefix}-comment`, now, now],
    );
  }
  measured = [];
  await oldReader.writeHttp(db, accountId, now);
  const beforeHttp = summary();
  measured = [];
  await sampleWrites("write-before");
  const beforeWrites = summary();
  measured = [];
  const before = await oldReader.read(db, accountId, now);
  const beforeCost = summary();
  measured = [];
  await migrate(migrations.find((f) => f.startsWith("0016_")));
  const backfill = summary();
  measured = [];
  const after = await newReader.read(db, accountId, now);
  const afterCost = summary();
  const statusQueries = [...measured];
  // SQL GROUP BY and map iteration may list equivalent intervals differently.
  before.periods.sort((a, b) => a.from - b.from || a.to - b.to);
  after.periods.sort((a, b) => a.from - b.from || a.to - b.to);
  assert.deepEqual(after, before, "The backfilled status must equal the historical calculation");
  assert.equal(afterCost.rowsWritten, 0, "Status reads must not write");
  assert(
    !statusQueries.some((q) => /\b(media_snapshots|instagram_http_attempts)\b/.test(q.sql)),
    "Status must not query snapshot/receipt history",
  );
  assert(
    afterCost.rowsRead > 0 && afterCost.rowsRead < beforeCost.rowsRead,
    "The native rows_read counter must demonstrate reduced reads",
  );
  const result = {
    checkedAt: new Date().toISOString(),
    baselineCommit: baseline,
    fixture: {
      publications: media.length,
      snapshots: snapshots.length,
      receipts: attempts.length,
      jobs: jobs.length,
      insights: insights.length,
      comments: comments.length,
    },
    before: beforeCost,
    after: afterCost,
    backfill,
    statusEqual: true,
    readReductionPercent: 100 * (1 - afterCost.rowsRead / beforeCost.rowsRead),
    statusQueries,
  };
  measured = [];
  await newReader.writeHttp(db, accountId, now);
  result.httpWrites = { before: beforeHttp, after: summary() };
  assert.equal(
    result.httpWrites.after.rowsWritten,
    beforeHttp.rowsWritten,
    "HTTP freshness must share the existing writes",
  );
  measured = [];
  await sampleWrites("write-after");
  result.collectionWrites = {
    before: beforeWrites,
    after: summary(),
    scenario:
      "one new snapshot, one completed activity collection, one completed job and one new unique comment",
  };
  measured = [];
  await newReader.read(db, accountId, now);
  result.beforeDoubleSnapshotHistory = summary();
  await query(
    "INSERT INTO media_snapshots(id,media_id,observed_at,api_version,metrics_json,provenance_json) SELECT id||'-growth',media_id,observed_at,api_version,metrics_json,provenance_json FROM media_snapshots WHERE id NOT LIKE 'write-%'",
  );
  measured = [];
  await newReader.read(db, accountId, now);
  result.afterDoubleSnapshotHistory = summary();
  assert.equal(
    result.afterDoubleSnapshotHistory.rowsRead,
    result.beforeDoubleSnapshotHistory.rowsRead,
    "Status reads must not grow with snapshot history",
  );
  // Simulate a request from the old Worker during schema/code cutover.
  await oldReader.writeHttp(db, accountId, now + 10000);
  const catchup = await readFile(
    new URL("status-counters-http-catchup.sql", import.meta.url),
    "utf8",
  );
  measured = [];
  await query(catchup);
  const catchupCost = summary();
  const expectedFreshness = { lastAttempt: now + 9900, lastCheck: now + 9910 };
  const checkFreshness = async () => {
    const row = await query(
      "SELECT json_extract(object_freshness_json,'$.\"10000\"') value FROM instagram_api_state WHERE account_id=? AND api_version='v26.0'",
      [accountId],
    );
    assert.deepEqual(JSON.parse(row.results[0].value), expectedFreshness);
  };
  await checkFreshness();
  await query("DELETE FROM instagram_http_attempts WHERE account_id=? AND object_id='10000'", [
    accountId,
  ]);
  await query(catchup);
  await checkFreshness();
  result.cutover = {
    legacyWriterGapReconciled: true,
    freshnessSurvivesReceiptPruning: true,
    catchupCost,
  };
  const destination = process.argv[2];
  if (destination) await writeFile(destination, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ ...result, statusQueries: undefined }));
} catch (error) {
  console.error(error instanceof Error ? error.message.slice(0, 2000) : "Benchmark failed");
  process.exitCode = 1;
} finally {
  await mf.dispose();
}
