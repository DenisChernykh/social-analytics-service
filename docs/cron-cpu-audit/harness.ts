// Diagnostic harness only. All identifiers, text, tokens and responses are synthetic.
// This file is not imported by the backend or shipped to production.
import { createScheduledOperations } from '../../backend/src/app/create-features';
import { D1Collection } from '../../backend/src/modules/collection/infrastructure/d1-collection';
import { D1Insights } from '../../backend/src/modules/account-insights/infrastructure/d1-insights';
import { activityPeriodPlan } from '../../backend/src/modules/account-insights/domain/periods';
import { activityMetrics } from '../../backend/src/modules/account-insights/domain/model';
import { selectWork } from '../../backend/src/modules/collection/domain/selection';
import { MetaClient } from '../../backend/src/modules/instagram/infrastructure/meta-client';
import { D1RequestPolicy } from '../../backend/src/modules/instagram/infrastructure/d1-request-policy';
import { TokenCipher } from '../../backend/src/platform/crypto/secrets';
export const now = Date.parse('2026-10-09T06:30:00Z');
export const day = 86400000;
export const accountId = 'ig_17841490000000001';
const key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; // public test key
const zone = 'Asia/Yekaterinburg';
let measure = async (_name: string, fn: () => any) => fn();
export function instrumentation(fn: typeof measure) { measure = fn; }
const wrap = (object: any, prefix: string) => {
  for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(object))) {
    if (name === 'constructor' || typeof object[name] !== 'function') continue;
    const fn = object[name].bind(object);
    object[name] = (...args: any[]) => measure(`${prefix}.${name}`, () => fn(...args));
  }
  return object;
};
export const envFor = (DB: any) => ({DB, ENVIRONMENT:'production', INSTAGRAM_API_VERSION:'v26.0',
  INSTAGRAM_REDIRECT_URI:'https://example.invalid/callback', BUILD_REVISION:'0.2.16',
  API_KEY:'synthetic-public-test-key', TOKEN_ENCRYPTION_KEY:key,
  INSTAGRAM_CLIENT_ID:'synthetic-client', INSTAGRAM_CLIENT_SECRET:'synthetic-secret'});
const run = (db:any, sql:string, values:any[]=[]) => db.prepare(sql).bind(...values).run();
export async function seed(DB:any, scale:number) {
  await run(DB,'INSERT INTO accounts(id,platform,external_id,username,account_type,connected_at) VALUES(?,?,?,?,?,?)', [accountId,'instagram','17841490000000001','synthetic','MEDIA_CREATOR',now-90*day]);
  await run(DB,'INSERT INTO instagram_connections(account_id,encrypted_token,expires_at,refreshed_at,scopes) VALUES(?,?,?,?,?)',
    [accountId,await new TokenCipher(key).encrypt('synthetic-local-token',accountId),now+60*day,now,JSON.stringify(['instagram_business_basic','instagram_business_manage_insights','instagram_business_manage_comments'])]);
  const statements=[];
  for(let i=0;i<247*scale;i++) {
    const id=`ig_media_${18000000000000000n+BigInt(i)}`;
    statements.push(DB.prepare('INSERT INTO media(id,account_id,external_id,caption,search_text,media_type,product_type,permalink,published_at,updated_at,first_discovered_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id,accountId,String(18000000000000000n+BigInt(i)),'Synthetic caption','synthetic','VIDEO','REELS','https://www.instagram.com/reel/synthetic/',now-(60+(i%300))*day,now,now-90*day));
    const metrics=Object.fromEntries(['views','reach','likes','comments','saves','shares','reposts','totalInteractions','averageWatchTimeMs','totalWatchTimeMs','skipRate','facebookViews'].map(metric=>[metric,{value:metric==='comments'?15:1000,reason:null,sourceField:metric,unit:'count',provenance:{responseReceivedAt:now,definitionVersion:'instagram-measurement-v2'}}]));
    for(let s=0;s<(i%247<4?2:3);s++) statements.push(DB.prepare('INSERT INTO media_snapshots(id,media_id,observed_at,api_version,metrics_json) VALUES(?,?,?,?,?)')
      .bind(`seed-snapshot-${i}-${s}`,id,now-s*day,'v26.0',JSON.stringify(metrics)));
    statements.push(DB.prepare('INSERT INTO comment_media_state(media_id,last_complete_at,next_refresh_at,last_comments_count) VALUES(?,?,?,?)').bind(id,now,now+7*day,15));
  }
  for(let i=0;i<3791*scale;i++) statements.push(DB.prepare('INSERT INTO comments(id,media_id,parent_id,text,published_at,observed_at) VALUES(?,?,?,?,?,?)')
    .bind(`seed-comment-${i}`,`ig_media_${18000000000000000n+BigInt(i%(247*scale))}`,null,'Synthetic comment text',now-day,now));
  for(let i=0;i<226*scale;i++) statements.push(DB.prepare('INSERT INTO collection_jobs(id,account_id,origin,status,next_attempt_at,started_at,completed_at,automatic) VALUES(?,?,?,?,?,?,?,?)')
    .bind(`seed-job-${i}`,accountId,'scheduled','completed',now,now-i*300000,now,1));
  const periods=activityPeriodPlan(now,zone,[]).periods;
  for(let i=0;i<137*scale;i++) {
    const p=periods[i%periods.length];
    const input={kind:i%137<52?'activity':'demographics',from:p.from,to:p.to,timeZone:zone,metricType:'total_value',metrics:activityMetrics};
    const payload={id:`seed-insight-${i}`,accountId,input,status:'completed',requestedAt:now-3*day,observedAt:now,
      apiVersion:'v26.0',values:activityMetrics.map(metric=>({metric,value:1,reason:null,points:[],breakdowns:[]})),errorCode:null};
    statements.push(DB.prepare('INSERT INTO account_insights(id,account_id,signature,observed_at,payload_json) VALUES(?,?,?,?,?)').bind(payload.id,accountId,'synthetic-seed',now,JSON.stringify(payload)));
  }
  // Replicate receipt history without storing any private production response.
  for(let i=0;i<500*scale;i++) statements.push(DB.prepare('INSERT INTO instagram_http_attempts(id,account_id,operation_id,object_id,requested_at,received_at,payload_json) VALUES(?,?,?,?,?,?,?)')
    .bind(`seed-receipt-${i}`,accountId,null,'synthetic',now-i*1000,now,JSON.stringify({result:'success',sample:null})));
  for(let i=0;i<5765*scale;i++) statements.push(DB.prepare('INSERT INTO comment_collections(id,media_id,signature,observed_at,result_json,job_id,parent_id,page_fingerprint) VALUES(?,?,?,?,?,?,?,?)')
    .bind(`seed-collection-${i}`,`ig_media_${18000000000000000n+BigInt(i%(247*scale))}`,'synthetic',now,JSON.stringify({status:'completed',collected:1,startedAt:now-1000}),`seed-job-${i%(226*scale)}`,null,`synthetic-fingerprint-${i}`));
  for(let i=0;i<statements.length;i+=60) await DB.batch(statements.slice(i,i+60));
  return {media:247*scale,snapshots:737*scale,comments:3791*scale,commentCollections:5765*scale,jobs:226*scale,insights:137*scale,receipts:500*scale,periods:periods.length};
}
const queue = () => activityPeriodPlan(now,zone,[]).periods;
export async function reset(DB:any, scenario:string, scale:number) {
  const deletes=['collection_schedules','collection_policy_history','sync_runs','sync_leases','account_snapshots','instagram_api_state','instagram_metric_support'];
  for(const table of deletes) await run(DB,`DELETE FROM ${table}`);
  await run(DB,"DELETE FROM collection_jobs WHERE id NOT LIKE 'seed-job-%'");
  await run(DB,"UPDATE collection_jobs SET status='completed',origin='scheduled',cursor=NULL,lease_token=NULL,lease_expires_at=NULL,last_attempt_at=NULL");
  await run(DB,"DELETE FROM account_insights WHERE id NOT LIKE 'seed-insight-%'");
  await run(DB,"DELETE FROM instagram_http_attempts WHERE id NOT LIKE 'seed-receipt-%'");
  await run(DB,"DELETE FROM comments WHERE id NOT LIKE 'seed-comment-%'");
  await run(DB,"DELETE FROM comment_collections WHERE id NOT LIKE 'seed-collection-%'");
  await run(DB,"DELETE FROM media_snapshots WHERE id NOT LIKE 'seed-snapshot-%'");
  await run(DB,"DELETE FROM media WHERE id NOT LIKE 'ig_media_18%'");
  await run(DB,'UPDATE comment_media_state SET next_refresh_at=?,last_complete_at=?,last_comments_count=15,event_generation=0,processed_generation=0', [now+7*day,now]);
  if(scenario==='empty' || scenario==='noop') return;
  const schedule=['empty_enabled','discovery','discovery_new','daily','daily_large'].includes(scenario);
  if(schedule) await run(DB,'INSERT INTO collection_schedules(account_id,enabled,discovery_minutes,time_zone,next_catalogue_at,next_discovery_at,next_stories_at,next_insights_at,updated_at,retry_at) VALUES(?,1,60,?,?,?,?,?,?,0)',
    [accountId,zone,now+30*day,scenario.startsWith('discovery')?now:now+day,now+day,scenario.startsWith('daily')?now:now+day,now-day]);
  if(['insights','comments','comments_large','daily','daily_large','backlog','selection'].includes(scenario)) {
    const origin=scenario.startsWith('comments')?'comments':'activity';
    const cursor=origin==='comments'?null:JSON.stringify(queue());
    const count=scenario==='backlog'?226*scale:scenario==='selection'?4:1;
    for(let i=0;i<count;i++) await run(DB,'INSERT INTO collection_jobs(id,account_id,origin,status,cursor,next_attempt_at,started_at,automatic,latency_origin) VALUES(?,?,?,?,?,?,?,?,?)',
      [`audit-job-${i}`,accountId,origin,'running',cursor,now,now-300000-i,1,'recorded_from_creation']);
  }
}
const rawComment=(id:string,parent?:string)=>({id,text:'Synthetic comment with a representative short text.',timestamp:new Date(now-day).toISOString(),parent_id:parent??null,from:{id:'17840000000000000',username:'synthetic'},like_count:2,hidden:false});
export function transport(DB:any, scenario:string, onRequest=()=>{}, traced=false) {
  let calls=0;
  const large=scenario==='comments_large';
  const comments=Array.from({length:5},(_,i)=>{
    const id=String(19000000000000000n+BigInt(i));
    return {...rawComment(id),replies:{data:Array.from({length:large?49:4},(_,j)=>rawComment(String(19100000000000000n+BigInt(i*100+j)),id)),paging:{next:'https://graph.instagram.com/synthetic',cursors:{after:`reply-after-${i}`}}}};
  });
  const commentBody=JSON.stringify({data:comments,paging:{next:'https://graph.instagram.com/synthetic',cursors:{after:'outer-after'}}});
  const media={id:'19900000000000001',caption:'Synthetic new publication',media_type:'VIDEO',media_product_type:'REELS',permalink:'https://www.instagram.com/reel/synthetic-new/',timestamp:new Date(now-day).toISOString(),like_count:30,comments_count:15};
  const profileBody=JSON.stringify({user_id:'17841490000000001',username:'synthetic',account_type:'MEDIA_CREATOR',followers_count:1000,media_count:247});
  const fakeFetch=async (input:any,_init:any)=>measure('mock.response',async()=>{
    onRequest(); calls++;
    const url=new URL(String(input));
    if(url.origin!=='https://graph.instagram.com') throw new Error('Synthetic HTTP guard');
    let body:string;
    if(url.pathname.endsWith('/comments') || url.pathname.endsWith('/replies')) body=commentBody;
    else if(url.pathname.endsWith('/insights')) body=JSON.stringify({data:(url.searchParams.get('metric')??'reach').split(',').map(name=>({name,period:'day',total_value:{value:10}}))});
    else if(url.pathname.endsWith('/media') || url.pathname.endsWith('/stories')) body=JSON.stringify({data:scenario==='discovery_new'?[media]:[]});
    else if(url.searchParams.get('fields')?.includes('account_type')) body=profileBody;
    else body=JSON.stringify(media);
    return new Response(body,{status:200,headers:{'Content-Type':'application/json','facebook-api-version':'v26.0'}});
  });
  const policy=traced?wrap(new D1RequestPolicy(DB),'policy'):new D1RequestPolicy(DB);
  const counters={attempts:0};
  return {options:{clock:()=>now,transport:(config:any)=>new MetaClient(config,fakeFetch as typeof fetch,{policy,clock:()=>now,budget:{maxAttempts:6,attempts:0,deadlineAt:now+90000,reserveMs:15000},counters})},calls:()=>calls};
}
export async function invoke(DB:any, scenario:string, traced=false) {
  if(scenario==='noop') return null;
  if(scenario==='selection' || scenario==='backlog') {
    const store=wrap(new D1Collection(DB),'collection');
    const heads=await store.workHeads(now);
    const candidates=[];
    for(const id of new Set(Object.values(heads).filter(Boolean))) {
      const job=await store.job(id);
      candidates.push({kind:'job' as const,id:job.id,dueAt:job.nextAttemptAt,deadline:JSON.parse(job.cursor)[0].from+90*day,cost:3,archive:true});
    }
    return selectWork(candidates,now,Math.floor(now/300000));
  }
  const fake=transport(DB,scenario,()=>{},traced);
  const operations=await measure('composition',()=>createScheduledOperations(envFor(DB) as any,fake.options,()=>now));
  if(traced) {
    for(const [property,label] of [['store','collection'],['analytics','analytics'],['comments','comments']] as const) wrap((operations as any)[property],label);
  }
  const result=await operations.tick();
  return {result,calls:fake.calls()};
}
export async function validate(DB:any) {
  const jobs=(await DB.prepare("SELECT status,error_code,origin,pages,collected FROM collection_jobs WHERE id NOT LIKE 'seed-job-%' ORDER BY id LIMIT 3").all()).results;
  if(jobs.some((j:any)=>j.error_code)) throw new Error(`Synthetic scenario failed: ${JSON.stringify(jobs)}`);
  const error=await DB.prepare('SELECT error_code FROM collection_schedules WHERE error_code IS NOT NULL').first();
  if(error) throw new Error(`Synthetic schedule failed: ${JSON.stringify(error)}`);
  return jobs;
}
export {activityPeriodPlan, D1Collection, D1Insights};
export default {async fetch(request:Request, env:any) {
  const url=new URL(request.url),scenario=url.searchParams.get('scenario')??'empty',scale=Number(url.searchParams.get('scale')??1);
  if(url.pathname==='/seed') return Response.json(await seed(env.DB,scale));
  if(url.pathname==='/reset') {await reset(env.DB,scenario,scale);return new Response('ok');}
  if(url.pathname==='/validate') return Response.json(await validate(env.DB));
  if(url.pathname==='/calendar') return Response.json(activityPeriodPlan(now,zone,[]).coverage);
  return Response.json(await invoke(env.DB,scenario));
}};
