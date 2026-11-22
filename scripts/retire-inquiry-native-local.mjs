import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
assert.equal(process.argv.length, 3);
const configuration = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.equal(configuration.format, 'sabalan-private-native-inquiry-next/v1');
assert.match(configuration.operation, /^[a-f0-9]{32}$/);
assert.equal(configuration.directory, '/app/online-runtime-acceptance/inquiry-next-' + configuration.operation);
function verify() {
  const output = execFileSync('docker', ['compose', '-f', 'D:/sabalanerp/docker-compose.local.yml', 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows;
  try { const parsed = JSON.parse(output); rows = Array.isArray(parsed) ? parsed : [parsed]; }
  catch { rows = output.trim().split(/\r?\n/).map(line => JSON.parse(line)); }
  for (const service of ['backend', 'frontend', 'postgres', 'inquiry']) assert.ok(rows.some(row => row.Project === 'sabalanerp-local'
    && row.Service === service && row.State === 'running' && row.Health === 'healthy'));
  return rows;
}
function inspect(id) {
  verify(); return JSON.parse(execFileSync('docker', ['inspect', id], { encoding: 'utf8' }))[0];
}
function identities() {
  return Object.fromEntries(['backend', 'frontend', 'postgres', 'inquiry'].map(service => {
    const row = verify().find(row => row.Service === service), value = inspect(row.Name);
    return [service, { id: value.Id, image: value.Image, startedAt: value.State.StartedAt }];
  }));
}
const before = identities(), candidate = inspect(configuration.candidate);
assert.equal(candidate.Image, configuration.image);
assert.equal(candidate.Config.Labels['io.sabalan.online-qa.operation'], configuration.operation);
assert.equal(candidate.State.Status, 'running');
const controllerRow = verify().find(row => row.Service === 'backend-retained'); assert.ok(controllerRow);
const controller = inspect(controllerRow.Name);
function read() {
  verify(); return JSON.parse(execFileSync('docker', ['exec', controller.Id, 'node', '-e', `
const fs=require('fs'),root=${JSON.stringify(configuration.coordination)},id=${JSON.stringify(configuration.runtimeId)};
const native=JSON.parse(fs.readFileSync(root+'/online/native/'+id+'/deployment-runtime-native.json'));
const work=JSON.parse(fs.readFileSync(root+'/online/work/'+id+'/state.json'));
const names=fs.readdirSync(root+'/online/admission').filter(n=>/^[0-9]{8}[.]json$/.test(n)).sort();
console.log(JSON.stringify({native,work,admission:JSON.parse(fs.readFileSync(root+'/online/admission/'+names.at(-1)))}));`], { encoding: 'utf8', timeout: 10000 }));
}
const initial = read();
assert.equal(initial.native.phase, 'ACTIVE'); assert.equal(initial.native.format, 'sabalan-inquiry-native/v2');
assert.equal(initial.native.guardian.pid, 1);
assert.equal(initial.work.phase, 'QUIESCENT'); assert.equal(initial.admission.phase, 'OPEN');
// Signal only this exact owned guardian. There is no timeout-to-SIGKILL or
// reset/removal fallback: failure retains the container, grants and evidence.
verify(); execFileSync('docker', ['kill', '--signal', 'SIGTERM', candidate.Id], { encoding: 'utf8', timeout: 10000 });
let final, value;
const deadline = Date.now() + 60000;
do {
  value = inspect(candidate.Id);
  if (value.State.Status === 'exited') break;
  await new Promise(resolve => setTimeout(resolve, 1000));
} while (Date.now() < deadline);
assert.equal(value.State.Status, 'exited', 'Native completion unproven; retain everything');
assert.equal(value.State.ExitCode, 128); assert.equal(value.State.OOMKilled, false);
final = read();
assert.equal(final.native.phase, 'QUIESCENT'); assert.equal(final.native.nativeReaped, true);
assert.equal(final.native.sqliteNativeClosed, true); assert.equal(final.native.stoppedBySignal, true);
assert.deepEqual(final.native.guardian, initial.native.guardian);
assert.equal(final.work.phase, 'QUIESCENT'); assert.equal(final.admission.phase, 'OPEN');
const after = identities(); assert.deepEqual(after, before);
const report = { candidate: candidate.Id, operation: configuration.operation, image: candidate.Image,
  guardianCompletedNaturally: true, automaticForceKill: false, retainedContainerAndScope: true,
  native: final.native, work: final.work, canonicalUnchanged: after,
  independentCensusStillRequired: true, productionAdmission: false };
const reportFile = 'reports/qa/inquiry-retired-' + randomBytes(16).toString('hex') + '.json';
fs.writeFileSync(path.join(root, reportFile), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ report: reportFile, guardianCompletedNaturally: true, independentCensusStillRequired: true }));
