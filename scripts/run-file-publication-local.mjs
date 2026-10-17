import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(root, 'backend/package.json'));
const ts = require('typescript');
const canonical = process.env.SABALAN_LOCAL_REPOSITORY_ROOT || 'D:/sabalanerp';
const compose = ['compose', '-f', path.join(canonical, 'docker-compose.local.yml')];
function verify() {
  const output = execFileSync('docker', [...compose, 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows; try { const parsed = JSON.parse(output); rows = Array.isArray(parsed) ? parsed : [parsed]; }
  catch { rows = output.trim().split(/\r?\n/).map(line => JSON.parse(line)); }
  for (const name of ['backend', 'frontend', 'postgres', 'inquiry']) assert.ok(rows.some(row =>
    row.Project === 'sabalanerp-local' && row.Service === name && row.State === 'running' && row.Health === 'healthy'));
  return rows;
}
function inspect(service) {
  const row = verify().find(row => row.Service === service); assert.ok(row);
  const [value] = JSON.parse(execFileSync('docker', ['inspect', row.Name], { encoding: 'utf8' }));
  assert.equal(value.Config.Labels['com.docker.compose.project'], 'sabalanerp-local'); return value;
}
const before = Object.fromEntries(['backend', 'frontend', 'postgres', 'inquiry'].map(service => {
  const value = inspect(service); return [service, { id: value.Id, image: value.Image, startedAt: value.State.StartedAt }];
}));
const slot = inspect('backend-candidate'); assert.equal(slot.Image, before.backend.image);
assert.ok(slot.Config.Env.includes('BACKEND_RUNTIME_ROLE=candidate'));
assert.ok(slot.Mounts.some(mount => mount.Type === 'volume' && mount.RW
  && mount.Name === 'sabalanerp-local_online_runtime_acceptance' && mount.Destination === '/app/online-runtime-acceptance'));
const directory = '/app/online-runtime-acceptance/file-publication-' + randomBytes(16).toString('hex');
const files = { 'fixture.cjs': fs.readFileSync(path.join(root, 'tests/online-deployment/file-publication-native.fixture.cjs')) };
const pdfBundle = await require('esbuild').build({
  absWorkingDir: root, entryPoints: ['backend/src/utils/pdf.ts'], bundle: true, packages: 'external',
  platform: 'node', format: 'cjs', target: 'node22', write: false, metafile: true,
});
files['pdf-publication.bundle.cjs'] = Buffer.from(pdfBundle.outputFiles[0].contents);
const pdfSourceHashes = Object.fromEntries(Object.keys(pdfBundle.metafile.inputs).map(relative =>
  [relative, createHash('sha256').update(fs.readFileSync(path.resolve(root, relative))).digest('hex')]));
for (const relative of ['services/durableFilePublication', 'services/accountingOfficialReportArtifact',
  'services/durableUpload', 'services/httpRequestLifecycle', 'middleware/errorHandler', 'services/__tests__/durableUpload.test',
  'services/dispatchDocuments/filesystemStorage', 'services/__tests__/durableFilePublication.test',
  'services/__tests__/accountingOfficialReportArtifact.test']) {
  files[relative + '.js'] = Buffer.from(ts.transpileModule(fs.readFileSync(path.join(root, 'backend/src', relative + '.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText);
}
const bootstrap = `const fs=require('fs'),path=require('path'),input=JSON.parse(fs.readFileSync(0,'utf8'));
  const root=${JSON.stringify(directory)};fs.mkdirSync(root,{mode:0o700});fs.chmodSync(root,0o700);
  for(const [name,encoded] of Object.entries(input)){if(!/^[A-Za-z0-9_./-]+$/.test(name)||name.includes('..'))throw Error('UNSAFE_SOURCE');
    const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
    const fd=fs.openSync(target,'wx',0o400);try{fs.writeFileSync(fd,Buffer.from(encoded,'base64'));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  fs.mkdirSync(path.join(root,'native-tests'),{mode:0o700});
  const fd=fs.openSync(root,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}`;
verify(); execFileSync('docker', ['exec', '-i', slot.Id, 'node', '-e', bootstrap], {
  input: JSON.stringify(Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, bytes.toString('base64')]))), encoding: 'utf8',
});
verify();
const tap = execFileSync('docker', ['exec', '-e', 'ONLINE_FILE_TEST_ROOT=' + directory + '/native-tests', slot.Id, 'node', '--test',
  directory + '/services/__tests__/durableUpload.test.js', directory + '/services/__tests__/durableFilePublication.test.js',
  directory + '/services/__tests__/accountingOfficialReportArtifact.test.js'], { encoding: 'utf8', timeout: 30_000 });
process.stdout.write(tap);
assert.match(tap, /# pass 7\r?\n/); assert.match(tap, /# skipped 0\r?\n/);
verify();
const report = JSON.parse(execFileSync('docker', ['exec', slot.Id, 'node', directory + '/fixture.cjs'], { encoding: 'utf8', timeout: 60_000 }).trim());
assert.equal(report.format, 'sabalan-file-publication-native/v1');
for (const [service, identity] of Object.entries(before)) {
  const value = inspect(service);
  assert.deepEqual({ id: value.Id, image: value.Image, startedAt: value.State.StartedAt }, identity);
}
report.canonicalServicesUnchanged = before;
report.sources = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]));
report.pdfSourceHashes = pdfSourceHashes;
const reportPath = path.join(root, 'reports/qa', path.basename(directory) + '.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(reportPath.replace(/\.json$/, '.tap'), tap, { flag: 'wx' });
console.log(JSON.stringify({ pass: true, reportPath, nativeChildSignal: report.nativeChildSignal, ownedDiagnosticBytesRemoved: report.ownedDiagnosticBytesRemoved }));
