#!/usr/bin/env node
// Reads checkpoint and runtime evidence. Writes only a proof to stdout.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ACTIVE = '334255f21ce1dc1eed916c26e47cc70c535cb81654552b760743e0e1cec997fd';
const PREVIOUS = '2cfea161077b52a2313177be2e2ce0ee9cb15682b7dd2d83c0df6539e30898a9';
const RECEIPT = '109bc44da8d00b93e99266c759c134c3570b67330c0b8fb1ddb6125cb16e5235';
const NAMESPACE = 'sabalan-rt-a21c30608612fd8d9a6c0b41f799c542c9391a8203d6ba5e';
const OLD_CONTAINER = '054134c71149589d36eeaec7d80b9f0932e92a675a2f5e91147fbd47748e1cbf';
const OLD_IMAGE = 'sha256:86899cc48ba087f22ee2385c20b6ca7cf2f568ff15d51fd44f1b6e57f021d4af';
const INQUIRY_IMAGE = 'sha256:861da55794e7dac1e98c972c3f8f3bbb2ec3b3289df10d27e1556d246b2c32c8';
const OLD_BOOT = 'ecdfd6df-b536-4161-9bef-a97e7a69f788';
const BOOT = 'e758296d-c127-49c1-94d4-636136f61d1b';
const PROJECT = 'sabalanerp-local';
const COORDINATION = '/app/recovery-coordination';
const PRIMARY = String.raw`D:\sabalanerp-local-recovery-20261117`;
const INDEPENDENT = String.raw`C:\Users\PC\Documents\Codex\sabalanerp-local-recovery-20261117`;
const MANIFEST_SHA = '19de038260f188e42b26c7178f75577193423ba8564d024e4adccf732f6460ad';
const DATABASE = { system: '7703877635514671138', oid: '57567', oldSessions: 0, allTagged: 0, prepared: 0 };
const DIGEST = /^[a-f0-9]{64}$/;
const IMAGE = /^sha256:[a-f0-9]{64}$/;
const SERVICES = ['backend', 'clamav', 'frontend', 'inquiry', 'postgres', 'redis'];
const PAYLOADS = [
  'backend_recovery.tar', 'backend_storage_accounting_contracts.tar',
  'backend_storage_contracts.tar', 'backend_storage_dispatch_documents.tar',
  'backend_storage_hr_hiring.tar', 'backend_storage_sepidar_backups.tar',
  'backend_storage_support_tickets.tar', 'backend_uploads.tar', 'inquiry_data.tar',
  'recovery_coordination.tar', 'redis_data.tar', 'postgres.dump', 'backend-image.tar',
  'inquiry-image.tar', 'inquiry-consistent.db', 'redis-consistent.rdb',
].sort();

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const docker = args => execFileSync('docker', args, { timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
const inspect = (...args) => JSON.parse(docker(['inspect', ...args]));

function assertPhysicalPath(file) {
  assert.equal(fs.realpathSync.native(file).toLowerCase(), file.toLowerCase(), 'checkpoint path was redirected');
}

async function hashCheckpointFile(file, expectedBytes) {
  assertPhysicalPath(file);
  const fd = fs.openSync(file, 'r');
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    assert.ok(before.isFile() && before.nlink === 1n && before.size === BigInt(expectedBytes), file);
    const digest = createHash('sha256');
    for await (const chunk of fs.createReadStream(file, { fd, autoClose: false })) digest.update(chunk);
    const after = fs.fstatSync(fd, { bigint: true });
    const named = fs.lstatSync(file, { bigint: true });
    for (const field of ['dev', 'ino', 'nlink', 'size', 'mtimeNs', 'ctimeNs']) {
      assert.equal(before[field], after[field], file);
      assert.equal(after[field], named[field], file);
    }
    return digest.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

function readManifest(root) {
  assertPhysicalPath(root);
  assert.ok(fs.lstatSync(root).isDirectory(), root);
  const file = path.join(root, 'manifest.json');
  assertPhysicalPath(file);
  const info = fs.lstatSync(file);
  assert.ok(info.isFile() && info.nlink === 1 && info.size > 0 && info.size <= 8192, file);
  return fs.readFileSync(file);
}

async function verifyCheckpoint() {
  const raw = readManifest(PRIMARY);
  assert.equal(sha(raw), MANIFEST_SHA);
  assert.deepEqual(raw, readManifest(INDEPENDENT), 'checkpoint manifests differ');
  const manifest = JSON.parse(raw);
  const bindings = {
    format: 'sabalan-local-dual-checkpoint/v1', sourceProject: PROJECT, activeSha256: ACTIVE,
    backendContainerId: OLD_CONTAINER, backendImage: OLD_IMAGE, inquiryImage: INQUIRY_IMAGE,
    observedBootId: BOOT, clusterIdentifier: DATABASE.system, databaseOid: DATABASE.oid,
  };
  for (const [field, expected] of Object.entries(bindings)) assert.equal(manifest[field], expected, field);
  assert.deepEqual(manifest.entries.map(entry => entry.name).sort(), PAYLOADS);
  for (const { name, bytes, sha256 } of manifest.entries) {
    assert.ok(Number.isSafeInteger(bytes) && bytes > 0, name);
    assert.match(sha256, DIGEST);
    for (const root of [PRIMARY, INDEPENDENT]) {
      assert.equal(await hashCheckpointFile(path.join(root, name), bytes), sha256, name);
    }
  }
  assert.deepEqual(readManifest(PRIMARY), raw);
  assert.deepEqual(readManifest(INDEPENDENT), raw);
  return {
    primaryPath: PRIMARY, independentPath: INDEPENDENT,
    manifestSha256: MANIFEST_SHA, independentManifestSha256: MANIFEST_SHA,
    primaryReadbackVerified: true, independentReadbackVerified: true,
    manifestRawBase64: raw.toString('base64'),
  };
}

function observeIncident() {
  docker(['compose', '-f', 'docker-compose.local.yml', 'ps', '--all']);
  const containers = inspect(...SERVICES.map(service => PROJECT + '-' + service + '-1'));
  assert.equal(containers.length, SERVICES.length);
  const services = Object.fromEntries(SERVICES.map((service, index) => [service, containers[index]]));
  for (const [service, container] of Object.entries(services)) {
    assert.equal(container.Config.Labels['com.docker.compose.project'], PROJECT);
    assert.equal(container.Config.Labels['com.docker.compose.service'], service);
    assert.notEqual(container.HostConfig.NetworkMode, 'host');
    assert.equal(container.HostConfig.PublishAllPorts, false);
    for (const bindings of Object.values(container.HostConfig.PortBindings ?? {})) {
      for (const binding of bindings ?? []) assert.equal(binding.HostIp, '127.0.0.1');
    }
  }
  const { backend, inquiry, postgres } = services;
  assert.equal(backend.Id, OLD_CONTAINER);
  assert.equal(backend.Image, OLD_IMAGE);
  assert.equal(backend.State.Status, 'exited');
  assert.equal(inquiry.Image, INQUIRY_IMAGE);
  assert.equal(inquiry.State.Health?.Status, 'healthy');
  const coordination = container => container.Mounts.find(mount => mount.Destination === COORDINATION);
  assert.ok(coordination(backend)?.RW && coordination(inquiry)?.RW);
  assert.equal(coordination(backend).Source, coordination(inquiry).Source);
  assert.equal(docker(['exec', postgres.Id, 'cat', '/proc/sys/kernel/random/boot_id']).toString().trim(), BOOT);
  const env = new Map(backend.Config.Env.map(entry => {
    const separator = entry.indexOf('=');
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
  assert.equal(env.get('NODE_ENV'), 'development');
  assert.equal(env.get('COMPOSE_PROJECT_NAME'), PROJECT);
  assert.equal(env.get('SMS_IR_ENVIRONMENT'), 'sandbox');
  assert.equal(env.get('BACKEND_RUNTIME_ROLE') ?? 'standalone', 'standalone');
  assert.ok(![...env.keys()].some(key => key.startsWith('BACKEND_ONLINE_')));
  for (const key of ['SMS_IR_API_KEY', 'WEB_PUSH_VAPID_PRIVATE_KEY', 'TAXPAYER_DELIVERY_BROKER_ENDPOINT',
    'TAXPAYER_BROKER_URL', 'TAXPAYER_BROKER_TOKEN', 'TAXPAYER_API_KEY', 'ACCOUNTING_RECONCILIATION_URL']) {
    assert.ok(!env.get(key), key);
  }
  const readCoordination = name => docker(['exec', inquiry.Id, 'cat', COORDINATION + '/' + name]);
  const raw = readCoordination('deployment-runtime-native.json');
  assert.equal(sha(raw), ACTIVE);
  const active = JSON.parse(raw);
  assert.equal(active.phase, 'ACTIVE');
  assert.equal(active.guardian.bootId, OLD_BOOT);
  assert.equal(active.namespace, NAMESPACE);
  assert.equal(active.previousSha256, PREVIOUS);
  assert.equal(active.localAbandonmentSha256, RECEIPT);
  assert.equal(sha(readCoordination('deployment-runtime-history/' + PREVIOUS + '.json')), PREVIOUS);
  const previousReceiptRaw = readCoordination('deployment-runtime-abandonment-20261116.json');
  assert.equal(sha(previousReceiptRaw), RECEIPT);
  const previousReceipt = JSON.parse(previousReceiptRaw);
  assert.equal(previousReceipt.phase, 'ABANDONED_ON_VM_REBOOT');
  assert.equal(previousReceipt.activeSha256, PREVIOUS);
  assert.equal(previousReceipt.hostProofSha256,
    sha(readCoordination('deployment-runtime-recovery-host-proof-20261116-retry.json')));
  const sql = `SELECT json_build_object('system',c.system_identifier::text,
    'oid',(SELECT oid::text FROM pg_database WHERE datname='sabalanerp'),
    'oldSessions',(SELECT count(*) FROM pg_stat_activity WHERE application_name='` + NAMESPACE + `'),
    'allTagged',(SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'sabalan-rt-%'),
    'prepared',(SELECT count(*) FROM pg_prepared_xacts)) FROM pg_control_system() c`;
  const database = JSON.parse(docker(['exec', postgres.Id, 'psql', '-X', '-q', '-t', '-A',
    '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-c', sql]));
  assert.deepEqual(database, DATABASE);
  return { inquiryId: inquiry.Id, postgresId: postgres.Id };
}

const [candidateImageId, extra] = process.argv.slice(2);
assert.equal(process.platform, 'win32', 'run on the Windows checkpoint host');
assert.equal(extra, undefined);
assert.match(candidateImageId ?? '', IMAGE);
const [baseImage, candidate] = inspect('--type=image', OLD_IMAGE, candidateImageId);
assert.equal(baseImage.Id, OLD_IMAGE);
assert.equal(candidate.Id, candidateImageId);
assert.equal(candidate.RootFS.Layers.length, baseImage.RootFS.Layers.length + 1);
assert.deepEqual(candidate.RootFS.Layers.slice(0, -1), baseImage.RootFS.Layers);
assert.deepEqual(candidate.Config, baseImage.Config);
const initial = observeIncident();
const checkpoint = await verifyCheckpoint();
assert.deepEqual(observeIncident(), initial);

const proof = {
  format: 'sabalan-local-native-reboot-host-proof/v1', project: PROJECT, activeSha256: ACTIVE,
  backendContainerId: OLD_CONTAINER, oldImageId: OLD_IMAGE, inquiryImageId: INQUIRY_IMAGE,
  candidateImageId, bootId: BOOT, publicIngress: false, previousActiveSha256: PREVIOUS,
  previousReceiptSha256: RECEIPT, database: DATABASE, checkpoint,
};
const output = Buffer.from(JSON.stringify(proof) + '\n');
assert.ok(output.length <= 16384);
process.stdout.write(output);
