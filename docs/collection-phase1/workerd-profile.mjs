import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { collectionCases } from '../../backend/test/collection-phase1-fixtures.ts';

const root = new URL('../../', import.meta.url), out = new URL('docs/collection-phase1/', root);
const req = createRequire(new URL('backend/package.json', root)), toolReq = createRequire(req.resolve('wrangler'));
const { Miniflare: Runtime, convertV4MiniflareOptions } = toolReq('miniflare');
const percentile = (a, q) => [...a].sort((x, y) => x - y)[Math.max(0, Math.ceil(a.length * q) - 1)];
const dist = (a) => ({ n: a.length, p50: percentile(a, .5), p95: percentile(a, .95), min: Math.min(...a), max: Math.max(...a) });
class CDP {
  id = 0; pending = new Map();
  constructor(ws) {
    this.ws = ws;
    ws.addEventListener('message', (e) => {
      const response = JSON.parse(String(e.data)), operation = this.pending.get(response.id);
      if (operation) { this.pending.delete(response.id); response.error ? operation.reject(new Error(JSON.stringify(response.error))) : operation.resolve(response.result); }
    });
  }
  static async open(mf) {
    const url = await mf.getInspectorURL(); url.pathname = '/core:user:phase1'; url.protocol = 'ws:';
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
    const cdp = new CDP(ws);
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
    return cdp;
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => { const id = ++this.id; this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  close() { this.ws.close(); }
}
function sampled(profile) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  let activeUs = 0, idleUs = 0;
  for (const [i, id] of (profile.samples ?? []).entries()) {
    const delta = profile.timeDeltas[i] ?? 0;
    if (nodes.get(id)?.callFrame.functionName === '(idle)') idleUs += delta;
    else activeUs += delta;
  }
  return { activeMs: activeUs / 1000, idleMs: idleUs / 1000, windowMs: (profile.endTime - profile.startTime) / 1000, samples: profile.samples?.length ?? 0 };
}
const get = async (mf, path) => {
  const response = await mf.dispatchFetch(`http://phase1.local${path}`);
  const body = await response.text();
  if (!response.ok) throw new Error(`Local synthetic harness ${response.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body);
};
const migrations = (await readdir(new URL('backend/migrations/', root))).filter((s) => s.endsWith('.sql')).sort();
const report = {
  environment: { node: process.version, workerd: toolReq('workerd/package.json').version, miniflare: toolReq('miniflare/package.json').version, cpu: os.cpus()[0].model,
    method: 'Warm workerd V8 statistical profile; 100us requested sampling; active sampled time excludes (idle). Includes local synthetic HTTP response and D1 binding overhead, no startup/seeding. Not billed production CPU; sampled waits may be misattributed.' },
  warmup: 3, samplesPerCase: 20, scenarios: [],
};
// Independent ephemeral Miniflare stores. Outbound access is disabled; no Wrangler config/secrets.
for (const version of ['before', 'after']) {
  const mf = new Runtime(convertV4MiniflareOptions({ name: 'phase1', compatibilityDate: '2026-08-28', compatibilityFlags: ['nodejs_compat'], modules: true,
    scriptPath: new URL(`tmp/collection-phase1/${version}-worker.mjs`, root).pathname,
    inspectorPort: 0, cf: false, host: '127.0.0.1', d1Databases: { DB: 'synthetic-local-phase1-only' },
    outboundService: () => new Response('External network disabled', { status: 403 }),
  }));
  try {
    await mf.ready; const db = await mf.getD1Database('DB');
    for (const filename of migrations)
      for (const statement of (await readFile(new URL(`backend/migrations/${filename}`, root), 'utf8')).split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean))
        await db.prepare(statement).run();
    const cdp = await CDP.open(mf);
    for (const scenario of collectionCases) {
      const samples = []; let example;
      for (let i = -report.warmup; i < report.samplesPerCase; i++) {
        await get(mf, `/seed?case=${scenario.name}`);
        if (i < 0) { await get(mf, '/run'); continue; }
        await cdp.send('Profiler.start');
        const start = performance.now(); const result = await get(mf, '/run'); const wallMs = performance.now() - start;
        const { profile } = await cdp.send('Profiler.stop');
        const validation = await get(mf, '/validate');
        assert.equal(validation.snapshots, result.statuses.at(-1) === 200 ? scenario.mediaCount ?? 1 : 0);
        assert.equal(validation.receipts, result.attempts);
        assert.ok(result.attempts <= scenario.maxAttempts * result.statuses.length);
        samples.push({ ...sampled(profile), wallMs, d1BindingCalls: result.d1BindingCalls, sqlStatements: result.sqlStatements });
        if (i === 0) {
          example = result;
          await writeFile(new URL(`${version}-${scenario.name}.cpuprofile`, out), JSON.stringify(profile));
        } else {
          for (const key of ['attempts', 'coreNumbers', 'savesReachPairs', 'sharesReachPairs', 'deferred', 'additionalNumbers', 'd1BindingCalls', 'sqlStatements'])
            assert.equal(result[key], example[key]);
        }
      }
      const summary = Object.fromEntries(['activeMs', 'wallMs', 'd1BindingCalls', 'sqlStatements'].map((key) => [key, dist(samples.map((s) => s[key]))]));
      report.scenarios.push({ version, case: scenario.name, example, samples, summary });
      await writeFile(new URL('workerd-results.json', out), JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify({ version, case: scenario.name, attempts: example.attempts, core: example.coreNumbers, pairs: [example.savesReachPairs, example.sharesReachPairs], deferred: example.deferred, additional: example.additionalNumbers, activeMs: summary.activeMs.p50, d1: summary.d1BindingCalls.p50 }));
    }
    cdp.close();
  } finally { await mf.dispose(); }
}
