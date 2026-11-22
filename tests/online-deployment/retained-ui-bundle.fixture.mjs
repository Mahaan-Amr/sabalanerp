import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const verifySource = String.raw`const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const assert=require('node:assert/strict');
const manifest=JSON.parse(fs.readFileSync('/app/online-runtime-manifest.json'));
assert.equal(manifest.format,'sabalan-diagnostic-ui-bundle/v1');
const roots=['.next-online-runtime','public'];
const observed=[];
function walk(directory){for(const name of fs.readdirSync('/app/'+directory).sort()){
 const relative=directory+'/'+name,stat=fs.lstatSync('/app/'+relative);
 assert.ok(!stat.isSymbolicLink());
 if(stat.isDirectory())walk(relative);else{assert.ok(stat.isFile());observed.push(relative);}
}}
roots.forEach(walk);
const entries=manifest.files.map(file=>file.path);
assert.deepEqual(observed.sort(),entries.filter(file=>roots.some(root=>file.startsWith(root+'/'))).sort());
for(const file of manifest.files){const stat=fs.lstatSync('/app/'+file.path);assert.ok(stat.isFile()&&!stat.isSymbolicLink());
 const bytes=fs.readFileSync('/app/'+file.path);assert.equal(bytes.length,file.bytes);
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),file.sha256);}
assert.equal(fs.readFileSync('/app/.next-online-runtime/BUILD_ID','utf8').trim(),manifest.buildId);
console.log(JSON.stringify({verifiedDiagnosticBundle:true,buildId:manifest.buildId,files:manifest.files.length}));
`;

/** Freeze only a completed Next runtime, excluding its mutable build cache.
 * This is diagnostic image construction, not production release attestation. */
export async function prepareRetainedUiBundle({frontend, artifact, directory, baseImage}) {
  assert.match(baseImage, /^sha256:[a-f0-9]{64}$/);
  assert.equal(await fs.realpath(frontend), path.resolve(frontend));
  assert.equal(path.dirname(path.resolve(artifact)), path.resolve(frontend));
  assert.equal(await fs.realpath(artifact), path.resolve(artifact));
  await fs.mkdir(directory, {mode: 0o700});
  const files = [], assets = [];
  let total = 0;
  async function copy(source, relative) {
    assert.ok(!relative.split('/').some(part => !part || part === '.' || part === '..'));
    const stat = await fs.lstat(source);
    assert.ok(!stat.isSymbolicLink(), 'Runtime input must not be a symbolic link');
    if (stat.isDirectory()) {
      await fs.mkdir(path.join(directory, relative), {recursive: true});
      for (const name of (await fs.readdir(source)).sort()) await copy(path.join(source, name), relative + '/' + name);
      return;
    }
    assert.ok(stat.isFile());
    const bytes = await fs.readFile(source);
    total += bytes.length; assert.ok(total <= 256 * 1024 * 1024 && files.length < 20000);
    const after = await fs.lstat(source);
    assert.equal(stat.size, after.size); assert.equal(stat.mtimeMs, after.mtimeMs); assert.equal(stat.ino, after.ino);
    assert.equal(sha(await fs.readFile(source)), sha(bytes), 'Runtime input changed while freezing');
    const target = path.join(directory, relative);
    await fs.mkdir(path.dirname(target), {recursive: true}); await fs.writeFile(target, bytes, {flag: 'wx'});
    const runtimePath = relative.startsWith('runtime/') ? '.next-online-runtime/' + relative.slice(8) : relative;
    files.push({path: runtimePath, bytes: bytes.length, sha256: sha(bytes)});
    if (relative.startsWith('runtime/static/')) assets.push({path: '/_next/' + relative.slice(8), bytes: bytes.length, sha256: sha(bytes)});
  }
  const roots = await fs.readdir(artifact);
  for (const required of ['server', 'static', 'BUILD_ID', 'browser-build-identity.json', 'required-server-files.json']) assert.ok(roots.includes(required));
  for (const name of roots.sort()) if (['server', 'static', 'BUILD_ID'].includes(name) || name.endsWith('.json')) {
    await copy(path.join(artifact, name), 'runtime/' + name);
  }
  await copy(path.join(frontend, 'public'), 'public');
  for (const name of ['next.config.js', 'browser-build-identity.cjs']) await copy(path.join(frontend, name), name);
  const identity = JSON.parse(await fs.readFile(path.join(directory, 'runtime/browser-build-identity.json')));
  const buildId = (await fs.readFile(path.join(directory, 'runtime/BUILD_ID'), 'utf8')).trim();
  assert.equal(identity.format, 'sabalan-browser-build/v1'); assert.equal(identity.browserBuildId, buildId); assert.equal(identity.nativeBuildId, buildId);
  assert.match(buildId, /^erp_[a-z0-9_-]{8,90}$/);
  files.sort((a, b) => a.path.localeCompare(b.path)); assets.sort((a, b) => a.path.localeCompare(b.path));
  const manifest = {format: 'sabalan-diagnostic-ui-bundle/v1', baseImage, buildId, files};
  const bytes = Buffer.from(JSON.stringify(manifest) + '\n');
  await fs.writeFile(path.join(directory, 'online-runtime-manifest.json'), bytes, {flag: 'wx'});
  await fs.writeFile(path.join(directory, 'online-runtime-verify.cjs'), verifySource, {flag: 'wx'});
  return {buildId, manifestSha256: sha(bytes), assets, runtimeFiles: files.length, runtimeBytes: total};
}
