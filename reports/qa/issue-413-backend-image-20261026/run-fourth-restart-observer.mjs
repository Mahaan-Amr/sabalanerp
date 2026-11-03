/** Bounded read-only current-incarnation observation under the original exclusive lease. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
const repo = path.resolve(import.meta.dirname, '../../..');
const evidence = import.meta.dirname;
const resultFile = path.join(evidence,'FOURTH-RESTART-ORIGINAL.json');
assert.ok(!fs.existsSync(resultFile),'IMMUTABLE_IMAGE_ATTEMPT_ALREADY_EXISTS');
const qa = 'D:/sabalanerp-online-qa';
const python = 'C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe';
const source = 'c3b7e4fcf88f5e2c3c54ae71dc5c593844d59b14';
const load = relative => import(pathToFileURL(path.join(repo, relative)));
const {acquireSerialHostLease} = await load('scripts/lib/serial-physical/host-lease.mjs');
const {originalBackendBaseCommands} = await load('scripts/lib/production-backend-base-process.mjs');
const {backendBaseLocalGuards, backendBaseLocalCapacity} = await load('scripts/lib/production-backend-base-local-guard.mjs');
const {stableBackendBaseFile} = await load('scripts/lib/production-backend-base-artifacts.mjs');
const {inspectPrivateDockerArchive} = await load('scripts/lib/private-docker-image-archive.mjs');
const {imageInspectionIdentity} = await load('scripts/lib/image-inspection-identity.mjs');
const sha = raw => createHash('sha256').update(raw).digest('hex');
const ref = file => ({file, ...(({bytes, sha256}) => ({bytes, sha256}))(stableBackendBaseFile(file))});
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2)+'\n', {flag:'wx', mode:0o600});
const commands = originalBackendBaseCommands();
const guards = backendBaseLocalGuards(commands);
const history = [];
async function run(executable, args) {
  const result = await commands.run(executable, args, {cwd:repo});
  history.push({executable, args, ...result});
  commands.assertSuccessful(result);
  return result.stdout;
}
const report = {format:'sabalan-413-fourth-restart-readonly-observation/v1', pass:false, candidateSourceCommit:source,
  productionAdmission:false, install:false, deploy:false, FULL:false, master10:false, push:false};
let lease, failure;
try {
  lease = await acquireSerialHostLease(qa+'/deployment.lock');
  report.lease = {file:qa+'/deployment.lock', originalPid:lease.originalPid, competingOriginalRefused:false};
  lease.assertHeld();
  await assert.rejects(acquireSerialHostLease(qa+'/deployment.lock'), /SERIAL_LEASE_BUSY_OR_UNAVAILABLE/);
  report.lease.competingOriginalRefused = true;
  report.servicesBefore = await guards.protectedIdentities();
  report.capacityBefore = backendBaseLocalCapacity({rawBytes:540220928});
  const observed = JSON.parse((await run(python,['-I','-B',path.join(evidence,'observe-current-fourth-restart.py')])).trim());
  report.observation = observed;
  report.servicesAfter = await guards.protectedIdentities();
  assert.deepEqual(report.servicesBefore,report.servicesAfter);
  save(path.join(evidence,'FOURTH-RESTART-OBSERVATION.json'),observed);
  report.pass=true;
} catch (error) { failure=error; report.error={name:error.name,message:String(error.message).slice(0,2000)}; }
finally {
  report.commands = history;
  report.originalChildren = await commands.close();
  if (report.originalChildren.interrupted) {report.pass=false; failure??=Error('ORIGINAL_INTERRUPTED');}
  try {
    if (lease) {await lease.release(); report.lease.closed=true; report.lease.acknowledgement='LEASE_CLOSED';}
  } catch (error) {
    report.pass=false; failure??=error;
    report.lease.closed=false; report.lease.acknowledgement='UNKNOWN';
    report.lease.closureError={name:error.name,message:String(error.message).slice(0,1000)};
  } finally {
    report.producer = ref(import.meta.filename);
    save(resultFile,report);
  }
}
console.log(JSON.stringify({pass:report.pass,receipt:resultFile,image:report.image?.id}));
if (failure) throw failure;
