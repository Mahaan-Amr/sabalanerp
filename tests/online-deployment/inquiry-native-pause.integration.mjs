import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '../..');
assert.equal(process.argv.length, 3);
const configuration = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.equal(configuration.format, 'sabalan-private-native-inquiry-next/v1');
assert.equal(configuration.url, 'http://127.0.0.1:3102');
assert.match(configuration.operation, /^[a-f0-9]{32}$/);
const compose = ['compose', '-f', 'D:/sabalanerp/docker-compose.local.yml'];
function verify() {
  const output = execFileSync('docker', [...compose, 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows;
  try { const value = JSON.parse(output); rows = Array.isArray(value) ? value : [value]; }
  catch { rows = output.trim().split(/\r?\n/).map(line => JSON.parse(line)); }
  for (const service of ['backend', 'frontend', 'postgres', 'inquiry']) assert.ok(rows.some(row => row.Project === 'sabalanerp-local'
    && row.Service === service && row.State === 'running' && row.Health === 'healthy'));
  return rows;
}
function inspect(service) {
  const row = verify().find(value => value.Service === service); assert.ok(row);
  return JSON.parse(execFileSync('docker', ['inspect', row.Name], { encoding: 'utf8' }))[0];
}
const candidate = inspect('inquiry-candidate'), issuer = inspect('backend-candidate'), controller = inspect('backend-retained');
assert.equal(candidate.Id, configuration.candidate); assert.equal(candidate.Image, configuration.image);
assert.equal(candidate.State.Health.Status, 'healthy');
assert.equal(candidate.Config.Labels['io.sabalan.online-qa.operation'], configuration.operation);
assert.ok(controller.Mounts.some(value => value.Destination === '/run/sabalan-online' && !value.RW));
assert.ok(!controller.Mounts.some(value => value.Name === 'sabalanerp-local_online_runtime_authority' && value.RW));
const before = Object.fromEntries(['backend', 'frontend', 'postgres', 'inquiry'].map(service => {
  const value = inspect(service); return [service, { id: value.Id, image: value.Image, startedAt: value.State.StartedAt }];
}));
const files = Object.fromEntries([
  ['pause-capture.py', 'tests/online-deployment/inquiry-pause-capture.fixture.py'],
  ['launch-capture.py', 'tests/online-deployment/inquiry-capture-launch.fixture.py'],
  ...['online-runtime-owner.py', 'online-runtime-scope.py', 'backend-runtime-owner.py', 'online-capture-admission.py'].map(name => [name, 'deploy/scripts/' + name]),
].map(([name, file]) => [name, fs.readFileSync(path.join(root, file))]));
const captureId = randomBytes(32).toString('hex');
const caseId = randomBytes(8).toString('hex'), caseDirectory = configuration.directory + '/pause-' + caseId;
const rowNumbers = { first: 'NATIVE-IMPORT-A-' + caseId, second: 'NATIVE-IMPORT-B-' + caseId, queued: 'NATIVE-QUEUED-' + caseId };
verify();
const admissionBefore = JSON.parse(execFileSync('docker', ['exec', controller.Id, 'node', '-e', `const fs=require('fs'),dir=${JSON.stringify(configuration.coordination + '/online/admission')};const names=fs.readdirSync(dir).filter(n=>/^[0-9]{8}[.]json$/.test(n)).sort();console.log(fs.readFileSync(dir+'/'+names.at(-1),'utf8'));`], {encoding:'utf8'}));
assert.equal(admissionBefore.phase, 'OPEN');
const generationName = offset => String(admissionBefore.generation + offset).padStart(8, '0') + '.json';
const sourceHashes = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]));
const manifestSha256 = createHash('sha256').update(JSON.stringify(sourceHashes)).digest('hex');
const prepare = `const fs=require('fs'),crypto=require('crypto');const p=JSON.parse(fs.readFileSync(0,'utf8')),root=p.directory;
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const encode=v=>Buffer.from(JSON.stringify(canonical(v))+'\\n'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const write=(file,bytes,mode=0o400)=>{const fd=fs.openSync(file,'wx',mode);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
fs.mkdirSync(root,{mode:0o700});
for(const [name,data]of Object.entries(p.files)){if(!/^[a-zA-Z0-9.-]+$/.test(name))throw Error('SOURCE_NAME_INVALID');write(root+'/'+name,Buffer.from(data,'base64'));}
const http=JSON.parse(fs.readFileSync('/app/runtime-authority/'+p.runtimeId+'.json'));
const nativeDirectory=p.coordination+'/online/native/'+p.captureId,boundaryDirectory=p.coordination+'/online/work/'+p.captureId;
fs.mkdirSync(nativeDirectory,{mode:0o700});fs.mkdirSync(boundaryDirectory,{mode:0o700});write(nativeDirectory+'/deployment-runtime-control.lock',Buffer.alloc(0),0o600);
const definition=fs.readFileSync(p.coordination+'/online/admission/scope.json');
const scope={...http,runtimeId:p.captureId,releaseId:'private-next-pause-probe',manifestSha256:p.manifestSha256,image:p.controllerImage,nonce:crypto.randomBytes(32).toString('hex'),purpose:'capture',role:'control',nativeDirectory,boundaryDirectory,worker:JSON.parse(definition).worker};
const {file,...gate}=scope.gate;const namespace='sabalan-rt-'+crypto.createHash('sha256').update(p.captureId,'ascii').digest('hex').slice(0,48);
write(boundaryDirectory+'/scope.json',encode({format:'sabalan-runtime-namespace/v1',scope:{runtimeId:p.captureId,image:scope.image,registrySha256:p.manifestSha256,generation:1,postgresApplicationName:namespace,gate}}),0o600);
const raw=encode(scope);write('/app/runtime-authority/'+p.captureId+'.json',raw);
const result={...p.configuration,captureId:p.captureId,captureFile:'/run/sabalan-online/'+p.captureId+'.json',captureSha256:sha(raw)};
write(root+'/action-fixture.json',encode(result));
for(const d of [nativeDirectory,boundaryDirectory,p.coordination+'/online/native',p.coordination+'/online/work',root,'/app/runtime-authority']){const fd=fs.openSync(d,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
console.log(JSON.stringify(result));`;
verify();
const prepared = JSON.parse(execFileSync('docker', ['exec', '-i', issuer.Id, '/usr/bin/flock', '--exclusive', '--nonblock',
  configuration.coordination + '/deployment-online-worker.lock', 'node', '-e', prepare], {
  input: JSON.stringify({ ...configuration, directory: caseDirectory, configuration: {...configuration,directory:caseDirectory,rowNumbers}, captureId, manifestSha256, controllerImage: controller.Image,
    files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, bytes.toString('base64')])) }),
  encoding: 'utf8', timeout: 30000, maxBuffer: 16384,
}));
function query(script) {
  verify(); return execFileSync('docker', ['exec', controller.Id, 'node', '-e', script], { encoding: 'utf8', timeout: 15000, maxBuffer: 32768 });
}
function launch(script) {
  verify(); const child = spawn('docker', ['exec', controller.Id, 'python3', '-I', '-B', caseDirectory + '/' + script, caseDirectory], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { if (output.length < 32768) output += bytes.toString(); });
  const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal, output })); });
  return { child, closed };
}
function waitFor(file, predicate = 'true') {
  return query(`const fs=require('fs'),file=${JSON.stringify(file)};const deadline=Date.now()+3000;
  (async()=>{while(Date.now()<deadline){try{const value=fs.readFileSync(file,'utf8');if(${predicate}){console.log(value);return;}}catch(error){if(error.code!=='ENOENT')throw error;}await new Promise(r=>setTimeout(r,5));}throw Error('PRIVATE_FIXTURE_WAIT_TIMEOUT');})().catch(()=>{process.exitCode=1;});`);
}
const { chromium } = createRequire(path.join(root, 'frontend/package.json'))('@playwright/test');
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const context = await browser.newContext();
let delayed = false, serverObservedAcquisition = false, capture, captureResult, passed = false, proof;
try {
  await context.route('**/*', route => new URL(route.request().url()).origin === configuration.url ? route.continue() : route.abort());
  const page = await context.newPage(); await page.goto(configuration.url + '/admin/login');
  await page.locator('input[name=email]').fill('native-browser@example.invalid');
  await page.locator('input[name=password]').fill('local-native-browser-only');
  await Promise.all([page.waitForURL(configuration.url + '/admin'), page.locator('form button').click()]);
  await page.goto(configuration.url + '/admin/import');
  await page.route('**/*', route => {
    const request = route.request();
    return request.method() === 'POST' && request.headers()['next-action']
      ? route.continue({ headers: { ...request.headers(), 'x-sabalan-qa-delay': caseId } }) : route.fallback();
  });
  await page.locator('input[name=file]').setInputFiles({ name: 'native-owned-rows.csv', mimeType: 'text/csv', buffer: Buffer.from(
    `rowNumber,name,description,listPrice,finalPrice,discountAvailability,lastDiscountPercent\n${rowNumbers.first},Native A,first,1000,1200,ندارد,\n${rowNumbers.second},Native B,second,2000,2300,ندارد,\n`) });
  const queuedPage = await context.newPage(); await queuedPage.goto(configuration.url + '/admin/products/new');
  await queuedPage.route('**/*', route => {
    const request = route.request();
    return request.method() === 'POST' && request.headers()['next-action']
      ? route.continue({ headers: { ...request.headers(), 'x-sabalan-qa-case': caseId } }) : route.fallback();
  });
  const queuedForm = queuedPage.locator('form').filter({ has: queuedPage.locator('input[name=rowNumber]') });
  await queuedForm.locator('input[name=rowNumber]').fill(rowNumbers.queued);
  await queuedForm.locator('input[name=name]').fill('Queued native action');
  const post = page.waitForRequest(request => request.method() === 'POST' && Boolean(request.headers()['next-action']));
  await page.locator('form').filter({ has: page.locator('input[name=file]') }).locator('button').last().click(); await post;
  delayed = true;
  waitFor(configuration.directory + '/arrivals/' + caseId + '.delayed.json');
  waitFor(configuration.coordination + '/online/work/' + configuration.runtimeId + '/state.json', `JSON.parse(value).phase==='ACTIVE'`);
  capture = launch('launch-capture.py');
  const closing = JSON.parse(waitFor(configuration.coordination + '/online/admission/' + generationName(1), `JSON.parse(value).phase==='CLOSING'`));
  assert.equal(closing.capture.runtimeId, captureId);
  const queuedPost = queuedPage.waitForRequest(request => request.method() === 'POST' && Boolean(request.headers()['next-action']));
  await queuedForm.locator('button').last().click(); await queuedPost;
  const acquisition = JSON.parse(waitFor(configuration.directory + '/arrivals/' + caseId + '.acquire.json'));
  assert.equal(acquisition.caseId, caseId); assert.equal(acquisition.phase, 'acquire');
  assert.equal(acquisition.negativeControl, configuration.negativeControl === true);
  const arrival = JSON.parse(waitFor(configuration.directory + '/arrivals/' + caseId + '.arrived.json'));
  assert.equal(arrival.pid, acquisition.pid); assert.equal(arrival.caseId, caseId);
  serverObservedAcquisition = true;
  const pendingState = JSON.parse(query(`console.log(require('fs').readFileSync(${JSON.stringify(configuration.coordination + '/online/work/' + configuration.runtimeId + '/state.json')},'utf8'))`));
  assert.equal(pendingState.phase, 'ACTIVE');
  query(`const fs=require('fs');fs.writeFileSync(${JSON.stringify(configuration.directory + '/arrivals/' + caseId + '.release')},'release-private-nested-callback',{flag:'wx',mode:0o600});`);
  const captured = await capture.closed; captureResult = captured;
  assert.equal(captured.code, 0, captured.output); assert.equal(captured.signal, null);
  proof = JSON.parse(waitFor(caseDirectory + '/pause-probe.json'));
  assert.equal(proof.admittedActionCompleted, true); assert.equal(proof.coherentApplicationCapture, false);
  const reopened = JSON.parse(waitFor(configuration.coordination + '/online/admission/' + generationName(2)));
  assert.equal(reopened.phase, 'OPEN'); assert.equal(reopened.capture.runtimeId, captureId);
  await queuedPage.waitForURL(configuration.url + '/admin');
  await page.waitForFunction(() => document.querySelector('input[name=file]')?.closest('form')?.querySelector('p')?.textContent?.includes('ایجاد شد'));
  verify();
  const values = JSON.parse(execFileSync('docker', ['exec', candidate.Id, 'node', '-e', `const {PrismaClient}=require('@prisma/client');const client=new PrismaClient();(async()=>{try{console.log(JSON.stringify(await client.product.findMany({where:{rowNumber:{in:${JSON.stringify(Object.values(rowNumbers))}}},orderBy:{rowNumber:'asc'},select:{rowNumber:true,name:true,listPrice:true,finalPrice:true}})));}finally{await client.$disconnect();}})().catch(()=>{process.exitCode=1});`], { encoding: 'utf8', timeout: 15000 }));
  assert.deepEqual(values, [
    { rowNumber: rowNumbers.first, name: 'Native A', listPrice: 1000, finalPrice: 1200 },
    { rowNumber: rowNumbers.second, name: 'Native B', listPrice: 2000, finalPrice: 2300 },
    { rowNumber: rowNumbers.queued, name: 'Queued native action', listPrice: null, finalPrice: null },
  ]);
  passed = true;
} finally {
  if (delayed) query(`const fs=require('fs'),file=${JSON.stringify(configuration.directory + '/arrivals/' + caseId + '.release')};try{fs.writeFileSync(file,'complete-known-private-nested-callback',{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}`);
  await context.close(); await browser.close();
  if (capture) await capture.closed;
  const after = Object.fromEntries(['backend', 'frontend', 'postgres', 'inquiry'].map(service => { const value = inspect(service); return [service, { id: value.Id, image: value.Image, startedAt: value.State.StartedAt }]; }));
  assert.deepEqual(after, before);
  fs.writeFileSync(path.join(root, 'reports/qa', 'inquiry-native-pause-' + configuration.operation + '-' + caseId + '.json'), JSON.stringify({
    actualHydratedNextActions: passed, nestedImportQueriesCompletedDuringClosing: passed, queuedActionCommittedOnce: passed,
    serverObservedAcquisition, negativeControl: configuration.negativeControl === true,
    nativePauseProof: proof, captureResult, sourceHashes, captureId, caseDirectory, rowNumbers, canonicalUnchanged: after,
    coherentApplicationCapture: false, immutableImagesOverlap: false, productionAdmission: false,
  }, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify({ actualHydratedNextActions: passed, coherentApplicationCapture: false, productionAdmission: false }));
