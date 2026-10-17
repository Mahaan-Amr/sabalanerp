import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const canonical = process.env.SABALAN_LOCAL_REPOSITORY_ROOT || 'D:/sabalanerp';
const compose = ['compose', '-f', path.join(canonical, 'docker-compose.local.yml')];
function verify() {
  const output = execFileSync('docker', [...compose, 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows;
  try { const parsed = JSON.parse(output); rows = Array.isArray(parsed) ? parsed : [parsed]; }
  catch { rows = output.trim().split(/\r?\n/).map(line => JSON.parse(line)); }
  for (const service of ['backend', 'frontend', 'postgres', 'inquiry']) assert.ok(rows.some(row => row.Project === 'sabalanerp-local'
    && row.Service === service && row.State === 'running' && row.Health === 'healthy'), `Canonical ${service} must be healthy`);
  return rows.find(row => row.Service === 'backend').Name;
}
const container = verify();
function identity() {
  verify();
  const [value] = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }));
  return { id: value.Id, image: value.Image, startedAt: value.State.StartedAt };
}
const before = identity();
const files = {
  'kernelWriteAdmission.js': fs.readFileSync(path.join(root, 'backend/dist/services/kernelWriteAdmission.js')),
  'httpRequestLifecycle.js': fs.readFileSync(path.join(root, 'backend/dist/services/httpRequestLifecycle.js')),
  'runtimeBoundaryJournal.js': fs.readFileSync(path.join(root, 'backend/dist/services/runtimeBoundaryJournal.js')),
  'runtimeTaskAdmission.js': fs.readFileSync(path.join(root, 'backend/dist/services/runtimeTaskAdmission.js')),
  'fixture.cjs': fs.readFileSync(path.join(root, 'tests/online-deployment/kernel-write-admission.fixture.cjs')),
  'runtime-fixture.cjs': fs.readFileSync(path.join(root, 'tests/online-deployment/runtime-boundary.fixture.cjs')),
};
const sources = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, bytes.toString('base64')]));
const bootstrap = `const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process'),assert=require('assert/strict');
  const files=JSON.parse(fs.readFileSync(0,'utf8'));
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-kernel-admission-runtime-'));fs.chmodSync(directory,0o700);
  let settled=false;
  try{for(const [name,base64]of Object.entries(files)){
    assert.ok(['kernelWriteAdmission.js','httpRequestLifecycle.js','runtimeBoundaryJournal.js','runtimeTaskAdmission.js','fixture.cjs','runtime-fixture.cjs'].includes(name));
    fs.writeFileSync(path.join(directory,name),Buffer.from(base64,'base64'),{flag:'wx',mode:0o400});}
    const result=cp.spawnSync(process.execPath,['--test',path.join(directory,'fixture.cjs'),path.join(directory,'runtime-fixture.cjs')],{stdio:'inherit'});
    if(result.error)throw result.error;if(result.signal||result.status===null)throw Error('FIXTURE_COMPLETION_UNPROVEN');
    settled=true;process.exitCode=result.status;
  }finally{
    assert.equal(path.dirname(directory),os.tmpdir());assert.match(path.basename(directory),/^sabalan-kernel-admission-runtime-/);
    assert.equal(fs.realpathSync(directory),directory);
    if(settled)fs.rmSync(directory,{recursive:true});else console.error('UNPROVEN_PRIVATE_FIXTURE_RETAINED',directory);
  }`;
verify();
const child = spawn('docker', ['exec', '-i', container, 'node', '-e', bootstrap], { stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.once('error', () => {}); // A failed exec is reported by its owned close/error result.
child.stdin.end(JSON.stringify(sources));
let bytes = 0, output = '';
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
  bytes += chunk.length;
  if (bytes <= 4 * 1024 * 1024) { output += chunk.toString(); process.stdout.write(chunk); }
});
const result = await new Promise((resolve, reject) => {
  child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
});
const after = identity();
assert.deepEqual(after, before, 'Canonical backend identity/start time changed during fixture');
assert.ok(bytes < 4 * 1024 * 1024, 'Fixture evidence bound exceeded');
assert.equal(result.signal, null); assert.equal(result.code, 0);
assert.match(output, /# tests 18\b/); assert.match(output, /# fail 0\b/); assert.match(output, /# skipped 0\b/);
console.log(JSON.stringify({ nativeLinuxGatePassed: true, backendUnchanged: after,
  compiledSha256: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, createHash('sha256').update(value).digest('hex')])) }));
