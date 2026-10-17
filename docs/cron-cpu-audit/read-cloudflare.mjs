import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
const root = new URL('../../', import.meta.url);
const config = JSON.parse(await readFile(new URL('backend/wrangler.jsonc', root), 'utf8'));
const profile = await readFile(`${homedir()}/Library/Preferences/.wrangler/config/social-analytics.toml`, 'utf8');
const credential = profile.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if (!credential) throw new Error('Existing Cloudflare authentication unavailable');
export async function readCF(path, body) {
  if (body && path !== '/graphql' && !path.endsWith('/query')) throw new Error('Read-only guard');
  if (path.endsWith('/query') && (!/^(SELECT|WITH|EXPLAIN QUERY PLAN SELECT|EXPLAIN QUERY PLAN WITH)\b/i.test(body.sql.trim()) || /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|PRAGMA|ATTACH)\b/i.test(body.sql))) throw new Error('SQL read-only guard');
  if (path === '/graphql' && /\bmutation\b/i.test(body.query)) throw new Error('GraphQL read-only guard');
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method: body ? 'POST' : 'GET', redirect: 'manual',
    headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
    ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok || result.success === false || result.errors?.length) {
    throw new Error(`Cloudflare HTTP ${response.status}: ${JSON.stringify(result.errors?.map(e => ({code:e.code,message:e.message})))}`);
  }
  return result;
}
export const account = config.account_id;
export const database = config.d1_databases[0].database_id;
export async function sql(statement, params=[]) {return (await readCF(`/accounts/${account}/d1/database/${database}/query`, {sql:statement, params})).result;}
if (process.argv[2] === 'inventory') {
  const output = {checkedAt: new Date().toISOString()};
  for (const [key,path] of Object.entries({settings:`/accounts/${account}/workers/scripts/api/settings`,deployments:`/accounts/${account}/workers/scripts/api/deployments`,subscriptions:`/accounts/${account}/subscriptions`})) {
    try {
      const {result} = await readCF(path);
      output[key] = key === 'settings' ? {usage_model: result.usage_model,limits:result.limits,logpush:result.logpush,observability:result.observability,bindings:result.bindings?.filter(b=>b.type==='plain_text'&&b.name==='BUILD_REVISION')} : key === 'subscriptions' ? result.map(r=>({product:r.rate_plan?.id,plan:r.rate_plan?.public_name,status:r.state})) : {deployments:result.deployments?.map(({id,created_on,versions,strategy})=>({id,created_on,versions,strategy}))};
    } catch(e) {output[key]={error:e.message};}
  }
  output.sourceMatch = {};
  const evidence = JSON.parse(await readFile(new URL('docs/cron-cpu-production-evidence.json',root)));
  for(const [file,sha] of Object.entries(evidence.release.sourceFilesSHA256)) {
    const current = createHash('sha256').update(await readFile(new URL(file,root))).digest('hex');
    if(current!==sha) output.sourceMatch[file]={expected:sha,actual:current};
  }
  await writeFile(new URL('docs/cron-cpu-audit/cloudflare-inventory.json',root), JSON.stringify(output,null,2));
  console.log(JSON.stringify(output,null,2));
}

if (process.argv[2] === 'bundle') {
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/api/content/v2`,{headers:{Authorization:`Bearer ${credential}`},redirect:'manual',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`Bundle read HTTP ${response.status}`);
  let bytes,name;
  if(response.headers.get('content-type')?.includes('multipart')) {
    const parts=await response.formData();
    const modules=[...parts.values()].filter(v=>typeof v!=='string'&&v.name.endsWith('.js')).sort((a,b)=>b.size-a.size);
    if(modules.length!==1)throw new Error(`Expected one JavaScript bundle, found ${modules.length}`);
    name=modules[0].name;bytes=Buffer.from(await modules[0].arrayBuffer());
  } else {name='script';bytes=Buffer.from(await response.arrayBuffer());}
  const local=await readFile(new URL('backend/dist/index.js',root));
  const check={checkedAt:new Date().toISOString(),name,bytes:bytes.length,remoteSHA256:createHash('sha256').update(bytes).digest('hex'),localSHA256:createHash('sha256').update(local).digest('hex'),equal:bytes.equals(local)};
  const dest=new URL('docs/cron-cpu-audit/cloudflare-inventory.json',root),inventory=JSON.parse(await readFile(dest));inventory.bundleCheck=check;await writeFile(dest,JSON.stringify(inventory,null,2));console.log(JSON.stringify(check));
}
