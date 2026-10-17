import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { Session } from 'node:inspector';
import { promisify } from 'node:util';
import os from 'node:os';
const root=new URL('../../',import.meta.url),out=new URL('docs/cron-cpu-audit/',root);
const h=await import(new URL('tmp/cron-cpu-audit/harness-node.mjs',root));
const cpu=()=>{const c=process.threadCpuUsage();return c.user+c.system;};
const percentile=(a,p)=>[...a].sort((x,y)=>x-y)[Math.max(0,Math.ceil(a.length*p)-1)];
const distribution=(a)=>({n:a.length,p50:percentile(a,.5),p95:percentile(a,.95),max:Math.max(...a)});
const migrations=(await readdir(new URL('backend/migrations/',root))).filter(f=>f.endsWith('.sql')).sort();
let trace=[],queries=[],measuring=false;
h.instrumentation(async(name,fn)=>{
  if(!measuring)return fn();
  const t=performance.now(),c=cpu();
  const result=await fn();
  trace.push({name,cpuMs:(cpu()-c)/1000,wallMs:performance.now()-t});return result;
});
class DB {
  constructor(){this.sqlite=new DatabaseSync(':memory:');this.sqlite.exec('PRAGMA foreign_keys=ON');}
  prepare(sql){
    const db=this;
    return new class Statement {
      values=[];
      bind(...values){this.values=values;return this;}
      execute(raw=false){
        const c=cpu(),t=performance.now(),stmt=db.sqlite.prepare(sql);stmt.setReturnArrays(raw);
        const records=stmt.columns().length?stmt.all(...this.values):[];
        const meta=stmt.columns().length?{changes:db.sqlite.prepare('SELECT changes() AS n').get().n}:stmt.run(...this.values);
        const result={results:records,success:true,meta:{changes:Number(meta.changes??0),duration:performance.now()-t}};
        if(measuring)queries.push({sql,params:this.values,cpuMs:(cpu()-c)/1000,wallMs:performance.now()-t,rows:records.length});
        return result;
      }
      async all(){return this.execute();}
      async raw(){return this.execute(true).results;}
      async first(column){const record=this.execute().results[0]??null;return column?record?.[column]??null:record;}
      async run(){return this.execute();}
    };
  }
  async batch(statements){this.sqlite.exec('SAVEPOINT audit_batch');try {const r=await Promise.all(statements.map(s=>s.all()));this.sqlite.exec('RELEASE audit_batch');return r;}catch(e){this.sqlite.exec('ROLLBACK TO audit_batch');this.sqlite.exec('RELEASE audit_batch');throw e;}}
}
const report={environment:{node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0].model,method:'Node main-thread CPU including synchronous SQLite; SQL cost separately measured; NOT Cloudflare billed CPU'},scenarios:[],sqlPlans:[]};
const session=new Session();session.connect();const post=promisify(session.post.bind(session));
await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:100});
for(const scale of [1,10]) {
  const db=new DB();
  for(const file of migrations)db.sqlite.exec(await readFile(new URL(`backend/migrations/${file}`,root),'utf8'));
  const fixture=await h.seed(db,scale);
  for(const scenario of ['noop','empty','empty_enabled','selection','discovery','discovery_new','insights','comments','comments_large','daily','backlog']) {
    const samples=[],stages={},allQueries=[];let example;
    for(let i=-5;i<40;i++) {
      await h.reset(db,scenario,scale);trace=[];queries=[];measuring=i>=0;
      const c=cpu(),p=process.cpuUsage(),t=performance.now();
      example=await h.invoke(db,scenario,i>=0);
      const wallMs=performance.now()-t,mainCpuMs=(cpu()-c)/1000,pc=process.cpuUsage(p);measuring=false;
      await h.validate(db);
      if(i>=0) {
        const sqlCpuMs=queries.reduce((n,q)=>n+q.cpuMs,0);
        samples.push({mainCpuMs,wallMs,sqlCpuMs,nonSqlCpuMs:mainCpuMs-sqlCpuMs,processCpuMs:(pc.user+pc.system)/1000,queries:queries.length,rows:queries.reduce((n,q)=>n+q.rows,0)});
        for(const step of trace)(stages[step.name]??=[]).push(step);
        if(i===0)allQueries.push(...queries);
      }
    }
    const summary={scenario,scale,fixture,example,samples,summary:Object.fromEntries(['mainCpuMs','wallMs','sqlCpuMs','nonSqlCpuMs','queries','rows'].map(k=>[k,distribution(samples.map(s=>s[k]))])),stages:Object.fromEntries(Object.entries(stages).map(([k,v])=>[k,{calls:v.length,cpuMs:distribution(v.map(s=>s.cpuMs)),wallMs:distribution(v.map(s=>s.wallMs))}])),queries:allQueries};
    report.scenarios.push(summary);
    for(const q of allQueries.filter(q=>/^(SELECT|WITH)/i.test(q.sql))) {
      if(report.sqlPlans.some(s=>s.sql===q.sql&&s.scale===scale))continue;
      const plan=db.sqlite.prepare(`EXPLAIN QUERY PLAN ${q.sql}`).all(...q.params);
      report.sqlPlans.push({scenario,scale,sql:q.sql,plan});
    }
    console.log(JSON.stringify({scenario,scale,summary:summary.summary}));
  }
  // Uninstrumented control: same full path, no method timing wrappers.
  for(const scenario of ['empty_enabled','insights','comments','daily']) {
    const samples=[];
    for(let i=0;i<40;i++) {await h.reset(db,scenario,scale);measuring=false;const c=cpu(),t=performance.now();await h.invoke(db,scenario,false);samples.push({cpuMs:(cpu()-c)/1000,wallMs:performance.now()-t});await h.validate(db);}
    report.scenarios.push({scenario:`${scenario}_uninstrumented`,scale,summary:{mainCpuMs:distribution(samples.map(s=>s.cpuMs)),wallMs:distribution(samples.map(s=>s.wallMs))},samples});
  }
  if(scale===1){
    await post('Profiler.start');
    for(let i=0;i<40;i++){await h.reset(db,'daily',1);await h.invoke(db,'daily',false);}
    const {profile}=await post('Profiler.stop');
    await writeFile(new URL('node-daily.cpuprofile',out),JSON.stringify(profile));
  }
  db.sqlite.close();
}
const obs=Array.from({length:1030},(_,i)=>({from:h.now-i*h.day,to:h.now-(i-1)*h.day,observedAt:h.now}));
report.calendar=[];
for(const size of [0,52,520,1030]) {const samples=[];for(let i=-5;i<80;i++){const c=cpu(),t=performance.now();h.activityPeriodPlan(h.now,'Asia/Yekaterinburg',obs.slice(0,size));if(i>=0)samples.push({cpuMs:(cpu()-c)/1000,wallMs:performance.now()-t});}report.calendar.push({observations:size,samples,cpuMs:distribution(samples.map(s=>s.cpuMs)),wallMs:distribution(samples.map(s=>s.wallMs))});}
session.disconnect();await writeFile(new URL('node-results.json',out),JSON.stringify(report,null,2));
