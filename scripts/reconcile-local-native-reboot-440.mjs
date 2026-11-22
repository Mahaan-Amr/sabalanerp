#!/usr/bin/env node
// Second pinned incident, one existing Compose service. Never run without reviewed backup destinations.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const PROJECT = 'sabalanerp-local';
const ACTIVE_SHA = 'b820bfa60ec642b87c17a34fcbc527021164708a33df1227d7e19c39c4f8be8a';
const OLD_BOOT = 'db891a29-1343-421d-9df8-28b3b495cf08';
const NEW_BOOT = 'd4568d2d-96ec-4bc3-94ab-4ba62defe9eb';
const OLD_CONTAINER = '00ac2640632a76be3d6bff5378511a14dc8c3b7834bf7754a5d70a0c169c671a';
const OLD_IMAGE = 'sha256:ab17d2c1380b2c70352af3d1cff8c2d301624346637ea5ecb7480fe1a0f21ab9';
const RETAINED_OLD_TAG = 'sabalanerp-local-backend:pre-reboot-20261114';
const PRIOR_RECEIPT_SHA = '44c60ad9d492eab6997fa32f3c44c0370f3d9020bd046b5e5ced3664bc44e6a3';
const PRIOR_PROOF_SHA = 'da0ac9ca538c3f6b7506affd83a73e69482a0e606e6675efc29e74d539e95841';
const PRIOR_MANIFEST_SHA = 'ac45cb21320c484cb71fac2e812cb1463eb85d6480c381164af750e1594f773b';
const PRIOR_PRIMARY = 'C:\\Users\\PC\\Documents\\ChatGPT\\sabalanerp-436-checkpoint-20261112-retry2';
const PRIOR_INDEPENDENT = 'D:\\sabalanerp-436-checkpoint-20261112-retry2';
const OTHER_CONTAINERS = { clamav: 'b89c4299ea7d41a1895c8d52a1835cefd3da2d447d6e1e985bb201ee00a1dca8',
  frontend: '19aebf5decc2ed7cdf62a83f5b4f792d320bf74cffb32a14ddcd97258f930115',
  inquiry: 'b67c817a4eee00e71a821805b3d80354f74758e5140418229a0fdb781d7a4257',
  postgres: '3ba7c705a08e4c3066a6dd43aa839ef9bcfd2614745558052884f2a4de787c48',
  redis: '06c2b7237917b007962b6e93dcc7ffb7fb49233f21c1d8c370c65134666ce3d8' };
const PRESERVED = [
  '23f4614a94022f620734db73518c133cc9a611a6ec34c39b20a3964cf249a209',
  '6822650bc17ebfa79eb752bc0e82855bb6364cb03a96b5cb43a686a1a80a8d99',
  '6b444749ec4f4a088b7872b6f129f6b624a86569a3467dd9fbb2bf4a51cea867',
  '89c6e30fce2656fe1dea63aa223cf5c4cfdad09157893dd19d91ca3fb15b9dec',
  'a9bb0fe72d69b3937277a1367bb9ca2feaedb9821898fbe20f0e85b6ab0231f0',
  'c5a4d5b2a61e52362cca587d6a122048dabc943f9384f7cc882cad46766b220d',
];
const INCIDENT_EVIDENCE = [
  ['local-forced-recovery-incident-57b31bd0b37eb5396ef575c42ba5cf5d2ef09dedb7ee054e22caa91676fe8eaf.json',
    '57b31bd0b37eb5396ef575c42ba5cf5d2ef09dedb7ee054e22caa91676fe8eaf'],
  ['local-reboot-incident-ce0b4189717428b1788c24c2353dab93daf29fafd604330e4d93e7d1c4b0783d.json',
    'ce0b4189717428b1788c24c2353dab93daf29fafd604330e4d93e7d1c4b0783d'],
];
const EXPECTED_EVIDENCE = [...PRESERVED.map(sha256 => ({
  name: `deployment-runtime-native.preserved-${sha256}.json`, sha256 })),
  ...INCIDENT_EVIDENCE.map(([name, sha256]) => ({ name, sha256 }))]
  .sort((a, b) => a.name.localeCompare(b.name));
const VOLUMES = [
  'sabalanerp-local_recovery_coordination', 'sabalanerp-local_backend_uploads',
  'sabalanerp-local_inquiry_data', 'sabalanerp-local_backend_storage_accounting_contracts',
  'sabalanerp-local_backend_storage_contracts', 'sabalanerp-local_backend_storage_hr_hiring',
  'sabalanerp-local_backend_recovery', 'sabalanerp-local_backend_storage_sepidar_backups',
  'sabalanerp-local_backend_storage_support_tickets',
  'sabalanerp-local_backend_storage_dispatch_documents',
].sort();
const ROOT = path.resolve(import.meta.dirname, '..');
const GUARD = 'C:\\dev\\sabalanerp-local-backend-guarded-20261105.yml';
const BASE = ['compose', '-p', PROJECT, '-f', 'docker-compose.local.yml', '-f', GUARD];
const OVERLAY = [...BASE, '-f', 'docker-compose.local-native-reboot-reconcile.yml'];
const PINNED = [...BASE, '-f', 'docker-compose.local-native-reboot-pin.yml'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const execute = (args, options = {}) => {
  const result = spawnSync('docker', args, { cwd: ROOT, encoding: options.encoding ?? 'utf8',
    input: options.input, maxBuffer: 20 * 1024 * 1024, timeout: options.timeout ?? 120000,
    env: options.env ?? process.env });
  assert.equal(result.status, 0, `Docker command failed: ${args.slice(0, 3).join(' ')} ${result.stderr || ''}`);
  return result.stdout;
};
const inspect = name => JSON.parse(execute(['inspect', name]))[0];
const readback = file => {
  const hash = createHash('sha256'), chunk = Buffer.allocUnsafe(4 * 1024 * 1024);
  const fd = fs.openSync(file, 'r');
  try {
    let count;
    while ((count = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) hash.update(chunk.subarray(0, count));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
};

export function waitDockerStream(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Docker stream exceeded ${timeoutMs} ms`));
    }, timeoutMs);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve(code); });
  });
}

async function streamDocker(args, destination) {
  const child = spawn('docker', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let bytes = 0, error = '';
  const output = destination ? fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 }) : null;
  const finished = output && new Promise((resolve, reject) => {
    output.once('finish', resolve);
    output.once('error', error => { child.kill(); reject(error); });
  });
  child.stdout.on('data', chunk => { bytes += chunk.length; });
  child.stderr.on('data', chunk => { error += chunk.toString('utf8').slice(0, 2048); });
  if (output) child.stdout.pipe(output);
  else child.stdout.resume();
  const code = await waitDockerStream(child, 30 * 60 * 1000);
  if (finished) await finished;
  assert.equal(code, 0, `Docker stream failed: ${error}`);
  return bytes;
}

export function verifyPgDump(file, runner = execute, suffix = randomBytes(8).toString('hex')) {
  assert.match(suffix, /^[a-f0-9]{16}$/);
  const staged = `/tmp/sabalan-native-checkpoint-${suffix}.dump`;
  let failure;
  try {
    runner(['cp', file, `${PROJECT}-postgres-1:${staged}`], { timeout: 10 * 60 * 1000 });
    const stagedSha = runner(['exec', `${PROJECT}-postgres-1`, 'sha256sum', staged],
      { timeout: 60 * 1000 }).trim().split(/\s+/)[0];
    assert.equal(stagedSha, readback(file), 'Staged PostgreSQL dump differs from host checkpoint.');
    const listing = runner(['exec', `${PROJECT}-postgres-1`, 'pg_restore', '--list', staged],
      { timeout: 5 * 60 * 1000 });
    assert.match(listing, /TABLE DATA|TABLE/);
  } catch (error) { failure = error; }
  try {
    runner(['exec', `${PROJECT}-postgres-1`, 'rm', '-f', '--', staged], { timeout: 60 * 1000 });
  } catch (cleanupError) {
    if (failure) throw new AggregateError([failure, cleanupError], 'Dump verification and temporary cleanup failed.');
    throw cleanupError;
  }
  if (failure) throw failure;
  return true;
}

export function assertExistingTarget(rows, containers) {
  const expected = ['backend', 'clamav', 'frontend', 'inquiry', 'postgres', 'redis'];
  assert.deepEqual(rows.map(row => row.Service).sort(), expected);
  for (const row of rows) {
    assert.equal(row.Project, PROJECT);
    if (row.Service !== 'backend') assert.equal(row.Health, 'healthy');
  }
  for (const [service, value] of Object.entries(containers)) {
    assert.equal(value.Config.Labels['com.docker.compose.project'], PROJECT);
    assert.equal(value.Config.Labels['com.docker.compose.service'], service);
    assert.equal(value.HostConfig.NetworkMode, `${PROJECT}_default`);
    for (const bindings of Object.values(value.HostConfig.PortBindings || {})) {
      for (const binding of bindings || []) assert.equal(binding.HostIp, '127.0.0.1');
    }
  }
  assert.equal(containers.backend.State.Restarting, true);
  assert.deepEqual(containers.backend.HostConfig.PortBindings['5000/tcp'],
    [{ HostIp: '127.0.0.1', HostPort: '5000' }]);
  assert.equal(containers.backend.Id, OLD_CONTAINER);
  assert.equal(containers.backend.Image, OLD_IMAGE);
  for (const [service, id] of Object.entries(OTHER_CONTAINERS)) assert.equal(containers[service].Id, id);
  return true;
}

function inventory() {
  const rows = execute([...BASE, 'ps', '--format', 'json']).trim().split(/\r?\n/).map(JSON.parse);
  const expected = ['backend', 'clamav', 'frontend', 'inquiry', 'postgres', 'redis'];
  const containers = Object.fromEntries(expected.map(service => [service, inspect(`${PROJECT}-${service}-1`)]));
  assertExistingTarget(rows, containers);
  assert.equal(execute(['exec', `${PROJECT}-inquiry-1`, 'cat', '/proc/sys/kernel/random/boot_id']).trim(), NEW_BOOT);
  const script = `const f=require('fs'),c=require('crypto'),d='/app/recovery-coordination';
    const h=x=>c.createHash('sha256').update(x).digest('hex');
    const active=f.readFileSync(d+'/deployment-runtime-native.json');
    const names=f.readdirSync(d).filter(x=>x.startsWith('deployment-runtime-native.preserved-')||x.startsWith('local-forced-recovery-incident-')||x.startsWith('local-reboot-incident-')).sort();
    console.log(JSON.stringify({activeSha256:h(active),active:JSON.parse(active),evidence:names.map(name=>({name,sha256:h(f.readFileSync(d+'/'+name))})),priorReceiptSha256:h(f.readFileSync(d+'/deployment-runtime-abandonment.json')),priorHostProofSha256:h(f.readFileSync(d+'/deployment-runtime-recovery-host-proof.json'))}));`;
  const state = JSON.parse(execute(['exec', `${PROJECT}-inquiry-1`, 'node', '-e', script]));
  assert.equal(state.activeSha256, ACTIVE_SHA);
  assert.equal(state.priorReceiptSha256, PRIOR_RECEIPT_SHA);
  assert.equal(state.priorHostProofSha256, PRIOR_PROOF_SHA);
  assert.deepEqual(state.evidence, EXPECTED_EVIDENCE);
  assert.equal(state.active.guardian.bootId, OLD_BOOT);
  assert.equal(state.active.guardian.pid, 1);
  assert.equal(state.active.guardian.pidNamespace, 'pid:[4026532751]');
  assert.equal(state.active.guardian.startTicks, '1829736');
  assert.equal(state.active.namespace,
    'sabalan-rt-d2d1b01b543eae810dd2d5b32d6b18537651363748b84d96');
  assert.equal(state.active.previousSha256,
    'a22e3874e7af624bc804ef91bb792026f13e49ce4d3247082c164848547b3a42');
  assert.equal(state.active.localAbandonmentSha256, PRIOR_RECEIPT_SHA);
  assert.equal(state.active.clusterIdentifier, '7703877635514671138');
  assert.equal(state.active.initialDatabase.oid, '57567');
  const sql = `SELECT json_build_object('system',c.system_identifier::text,
    'oid',(SELECT oid::text FROM pg_database WHERE datname='sabalanerp'),
    'oldSessions',(SELECT count(*) FROM pg_stat_activity WHERE application_name='${state.active.namespace}'),
    'allTagged',(SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'sabalan-rt-%'),
    'prepared',(SELECT count(*) FROM pg_prepared_xacts)) FROM pg_control_system() c`;
  const database = JSON.parse(execute(['exec', `${PROJECT}-postgres-1`, 'psql', '-X', '-q', '-t', '-A',
    '-U', 'postgres', '-d', 'postgres', '-c', sql]));
  assert.equal(database.system, state.active.clusterIdentifier);
  assert.equal(database.oid, state.active.initialDatabase.oid);
  assert.equal(database.system, '7703877635514671138');
  assert.equal(database.oid, '57567');
  assert.equal(database.oldSessions, 0);
  assert.equal(database.allTagged, 0);
  assert.equal(database.prepared, 0);
  return { containers, state, database };
}

export function assertCheckpointReadback(checkpoint) {
  const { primaryPath, independentPath, manifest, manifestSha256 } = checkpoint;
  assert.equal(digest(Buffer.from(JSON.stringify(manifest) + '\n')), manifestSha256);
  assert.equal(readback(path.join(primaryPath, 'manifest.json')), manifestSha256);
  assert.equal(readback(path.join(independentPath, 'manifest.json')), manifestSha256);
  for (const entry of manifest.entries) {
    for (const root of [primaryPath, independentPath]) {
      const file = path.join(root, entry.name);
      assert.equal(fs.statSync(file).size, entry.bytes);
      assert.equal(readback(file), entry.sha256);
    }
  }
  return true;
}

export function assertPriorCheckpoint() {
  const primary = fs.readFileSync(path.join(PRIOR_PRIMARY, 'manifest.json'));
  const independent = fs.readFileSync(path.join(PRIOR_INDEPENDENT, 'manifest.json'));
  assert.equal(digest(primary), PRIOR_MANIFEST_SHA);
  assert.equal(digest(independent), PRIOR_MANIFEST_SHA);
  const manifest = JSON.parse(primary);
  assert.equal(manifest.activeSha256,
    'a22e3874e7af624bc804ef91bb792026f13e49ce4d3247082c164848547b3a42');
  assertCheckpointReadback({ primaryPath: PRIOR_PRIMARY, independentPath: PRIOR_INDEPENDENT,
    manifestSha256: PRIOR_MANIFEST_SHA, manifest });
  return true;
}

async function checkpoint(primaryRoot, independentRoot, containers, state) {
  const primary = path.resolve(primaryRoot), independent = path.resolve(independentRoot);
  assert.notEqual(primary, independent);
  assert.match(primary, /^C:[\\/]/i);
  assert.match(independent, /^D:[\\/]/i);
  for (const target of [primary, independent]) {
    const entry = fs.lstatSync(target);
    assert(entry.isDirectory() && !entry.isSymbolicLink(), 'Checkpoint destination must be a real directory.');
  }
  assert.notEqual(fs.statSync(primary).dev, fs.statSync(independent).dev,
    'The independent checkpoint must be on a different filesystem.');
  assert.equal(fs.readdirSync(primary).length, 0);
  assert.equal(fs.readdirSync(independent).length, 0);
  const sourceMounts = [];
  for (const service of ['inquiry', 'backend']) {
    for (const mount of containers[service].Mounts.filter(item => item.Type === 'volume')) {
      if (sourceMounts.some(item => item.name === mount.Name)) continue;
      sourceMounts.push({ name: mount.Name, container: `${PROJECT}-${service}-1`, destination: mount.Destination });
    }
  }
  assert.deepEqual(sourceMounts.map(item => item.name).sort(), VOLUMES);
  const sizes = [];
  for (const mount of sourceMounts) sizes.push(await streamDocker(['cp', `${mount.container}:${mount.destination}`, '-']));
  const pgBytes = Number(execute(['exec', `${PROJECT}-postgres-1`, 'psql', '-X', '-q', '-t', '-A',
    '-U', 'postgres', '-d', 'postgres', '-c', "SELECT pg_database_size('sabalanerp')"]).trim());
  assert(Number.isSafeInteger(pgBytes) && pgBytes > 0);
  const redisMemory = Number(execute(['exec', `${PROJECT}-redis-1`, 'redis-cli', 'INFO', 'memory'])
    .match(/^used_memory:(\d+)/m)?.[1]);
  assert(Number.isSafeInteger(redisMemory) && redisMemory >= 0);
  const oldImageBytes = JSON.parse(execute(['image', 'inspect', OLD_IMAGE]))[0].Size;
  assert(Number.isSafeInteger(oldImageBytes) && oldImageBytes > 0);
  const estimated = sizes.reduce((sum, size) => sum + size, 0)
    + pgBytes * 2 + redisMemory * 2 + oldImageBytes * 2;
  const reserve = 1024 * 1024 * 1024;
  for (const target of [primary, independent]) {
    const free = fs.statfsSync(target).bavail * fs.statfsSync(target).bsize;
    assert(free > estimated + reserve, `${target} lacks checkpoint space`);
  }
  const entries = [];
  const oldInspect = path.join(primary, 'backend-old-container-inspect.json');
  fs.writeFileSync(oldInspect, JSON.stringify(containers.backend) + '\n', { flag: 'wx', mode: 0o600 });
  entries.push({ name: path.basename(oldInspect), sha256: readback(oldInspect), bytes: fs.statSync(oldInspect).size });
  const oldRootfs = path.join(primary, 'backend-old-rootfs.tar');
  await streamDocker(['export', containers.backend.Id], oldRootfs);
  entries.push({ name: path.basename(oldRootfs), sha256: readback(oldRootfs), bytes: fs.statSync(oldRootfs).size });
  const dump = path.join(primary, 'postgres-sabalanerp.dump');
  await streamDocker(['exec', `${PROJECT}-postgres-1`, 'pg_dump', '-U', 'postgres', '-d', 'sabalanerp', '-Fc'], dump);
  verifyPgDump(dump);
  entries.push({ name: path.basename(dump), sha256: readback(dump), bytes: fs.statSync(dump).size });
  for (const mount of sourceMounts) {
    const name = `volume-${mount.name}.tar`;
    const file = path.join(primary, name);
    await streamDocker(['cp', `${mount.container}:${mount.destination}`, '-'], file);
    entries.push({ name, sha256: readback(file), bytes: fs.statSync(file).size,
      source: `${mount.container}:${mount.destination}` });
  }
  const sqliteTmp = `/tmp/sabalan-local-reboot-${randomBytes(8).toString('hex')}.db`;
  execute(['exec', `${PROJECT}-inquiry-1`, 'sqlite3', '/data/inquiry.db', `.backup ${sqliteTmp}`]);
  assert.equal(execute(['exec', `${PROJECT}-inquiry-1`, 'sqlite3', sqliteTmp,
    'PRAGMA integrity_check;']).trim(), 'ok');
  const sourceSqliteSha = execute(['exec', `${PROJECT}-inquiry-1`, 'sha256sum', sqliteTmp]).split(/\s+/)[0];
  const sqlite = path.join(primary, 'inquiry-consistent.db');
  execute(['cp', `${PROJECT}-inquiry-1:${sqliteTmp}`, sqlite], { timeout: 30 * 60 * 1000 });
  assert.equal(readback(sqlite), sourceSqliteSha);
  entries.push({ name: path.basename(sqlite), sha256: readback(sqlite), bytes: fs.statSync(sqlite).size });
  const redisTmp = `/tmp/sabalan-local-reboot-${randomBytes(8).toString('hex')}.rdb`;
  execute(['exec', `${PROJECT}-redis-1`, 'redis-cli', '--rdb', redisTmp], { timeout: 30 * 60 * 1000 });
  assert.match(execute(['exec', `${PROJECT}-redis-1`, 'redis-check-rdb', redisTmp]),
    /RDB looks OK|Checksum OK/i);
  const redisSha = execute(['exec', `${PROJECT}-redis-1`, 'sha256sum', redisTmp]).split(/\s+/)[0];
  const redis = path.join(primary, 'redis-consistent.rdb');
  execute(['cp', `${PROJECT}-redis-1:${redisTmp}`, redis], { timeout: 30 * 60 * 1000 });
  assert.equal(readback(redis), redisSha);
  entries.push({ name: path.basename(redis), sha256: readback(redis), bytes: fs.statSync(redis).size });
  const manifest = { format: 'sabalan-local-native-reboot-checkpoint/v1', activeSha256: state.activeSha256,
    postgresSystemIdentifier: state.active.clusterIdentifier, databaseOid: state.active.initialDatabase.oid,
    inquiryDatabase: 'consistent-sqlite-backup', redis: 'consistent-rdb-snapshot',
    clamavSignatures: 'regenerable-service-untouched', volumeArchives: 'file-copy-only',
    absentBeforeReconciliation: [], entries };
  const raw = Buffer.from(JSON.stringify(manifest) + '\n');
  fs.writeFileSync(path.join(primary, 'manifest.json'), raw, { flag: 'wx', mode: 0o600 });
  for (const file of [...entries.map(entry => entry.name), 'manifest.json']) {
    fs.copyFileSync(path.join(primary, file), path.join(independent, file), fs.constants.COPYFILE_EXCL);
  }
  const checkpoint = { manifestSha256: digest(raw), independentManifestSha256: digest(raw),
    primaryPath: primary, independentPath: independent, manifest,
    primaryReadbackVerified: true, independentReadbackVerified: true };
  assertCheckpointReadback(checkpoint);
  return checkpoint;
}

async function main() {
  const [flag, primary, independent] = process.argv.slice(2);
  assert.equal(flag, '--execute-reviewed-incident');
  assert(primary && independent, 'Specify two existing empty checkpoint directories on different filesystems.');
  assert.equal(digest(fs.readFileSync(GUARD)),
    '98ade19f953ce07845c4433db51c7f9d229d09369caeae33e6760d247bcc1821',
    'The existing guarded backend overlay changed.');
  assertPriorCheckpoint();
  const { containers, state, database } = inventory();
  const copy = await checkpoint(primary, independent, containers, state);
  const fresh = inventory();
  assert.equal(fresh.state.activeSha256, state.activeSha256);
  assert.deepEqual(fresh.state.evidence, state.evidence);
  assert.deepEqual(fresh.database, database);
  assertPriorCheckpoint();
  const existingTag = spawnSync('docker', ['image', 'inspect', RETAINED_OLD_TAG],
    { cwd: ROOT, encoding: 'utf8', timeout: 10000 });
  assert.notEqual(existingTag.status, 0, 'Old image retention tag already exists.');
  execute(['tag', OLD_IMAGE, RETAINED_OLD_TAG]);
  assert.equal(JSON.parse(execute(['image', 'inspect', RETAINED_OLD_TAG]))[0].Id, OLD_IMAGE);
  execute([...BASE, 'build', 'backend'], { timeout: 30 * 60 * 1000 });
  const candidateImageId = JSON.parse(execute(['image', 'inspect', `${PROJECT}-backend`]))[0].Id;
  assert(/^sha256:[a-f0-9]{64}$/.test(candidateImageId) && candidateImageId !== OLD_IMAGE);
  assertCheckpointReadback(copy);
  assertPriorCheckpoint();
  const historicalActive = state.evidence.filter(item => item.name.startsWith('deployment-runtime-native.preserved-'));
  const historicalIncidentEvidence = state.evidence.filter(item => item.name.startsWith('local-'));
  const proof = { format: 'sabalan-local-native-reboot-host-proof/v1', project: PROJECT,
    backendContainerId: containers.backend.Id, oldImageId: containers.backend.Image,
    retainedOldImageTag: RETAINED_OLD_TAG,
    priorReceiptSha256: PRIOR_RECEIPT_SHA, priorHostProofSha256: PRIOR_PROOF_SHA,
    priorCheckpointManifestSha256: PRIOR_MANIFEST_SHA,
    candidateImageId, activeSha256: ACTIVE_SHA, bootId: NEW_BOOT, publicIngress: false,
    historicalActive, historicalIncidentEvidence, database, checkpoint: copy };
  const proofBytes = Buffer.from(JSON.stringify(proof) + '\n');
  const writer = `const f=require('fs'),p='/app/recovery-coordination/deployment-runtime-recovery-host-proof-440.json';
    const b=f.readFileSync(0);const fd=f.openSync(p,'wx',0o600);try{f.writeSync(fd,b);f.fsyncSync(fd)}finally{f.closeSync(fd)}
    const d=f.openSync('/app/recovery-coordination','r');try{f.fsyncSync(d)}finally{f.closeSync(d)}`;
  assert.equal(execute(['exec', `${PROJECT}-inquiry-1`, 'id', '-u']).trim(), '0');
  execute(['exec', '-i', `${PROJECT}-inquiry-1`, 'node', '-e', writer], { input: proofBytes, encoding: null });
  const env = { ...process.env, LOCAL_NATIVE_REBOOT_IMAGE_ID: candidateImageId,
    LOCAL_NATIVE_REBOOT_EXPECTED_ACTIVE_SHA256: ACTIVE_SHA,
    LOCAL_NATIVE_REBOOT_EXPECTED_OLD_BOOT_ID: OLD_BOOT,
    LOCAL_NATIVE_REBOOT_HOST_PROOF_SHA256: digest(proofBytes) };
  assert.equal(JSON.parse(execute(['image', 'inspect', `${PROJECT}-backend`]))[0].Id, candidateImageId);
  execute([...OVERLAY, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'backend'], { env });
  let backend;
  for (let attempt = 0; attempt < 120; attempt++) {
    backend = inspect(`${PROJECT}-backend-1`);
    assert.equal(backend.Image, candidateImageId);
    if (backend.State.Status === 'exited') break;
    await delay(500);
  }
  assert.equal(backend.State.Status, 'exited');
  assert.equal(backend.State.ExitCode, 0);
  // Do not restore the normal command unless the one-shot receipt is verified.
  const reader = `const f=require('fs'),c=require('crypto'),d='/app/recovery-coordination';
    const r=f.readFileSync(d+'/deployment-runtime-abandonment-440.json');
    const a=f.readFileSync(d+'/deployment-runtime-native.json');
    console.log(JSON.stringify({receipt:JSON.parse(r),activeSha256:c.createHash('sha256').update(a).digest('hex')}));`;
  const result = JSON.parse(execute(['exec', `${PROJECT}-inquiry-1`, 'node', '-e', reader]));
  assert.equal(result.activeSha256, ACTIVE_SHA);
  assert.equal(result.receipt.phase, 'ABANDONED_ON_VM_REBOOT');
  assert.equal(result.receipt.nativeReaped, false);
  assert.equal(result.receipt.externalEffectsCompleted, false);
  assert.equal(result.receipt.productionAdmission, false);
  assert.equal(result.receipt.activeSha256, ACTIVE_SHA);
  assert.equal(result.receipt.priorReceiptSha256, PRIOR_RECEIPT_SHA);
  assert.equal(result.receipt.priorHostProofSha256, PRIOR_PROOF_SHA);
  assert.equal(result.receipt.priorCheckpointManifestSha256, PRIOR_MANIFEST_SHA);
  assert.equal(result.receipt.checkpointManifestSha256, copy.manifestSha256);
  assert.equal(result.receipt.hostProofSha256, digest(proofBytes));
  execute([...PINNED, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'backend'], { env });
  let serving;
  for (let attempt = 0; attempt < 1200; attempt++) {
    serving = inspect(`${PROJECT}-backend-1`);
    assert.equal(serving.Image, candidateImageId);
    if (serving.State.Health?.Status === 'healthy') break;
    if (serving.State.Restarting || serving.State.Status === 'exited') {
      throw new Error('Restored local backend did not become healthy; retain checkpoint and receipt for diagnosis.');
    }
    await delay(500);
  }
  assert.equal(serving.State.Health?.Status, 'healthy');
  assert.deepEqual(serving.Mounts.filter(item => item.Type === 'volume').map(item => item.Name).sort(), VOLUMES);
  for (const service of ['clamav', 'frontend', 'inquiry', 'postgres', 'redis']) {
    assert.equal(inspect(`${PROJECT}-${service}-1`).Id, containers[service].Id);
  }
  assertPriorCheckpoint();
  assertCheckpointReadback(copy);
  assert.equal(JSON.parse(execute(['image', 'inspect', RETAINED_OLD_TAG]))[0].Id, OLD_IMAGE);
  console.log(JSON.stringify({ outcome: 'LOCAL_REBOOT_RECONCILED', checkpoint: copy,
    activeSha256: ACTIVE_SHA, imageId: candidateImageId, oldContainerReplaced: true }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`LOCAL_REBOOT_RECONCILIATION_FAILED: ${error.message}`); process.exitCode = 1; });
}
