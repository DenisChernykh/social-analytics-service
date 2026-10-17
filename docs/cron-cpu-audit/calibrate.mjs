// Local profiler calibration only; no backend code or remote bindings.
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
const root = new URL('../../', import.meta.url);
const req = createRequire(new URL('backend/package.json', root));
const runtimeReq = createRequire(req.resolve('wrangler'));
const { Miniflare, convertV4MiniflareOptions } = runtimeReq('miniflare');
let calendarSource;
if (process.argv.includes('--calendar')) {
  const esbuild=runtimeReq('esbuild');
  const r=await esbuild.build({stdin:{contents:`import {activityPeriodPlan} from './backend/src/modules/account-insights/domain/periods';
  const now=Date.parse('2026-10-09T06:30:00Z');const all=Array.from({length:1030},(_,i)=>({from:now-i*86400000,to:now-(i-1)*86400000,observedAt:now}));
  const fixtures={0:[],52:all.slice(0,52),520:all.slice(0,520),1030:all};
  export default {fetch(r){const n=Number(new URL(r.url).pathname.slice(1));let p;for(let i=0;i<50;i++)p=activityPeriodPlan(now,'Asia/Yekaterinburg',fixtures[n]);return Response.json(p.coverage)}};`,resolveDir:root.pathname,loader:'ts'},write:false,bundle:true,format:'esm',platform:'browser',target:'es2022'});calendarSource=r.outputFiles[0].text;
}
const mf = new Miniflare(convertV4MiniflareOptions({
  name: 'calibration', host: '127.0.0.1', inspectorPort: 0, cf: false,
  compatibilityDate: '2026-08-28', modules: true,
  script: calendarSource ?? `export default {async fetch(request) {
    const kind = new URL(request.url).pathname;
    if (kind === '/wait') await scheduler.wait(50);
    if (kind === '/busy') { let x = 0; for (let i = 0; i < 10000000; i++) x += Math.sqrt(i); return Response.json({x}); }
    return Response.json({ok:true});
  }}`,
}));
const dist = a => { a.sort((x,y)=>x-y); return {n:a.length,p50:a[Math.ceil(a.length*.5)-1],p95:a[Math.ceil(a.length*.95)-1],max:a.at(-1)}; };
try {
  await mf.ready;
  const url = await mf.getInspectorURL(); url.pathname = '/core:user:calibration'; url.protocol = 'ws:';
  const ws = new WebSocket(url); await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
  let next = 0; const pending = new Map();
  ws.addEventListener('message',e=>{const r=JSON.parse(String(e.data));if(pending.has(r.id)){pending.get(r.id)(r.result);pending.delete(r.id);}});
  const send = (method,params={}) => new Promise(resolve=>{const id=++next;pending.set(id,resolve);ws.send(JSON.stringify({id,method,params}));});
  await send('Profiler.enable'); await send('Profiler.setSamplingInterval',{interval:100});
  const result = [];
  for (const kind of calendarSource ? ['0','52','520','1030'] : ['noop','wait','busy']) {
    for(let i=0;i<3;i++) await (await mf.dispatchFetch(`http://audit.local/${kind}`)).text();
    const samples=[];
    for(let i=0;i<20;i++) {
      await send('Profiler.start'); const start=performance.now();
      await (await mf.dispatchFetch(`http://audit.local/${kind}`)).text(); const wallMs=performance.now()-start;
      const {profile}=await send('Profiler.stop'); const nodes=new Map(profile.nodes.map(n=>[n.id,n]));
      let active=0,idle=0;
      for(let j=0;j<(profile.samples??[]).length;j++) {if(nodes.get(profile.samples[j])?.callFrame.functionName==='(idle)')idle+=profile.timeDeltas[j];else active+=profile.timeDeltas[j];}
      samples.push({activeMs:active/1000,idleMs:idle/1000,wallMs,longDeltas:profile.timeDeltas.map((us,j)=>({us,frame:nodes.get(profile.samples[j])?.callFrame.functionName})).filter(r=>r.us>2000)}); if(kind==='wait'&&active>2000)await writeFile(new URL('docs/cron-cpu-audit/calibration-wait-outlier.cpuprofile',root),JSON.stringify(profile));
    }
    result.push({kind,samples,activeMs:dist(samples.map(s=>s.activeMs)),wallMs:dist(samples.map(s=>s.wallMs))});
  }
  ws.close();
  await writeFile(new URL(calendarSource?'docs/cron-cpu-audit/calendar-isolated.json':'docs/cron-cpu-audit/calibration.json',root),JSON.stringify({method:calendarSource?'Each invocation synchronously computes 50 calendars, no D1 or other awaits; activeMs/50 estimates average calendar time including amortized harness': 'Same CDP statistical estimator as workerd-profile.mjs; wait is deliberately 50 ms; busy is 10M sqrt operations, not a wall-clock timer',result},null,2));
  console.log(JSON.stringify(result.map(({kind,activeMs,wallMs})=>({kind,activeMs,wallMs}))));
} finally { await mf.dispose(); }
