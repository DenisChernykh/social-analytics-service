import {readCF,sql,account} from './read-cloudflare.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../../',import.meta.url);
const end=new Date(Date.now()-3*60000).toISOString();
const windows=[{revision:'0.2.15',version:'6ebe6029-74e1-4551-b68a-0b1c30a56f68',start:'2026-10-08T16:20:00Z',end:'2026-10-09T06:20:00Z'},
{revision:'0.2.16',version:'e659a098-741f-47ba-891f-ad25274efa70',start:'2026-10-09T06:30:00Z',end}];
const output={checkedAt:new Date().toISOString(),windows:[],limitations:[]};
for(const w of windows) {
  const filter=`scriptName:"api",datetime_geq:"${w.start}",datetime_lt:"${w.end}"`;
  const query=`{viewer {accounts(filter:{accountTag:"${account}"}) {scheduled:workersInvocationsScheduled(limit:2000,filter:{${filter}},orderBy:[scheduledDatetime_ASC]) {cpuTimeUs cron datetime scheduledDatetime status} mixed:workersInvocationsAdaptive(limit:2000,filter:{${filter},scriptVersion:"${w.version}"}) {dimensions{datetimeMinute status scriptVersion usageModel} sum{requests errors cpuTimeUs subrequests wallTime duration} max{cpuTime duration wallTime memoryUsageBytes} quantiles{cpuTimeP50 cpuTimeP95 cpuTimeP99 durationP50 wallTimeP50 memoryUsageBytesP50}}}}}`;
  try {const r=await readCF('/graphql',{query});output.windows.push({...w,...r.data.viewer.accounts[0],query});}
  catch(e) {output.windows.push({...w,error:e.message,query});}
}
const aggregate=`SELECT
 (SELECT COUNT(*) FROM accounts) accounts,
 (SELECT COUNT(*) FROM media) media,
 (SELECT COUNT(*) FROM media_snapshots) snapshots,
 (SELECT COUNT(*) FROM account_snapshots) accountSnapshots,
 (SELECT COUNT(*) FROM comments) comments,
 (SELECT COUNT(*) FROM comment_collections) commentCollections,
 (SELECT COUNT(*) FROM collection_jobs) jobs,
 (SELECT COUNT(*) FROM collection_jobs WHERE status='running') runningJobs,
 (SELECT COUNT(*) FROM account_insights) insights,
 (SELECT COUNT(*) FROM instagram_http_attempts) receipts,
 (SELECT COUNT(*) FROM collection_schedules WHERE enabled=1) enabledSchedules,
 (SELECT AVG(length(cursor)) FROM collection_jobs WHERE status='running') meanActiveCursorBytes,
 (SELECT MAX(length(cursor)) FROM collection_jobs WHERE status='running') maxActiveCursorBytes,
 (SELECT AVG(length(metrics_json)) FROM media_snapshots) meanMetricsBytes,
 (SELECT MAX(length(payload_json)) FROM account_insights) maxInsightBytes,
 (SELECT MAX(length(result_json)) FROM comment_collections) maxCommentResultBytes,
 (SELECT MAX(json_extract(result_json,'$.collected')) FROM comment_collections) maxSavedCommentPage,
 (SELECT MAX(length(text)) FROM comments) maxCommentTextBytes`;
try {output.aggregates=await sql(aggregate);}
catch(e){output.aggregates={error:e.message};}
try {output.schedules=await sql('SELECT enabled,discovery_minutes,time_zone,next_insights_at,next_discovery_at,next_stories_at,next_catalogue_at,retry_at FROM collection_schedules');}
catch(e){output.schedules={error:e.message};}
try {output.d1=await readCF('/graphql',{query:`{viewer {accounts(filter:{accountTag:"${account}"}) {d1AnalyticsAdaptiveGroups(limit:1,filter:{datetime_geq:"2026-10-09T06:30:00Z",datetime_lt:"${end}"}) {sum {readQueries writeQueries rowsRead rowsWritten} quantiles {queryBatchTimeMsP50 queryBatchTimeMsP95 queryBatchTimeMsP99}}}}}`});}
catch(e){output.d1={error:e.message};}
await writeFile(new URL('docs/cron-cpu-audit/production-analytics.json',root),JSON.stringify(output,null,2));
console.log(JSON.stringify({checkedAt:output.checkedAt,windows:output.windows.map(w=>({revision:w.revision,start:w.start,end:w.end,scheduled:w.scheduled?.length,mixed:w.mixed?.length,error:w.error})),aggregates:output.aggregates,d1:output.d1},null,2));
