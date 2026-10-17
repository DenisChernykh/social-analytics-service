// Derive tables and source-mapped sample attribution from saved evidence.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
const root = new URL('../../',import.meta.url), out = new URL('./',import.meta.url);
const read = async name => JSON.parse(await readFile(new URL(name,out),'utf8'));
const dist = values => {const a=[...values].sort((x,y)=>x-y);return {n:a.length,p50:a[Math.ceil(a.length*.5)-1],p95:a[Math.ceil(a.length*.95)-1],max:a.at(-1),mean:a.reduce((x,y)=>x+y,0)/a.length};};
const fmt = n => Number(n).toFixed(3);
const worker=await read('workerd-results.json'),node=await read('node-results.json'),production=await read('production-analytics.json');
const output={production:[],profiles:[],runtimeImports:[],instrumentation:[]};
for(const w of production.windows) {
  const scheduled=w.scheduled??[],mixed=w.mixed??[];
  const key=r=>`${r.datetime.slice(0,16)}|${r.status}`;
  const cronKeys=new Set(scheduled.map(key));
  const pureHttp=mixed.filter(r=>!cronKeys.has(`${r.dimensions.datetimeMinute.slice(0,16)}|${r.dimensions.status}`));
  const exactCron=[];
  for(const r of scheduled) {
    const group=mixed.find(g=>`${g.dimensions.datetimeMinute.slice(0,16)}|${g.dimensions.status}`===key(r));
    if(group?.sum.requests===1&&group.sum.cpuTimeUs===r.cpuTimeUs)exactCron.push({...r,metrics:group});
  }
  const totalRequests=mixed.reduce((s,r)=>s+r.sum.requests,0),totalCPU=mixed.reduce((s,r)=>s+r.sum.cpuTimeUs,0);
  const daily=scheduled.filter(r=>w.revision==='0.2.16'&&r.scheduledDatetime.startsWith('2026-10-09T06:30:'));
  const ordinary=scheduled.filter(r=>!daily.includes(r));
  const cpu=rows=>dist(rows.map(r=>r.cpuTimeUs/1000));
  output.production.push({revision:w.revision,start:w.start,end:w.end,scheduled:cpu(scheduled),success:cpu(scheduled.filter(r=>r.status==='success')),failed:scheduled.filter(r=>r.status!=='success'),ordinary:w.revision==='0.2.16'?cpu(ordinary):null,daily,dailyClassification:'Only 0.2.16 06:30 is independently known as replanning from prior production report and next_insights_at; others have no direct origin dimension',
    exactCronMatches:exactCron.length,cronWallMs:dist(exactCron.map(r=>r.metrics.sum.wallTime/1000)),cronMemoryMiB:dist(exactCron.map(r=>r.metrics.max.memoryUsageBytes/1048576)),
    cronSubrequests:dist(exactCron.map(r=>r.metrics.sum.subrequests)),maxAllTypesMemoryMiB:Math.max(...mixed.map(r=>r.max.memoryUsageBytes))/1048576,
    pureHttpGroups:pureHttp.length,pureHttpRequests:pureHttp.reduce((s,r)=>s+r.sum.requests,0),pureHttpCPUmeanMs:pureHttp.reduce((s,r)=>s+r.sum.cpuTimeUs,0)/pureHttp.reduce((s,r)=>s+r.sum.requests,0)/1000,
    inferredHttpRequests:totalRequests-scheduled.length,inferredHttpCPUmeanMs:(totalCPU-scheduled.reduce((s,r)=>s+r.cpuTimeUs,0))/(totalRequests-scheduled.length)/1000,
    failedMetrics:exactCron.filter(r=>r.status!=='success').map(({cpuTimeUs,scheduledDatetime,metrics})=>({scheduledDatetime,cpuMs:cpuTimeUs/1000,wallMs:metrics.sum.wallTime/1000,memoryMiB:metrics.max.memoryUsageBytes/1048576,subrequests:metrics.sum.subrequests})),
    inferenceAssumption:'Scheduled dataset complete; adaptive data not sampled/truncated; backend entrypoints only fetch and scheduled. Pure HTTP groups exclude any minute/status with Scheduled. No HTTP percentile inferred from mixed groups.',
  });
}
const req=createRequire(new URL('backend/package.json',root)),wr=createRequire(req.resolve('wrangler'));
const {SourceMapConsumer}=wr('source-map');
const maps={
  production:new SourceMapConsumer(await readFile(new URL('backend/dist/index.js.map',root),'utf8')),
  harness:new SourceMapConsumer(await readFile(new URL('tmp/cron-cpu-audit/harness-worker.mjs.map',root),'utf8')),
};
const category=source=>source.includes('drizzle-orm')?'Drizzle':source.includes('/zod/')?'Zod':source.includes('platform/database/schema')?'database schema':source.includes('domain/periods')?'calendar':source.includes('docs/cron-cpu-audit')?'harness':source.includes('backend/src')||source.startsWith('src/')?'application':source.includes('cloudflare-internal:d1')?'D1 binding':source.includes('cloudflare-internal:')?'runtime JS binding':null;
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
for(const [name,map] of [['startup-production-bundle','production'],['cold-empty','production'],['daily-1x','harness'],['daily-10x','harness'],['comments-1x','harness'],['discovery_new-1x','harness']]) {
  const p=await read(`${name}.cpuprofile`),nodes=new Map(p.nodes.map(n=>[n.id,n])),parents=new Map(),weights=new Map(),buckets={};
  for(const n of p.nodes)for(const child of n.children??[])parents.set(child,n.id);
  const source=n=>{const f=n.callFrame;if(f.url.includes('mjs')&&f.lineNumber>=0){const s=maps[map].originalPositionFor({line:f.lineNumber+1,column:Math.max(f.columnNumber,0)}).source;return s??f.functionName;}return f.url||f.functionName;};
  for(let i=0;i<p.samples.length;i++) {
    const id=p.samples[i],n=nodes.get(id),time=p.timeDeltas[i];if(n.callFrame.functionName==='(idle)')continue;
    let label=n.callFrame.functionName==='(garbage collector)'?'GC':n.callFrame.functionName==='(program)'?'native/program':null;
    let current=id;
    while(!label&&current){label=category(source(nodes.get(current)));current=parents.get(current);}
    label??='unattributed/helpers';buckets[label]=(buckets[label]??0)+time;
    current=id;while(current){weights.set(current,(weights.get(current)??0)+time);current=parents.get(current);}
  }
  output.profiles.push({name,activeMs:[...Object.values(buckets)].reduce((x,y)=>x+y,0)/1000,attributedMs:Object.fromEntries(Object.entries(buckets).map(([k,v])=>[k,v/1000])),method:'One statistical sample trace; disjoint leaf time attributed to nearest source-mapped ancestor. Not an invocation-stage production decomposition.'});
  if(['cold-empty','daily-1x'].includes(name)) {
    const total=weights.get(p.nodes[0].id),bars=[];let maxDepth=0;
    const draw=(id,x,depth)=>{const n=nodes.get(id),us=weights.get(id)??0;if(!us)return;maxDepth=Math.max(maxDepth,depth);const width=us/total*1160;const label=n.callFrame.functionName||'(anonymous)';const hue=[...label].reduce((s,c)=>s+c.charCodeAt(0),0)%65;bars.push(`<g><title>${escape(label)} — ${fmt(us/1000)} ms inclusive; ${escape(source(n))}:${n.callFrame.lineNumber+1}</title><rect x="${x}" y="${72+depth*19}" width="${width}" height="18" fill="hsl(${hue} 80% 70%)" stroke="white" stroke-width="0.5"/>${width>35?`<text x="${x+3}" y="${85+depth*19}" font-size="10">${escape(label.slice(0,Math.floor(width/6)))}</text>`:''}</g>`);let offset=x;for(const child of n.children??[]){draw(child,offset,depth+1);offset+=(weights.get(child)??0)/total*1160;}};
    draw(p.nodes[0].id,20,0);
    await writeFile(new URL(`${name}-flamegraph.svg`,out),`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${110+maxDepth*19}" viewBox="0 0 1200 ${110+maxDepth*19}" font-family="Arial,sans-serif"><rect width="100%" height="100%" fill="#fafaf8"/><text x="20" y="28" font-size="18">${escape(name)} — local workerd, ${fmt(total/1000)} ms sampled active</text><text x="20" y="51" font-size="12">Idle removed. Hover a frame for its stack cost. One trace; this is not billed production CPU.</text>${bars.join('')}</svg>`);
  }
}
// Runtime static imports after erasing type-only syntax. Dynamic HTTP import is excluded.
const seen=new Set(),external=new Set();
async function walk(file){if(seen.has(file))return;seen.add(file);const text=stripTypeScriptTypes(await readFile(new URL(file,root),'utf8'),{mode:'transform'});for(const m of text.matchAll(/(?:import\s+(?:[^;]+?\s+from\s+)?|export\s+[^;]*?\s+from\s+)['"]([^'"]+)['"]/g)){const spec=m[1];if(!spec.startsWith('.')){external.add(spec);continue;}const base=path.posix.normalize(path.posix.join(path.posix.dirname(file),spec));for(const f of [`${base}.ts`,`${base}/index.ts`]){try{await readFile(new URL(f,root));await walk(f);break;}catch(e){if(e.code!=='ENOENT')throw e;}}}}
await walk('backend/src/index.ts');output.runtimeImports=[...seen].sort();output.externalStaticImports=[...external].sort();
for(const scale of [1,10])for(const scenario of ['empty_enabled','insights','comments','daily']) {const a=node.scenarios.find(s=>s.scenario===scenario&&s.scale===scale),b=node.scenarios.find(s=>s.scenario===`${scenario}_uninstrumented`&&s.scale===scale);output.instrumentation.push({scenario,scale,instrumentedP50:a.summary.mainCpuMs.p50,uninstrumentedP50:b.summary.mainCpuMs.p50,differenceP50:a.summary.mainCpuMs.p50-b.summary.mainCpuMs.p50,nEach:40,limitation:'Sequential control, JIT/GC/order not paired; negative differences are noise, not a negative overhead.'});}
await writeFile(new URL('analysis.json',out),JSON.stringify(output,null,2));
const lines=['<!-- Generated from saved evidence by analyze.mjs. -->','', '| Local workerd scenario | 1x CPU p50 / p95 / max, ms | 10x CPU p50 / p95 / max, ms | 1x wall p50 / p95 / max, ms | 10x wall p50 / p95 / max, ms |','|---|---:|---:|---:|---:|'];
const triple=d=>`${fmt(d.p50)} / ${fmt(d.p95)} / ${fmt(d.max)}`;
for(const a of worker.scenarios.filter(s=>s.scale===1&&s.activeMs)){const b=worker.scenarios.find(s=>s.scenario===a.scenario&&s.scale===10);lines.push(`| ${a.scenario} (n=30) | ${triple(a.activeMs)} | ${triple(b.activeMs)} | ${triple(a.wallMs)} | ${triple(b.wallMs)} |`);}
lines.push('','| Node scenario | 1x CPU p50 / p95 / max | SQL p50 | Remaining main-thread CPU p50 | 10x CPU p50 / p95 / max | SQL p50 at 10x | SQL statements / returned rows 1x → 10x |','|---|---:|---:|---:|---:|---:|---:|');
for(const a of node.scenarios.filter(s=>s.scale===1&&!s.scenario.includes('uninstrumented'))){const b=node.scenarios.find(s=>s.scenario===a.scenario&&s.scale===10);lines.push(`| ${a.scenario} (n=40) | ${triple(a.summary.mainCpuMs)} | ${fmt(a.summary.sqlCpuMs.p50)} | ${fmt(a.summary.nonSqlCpuMs.p50)} | ${triple(b.summary.mainCpuMs)} | ${fmt(b.summary.sqlCpuMs.p50)} | ${a.summary.queries.p50} / ${a.summary.rows.p50} → ${b.summary.queries.p50} / ${b.summary.rows.p50} |`);}
await writeFile(new URL('tables.md',out),lines.join('\n')+'\n');
console.log(JSON.stringify({production:output.production,profiles:output.profiles,runtimeImports:output.runtimeImports.length,external:output.externalStaticImports,instrumentation:output.instrumentation},null,2));
