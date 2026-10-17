// Count SQL statements separately from D1 API calls (one batch is one API call).
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir, writeFile } from 'node:fs/promises';
const root=new URL('../../',import.meta.url);
const h=await import(new URL('tmp/cron-cpu-audit/harness-node.mjs',root));
class DB {
  sqlite=new DatabaseSync(':memory:'); depth=0; sqlStatements=0; bindingCalls=0;
  prepare(sql){const db=this;return new class {
    values=[];bind(...values){this.values=values;return this;}
    execute(raw=false){db.sqlStatements++;if(!db.depth)db.bindingCalls++;const s=db.sqlite.prepare(sql);s.setReturnArrays(raw);const results=s.columns().length?s.all(...this.values):[];const meta=s.columns().length?{changes:db.sqlite.prepare('SELECT changes() AS n').get().n}:s.run(...this.values);return {results,success:true,meta:{changes:Number(meta.changes??0)}};}
    async all(){return this.execute();}async raw(){return this.execute(true).results;}async first(column){const row=this.execute().results[0]??null;return column?row?.[column]??null:row;}async run(){return this.execute();}
  };}
  async batch(statements){this.bindingCalls++;this.depth++;this.sqlite.exec('SAVEPOINT audit');try{const r=await Promise.all(statements.map(s=>s.all()));this.sqlite.exec('RELEASE audit');return r;}catch(e){this.sqlite.exec('ROLLBACK TO audit');this.sqlite.exec('RELEASE audit');throw e;}finally{this.depth--;}}
}
const db=new DB();db.sqlite.exec('PRAGMA foreign_keys=ON');
for(const f of (await readdir(new URL('backend/migrations/',root))).filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(await readFile(new URL(`backend/migrations/${f}`,root),'utf8'));
await h.seed(db,1);const results=[];
for(const scenario of ['empty','empty_enabled','selection','discovery','discovery_new','insights','comments','comments_large','daily','backlog']) {
  await h.reset(db,scenario,1);db.sqlStatements=0;db.bindingCalls=0;
  const result=await h.invoke(db,scenario,false);results.push({scenario,sqlStatements:db.sqlStatements,d1BindingCalls:db.bindingCalls,externalFetches:result?.calls??0});await h.validate(db);
}
db.sqlite.close();
await writeFile(new URL('docs/cron-cpu-audit/query-counts.json',root),JSON.stringify({method:'Local real application path, counting all/run/raw/first as one call and batch as one call with multiple SQL statements; internal adapter SELECT changes() excluded',results},null,2));
console.log(JSON.stringify(results));
