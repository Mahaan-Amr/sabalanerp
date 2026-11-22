import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..'), inquiryRoot = path.join(root, 'apps/sabalan-inquiry');
const canonical = process.env.SABALAN_LOCAL_REPOSITORY_ROOT || 'D:/sabalanerp';
const browserBuildId = process.env.SABALAN_INQUIRY_BUILD_ID;
assert.match(browserBuildId || '', /^inquiry_online_[a-f0-9]{32}$/, 'EXPLICIT_IMMUTABLE_INQUIRY_BUILD_ID_REQUIRED');
const protectedServices = ['backend', 'frontend', 'postgres', 'inquiry', 'redis', 'clamav',
  'backend-candidate', 'backend-retained', 'frontend-candidate', 'frontend-retained'];
function verify() {
  const output = execFileSync('docker', ['compose', '-f', path.join(canonical, 'docker-compose.local.yml'), 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows;
  try { const parsed = JSON.parse(output); rows = Array.isArray(parsed) ? parsed : [parsed]; }
  catch { rows = output.trim().split(/\r?\n/).map(line => JSON.parse(line)); }
  assert.equal(rows.length, protectedServices.length, 'CANONICAL_TEN_SERVICE_SET_REQUIRED');
  for (const service of protectedServices) assert.ok(rows.some(row =>
    row.Project === 'sabalanerp-local' && row.Service === service && row.State === 'running' && row.Health === 'healthy'));
  return rows;
}
function identity(service) {
  const name = verify().find(row => row.Service === service).Name;
  const [value] = JSON.parse(execFileSync('docker', ['inspect', name], { encoding: 'utf8' }));
  return { id: value.Id, image: value.Image, startedAt: value.State.StartedAt };
}
const before = Object.fromEntries(protectedServices.map(service => [service, identity(service)]));
verify();
const dependencyInventory = JSON.parse(execFileSync('docker', ['exec', before.inquiry.id, 'node', '-e', `
const fs=require('fs'),path=require('path');const root='/app/node_modules';let count=0,bytes=0;
function visit(file){const value=fs.lstatSync(file);if(++count>250000)throw Error('DEPENDENCY_INVENTORY_BOUND');
 if(value.isSymbolicLink()){const real=fs.realpathSync(file);if(!real.startsWith(root+'/'))throw Error('EXTERNAL_DEPENDENCY_ALIAS');}
 else if(value.isDirectory())for(const name of fs.readdirSync(file))visit(path.join(file,name));
 else if(value.isFile()){bytes+=value.size;if(bytes>2147483648)throw Error('DEPENDENCY_BYTES_BOUND');}
 else throw Error('SPECIAL_DEPENDENCY_FILE');}
visit(root);console.log(JSON.stringify({count,bytes}));`], { encoding: 'utf8', timeout: 30000 }));
const sourceNames = execFileSync('git', ['ls-files', '-z'], { cwd: inquiryRoot, encoding: 'utf8' }).split('\0').filter(Boolean);
sourceNames.push('instrumentation.ts', 'lib/runtime-work.ts', 'tests/runtime-work.test.cjs');
const files = {};
for (const name of [...new Set(sourceNames)]) {
  if (!/^(?:app|components|lib|prisma|public|tests)\//.test(name)
    && !['package.json', 'package-lock.json', 'tsconfig.json', 'next.config.ts', 'next-env.d.ts', 'postcss.config.mjs', 'eslint.config.mjs', 'instrumentation.ts'].includes(name)) continue;
  assert.ok(!name.split('/').includes('..') && !name.split('/').some(value => value.startsWith('.env')));
  if (/\.(?:db|sqlite|tsbuildinfo)$/.test(name)) continue;
  const file = path.join(inquiryRoot, name);
  if (fs.existsSync(file)) files[name] = fs.readFileSync(file);
}
const total = Object.values(files).reduce((sum, bytes) => sum + bytes.length, 0);
assert.ok(total > 1000 && total < 32 * 1024 * 1024);
const sourceHashes = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]));
const directory = '/tmp/sabalan-inquiry-build-' + randomBytes(16).toString('hex');
const bootstrap = `const fs=require('fs'),path=require('path'),cp=require('child_process');
const input=JSON.parse(fs.readFileSync(0,'utf8')),root=input.directory;
const capacity=fs.statfsSync('/tmp',{bigint:true});if(capacity.bavail*capacity.bsize<2147483648n)throw Error('PRIVATE_BUILD_SPACE_INSUFFICIENT');
fs.mkdirSync(root,{mode:0o700});
for(const [name,encoded]of Object.entries(input.files)){
 if(name.startsWith('/')||name.includes('..')||name.split('/').some(v=>v.startsWith('.env')))throw Error('SOURCE_PATH_UNSAFE');
 const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,Buffer.from(encoded,'base64'),{flag:'wx',mode:0o600});
}
fs.mkdirSync(root+'/node_modules',{mode:0o700});`;
verify();
execFileSync('docker', ['exec', '-i', before.backend.id, 'node', '-e', bootstrap], { encoding: 'utf8', timeout: 30000,
  input: JSON.stringify({ directory, files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, bytes.toString('base64')])) }) });
const closed = child => new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
verify();
const reader = spawn('docker', ['exec', before.inquiry.id, 'tar', '-C', '/app/node_modules', '-czf', '-', '.'], { stdio: ['ignore', 'pipe', 'pipe'] });
const readClosed = closed(reader);
verify();
const writer = spawn('docker', ['exec', '-i', before.backend.id, 'tar', '-xzf', '-', '-C', directory + '/node_modules'], { stdio: ['pipe', 'ignore', 'pipe'] });
const writeClosed = closed(writer); writer.stdin.once('error', () => {});
const dependencyHash = createHash('sha256'); let dependencyBytes = 0;
reader.stdout.on('data', bytes => { dependencyHash.update(bytes); dependencyBytes += bytes.length; });
reader.stdout.pipe(writer.stdin);
// Drain bounded, non-secret archive diagnostics; completion is checked below.
reader.stderr.on('data', () => {}); writer.stderr.on('data', () => {});
const [readResult, writeResult] = await Promise.all([readClosed, writeClosed]);
assert.deepEqual(readResult, { code: 0, signal: null }); assert.deepEqual(writeResult, { code: 0, signal: null });
assert.ok(dependencyBytes > 1024 && dependencyBytes < 512 * 1024 * 1024);
const dependencyArchiveSha256 = dependencyHash.digest('hex');
const build = `const fs=require('fs'),cp=require('child_process');const root=${JSON.stringify(directory)};
const env={...process.env,NODE_ENV:'production',NODE_OPTIONS:'--max-old-space-size=768',RAYON_NUM_THREADS:'2',DATABASE_URL:'file:'+root+'/build-only.db',SESSION_SECRET:'private-build-fixture-secret-minimum-32-characters',NEXT_TELEMETRY_DISABLED:'1'};
env.SABALAN_INQUIRY_BUILD_ID=${JSON.stringify(browserBuildId)};
for(const key of Object.keys(env))if(key.startsWith('PG')||key.startsWith('BACKEND_')||key.startsWith('INQUIRY_NATIVE_')||key==='INQUIRY_RUNTIME_GENERATION')delete env[key];
const versions=Object.fromEntries(['next','react','typescript','@prisma/client'].map(name=>[name,require(root+'/node_modules/'+name+'/package.json').version]));
console.log(JSON.stringify({privateBuildRoot:root,versions,pythonAvailable:fs.existsSync('/usr/bin/python3')}));
for(const args of [
 [root+'/node_modules/prisma/build/index.js','db','push','--skip-generate','--schema',root+'/prisma/schema.prisma'],
 [root+'/node_modules/next/dist/bin/next','build'],
]){const result=cp.spawnSync(process.execPath,args,{cwd:root,env,stdio:'inherit'});if(result.error||result.signal||result.status!==0){console.log(JSON.stringify({failedCommand:args[0],status:result.status,signal:result.signal}));throw Error('PRIVATE_INQUIRY_BUILD_FAILED');}}
// Next 16 uses an internal constant BUILD_ID when native deploymentId skew
// protection is enabled. The browser selector is deploymentId, not that ID.
const frameworkBuildId=fs.readFileSync(root+'/.next/BUILD_ID','utf8').trim();
if(!/^[A-Za-z0-9_-]{8,128}$/.test(frameworkBuildId))throw Error('PRIVATE_INQUIRY_FRAMEWORK_BUILD_ID_INVALID');
const required=JSON.parse(fs.readFileSync(root+'/.next/required-server-files.json','utf8'));
if(required.config.deploymentId!==env.SABALAN_INQUIRY_BUILD_ID||required.config.env.NEXT_PUBLIC_INQUIRY_BUILD_ID!==env.SABALAN_INQUIRY_BUILD_ID)throw Error('PRIVATE_INQUIRY_DEPLOYMENT_ID_MISMATCH');
console.log(JSON.stringify({frameworkBuildId,browserDeploymentId:env.SABALAN_INQUIRY_BUILD_ID}));
console.log('PRIVATE_INQUIRY_BUILD_PASSED');`;
verify();
const child = spawn('docker', ['exec', before.backend.id, 'node', '-e', build], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', count = 0;
for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {
  count += bytes.length;
  if (count < 2 * 1024 * 1024) { output += bytes.toString(); process.stdout.write(bytes); }
});
const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
const after = Object.fromEntries(protectedServices.map(service => [service, identity(service)])); assert.deepEqual(after, before);
for (const [name, fingerprint] of Object.entries(sourceHashes)) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(inquiryRoot, name))).digest('hex'), fingerprint, 'INQUIRY_BUILD_SOURCE_CHANGED: ' + name);
const report = { format: 'sabalan-private-inquiry-build/v1', directory, canonicalUnchanged: after, result,
  dependencyInventory, dependencyBytes, dependencyArchiveSha256, browserBuildId, sourceHashes,
  actualImmutableImageBuild: false, nativeActionOverlap: false, publicAdmission: false };
const basename = path.basename(directory);
fs.writeFileSync(path.join(root, 'reports/qa', basename + '.log'), output, { flag: 'wx' });
fs.writeFileSync(path.join(root, 'reports/qa', basename + '.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
assert.ok(count < 2 * 1024 * 1024); assert.equal(result.signal, null); assert.equal(result.code, 0);
assert.match(output, /PRIVATE_INQUIRY_BUILD_PASSED/);
