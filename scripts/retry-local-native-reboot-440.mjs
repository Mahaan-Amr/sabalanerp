#!/usr/bin/env node
// Retry only the halted #440 one-shot after preserving its failed container and image.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { assertCheckpointReadback, assertPriorCheckpoint, waitDockerStream }
  from './reconcile-local-native-reboot-440.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PROJECT = 'sabalanerp-local';
const GUARD = 'C:\\dev\\sabalanerp-local-backend-guarded-20261105.yml';
const BASE = ['compose', '-p', PROJECT, '-f', 'docker-compose.local.yml', '-f', GUARD];
const ONE_SHOT = [...BASE, '-f', 'docker-compose.local-native-reboot-reconcile.yml'];
const NORMAL = [...BASE, '-f', 'docker-compose.local-native-reboot-pin.yml'];
const ACTIVE = 'b820bfa60ec642b87c17a34fcbc527021164708a33df1227d7e19c39c4f8be8a';
const BOOT = 'd4568d2d-96ec-4bc3-94ab-4ba62defe9eb';
const OLD_BOOT = 'db891a29-1343-421d-9df8-28b3b495cf08';
const FAILED_CONTAINER = 'b458b387a52ceeff66d101298764846b64701b2ca6fc78a45856efb1911763e4';
const FAILED_IMAGE = 'sha256:84d6cadf143013d289efb80d5f533d31bfe06d43a285bf5611e88c23e213a5d2';
const FAILED_TAG = 'sabalanerp-local-backend:failed-reboot-20261114';
const OLD_IMAGE = 'sha256:ab17d2c1380b2c70352af3d1cff8c2d301624346637ea5ecb7480fe1a0f21ab9';
const OLD_TAG = 'sabalanerp-local-backend:pre-reboot-20261114';
const PROOF_SHA = 'd96d4a1e369cafc96766a251effdeec7ddc77a2cc0c9e2b750b4fb243626babe';
const CHECKPOINT_SHA = '61e05b366521390357cdbde41e43c2aacce76d2859d16fc984f6a90836cce17c';
const CHECKPOINT = {
  primaryPath: 'C:\\Users\\PC\\Documents\\ChatGPT\\sabalanerp-440-checkpoint-20261114',
  independentPath: 'D:\\sabalanerp-440-checkpoint-20261114',
};
const OTHER = { clamav: 'b89c4299ea7d41a1895c8d52a1835cefd3da2d447d6e1e985bb201ee00a1dca8',
  frontend: '19aebf5decc2ed7cdf62a83f5b4f792d320bf74cffb32a14ddcd97258f930115',
  inquiry: 'b67c817a4eee00e71a821805b3d80354f74758e5140418229a0fdb781d7a4257',
  postgres: '3ba7c705a08e4c3066a6dd43aa839ef9bcfd2614745558052884f2a4de787c48',
  redis: '06c2b7237917b007962b6e93dcc7ffb7fb49233f21c1d8c370c65134666ce3d8' };
const VOLUMES = [
  'sabalanerp-local_recovery_coordination', 'sabalanerp-local_backend_uploads',
  'sabalanerp-local_inquiry_data', 'sabalanerp-local_backend_storage_accounting_contracts',
  'sabalanerp-local_backend_storage_contracts', 'sabalanerp-local_backend_storage_dispatch_documents',
  'sabalanerp-local_backend_storage_hr_hiring', 'sabalanerp-local_backend_recovery',
  'sabalanerp-local_backend_storage_sepidar_backups',
  'sabalanerp-local_backend_storage_support_tickets',
].sort();
const digest = value => createHash('sha256').update(value).digest('hex');
const readback = file => {
  const hash = createHash('sha256'), bytes = Buffer.allocUnsafe(4 * 1024 * 1024);
  const fd = fs.openSync(file, 'r');
  try {
    let count;
    while ((count = fs.readSync(fd, bytes, 0, bytes.length, null)) > 0) hash.update(bytes.subarray(0, count));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
};
const execute = (args, options = {}) => {
  const result = spawnSync('docker', args, { cwd: ROOT, encoding: options.encoding ?? 'utf8',
    input: options.input, timeout: options.timeout ?? 120000, maxBuffer: 20 * 1024 * 1024,
    env: options.env ?? process.env });
  assert.equal(result.status, 0, `Docker command failed: ${args.slice(0, 3).join(' ')} ${result.stderr || ''}`);
  return result.stdout;
};
const inspect = name => JSON.parse(execute(['inspect', name]))[0];
const image = name => JSON.parse(execute(['image', 'inspect', name]))[0];

function checkpointReadback() {
  const raw = fs.readFileSync(path.join(CHECKPOINT.primaryPath, 'manifest.json'));
  assert.equal(digest(raw), CHECKPOINT_SHA);
  assert.equal(readback(path.join(CHECKPOINT.independentPath, 'manifest.json')), CHECKPOINT_SHA);
  const manifest = JSON.parse(raw);
  assert.equal(manifest.activeSha256, ACTIVE);
  assert.equal(manifest.postgresSystemIdentifier, '7703877635514671138');
  assert.equal(manifest.databaseOid, '57567');
  assertCheckpointReadback({ ...CHECKPOINT, manifest, manifestSha256: CHECKPOINT_SHA });
  assertPriorCheckpoint();
  return { ...CHECKPOINT, manifest, manifestSha256: CHECKPOINT_SHA,
    independentManifestSha256: CHECKPOINT_SHA, primaryReadbackVerified: true,
    independentReadbackVerified: true };
}

export function assertFailedTarget(rows, containers, state, database) {
  assert.deepEqual(rows.map(row => row.Service).sort(),
    ['backend', 'clamav', 'frontend', 'inquiry', 'postgres', 'redis']);
  for (const row of rows) {
    assert.equal(row.Project, PROJECT);
    if (row.Service !== 'backend') assert.equal(row.Health, 'healthy');
  }
  assert.equal(containers.backend.Id, FAILED_CONTAINER);
  assert.equal(containers.backend.Image, FAILED_IMAGE);
  assert.equal(containers.backend.State.Status, 'exited');
  assert.equal(containers.backend.State.ExitCode, 75);
  assert.deepEqual(containers.backend.Mounts.filter(item => item.Type === 'volume')
    .map(item => item.Name).sort(), VOLUMES);
  assert.deepEqual(containers.backend.HostConfig.PortBindings?.['5000/tcp'],
    [{ HostIp: '127.0.0.1', HostPort: '5000' }]);
  for (const [service, id] of Object.entries(OTHER)) assert.equal(containers[service].Id, id);
  for (const [service, container] of Object.entries(containers)) {
    assert.equal(container.Config.Labels['com.docker.compose.project'], PROJECT);
    assert.equal(container.Config.Labels['com.docker.compose.service'], service);
    assert.equal(container.HostConfig.NetworkMode, `${PROJECT}_default`);
    for (const bindings of Object.values(container.HostConfig.PortBindings || {})) {
      for (const binding of bindings || []) assert.equal(binding.HostIp, '127.0.0.1');
    }
  }
  assert.equal(state.activeSha256, ACTIVE);
  assert.equal(state.active.guardian.bootId, OLD_BOOT);
  assert.equal(state.active.guardian.pidNamespace, 'pid:[4026532751]');
  assert.equal(state.active.guardian.startTicks, '1829736');
  assert.equal(state.priorProofSha256, PROOF_SHA);
  assert.equal(state.receiptExists, false);
  assert.equal(database.system, '7703877635514671138');
  assert.equal(database.oid, '57567');
  assert.equal(database.oldSessions, 0);
  assert.equal(database.allTagged, 0);
  assert.equal(database.prepared, 0);
  return true;
}

function inventory() {
  const rows = execute([...BASE, 'ps', '--all', '--format', 'json']).trim().split(/\r?\n/).map(JSON.parse);
  const containers = Object.fromEntries(['backend', ...Object.keys(OTHER)]
    .map(service => [service, inspect(`${PROJECT}-${service}-1`)]));
  const script = `const f=require('fs'),c=require('crypto'),d='/app/recovery-coordination';
    const h=x=>c.createHash('sha256').update(x).digest('hex');
    const active=f.readFileSync(d+'/deployment-runtime-native.json');
    const proof=f.readFileSync(d+'/deployment-runtime-recovery-host-proof-440.json');
    const names=f.readdirSync(d).filter(x=>x.startsWith('deployment-runtime-native.preserved-')||x.startsWith('local-forced-recovery-incident-')||x.startsWith('local-reboot-incident-')).sort();
    console.log(JSON.stringify({active:JSON.parse(active),activeSha256:h(active),priorProof:JSON.parse(proof),
      priorProofSha256:h(proof),receiptExists:f.existsSync(d+'/deployment-runtime-abandonment-440.json'),
      retryProofExists:f.existsSync(d+'/deployment-runtime-recovery-host-proof-440-retry.json'),
      firstReceiptSha256:h(f.readFileSync(d+'/deployment-runtime-abandonment.json')),
      firstHostProofSha256:h(f.readFileSync(d+'/deployment-runtime-recovery-host-proof.json')),
      evidence:names.map(name=>({name,sha256:h(f.readFileSync(d+'/'+name))}))}));`;
  const state = JSON.parse(execute(['exec', `${PROJECT}-inquiry-1`, 'node', '-e', script]));
  assert.equal(state.retryProofExists, false);
  assert.equal(state.priorProof.candidateImageId, FAILED_IMAGE);
  assert.equal(state.priorProof.checkpoint.manifestSha256, CHECKPOINT_SHA);
  assert.equal(state.priorProof.activeSha256, ACTIVE);
  assert.equal(state.firstReceiptSha256, '44c60ad9d492eab6997fa32f3c44c0370f3d9020bd046b5e5ced3664bc44e6a3');
  assert.equal(state.firstHostProofSha256, 'da0ac9ca538c3f6b7506affd83a73e69482a0e606e6675efc29e74d539e95841');
  assert.deepEqual(state.evidence, [...state.priorProof.historicalActive,
    ...state.priorProof.historicalIncidentEvidence].sort((a, b) => a.name.localeCompare(b.name)));
  assert.equal(execute(['exec', `${PROJECT}-inquiry-1`, 'cat', '/proc/sys/kernel/random/boot_id']).trim(), BOOT);
  const sql = `SELECT json_build_object('system',c.system_identifier::text,
    'oid',(SELECT oid::text FROM pg_database WHERE datname='sabalanerp'),
    'oldSessions',(SELECT count(*) FROM pg_stat_activity WHERE application_name='sabalan-rt-d2d1b01b543eae810dd2d5b32d6b18537651363748b84d96'),
    'allTagged',(SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'sabalan-rt-%'),
    'prepared',(SELECT count(*) FROM pg_prepared_xacts)) FROM pg_control_system() c`;
  const database = JSON.parse(execute(['exec', `${PROJECT}-postgres-1`, 'psql', '-X', '-q', '-t', '-A',
    '-U', 'postgres', '-d', 'postgres', '-c', sql]));
  assertFailedTarget(rows, containers, state, database);
  assert.equal(image(OLD_TAG).Id, OLD_IMAGE);
  assert.equal(image(FAILED_IMAGE).Id, FAILED_IMAGE);
  return { containers, state, database };
}

async function archiveStream(args, destination) {
  const child = spawn('docker', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 });
  let error = '';
  child.stderr.on('data', chunk => { error += chunk.toString('utf8').slice(0, 2048); });
  child.stdout.pipe(output);
  const finished = new Promise((resolve, reject) => {
    output.once('finish', resolve);
    output.once('error', reject);
  });
  const code = await waitDockerStream(child, 30 * 60 * 1000);
  await finished;
  assert.equal(code, 0, `Failed container export failed: ${error}`);
}

async function failedEvidence(primaryRoot, independentRoot, containers) {
  const primary = path.resolve(primaryRoot), independent = path.resolve(independentRoot);
  assert.match(primary, /^C:[\\/]/i); assert.match(independent, /^D:[\\/]/i);
  assert.notEqual(fs.statSync(primary).dev, fs.statSync(independent).dev);
  for (const target of [primary, independent]) {
    const item = fs.lstatSync(target);
    assert(item.isDirectory() && !item.isSymbolicLink());
    assert.equal(fs.readdirSync(target).length, 0);
  }
  const estimate = image(FAILED_IMAGE).Size * 2 + 1024 * 1024 * 1024;
  for (const target of [primary, independent]) {
    const space = fs.statfsSync(target);
    assert(space.bavail * space.bsize > estimate, `${target} lacks evidence space`);
  }
  const entries = [];
  for (const [name, value] of [
    ['failed-container-inspect.json', containers.backend],
    ['failed-image-inspect.json', image(FAILED_IMAGE)],
  ]) {
    const file = path.join(primary, name);
    fs.writeFileSync(file, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 });
    entries.push({ name, sha256: readback(file), bytes: fs.statSync(file).size });
  }
  const rootfs = path.join(primary, 'failed-container-rootfs.tar');
  await archiveStream(['export', FAILED_CONTAINER], rootfs);
  entries.push({ name: path.basename(rootfs), sha256: readback(rootfs), bytes: fs.statSync(rootfs).size });
  const manifest = { format: 'sabalan-local-native-reboot-failed-one-shot/v1',
    containerId: FAILED_CONTAINER, imageId: FAILED_IMAGE, activeSha256: ACTIVE,
    hostProofSha256: PROOF_SHA, checkpointManifestSha256: CHECKPOINT_SHA, entries };
  const raw = Buffer.from(JSON.stringify(manifest) + '\n');
  fs.writeFileSync(path.join(primary, 'manifest.json'), raw, { flag: 'wx', mode: 0o600 });
  for (const name of [...entries.map(item => item.name), 'manifest.json']) {
    fs.copyFileSync(path.join(primary, name), path.join(independent, name), fs.constants.COPYFILE_EXCL);
  }
  const result = { format: manifest.format, containerId: FAILED_CONTAINER, imageId: FAILED_IMAGE,
    retainedImageTag: FAILED_TAG, activeSha256: ACTIVE, hostProofSha256: PROOF_SHA,
    checkpointManifestSha256: CHECKPOINT_SHA, primaryPath: primary, independentPath: independent,
    primaryReadbackVerified: true, independentReadbackVerified: true,
    manifestSha256: digest(raw), independentManifestSha256: digest(raw), manifest };
  assertCheckpointReadback(result);
  return result;
}

async function main() {
  const [flag, primary, independent] = process.argv.slice(2);
  assert.equal(flag, '--execute-reviewed-retry');
  assert(primary && independent, 'Specify new empty C: and D: failed-evidence directories.');
  assert.equal(digest(fs.readFileSync(GUARD)),
    '98ade19f953ce07845c4433db51c7f9d229d09369caeae33e6760d247bcc1821');
  const recipe = fs.readFileSync(path.join(ROOT, 'backend/Dockerfile'), 'utf8');
  assert.match(recipe, /deploy\/scripts\/local-native-reboot-440\.py .*\.\/scripts\//);
  const checkpoint = checkpointReadback();
  const initial = inventory();
  const evidence = await failedEvidence(primary, independent, initial.containers);
  const fresh = inventory();
  assert.deepEqual(fresh.state, initial.state);
  assert.deepEqual(fresh.database, initial.database);
  checkpointReadback();
  const existingTag = spawnSync('docker', ['image', 'inspect', FAILED_TAG],
    { cwd: ROOT, encoding: 'utf8', timeout: 10000 });
  assert.notEqual(existingTag.status, 0, 'Failed-image retention tag already exists.');
  execute(['tag', FAILED_IMAGE, FAILED_TAG]);
  assert.equal(image(FAILED_TAG).Id, FAILED_IMAGE);
  execute([...BASE, 'build', 'backend'], { timeout: 30 * 60 * 1000 });
  const candidateImageId = image(`${PROJECT}-backend`).Id;
  assert.match(candidateImageId, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(candidateImageId, FAILED_IMAGE);
  assert.notEqual(candidateImageId, OLD_IMAGE);
  assertCheckpointReadback(evidence);
  checkpointReadback();
  inventory();
  const proof = { ...initial.state.priorProof, candidateImageId,
    supersedesHostProofSha256: PROOF_SHA, failedOneShotEvidence: evidence,
    checkpoint };
  const proofBytes = Buffer.from(JSON.stringify(proof) + '\n');
  const writer = `const f=require('fs'),p='/app/recovery-coordination/deployment-runtime-recovery-host-proof-440-retry.json';
    const b=f.readFileSync(0);const fd=f.openSync(p,'wx',0o600);try{f.writeSync(fd,b);f.fsyncSync(fd)}finally{f.closeSync(fd)}
    const d=f.openSync('/app/recovery-coordination','r');try{f.fsyncSync(d)}finally{f.closeSync(d)}`;
  assert.equal(execute(['exec', `${PROJECT}-inquiry-1`, 'id', '-u']).trim(), '0');
  execute(['exec', '-i', `${PROJECT}-inquiry-1`, 'node', '-e', writer],
    { input: proofBytes, encoding: null });
  const env = { ...process.env, LOCAL_NATIVE_REBOOT_IMAGE_ID: candidateImageId,
    LOCAL_NATIVE_REBOOT_EXPECTED_ACTIVE_SHA256: ACTIVE,
    LOCAL_NATIVE_REBOOT_EXPECTED_OLD_BOOT_ID: OLD_BOOT,
    LOCAL_NATIVE_REBOOT_HOST_PROOF_SHA256: digest(proofBytes) };
  execute([...ONE_SHOT, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'backend'], { env });
  let backend;
  for (let attempt = 0; attempt < 120; attempt++) {
    backend = inspect(`${PROJECT}-backend-1`);
    assert.equal(backend.Image, candidateImageId);
    if (backend.State.Status === 'exited') break;
    await delay(500);
  }
  assert.equal(backend.State.Status, 'exited');
  assert.equal(backend.State.ExitCode, 0);
  const reader = `const f=require('fs'),c=require('crypto'),d='/app/recovery-coordination';
    const h=x=>c.createHash('sha256').update(x).digest('hex');
    const r=f.readFileSync(d+'/deployment-runtime-abandonment-440.json');
    const a=f.readFileSync(d+'/deployment-runtime-native.json');
    console.log(JSON.stringify({receipt:JSON.parse(r),activeSha256:h(a),
      failedHostProofSha256:h(f.readFileSync(d+'/deployment-runtime-recovery-host-proof-440.json')),
      retryHostProofSha256:h(f.readFileSync(d+'/deployment-runtime-recovery-host-proof-440-retry.json'))}));`;
  const result = JSON.parse(execute(['exec', `${PROJECT}-inquiry-1`, 'node', '-e', reader]));
  assert.equal(result.activeSha256, ACTIVE);
  assert.equal(result.failedHostProofSha256, PROOF_SHA);
  assert.equal(result.retryHostProofSha256, digest(proofBytes));
  assert.equal(result.receipt.phase, 'ABANDONED_ON_VM_REBOOT');
  assert.equal(result.receipt.nativeReaped, false);
  assert.equal(result.receipt.externalEffectsCompleted, false);
  assert.equal(result.receipt.productionAdmission, false);
  assert.equal(result.receipt.hostProofSha256, digest(proofBytes));
  assert.equal(result.receipt.checkpointManifestSha256, CHECKPOINT_SHA);
  assert.equal(result.receipt.supersedesHostProofSha256, PROOF_SHA);
  assert.equal(result.receipt.failedOneShotEvidenceManifestSha256, evidence.manifestSha256);
  execute([...NORMAL, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'backend'], { env });
  let serving;
  for (let attempt = 0; attempt < 1200; attempt++) {
    serving = inspect(`${PROJECT}-backend-1`);
    assert.equal(serving.Image, candidateImageId);
    if (serving.State.Health?.Status === 'healthy') break;
    if (serving.State.Restarting || serving.State.Status === 'exited') throw new Error('Backend restore failed.');
    await delay(500);
  }
  assert.equal(serving.State.Health?.Status, 'healthy');
  assert.deepEqual(serving.Mounts.filter(item => item.Type === 'volume')
    .map(item => item.Name).sort(), VOLUMES);
  for (const [service, id] of Object.entries(OTHER)) assert.equal(inspect(`${PROJECT}-${service}-1`).Id, id);
  assert.equal(image(FAILED_TAG).Id, FAILED_IMAGE);
  assert.equal(image(OLD_TAG).Id, OLD_IMAGE);
  assertCheckpointReadback(evidence);
  checkpointReadback();
  console.log(JSON.stringify({ outcome: 'LOCAL_REBOOT_440_RETRIED', imageId: candidateImageId,
    evidenceManifestSha256: evidence.manifestSha256, checkpointManifestSha256: CHECKPOINT_SHA }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`LOCAL_REBOOT_440_RETRY_FAILED: ${error.message}`); process.exitCode = 1; });
}
