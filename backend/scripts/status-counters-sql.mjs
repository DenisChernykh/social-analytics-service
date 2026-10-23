// The migration owns these projections and their transactional maintenance.
// Before release, generate/check its custom suffix. An applied migration is
// immutable: policy changes require a new versioned backfill migration.
import { readFile, writeFile } from "node:fs/promises";
import { activityMetrics } from "../src/modules/account-insights/domain/model.ts";
import { metricKeys } from "../src/modules/analytics/domain/model.ts";
import { ageSnapshotWindows } from "../src/modules/collection/domain/age-policy.ts";

const marker = "-- Materialized collection status v1";
const statements = [];
const add = (sql) => statements.push(sql.trim());
const jsonMax = (a, b) =>
  `CASE WHEN ${a} IS NULL THEN ${b} WHEN ${b} IS NULL THEN ${a} ELSE MAX(${a},${b}) END`;
const first = (a, b) =>
  `CASE WHEN ${a} IS NULL THEN ${b} WHEN ${b} IS NULL THEN ${a} ELSE MIN(${a},${b}) END`;
const deferred = `CASE WHEN ${metricKeys.map((k) => `json_extract(s.metrics_json,'$.${k}.reason')='request_deferred'`).join(" OR ")} THEN 1
  WHEN instr(s.metrics_json,'request_deferred')>0 OR instr(s.metrics_json,char(92))>0
  THEN EXISTS (SELECT 1 FROM json_each(s.metrics_json) v WHERE json_extract(v.value,'$.reason')='request_deferred') ELSE 0 END`;
const fastUseful = `json_extract(s.metrics_json,'$.views.value') IS NOT NULL
 OR json_extract(s.metrics_json,'$.reach.value') IS NOT NULL
 OR json_extract(s.metrics_json,'$.likes.value') IS NOT NULL
 OR json_extract(s.metrics_json,'$.comments.value') IS NOT NULL
 OR json_extract(s.story_insights_json,'$.navigationTotal.value') IS NOT NULL`;
const fallbackUseful = `EXISTS (SELECT 1 FROM json_each(s.metrics_json) v WHERE json_extract(v.value,'$.value') IS NOT NULL)
 OR EXISTS (SELECT 1 FROM json_each(s.story_insights_json,'$.navigation') v WHERE json_extract(v.value,'$.value') IS NOT NULL)`;
add(`CREATE VIEW collection_snapshot_facts AS SELECT s.id,s.rowid sequence,s.media_id,s.observed_at,s.operation_id,
  s.provenance_json IS NULL legacy,CASE WHEN ${fastUseful} THEN s.observed_at WHEN ${fallbackUseful} THEN s.observed_at END useful_at,
  ${deferred} deferred,
  ${ageSnapshotWindows.map((w) => `CASE WHEN json_extract(s.metrics_json,'$.reach.value') IS NOT NULL AND s.observed_at BETWEEN m.published_at+${(w.targetHours - w.toleranceHours) * 3_600_000} AND m.published_at+${(w.targetHours + w.toleranceHours) * 3_600_000} THEN s.observed_at END reach_${w.targetHours}`).join(",\n  ")}
FROM media_snapshots s JOIN media m ON m.id=s.media_id;`);
const latest = `json_object('id',f.id,'sequence',f.sequence,'at',f.observed_at,'operationId',f.operation_id,'deferred',f.deferred)`;
const rebuiltMedia = `(SELECT json_object('lastSuccess',MAX(f.observed_at),'lastUseful',MAX(f.useful_at),'legacy',COALESCE(SUM(f.legacy),0),
  'latest',json((SELECT ${latest} FROM collection_snapshot_facts f WHERE f.media_id=media.id ORDER BY f.observed_at DESC,f.sequence DESC LIMIT 1)),
  'reachWindows',json_object(${ageSnapshotWindows.map((w) => `'${w.targetHours}',MIN(f.reach_${w.targetHours})`).join(",")}))
  FROM collection_snapshot_facts f WHERE f.media_id=media.id)`;
const existing = (path) => `json_extract(media.collection_status_json,'$.${path}')`;
const incrementalMedia = `(SELECT json_set(media.collection_status_json,
  '$.lastSuccess',${jsonMax(existing("lastSuccess"), "f.observed_at")},
  '$.lastUseful',${jsonMax(existing("lastUseful"), "f.useful_at")},
  '$.legacy',COALESCE(${existing("legacy")},0)+f.legacy,
  '$.latest',json(CASE WHEN ${existing("latest.at")} IS NULL OR f.observed_at>${existing("latest.at")} OR (f.observed_at=${existing("latest.at")} AND f.sequence>${existing("latest.sequence")}) THEN ${latest} ELSE ${existing("latest")} END),
  '$.reachWindows',json_object(${ageSnapshotWindows.map((w) => `'${w.targetHours}',${first(existing(`reachWindows."${w.targetHours}"`), `f.reach_${w.targetHours}`)}`).join(",")}))
  FROM collection_snapshot_facts f WHERE f.id=NEW.id)`;
add(`UPDATE media SET collection_status_json=${rebuiltMedia};`);
add(`CREATE TRIGGER collection_snapshot_insert AFTER INSERT ON media_snapshots BEGIN
 UPDATE media SET collection_status_json=${incrementalMedia} WHERE id=NEW.media_id;
END;`);
add(`CREATE TRIGGER collection_snapshot_delete AFTER DELETE ON media_snapshots BEGIN
 UPDATE media SET collection_status_json=${rebuiltMedia} WHERE id=OLD.media_id;
END;`);
add(`CREATE TRIGGER collection_snapshot_update AFTER UPDATE ON media_snapshots BEGIN
 UPDATE media SET collection_status_json=${rebuiltMedia} WHERE id=OLD.media_id OR id=NEW.media_id;
END;`);
add(`CREATE TRIGGER collection_media_retime AFTER UPDATE OF published_at ON media WHEN OLD.published_at!=NEW.published_at BEGIN
 UPDATE media SET collection_status_json=${rebuiltMedia} WHERE id=NEW.id;
END;`);

// Each completed activity interval has one latest eligible observation, even
// when saved operation IDs, metric order or full signatures differ.
const field = (alias, name) => `json_extract(${alias}.payload_json,'$.${name}')`;
const activityEligible = (alias) => `${field(alias, "status")}='completed'
 AND ${field(alias, "input.kind")}='activity' AND ${field(alias, "input.metricType")}='total_value'
 AND ${field(alias, "apiVersion")} IS NOT NULL AND ${field(alias, "input.timeZone")} IS NOT NULL
 AND ${field(alias, "input.from")} IS NOT NULL AND ${field(alias, "input.to")} IS NOT NULL
 AND ${field(alias, "input.breakdown")} IS NULL
 AND NOT EXISTS (SELECT 1 FROM json_each(${alias}.payload_json,'$.values') v WHERE json_extract(v.value,'$.reason')='request_deferred')
 AND (SELECT COUNT(DISTINCT saved.value) FROM json_each(${alias}.payload_json,'$.input.metrics') saved WHERE saved.value IN (${activityMetrics.map((m) => `'${m}'`).join(",")}))=${activityMetrics.length}`;
const activityKey = (alias) =>
  `${field(alias, "apiVersion")}||'|'||${field(alias, "input.timeZone")}||'|'||${field(alias, "input.from")}||'|'||${field(alias, "input.to")}`;
add(
  `CREATE VIEW collection_activity_facts AS SELECT a.id,a.account_id,a.observed_at,${activityKey("a")} period_key FROM account_insights a WHERE ${activityEligible("a")};`,
);
add(`UPDATE accounts SET activity_periods_json=COALESCE((SELECT json_group_object(period_key,observed_at) FROM
 (SELECT period_key,MAX(observed_at) observed_at FROM collection_activity_facts WHERE account_id=accounts.id GROUP BY period_key)),'{}');`);
const newPeriod = `UPDATE accounts SET activity_periods_json=json_set(activity_periods_json,'$.'||json_quote(f.period_key),
 ${jsonMax("json_extract(activity_periods_json,'$.'||json_quote(f.period_key))", "f.observed_at")})
 FROM collection_activity_facts f WHERE f.id=NEW.id AND accounts.id=f.account_id;`;
const oldPeriod = `UPDATE accounts SET activity_periods_json=CASE WHEN (SELECT MAX(observed_at) FROM collection_activity_facts f WHERE f.account_id=OLD.account_id AND f.period_key=${activityKey("OLD")}) IS NULL
 THEN json_remove(activity_periods_json,'$.'||json_quote(${activityKey("OLD")}))
 ELSE json_set(activity_periods_json,'$.'||json_quote(${activityKey("OLD")}), (SELECT MAX(observed_at) FROM collection_activity_facts f WHERE f.account_id=OLD.account_id AND f.period_key=${activityKey("OLD")})) END
 WHERE id=OLD.account_id AND ${activityEligible("OLD")} AND json_extract(activity_periods_json,'$.'||json_quote(${activityKey("OLD")}))=OLD.observed_at;`;
add(
  `CREATE TRIGGER collection_activity_insert AFTER INSERT ON account_insights BEGIN ${newPeriod} END;`,
);
add(
  `CREATE TRIGGER collection_activity_update AFTER UPDATE ON account_insights BEGIN ${oldPeriod} ${newPeriod} END;`,
);
add(
  `CREATE TRIGGER collection_activity_delete AFTER DELETE ON account_insights BEGIN ${oldPeriod} END;`,
);

// A daily terminal-job bucket is recomputed only when that bucket changes.
// Running jobs keep their live deadlines and leases, outside historical totals.
const bucketKey = (alias) =>
  `CAST(${alias}.started_at/86400000 AS INTEGER)||'|'||${alias}.origin||'|'||${alias}.status`;
const bucket = (
  alias,
) => `(SELECT json_object('day',CAST(${alias}.started_at/86400000 AS INTEGER),'origin',${alias}.origin,'status',${alias}.status,
 'count',COUNT(*),'maxStartedAt',MAX(started_at),'lastAttempt',MAX(last_attempt_at),'lastSuccess',MAX(last_success_at),'lastUsefulObservation',MAX(last_useful_observation_at),'lastCompletedAt',MAX(completed_at),
 'pendingParents',COALESCE(SUM(CASE WHEN origin IN ('comments','comments_refresh') AND status='failed' THEN json_array_length(cursor,'$.parents') ELSE 0 END),0))
 FROM collection_jobs WHERE account_id=${alias}.account_id AND origin=${alias}.origin AND status=${alias}.status
 AND started_at>=CAST(${alias}.started_at/86400000 AS INTEGER)*86400000 AND started_at<(CAST(${alias}.started_at/86400000 AS INTEGER)+1)*86400000)`;
const refreshBucket = (alias, condition = "1") =>
  `UPDATE accounts SET collection_jobs_json=json_set(collection_jobs_json,'$.'||json_quote(${bucketKey(alias)}),json(${bucket(alias)})) WHERE id=${alias}.account_id AND ${alias}.status!='running' AND (${condition});`;
add(`UPDATE accounts SET collection_jobs_json=COALESCE((SELECT json_group_object(bucket_key,json(payload)) FROM (SELECT CAST(started_at/86400000 AS INTEGER)||'|'||origin||'|'||status bucket_key,
 json_object('day',CAST(started_at/86400000 AS INTEGER),'origin',origin,'status',status,'count',COUNT(*),'maxStartedAt',MAX(started_at),'lastAttempt',MAX(last_attempt_at),'lastSuccess',MAX(last_success_at),'lastUsefulObservation',MAX(last_useful_observation_at),'lastCompletedAt',MAX(completed_at),
 'pendingParents',COALESCE(SUM(CASE WHEN origin IN ('comments','comments_refresh') AND status='failed' THEN json_array_length(cursor,'$.parents') ELSE 0 END),0)) payload
 FROM collection_jobs WHERE account_id=accounts.id AND status!='running' GROUP BY CAST(started_at/86400000 AS INTEGER),origin,status)),'{}');`);
add(
  `CREATE TRIGGER collection_job_insert AFTER INSERT ON collection_jobs WHEN NEW.status!='running' BEGIN ${refreshBucket("NEW")} END;`,
);
add(
  `CREATE TRIGGER collection_job_delete AFTER DELETE ON collection_jobs WHEN OLD.status!='running' BEGIN ${refreshBucket("OLD")} END;`,
);
add(`CREATE TRIGGER collection_job_update AFTER UPDATE OF account_id,origin,status,started_at,last_attempt_at,last_success_at,last_useful_observation_at,completed_at,cursor ON collection_jobs
 WHEN OLD.status!='running' OR NEW.status!='running' BEGIN
 ${refreshBucket("OLD", `NEW.status='running' OR OLD.account_id!=NEW.account_id OR (${bucketKey("OLD")})!=(${bucketKey("NEW")})`)}
 ${refreshBucket("NEW")}
END;`);

// Count unique identities, not repeated observations or upsert changes.
add(
  `UPDATE comment_media_state SET unique_saved=(SELECT COUNT(*) FROM comments WHERE comments.media_id=comment_media_state.media_id);`,
);
add(`INSERT INTO comment_media_state(media_id,unique_saved) SELECT media_id,COUNT(*) FROM comments GROUP BY media_id
 ON CONFLICT(media_id) DO UPDATE SET unique_saved=excluded.unique_saved;`);
add(`CREATE TRIGGER collection_comment_insert AFTER INSERT ON comments BEGIN
 INSERT INTO comment_media_state(media_id,unique_saved) VALUES(NEW.media_id,1) ON CONFLICT(media_id) DO UPDATE SET unique_saved=unique_saved+1;
END;`);
add(
  `CREATE TRIGGER collection_comment_delete AFTER DELETE ON comments BEGIN UPDATE comment_media_state SET unique_saved=unique_saved-1 WHERE media_id=OLD.media_id; END;`,
);
add(`CREATE TRIGGER collection_comment_move AFTER UPDATE OF media_id ON comments WHEN OLD.media_id!=NEW.media_id BEGIN
 UPDATE comment_media_state SET unique_saved=unique_saved-1 WHERE media_id=OLD.media_id;
 INSERT INTO comment_media_state(media_id,unique_saved) VALUES(NEW.media_id,1) ON CONFLICT(media_id) DO UPDATE SET unique_saved=unique_saved+1;
END;`);

// HTTP freshness shares the already-written accounting row. It needs no
// extra per-request writes and survives raw receipt retention/pruning.
const httpCatchup = `UPDATE instagram_api_state SET object_freshness_json=COALESCE((SELECT json_group_object(object_id,json_object('lastAttempt',lastAttempt,'lastCheck',lastCheck)) FROM (
 SELECT object_id,MAX(lastAttempt) lastAttempt,MAX(lastCheck) lastCheck FROM (
  SELECT key object_id,json_extract(value,'$.lastAttempt') lastAttempt,json_extract(value,'$.lastCheck') lastCheck FROM json_each(instagram_api_state.object_freshness_json)
  UNION ALL
  SELECT object_id,MAX(requested_at) lastAttempt,MAX(CASE WHEN json_extract(payload_json,'$.result')='success' THEN received_at END) lastCheck
  FROM instagram_http_attempts WHERE account_id=instagram_api_state.account_id AND object_id IS NOT NULL AND json_extract(payload_json,'$.requestedApiVersion')=instagram_api_state.api_version GROUP BY object_id
 ) GROUP BY object_id
)),'{}');`;
add(httpCatchup);
// Install every maintenance trigger before backfill, including when a runner
// executes statements separately. Old and new writers then remain compatible.
const ordered = [
  ...statements.filter((s) => s.startsWith("CREATE ")),
  ...statements.filter((s) => !s.startsWith("CREATE ")),
];
const catchupPath = new URL("status-counters-http-catchup.sql", import.meta.url);

const suffix = `${marker}\n${ordered.join("\n--> statement-breakpoint\n")}\n`;
const file = process.argv.find((arg) => arg.endsWith(".sql"));
if (!file) throw new Error("Pass the generated status migration .sql path");
const current = await readFile(file, "utf8");
if (process.argv.includes("--check")) {
  if (current.slice(current.indexOf(marker)) !== suffix)
    throw new Error("Status migration projections differ from their generator/policy");
  if ((await readFile(catchupPath, "utf8")) !== `${httpCatchup}\n`)
    throw new Error("HTTP cutover catch-up differs from its generator");
  console.log("Status migration projections match their generator and coverage policy.");
} else {
  const base = current.includes(marker)
    ? current.slice(0, current.indexOf(marker))
    : `${current}\n--> statement-breakpoint\n`;
  await writeFile(file, base + suffix);
  await writeFile(catchupPath, `${httpCatchup}\n`);
}
