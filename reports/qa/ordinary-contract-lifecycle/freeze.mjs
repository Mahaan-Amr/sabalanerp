import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 20_000_000 });
const sha = data => createHash('sha256').update(data).digest('hex');
const paths = [...new Set([...git('diff', '--name-only', 'HEAD').trim().split('\n'),
  ...git('ls-files', '--others', '--exclude-standard').trim().split('\n')])]
  .filter(path => path && !path.startsWith('reports/qa/')).sort();
const sources = paths.map(path => ({ path, sha256: sha(readFileSync(path)), content: readFileSync(path, 'utf8') }));
const directory = 'reports/qa/ordinary-contract-lifecycle';
const patch = git('diff', '--binary', 'HEAD');
const bundle = JSON.stringify(sources, null, 2);
writeFileSync(`${directory}/candidate.patch`, patch);
writeFileSync(`${directory}/candidate.sources.json`, bundle);
const head = git('rev-parse', 'HEAD').trim();
const manifest = { capturedAt: new Date().toISOString(), base: head, head,
  scope: 'Working tree implementation from initially clean tracked HEAD; unrelated existing reports/qa excluded',
  patchSha256: sha(patch), sourceBundleSha256: sha(bundle), files: sources.map(({path,sha256})=>({path,sha256})) };
writeFileSync(`${directory}/candidate.json`, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ head, patchSha256: manifest.patchSha256, sourceBundleSha256:manifest.sourceBundleSha256, files: paths.length }));
