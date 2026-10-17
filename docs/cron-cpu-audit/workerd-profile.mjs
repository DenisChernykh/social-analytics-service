import { createRequire } from 'node:module';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
const root=new URL('../../',import.meta.url),out=new URL('docs/cron-cpu-audit/',root);
const req=createRequire(new URL('backend/package.json',root)),toolReq=createRequire(req.resolve('wrangler'));
const {Miniflare:Runtime,convertV4MiniflareOptions}=toolReq('miniflare');
function Miniflare(options){return new Runtime(convertV4MiniflareOptions(options));}
const base={name:'audit',compatibilityDate:'2026-08-28',compatibilityFlags:['nodejs_compat'],inspectorPort:0,cf:false,host:'127.0.0.1'};
const percentile=(a,p)=>[...a].sort((x,y)=>x-y)[Math.max(0,Math.ceil(a.length*p)-1)];
const dist=(a)=>({n:a.length,p50:percentile(a,.5),p95:percentile(a,.95),max:Math.max(...a)});
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();ws.addEventListener('message',e=>{const r=JSON.parse(String(e.data));const p=this.pending.get(r.id);if(p){this.pending.delete(r.id);r.error?p.reject(new Error(JSON.stringify(r.error))):p.resolve(r.result);}});}
  static async open(mf){const u=await mf.getInspectorURL();u.pathname='/core:user:audit';u.protocol='ws:';const ws=new WebSocket(u);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});const c=new CDP(ws);await c.send('Profiler.enable');await c.send('Profiler.setSamplingInterval',{interval:100});return c;}
  send(method,params={}){return new Promise((resolve,reject)=>{const id=++this.id;this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}
  close(){this.ws.close();}
}
function summary(profile){
  const nodes=new Map(profile.nodes.map(n=>[n.id,n]));
  let activeUs=0,idleUs=0,gcUs=0,programUs=0;
  const frames={};
  for(let i=0;i<(profile.samples??[]).length;i++){
    const n=nodes.get(profile.samples[i]),d=profile.timeDeltas[i]??0,name=n?.callFrame.functionName??'';
    if(name==='(idle)')idleUs+=d;else activeUs+=d;
    if(name==='(garbage collector)')gcUs+=d;
    if(name==='(program)')programUs+=d;
    const key=`${name}|${n?.callFrame.url??''}:${(n?.callFrame.lineNumber??-1)+1}`;
    frames[key]=(frames[key]??0)+d;
  }
  return {activeMs:activeUs/1000,idleMs:idleUs/1000,gcMs:gcUs/1000,programMs:programUs/1000,windowMs:(profile.endTime-profile.startTime)/1000,samples:profile.samples?.length??0,frames:Object.entries(frames).sort((a,b)=>b[1]-a[1]).slice(0,35).map(([frame,us])=>({frame,ms:us/1000}))};
}
const fetchJson=async(mf,path)=>{const r=await mf.dispatchFetch(`http://audit.local${path}`);const text=await r.text();if(!r.ok)throw new Error(`Local harness ${r.status}: ${text.slice(0,600)}`);return text?JSON.parse(text):null;};
async function capture(mf,cdp,path){await cdp.send('Profiler.start');const t=performance.now();const result=await fetchJson(mf,path);const wallMs=performance.now()-t;const {profile}=await cdp.send('Profiler.stop');return {summary:{...summary(profile),wallMs},profile,result};}
const report={environment:{node:process.version,workerd:toolReq('workerd/package.json').version,miniflare:toolReq('miniflare/package.json').version,cpu:os.cpus()[0].model,method:'workerd V8 statistical profiler, 100 us requested interval, active = sampled time minus (idle), same method as Wrangler startup; not billed production CPU; includes diagnostic HTTP/mock layer and local D1 binding, remote latency absent; sampled wait can be misattributed'},startup:[],scenarios:[],coldEmpty:[]};
const prod=await readFile(new URL('backend/dist/index.js',root),'utf8');
for(const [label,source] of [['production-bundle',prod],['operations-only-wrangler',await readFile(new URL('tmp/cron-cpu-audit/operations-wrangler/operations-entry.js',root),'utf8')],['minimal', 'export default {}']]){
  const samples=[];
  for(let i=0;i<12;i++) {
    const mf=new Miniflare({...base,modulesRoot:'/',modules:[{type:'ESModule',path:'/wrapper.mjs',contents:'export default {async fetch(){await import("./target.mjs");return Response.json({ok:true})}}'}, {type:'ESModule',path:'/target.mjs',contents:source}]});
    try {await mf.ready;const cdp=await CDP.open(mf);const sample=await capture(mf,cdp,'/');samples.push(sample.summary);if(i===0)await writeFile(new URL(`startup-${label}.cpuprofile`,out),JSON.stringify(sample.profile));cdp.close();}finally{await mf.dispose();}
  }
  report.startup.push({label,samples,activeMs:dist(samples.map(s=>s.activeMs)),wallMs:dist(samples.map(s=>s.wallMs))});console.log(JSON.stringify({label,activeMs:report.startup.at(-1).activeMs,wallMs:report.startup.at(-1).wallMs}));
}
if(process.argv.includes('--startup-only')) {await writeFile(new URL('startup-results.json',out),JSON.stringify(report,null,2));process.exit(0);}
const migrations=(await readdir(new URL('backend/migrations/',root))).filter(f=>f.endsWith('.sql')).sort();
for(const scale of [1,10]) {
  const mf=new Miniflare({...base,modules:true,scriptPath:new URL('tmp/cron-cpu-audit/harness-worker.mjs',root).pathname,d1Databases:{DB:'synthetic-local-audit-only'},outboundService:()=>new Response('External network disabled',{status:403})});
  try {
    await mf.ready;const db=await mf.getD1Database('DB');
    for(const file of migrations){const contents=await readFile(new URL(`backend/migrations/${file}`,root),'utf8');const statements=contents.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);for(const statement of statements)await db.prepare(statement).run();}
    const fixture=await fetchJson(mf,`/seed?scale=${scale}`),cdp=await CDP.open(mf);
    for(const scenario of ['noop','empty','empty_enabled','selection','discovery','discovery_new','insights','comments','comments_large','daily','backlog']) {
      const samples=[];let example,first;
      for(let i=-3;i<30;i++) {
        await (await mf.dispatchFetch(`http://audit.local/reset?scenario=${scenario}&scale=${scale}`)).text();
        if(i===-3){const s=await capture(mf,cdp,`/run?scenario=${scenario}`);first=s.summary;await writeFile(new URL(`first-${scenario}-${scale}x.cpuprofile`,out),JSON.stringify(s.profile));continue;}
        if(i<0){await fetchJson(mf,`/run?scenario=${scenario}`);continue;}
        const sample=await capture(mf,cdp,`/run?scenario=${scenario}`);samples.push(sample.summary);example=sample.result;
        await fetchJson(mf,'/validate');
        if(i===0)await writeFile(new URL(`${scenario}-${scale}x.cpuprofile`,out),JSON.stringify(sample.profile));
      }
      report.scenarios.push({scenario,scale,fixture,example,first,samples,activeMs:dist(samples.map(s=>s.activeMs)),wallMs:dist(samples.map(s=>s.wallMs))});
      console.log(JSON.stringify({scenario,scale,activeMs:report.scenarios.at(-1).activeMs,wallMs:report.scenarios.at(-1).wallMs}));
      await writeFile(new URL('workerd-results.json',out),JSON.stringify(report,null,2));
    }
    // Isolate cumulative calendar samples from all I/O to corroborate Intl's cost.
    await cdp.send('Profiler.start');const t=performance.now();for(let i=0;i<100;i++)await fetchJson(mf,'/calendar');const {profile}=await cdp.send('Profiler.stop');
    await writeFile(new URL(`calendar-${scale}x.cpuprofile`,out),JSON.stringify(profile));
    report.scenarios.push({scenario:'calendar_batch_100',scale,summary:summary(profile),wallMs:performance.now()-t});
    cdp.close();
  }finally{await mf.dispose();}
}
// A true cold import + exact production scheduled handler against empty local D1.
for(let i=0;i<12;i++) {
  const mf=new Miniflare({...base,d1Databases:{DB:'synthetic-local-cold-only'},modulesRoot:'/',modules:[{type:'ESModule',path:'/cold.mjs',contents:'export default {async fetch(r,env){const worker=(await import("./target.mjs")).default;let work;worker.scheduled({},env,{waitUntil(p){work=p}});await work;return Response.json({ok:true})}}'},{type:'ESModule',path:'/target.mjs',contents:prod}],bindings:{ENVIRONMENT:'production',INSTAGRAM_API_VERSION:'v26.0',INSTAGRAM_REDIRECT_URI:'https://example.invalid/callback',BUILD_REVISION:'0.2.16',INSTAGRAM_CLIENT_ID:'synthetic',INSTAGRAM_CLIENT_SECRET:'synthetic',TOKEN_ENCRYPTION_KEY:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='},outboundService:()=>new Response('External network disabled',{status:403})});
  try {await mf.ready;const db=await mf.getD1Database('DB');for(const file of migrations){for(const statement of (await readFile(new URL(`backend/migrations/${file}`,root),'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();}
    const cdp=await CDP.open(mf),cold=await capture(mf,cdp,'/'),warm=await capture(mf,cdp,'/');report.coldEmpty.push({cold:cold.summary,warm:warm.summary});if(i===0)await writeFile(new URL('cold-empty.cpuprofile',out),JSON.stringify(cold.profile));cdp.close();
  }finally{await mf.dispose();}
}
report.coldEmptySummary={cold:dist(report.coldEmpty.map(s=>s.cold.activeMs)),warm:dist(report.coldEmpty.map(s=>s.warm.activeMs))};
await writeFile(new URL('workerd-results.json',out),JSON.stringify(report,null,2));
