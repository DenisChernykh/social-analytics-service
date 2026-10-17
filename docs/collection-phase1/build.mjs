import { createRequire } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = new URL('../../', import.meta.url).pathname;
const out = path.join(root, 'tmp/collection-phase1');
const require = createRequire(path.join(root, 'backend/package.json'));
const tools = createRequire(require.resolve('wrangler'));
const { build } = tools('esbuild');
const sha256 = (contents) => createHash('sha256').update(contents).digest('hex');
await mkdir(out, { recursive: true });
const baseline = JSON.parse(await readFile(path.join(root, 'docs/collection-phase1/baseline-source-manifest.json'), 'utf8'));
if (sha256(await readFile(path.join(root, 'docs/collection-phase1/baseline-backend-src.tar.gz'))) !== baseline.archiveSHA256)
  throw new Error('Immutable baseline archive hash mismatch');
if (!existsSync(path.join(out, 'before/backend/src'))) {
  await mkdir(path.join(out, 'before'), { recursive: true });
  execFileSync('tar', ['-xzf', path.join(root, 'docs/collection-phase1/baseline-backend-src.tar.gz'), '-C', path.join(out, 'before')]);
}
for (const [filename, hash] of Object.entries(baseline.files))
  if (sha256(await readFile(path.join(out, 'before', filename))) !== hash)
    throw new Error(`Immutable baseline file hash mismatch: ${filename}`);
const manifest = { node: process.version, versions: {}, builds: {} };
for (const library of ['wrangler', 'miniflare', 'workerd', 'esbuild'])
  manifest.versions[library] = (library === 'wrangler' ? require : tools)(`${library}/package.json`).version;
for (const version of ['before', 'after']) {
  const source = version === 'before' ? path.join(out, 'before/backend/src') : path.join(root, 'backend/src');
  const redirect = {
    name: 'immutable-baseline-source',
    setup(build) {
      build.onResolve({ filter: /^\./ }, (args) => {
        const original = path.resolve(args.resolveDir, args.path);
        const prefix = path.join(root, 'backend/src') + '/';
        if (!original.startsWith(prefix)) return;
        const target = path.join(source, original.slice(prefix.length));
        const resolved = [target, `${target}.ts`, path.join(target, 'index.ts')].find((p) => existsSync(p) && statSync(p).isFile());
        if (!resolved) throw new Error(`Unresolved baseline source: ${original}`);
        return { path: resolved };
      });
    },
  };
  for (const platform of ['node', 'worker']) {
    const outfile = path.join(out, `${version}-${platform}.mjs`);
    const result = await build({
      absWorkingDir: root,
      entryPoints: [platform === 'node' ? 'backend/test/collection-phase1-runner.ts' : 'docs/collection-phase1/worker-entry.ts'],
      outfile, bundle: true, format: 'esm', platform: platform === 'node' ? 'node' : 'browser',
      target: 'es2022', plugins: [redirect], metafile: true, sourcemap: true,
      nodePaths: [path.join(root, 'backend/node_modules')],
    });
    const inputs = {};
    for (const filename of Object.keys(result.metafile.inputs).filter((p) => p.includes('/src/') && !p.includes('node_modules'))) {
      const contents = await readFile(path.resolve(root, filename));
      inputs[filename] = createHash('sha256').update(contents).digest('hex');
    }
    manifest.builds[`${version}-${platform}`] = {
      bundleSHA256: createHash('sha256').update(await readFile(outfile)).digest('hex'),
      sourceInputsSHA256: inputs,
    };
  }
}
manifest.fixturesSHA256 = createHash('sha256').update(await readFile(path.join(root, 'backend/test/collection-phase1-fixtures.ts'))).digest('hex');
manifest.harnessSHA256 = {};
for (const filename of ['backend/test/collection-phase1-runner.ts', 'docs/collection-phase1/worker-entry.ts', 'docs/collection-phase1/node-profile.mjs', 'docs/collection-phase1/workerd-profile.mjs', 'docs/collection-phase1/build.mjs'])
  manifest.harnessSHA256[filename] = sha256(await readFile(path.join(root, filename)));
await writeFile(path.join(root, 'docs/collection-phase1/build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ builds: Object.keys(manifest.builds), fixturesSHA256: manifest.fixturesSHA256 }));
