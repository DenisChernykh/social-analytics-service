import { writeFile } from 'node:fs/promises';
const root=new URL('../../',import.meta.url);
const h=await import(new URL('tmp/cron-cpu-audit/harness-node.mjs',root));
const cpu=()=>{const c=process.threadCpuUsage();return c.user+c.system;};
const dist=a=>{a.sort((x,y)=>x-y);return {n:a.length,p50:a[Math.ceil(a.length*.5)-1],p95:a[Math.ceil(a.length*.95)-1],max:a.at(-1)}};
const results=[];
for(const scenario of ['insights','comments_large']) {
  const samples=[];
  for(let i=-10;i<200;i++){const c=cpu(),t=performance.now();h.transport({},scenario);if(i>=0)samples.push({cpuMs:(cpu()-c)/1000,wallMs:performance.now()-t});}
  results.push({scenario,samples,cpuMs:dist(samples.map(s=>s.cpuMs)),wallMs:dist(samples.map(s=>s.wallMs))});
}
await writeFile(new URL('docs/cron-cpu-audit/mock-overhead.json',root),JSON.stringify({method:'Node main-thread CPU; transport() synthetic body preparation and policy construction included, no actual HTTP response/validation',results},null,2));
console.log(JSON.stringify(results.map(({scenario,cpuMs,wallMs})=>({scenario,cpuMs,wallMs}))));
