import { readCF, account } from './read-cloudflare.mjs';
import { readFile, writeFile } from 'node:fs/promises';
const out=new URL('./cloudflare-inventory.json',import.meta.url);
const inventory=JSON.parse(await readFile(out));
const results=await Promise.allSettled([
  readCF(`/accounts/${account}/workers/scripts/api/versions/e659a098-741f-47ba-891f-ad25274efa70`),
  readCF(`/accounts/${account}/workers/scripts/api/script-settings`),
]);
inventory.runtimeCheck={checkedAt:new Date().toISOString()};
for(let i=0;i<results.length;i++) {
  const r=results[i];if(r.status==='rejected'){inventory.runtimeCheck[i?'scriptSettings':'version']={error:r.reason.message};continue;}
  const v=r.value.result,m=v.resources?.script??{};
  inventory.runtimeCheck[i?'scriptSettings':'version']=i?{logpush:v.logpush,observability:v.observability,tailConsumers:v.tail_consumers}:{id:v.id,usageModel:m.usage_model,limits:m.limits,compatibilityDate:m.compatibility_date,compatibilityFlags:m.compatibility_flags,scriptKeys:Object.keys(m)};
}
await writeFile(out,JSON.stringify(inventory,null,2));console.log(JSON.stringify(inventory.runtimeCheck));
