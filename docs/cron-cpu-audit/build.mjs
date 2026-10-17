import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const root=new URL('../../',import.meta.url);
const require=createRequire(new URL('backend/package.json',root));
const toolRequire=createRequire(require.resolve('wrangler'));
export const esbuild=toolRequire('esbuild');
export const {Miniflare}=toolRequire('miniflare');
export const out=new URL('tmp/cron-cpu-audit/',root);
await mkdir(out,{recursive:true});
for(const [name,entry,platform] of [['harness-node','docs/cron-cpu-audit/harness.ts','node'],['harness-worker','docs/cron-cpu-audit/worker-entry.ts','browser'],['entry-operations','docs/cron-cpu-audit/operations-entry.ts','browser'],['entry-source','backend/src/index.ts','browser']]) {
  const result=await esbuild.build({absWorkingDir:root.pathname,entryPoints:[entry],outfile:new URL(`${name}.mjs`,out).pathname,bundle:true,format:'esm',platform,target:'es2022',metafile:true,sourcemap:true});
  await writeFile(new URL(`${name}-meta.json`,out),JSON.stringify(result.metafile));
}
