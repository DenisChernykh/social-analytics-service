import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { collectionCases, phase1AccountId } from "../../backend/test/collection-phase1-fixtures.ts";

// Isolated SQLite only. Old production reader + new writer use the same saved facts.
const root = new URL("../../", import.meta.url);
const before = await import(new URL("tmp/collection-phase1/before-node.mjs", root));
const after = await import(new URL("tmp/collection-phase1/after-node.mjs", root));
class DB {
  sqlite = new DatabaseSync(":memory:");
  prepare(sql) {
    const database = this;
    return new class {
      values = [];
      bind(...values) { this.values = values; return this; }
      execute(raw = false) {
        const statement = database.sqlite.prepare(sql);
        statement.setReturnArrays(raw);
        const hasRows = statement.columns().length > 0;
        const results = hasRows ? statement.all(...this.values) : [];
        const meta = hasRows ? database.sqlite.prepare("SELECT changes() changes").get() : statement.run(...this.values);
        return { results, success: true, meta: { changes: Number(meta.changes) } };
      }
      async all() { return this.execute(); }
      async run() { return this.execute(); }
      async raw() { return this.execute(true).results; }
      async first(column) { const row = this.execute().results[0] ?? null; return column ? row?.[column] ?? null : row; }
    };
  }
  async batch(statements) {
    this.sqlite.exec("SAVEPOINT release_test");
    try { const result = await Promise.all(statements.map((statement) => statement.all())); this.sqlite.exec("RELEASE release_test"); return result; }
    catch (error) { this.sqlite.exec("ROLLBACK TO release_test; RELEASE release_test"); throw error; }
  }
}
const db = new DB();
db.sqlite.exec("PRAGMA foreign_keys=ON");
for (const file of (await readdir(new URL("backend/migrations/", root))).filter((file) => file.endsWith(".sql")).sort()) {
  db.sqlite.exec(await readFile(new URL(`backend/migrations/${file}`, root), "utf8"));
}
const facts = () => createHash("sha256").update(JSON.stringify([
  db.sqlite.prepare("SELECT * FROM media_snapshots ORDER BY id").all(),
  db.sqlite.prepare("SELECT * FROM account_snapshots ORDER BY id").all(),
  db.sqlite.prepare("SELECT * FROM instagram_http_attempts ORDER BY id").all(),
  db.sqlite.prepare("SELECT * FROM sync_runs ORDER BY id").all(),
])).digest("hex");
const cases = [];
for (const scenario of collectionCases) {
  db.sqlite.exec("DELETE FROM accounts");
  const writer = await after.scenarioRunner(db, scenario);
  const result = await after.exerciseScenario(writer);
  assert.equal(result.statuses.at(-1), 200);
  const digest = facts();
  const reader = await before.scenarioRunner(db, scenario);
  for (const [index, item] of reader.media.entries()) {
    const response = await reader.request(`/api/media/${phase1AccountId}_${item.id}/statistics`);
    assert.equal(response.status, 200);
    const report = await response.json();
    for (const key of ["metrics", "calculated", "observation", "source", "storyInsights", "profileActivity"]) {
      assert.deepEqual(report[key], result.reports[index][key], `${scenario.name}: old reader changed ${key}`);
    }
  }
  const replay = await reader.collect();
  assert.equal(replay.status, 200);
  assert.equal(reader.calls.length, 0, "Rollback replay made a provider request");
  assert.equal(facts(), digest, "Rollback read/replay changed immutable facts or checkpoints");
  cases.push({ name: scenario.name, reports: reader.media.length, oldReaderExact: true, oldReplayHTTP: 0, savedFactsUnchanged: true });
}
db.sqlite.close();
const evidence = { checkedAt: new Date().toISOString(), scope: "Synthetic local SQLite; new writer followed by immutable 0.2.16 reader and replay, no external requests", cases };
await writeFile(new URL("./rollback-compatibility.json", import.meta.url), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ cases: cases.length, reports: cases.reduce((sum, entry) => sum + entry.reports, 0), oldReaderExact: true, oldReplayHTTP: 0, savedFactsUnchanged: true }));
