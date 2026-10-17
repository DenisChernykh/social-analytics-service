import {readCF,sql,account} from './read-cloudflare.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../../',import.meta.url);
const output={checkedAt:new Date().toISOString(),queries:[],other:{}};
const [[connection]]=(await sql('SELECT id FROM accounts LIMIT 1')).map(r=>r.results);
const data=JSON.parse(await readFile(new URL('docs/cron-cpu-audit/node-results.json',root)));
const keywords=['collection_schedules','WITH eligible','WITH targets','SELECT MIN(m.published_at','SELECT m.id FROM media m LEFT','SELECT m.id,m.published_at','SELECT\n (SELECT enabled','SELECT json_extract(payload_json'];
const queries=data.sqlPlans.filter(p=>p.scale===1&&keywords.some(k=>p.sql.includes(k)));
for(const q of queries){
  const original=data.scenarios.flatMap(s=>s.queries??[]).find(x=>x.sql===q.sql);
  const params=original.params.map(p=>p==='ig_17841490000000001'?connection.id:typeof p==='number'&&p>1e12?p+Date.now()-Date.parse('2026-10-09T06:30:00Z'):p);
  const entry={scenario:q.scenario,sql:q.sql,parameters:params.map(p=>p===connection.id?'[connected account]':p)};
  try {entry.plan=(await sql(`EXPLAIN QUERY PLAN ${q.sql}`,params)).map(r=>({plan:r.results,meta:r.meta}));const results=await sql(q.sql,params);entry.execution=results.map(r=>({applicationRows:r.results.length,meta:r.meta}));}
  catch(e){entry.error=e.message;}
  output.queries.push(entry);
}
for(const [name,statement,params] of [
 ['receipt_prune','SELECT id FROM instagram_http_attempts WHERE requested_at<? LIMIT 100',[Date.now()-30*86400000]],
 ['receipt_sample_prune',"SELECT id FROM instagram_http_attempts WHERE requested_at<? AND json_extract(payload_json,'$.sample') IS NOT NULL LIMIT 100",[Date.now()-7*86400000]],
]) {const plan=await sql(`EXPLAIN QUERY PLAN ${statement}`,params),r=await sql(statement,params);output.queries.push({scenario:'request-maintenance',sql:statement,plan:plan.map(r=>({plan:r.results,meta:r.meta})),execution:r.map(r=>({applicationRows:r.results.length,meta:r.meta}))});}
for(const [name,path] of Object.entries({accountSettings:`/accounts/${account}/workers/account-settings`,cron:`/accounts/${account}/workers/scripts/api/schedules`,settings:`/accounts/${account}/workers/scripts/api/settings`})){
 try {const {result}=await readCF(path);output.other[name]=name==='account'?{settings:result.settings}:name==='settings'?{usageModel:result.usage_model,limits:result.limits,observability:result.observability,logpush:result.logpush}:result;}catch(e){output.other[name]={error:e.message};}
}
try{output.fieldDescriptions=await readCF('/graphql',{query:'{max:__type(name:"AccountWorkersInvocationsAdaptiveMax"){fields{name description}} sum:__type(name:"AccountWorkersInvocationsAdaptiveSum"){fields{name description}} scheduled:__type(name:"AccountWorkersInvocationsScheduled"){fields{name description}}}'});}catch(e){output.fieldDescriptions={error:e.message};}
await writeFile(new URL('docs/cron-cpu-audit/remote-sql.json',root),JSON.stringify(output,null,2));
console.log(JSON.stringify({checkedAt:output.checkedAt,queries:output.queries.map(q=>({scenario:q.scenario,sql:q.sql.slice(0,65),plan:q.plan?.[0]?.plan?.map(p=>p.detail),execution:q.execution,error:q.error})),other:output.other,fieldDescriptions:output.fieldDescriptions},null,2));
