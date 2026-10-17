import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const folder = new URL('./', import.meta.url);
const node = JSON.parse(await readFile(new URL('node-results.json', folder), 'utf8'));
const workerd = JSON.parse(await readFile(new URL('workerd-results.json', folder), 'utf8'));
const percentile = (a, p) => [...a].sort((x, y) => x - y)[Math.max(0, Math.ceil(a.length * p) - 1)];
const summary = { method: 'Equal fixture mix: one of each of 12 cases, 13 attempted publications. HTTP includes profile/catalog/probes/retries. D1 includes collection, completed replay and backend report reads; seeding and validation excluded. CPU sum is sum of per-case medians, not one production invocation.', scenarios: [], aggregate: {} };
const metrics = ['attempts', 'coreNumbers', 'structuredNumbers', 'savesReachPairs', 'sharesReachPairs', 'deferred', 'additionalNumbers'];
for (const before of workerd.scenarios.filter((s) => s.version === 'before')) {
  const after = workerd.scenarios.find((s) => s.version === 'after' && s.case === before.case);
  assert.ok(after);
  const entry = { case: before.case };
  for (const [version, result] of [['before', before], ['after', after]]) {
    const control = node.scenarios.find((s) => s.version === version && s.case === before.case);
    for (const key of metrics) assert.equal(control.example[key], result.example[key]);
    assert.equal(control.summary.d1BindingCalls.p50, result.summary.d1BindingCalls.p50);
    entry[version] = {
      ...Object.fromEntries(metrics.map((key) => [key, result.example[key]])),
      statuses: result.example.statuses,
      d1BindingCalls: result.summary.d1BindingCalls.p50,
      sqlStatements: result.summary.sqlStatements.p50,
      workerdActiveMsP50: result.summary.activeMs.p50, workerdActiveMsP95: result.summary.activeMs.p95,
      nodeNonSqlCpuMsP50: control.summary.nonSqlCpuMs.p50,
      deferredFields: result.example.deferredFields,
      reasons: result.example.reasons,
      primaryDeferred: result.example.deferredFields.filter((field) => !['facebookViews', 'crosspostedViews'].includes(field.field) && !field.field.includes('.') && !['navigationTotal', 'replies', 'profileActivity.total'].includes(field.field)).length,
    };
  }
  summary.scenarios.push(entry);
}
for (const version of ['before', 'after']) {
  const total = {};
  for (const key of [...metrics, 'd1BindingCalls', 'sqlStatements', 'primaryDeferred'])
    total[key] = summary.scenarios.reduce((n, s) => n + s[version][key], 0);
  total.workerdSumOfCaseMediansMs = summary.scenarios.reduce((n, s) => n + s[version].workerdActiveMsP50, 0);
  total.nodeNonSqlSumOfCaseMediansMs = summary.scenarios.reduce((n, s) => n + s[version].nodeNonSqlCpuMsP50, 0);
  const workerCases = workerd.scenarios.filter((s) => s.version === version);
  const cpuRoundSums = Array.from({ length: workerd.samplesPerCase }, (_, i) => workerCases.reduce((n, s) => n + s.samples[i].activeMs, 0));
  total.workerdRoundSumDistribution = { p50: percentile(cpuRoundSums, .5), p95: percentile(cpuRoundSums, .95), min: Math.min(...cpuRoundSums), max: Math.max(...cpuRoundSums) };
  total.corePerHttp = total.coreNumbers / total.attempts;
  total.d1PerCore = total.d1BindingCalls / total.coreNumbers;
  total.availableAdditionalWithSixAttemptBudget = summary.scenarios.filter((s) => !['zero_denominator_deferred', 'pre_insights_budget'].includes(s.case)).reduce((n, s) => n + s[version].additionalNumbers, 0);
  total.snapshots = summary.scenarios.reduce((n, s) => n + (s[version].statuses.at(-1) === 200 ? s.case === 'page_budget_exhausted' ? 2 : 1 : 0), 0);
  summary.aggregate[version] = total;
}
summary.mcp = { realBackendChecks: node.mcp.length, reportsChecked: node.mcp.reduce((n, s) => n + s.reportsChecked, 0), allPassed: node.mcp.every((s) => s.exactMetricsAndReceipts) };
await writeFile(new URL('comparison.json', folder), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ aggregate: summary.aggregate, mcp: summary.mcp }, null, 2));
