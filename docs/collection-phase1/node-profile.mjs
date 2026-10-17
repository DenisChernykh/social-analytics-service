import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import { collectionCases, phase1AccountId, phase1ApiKey } from '../../backend/test/collection-phase1-fixtures.ts';
import { createWorker } from '../../chatgpt/src/worker.ts';
import { reportResponse } from '../../chatgpt/src/contract.ts';

const root = new URL('../../', import.meta.url);
const sdk = createRequire(new URL('chatgpt/package.json', root));
const { Client } = sdk('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = sdk('@modelcontextprotocol/sdk/client/streamableHttp.js');
const cpu = () => { const c = process.threadCpuUsage(); return c.user + c.system; };
const p = (a, q) => [...a].sort((x, y) => x - y)[Math.max(0, Math.ceil(a.length * q) - 1)];
const distribution = (a) => ({ n: a.length, p50: p(a, .5), p95: p(a, .95), min: Math.min(...a), max: Math.max(...a) });
const migrations = (await readdir(new URL('backend/migrations/', root))).filter((s) => s.endsWith('.sql')).sort();
const report = {
  environment: { node: process.version, cpu: os.cpus()[0].model, method: 'Warm Node main-thread CPU, real application/HTTP/report path and synchronous SQLite D1 shim. SQL CPU measured separately. Not billed Cloudflare CPU; synthetic provider latency excluded.' },
  warmup: 5, samplesPerCase: 40, scenarios: [], mcp: [],
};

class DB {
  sqlite = new DatabaseSync(':memory:');
  depth = 0; d1BindingCalls = 0; sqlStatements = 0; sqlCpuMs = 0;
  prepare(sql) {
    const db = this;
    return new class {
      values = [];
      bind(...values) { this.values = values; return this; }
      execute(raw = false) {
        const start = cpu(); db.sqlStatements++; if (!db.depth) db.d1BindingCalls++;
        const statement = db.sqlite.prepare(sql); statement.setReturnArrays(raw);
        const hasRows = statement.columns().length > 0;
        const results = hasRows ? statement.all(...this.values) : [];
        const meta = hasRows ? { changes: db.sqlite.prepare('SELECT changes() AS n').get().n } : statement.run(...this.values);
        db.sqlCpuMs += (cpu() - start) / 1000;
        return { results, success: true, meta: { changes: Number(meta.changes ?? 0) } };
      }
      async all() { return this.execute(); } async raw() { return this.execute(true).results; }
      async run() { return this.execute(); } async first(column) { const row = this.execute().results[0] ?? null; return column ? row?.[column] ?? null : row; }
    };
  }
  async batch(statements) {
    this.d1BindingCalls++; this.depth++; this.sqlite.exec('SAVEPOINT phase1');
    try { const result = await Promise.all(statements.map((s) => s.all())); this.sqlite.exec('RELEASE phase1'); return result; }
    catch (error) { this.sqlite.exec('ROLLBACK TO phase1'); this.sqlite.exec('RELEASE phase1'); throw error; }
    finally { this.depth--; }
  }
}

async function mcpCheck(runner, expected) {
  const owner = 'phase1@example.test';
  const worker = createWorker(async (request) => {
    const u = new URL(request.url);
    return runner.request(u.pathname + u.search, request.method);
  });
  const client = new Client({ name: 'phase1-real-backend-verification', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL('https://site.example.test/mcp'), {
    fetch: async (input, init) => {
      const request = new Request(input, init); request.headers.set('oai-authenticated-user-email', owner);
      return worker.fetch(request, { SOCIAL_API_KEY: phase1ApiKey, SOCIAL_OWNER_EMAIL: owner });
    },
  }));
  try {
    for (const [i, report] of expected.reports.entries()) {
      const canonical = reportResponse.parse(report);
      const result = await client.callTool({ name: 'get_media_report', arguments: { mediaId: `${phase1AccountId}_${runner.media[i].id}` } });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      assert.deepEqual(result.structuredContent.data.metrics, report.metrics);
      assert.deepEqual(result.structuredContent.data.calculated, report.calculated);
      assert.deepEqual(result.structuredContent.data.observation, report.observation);
      assert.deepEqual(result.structuredContent.data.storyInsights, canonical.storyInsights);
    }
    return { reportsChecked: expected.reports.length, exactMetricsAndReceipts: true, backend: 'actual local app + SQLite', transport: 'actual MCP Client/StreamableHTTP adapter; no external calls' };
  } finally { await client.close(); }
}

for (const version of ['before', 'after']) {
  const h = await import(new URL(`tmp/collection-phase1/${version}-node.mjs`, root));
  const db = new DB(); db.sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of migrations) db.sqlite.exec(await readFile(new URL(`backend/migrations/${file}`, root), 'utf8'));
  for (const scenario of collectionCases) {
    const samples = []; let example, check;
    for (let i = -report.warmup; i < report.samplesPerCase; i++) {
      db.sqlite.exec('DELETE FROM accounts');
      const runner = await h.scenarioRunner(db, scenario);
      db.d1BindingCalls = 0; db.sqlStatements = 0; db.sqlCpuMs = 0;
      const start = cpu(), wall = performance.now();
      const result = await h.exerciseScenario(runner);
      const sample = { cpuMs: (cpu() - start) / 1000, wallMs: performance.now() - wall, sqlCpuMs: db.sqlCpuMs, d1BindingCalls: db.d1BindingCalls, sqlStatements: db.sqlStatements };
      sample.nonSqlCpuMs = sample.cpuMs - sample.sqlCpuMs;
      const snapshotCount = db.sqlite.prepare('SELECT COUNT(*) AS n FROM media_snapshots').get().n;
      assert.equal(snapshotCount, result.statuses.at(-1) === 200 ? scenario.mediaCount ?? 1 : 0);
      assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM instagram_http_attempts').get().n, result.attempts);
      if (i >= 0) samples.push(sample);
      if (i === 0) {
        example = result;
        check = await mcpCheck(runner, result);
      }
    }
    const summary = Object.fromEntries(['cpuMs', 'nonSqlCpuMs', 'sqlCpuMs', 'wallMs', 'd1BindingCalls', 'sqlStatements'].map((key) => [key, distribution(samples.map((s) => s[key]))]));
    report.scenarios.push({ version, case: scenario.name, example, samples, summary });
    report.mcp.push({ version, case: scenario.name, ...check });
    await writeFile(new URL('docs/collection-phase1/node-results.json', root), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ version, case: scenario.name, attempts: example.attempts, core: example.coreNumbers, pairs: [example.savesReachPairs, example.sharesReachPairs], deferred: example.deferred, additional: example.additionalNumbers, cpuMs: summary.nonSqlCpuMs.p50, d1: summary.d1BindingCalls.p50 }));
  }
  db.sqlite.close();
}
