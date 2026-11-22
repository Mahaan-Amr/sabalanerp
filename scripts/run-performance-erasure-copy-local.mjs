import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const root = path.resolve(import.meta.dirname, '..');
const canonical = process.env.SABALAN_LOCAL_REPOSITORY_ROOT || 'D:/sabalanerp';
const compose = ['compose', '-f', path.join(canonical, 'docker-compose.local.yml')];
function verify() {
  const output = execFileSync('docker', [...compose, 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows;
  try { const parsed = JSON.parse(output); rows = Array.isArray(parsed) ? parsed : [parsed]; }
  catch { rows = output.trim().split(/\r?\n/).map(line => JSON.parse(line)); }
  for (const name of ['backend', 'frontend', 'postgres', 'inquiry']) assert.ok(rows.some(row =>
    row.Project === 'sabalanerp-local' && row.Service === name && row.State === 'running' && row.Health === 'healthy'));
  return rows;
}
function inspect(service) {
  const row = verify().find(row => row.Service === service); assert.ok(row);
  const [value] = JSON.parse(execFileSync('docker', ['inspect', row.Name], { encoding: 'utf8' }));
  assert.equal(value.Config.Labels['com.docker.compose.project'], 'sabalanerp-local');
  return value;
}
const before = Object.fromEntries(['backend', 'frontend', 'postgres', 'inquiry'].map(service => {
  const value = inspect(service); return [service, { id: value.Id, image: value.Image, startedAt: value.State.StartedAt }];
}));

const directory = 'performance-erasure-copy-' + randomBytes(16).toString('hex');
const sourcePaths = ['backend/src/services/personnelPerformanceErasure.ts', 'backend/src/services/personnelPerformanceErasureStore.ts',
  'backend/src/services/__tests__/personnelPerformanceErasure.test.ts', 'backend/src/services/__tests__/personnelPerformanceErasure.integration.test.ts',
  'backend/src/services/__tests__/dispatchDocumentsTemporaryDatabase.ts'];
const sha = file => createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
const sources = Object.fromEntries(sourcePaths.map(file=>[file,sha(file)]));
const environment = {...process.env, SABALAN_LOCAL_REPOSITORY_ROOT:canonical, NODE_ENV:'test',
 DATABASE_URL:'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?connection_limit=4&pool_timeout=10',
 PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_ID:'local-development-v1',
 PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_BASE64:'cGVyZi1sb2NhbC0wMTIzNDU2Nzg5YWJjZGVmLXYxISE=', PERFORMANCE_ERASURE_BULK_THRESHOLD:'100'};
const attempts=[];
for(const fixture of ['personnelPerformanceErasure.test.ts','personnelPerformanceErasure.integration.test.ts']){
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','src/services/__tests__/'+fixture],{cwd:path.join(root,'backend'),env:environment,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',bytes=>stdout+=bytes);child.stderr.on('data',bytes=>stderr+=bytes);
  child.once('error',reject);child.once('close',(code,signal)=>resolve({fixture,code,signal,stdout,stderr}));
 });attempts.push(result);
 if(result.code!==0||result.signal)break;
}
const report={format:'sabalan-performance-erasure-copy-native/v1',pass:false,attempts,sources,canonicalServicesBefore:before,productionMutation:false,wholeProgramComplete:false};
const reportPath=path.join(root,'reports/qa',directory+'.json');
fs.writeFileSync(reportPath.replace(/\.json$/,'.core.json'),JSON.stringify({...report,canonicalVerification:'PENDING'},null,2)+'\n',{flag:'wx'});
for(const [service,expected]of Object.entries(before)){
 const value=inspect(service);assert.deepEqual({id:value.Id,image:value.Image,startedAt:value.State.StartedAt},expected);
}
for(const [file,expected]of Object.entries(sources))assert.equal(sha(file),expected,'SOURCE_CHANGED '+file);
report.canonicalServicesUnchanged=before;report.pass=attempts.length===2&&attempts.every(r=>r.code===0&&!r.signal);
fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({pass:report.pass,reportPath}));if(!report.pass)process.exitCode=1;
