import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

// No external credentials or network: a populated 0008 SQLite schema is
// upgraded with the actual additive migrations, retaining all legacy facts.
const directory = new URL("../backend/migrations/", import.meta.url);
const migrations = (await readdir(directory)).filter((p) => /^\d+_.+\.sql$/.test(p)).sort();
const database = new DatabaseSync(":memory:");
database.exec("PRAGMA foreign_keys=ON");
const apply = async (file) => database.exec(await readFile(new URL(file, directory), "utf8"));
for (const file of migrations.filter((p) => Number(p.slice(0, 4)) <= 8)) await apply(file);
database.exec(`
INSERT INTO accounts(id,platform,external_id,username,account_type,connected_at) VALUES('legacy','instagram','fixture','fixture','MEDIA_CREATOR',100);
INSERT INTO media(id,account_id,external_id,caption,search_text,media_type,product_type,permalink,published_at,updated_at)
VALUES('legacy-media','legacy','fixture-media','','','VIDEO','REELS','https://www.instagram.com/reel/fixture/',50,200);
INSERT INTO media_snapshots(id,media_id,observed_at,api_version,metrics_json) VALUES('legacy-snapshot','legacy-media',200,'v26.0','{"views":{"value":0,"reason":null,"unit":"count","sourceField":"views"}}');
INSERT INTO account_snapshots(id,account_id,observed_at,followers_count,media_count) VALUES('legacy-profile','legacy',150,100,1);
INSERT INTO sync_runs(id,account_id,page_size,status,started_at,completed_at,lease_expires_at) VALUES('legacy-run','legacy',1,'completed',100,200,900100);
INSERT INTO collection_jobs(id,account_id,origin,status,started_at,next_attempt_at) VALUES('legacy-job','legacy','scheduled','running',100,200);
INSERT INTO instagram_api_state(id,account_id,api_version,usage_percent,usage_observed_at,recorded_requests,since_at,observed_at) VALUES('legacy-state','legacy','v26.0',12,100,37,100,200);
INSERT INTO account_insights(id,account_id,signature,observed_at,payload_json) VALUES('legacy-period','legacy','legacy-range',200,'{"status":"completed","input":{"kind":"activity","from":0,"to":100},"values":[]}');
`);
const tables = [
  "accounts",
  "media",
  "media_snapshots",
  "account_snapshots",
  "sync_runs",
  "collection_jobs",
  "instagram_api_state",
  "account_insights",
];
const before = Object.fromEntries(
  tables.map((table) => [table, database.prepare(`SELECT * FROM ${table}`).all()]),
);
const columns = Object.fromEntries(tables.map((table) => [table, Object.keys(before[table][0])]));
const applied = migrations.filter((p) => Number(p.slice(0, 4)) > 8);
for (const file of applied) await apply(file);
for (const table of tables) {
  const after = database.prepare(`SELECT ${columns[table].join(",")} FROM ${table}`).all();
  assert.deepEqual(after, before[table], `${table}: an existing fact changed`);
}
assert.equal(
  database.prepare("SELECT provenance_json FROM media_snapshots").get().provenance_json,
  null,
);
assert.equal(
  database.prepare("SELECT provenance_json FROM account_snapshots").get().provenance_json,
  null,
);
assert.deepEqual(
  {
    ...database
      .prepare("SELECT useful_values,coverage_state,first_useful_at,last_useful_at FROM sync_runs")
      .get(),
  },
  { useful_values: null, coverage_state: null, first_useful_at: null, last_useful_at: null },
);
assert.deepEqual(
  {
    ...database
      .prepare(
        "SELECT latency_origin,http_attempts_since_at,first_attempt_at,first_useful_observation_at,last_step_http_attempts FROM collection_jobs",
      )
      .get(),
  },
  {
    latency_origin: null,
    http_attempts_since_at: null,
    first_attempt_at: null,
    first_useful_observation_at: null,
    last_step_http_attempts: null,
  },
);
assert.equal(
  database.prepare("SELECT accounting_since_at FROM instagram_api_state").get().accounting_since_at,
  null,
);
assert.equal(database.prepare("SELECT COUNT(*) n FROM collection_policy_history").get().n, 0);
assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
const evidence = {
  checkedAt: new Date().toISOString(),
  baseline: "0008",
  applied,
  preservedTables: tables,
  preservedRows: tables.length,
  legacyProvenance: "unknown",
  legacyPolicyHistory: "unknown",
  legacyCounterEpoch: "unknown",
  foreignKeyErrors: 0,
  legacyFactsSha256: createHash("sha256").update(JSON.stringify(before)).digest("hex"),
};
await writeFile(
  new URL("../docs/instagram-data-migration-evidence.json", import.meta.url),
  `${JSON.stringify(evidence, null, 2)}\n`,
);
database.close();
console.log(JSON.stringify(evidence));
