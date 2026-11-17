import assert from 'node:assert/strict';
import { withHealthyDrill } from './deploymentCheckpointDrill.fixture';
import { test } from 'node:test';
import { hasHealthyIndependentCheckpointDrill, planRemoteCheckpointRetention, PROTECTED_DATABASE_ROLE_COMPONENT } from '../deploymentCheckpointPolicy';
import { assertRoleDrillDatabase, replaceRoleDrillSidecar, type RoleDrillTarget } from '../deploymentDrillRoleTarget';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { enforceFilesystemRemoteRetention, enforceLocalCheckpointRetention } from '../deploymentCheckpointStorage';

test('independent drill must bind full verified scope, exact archive and distinct stable hosts', () => {
  const point = withHealthyDrill({ id: 'point', releaseId: 'release', size: 100 });
  assert.equal(hasHealthyIndependentCheckpointDrill(point), true);
  const invalid = [
    { lastDrill: undefined },
    { sourceMachineUuidSha256: undefined },
    { checksum: 'e'.repeat(64) }, { size: 101 }, { releaseId: 'different' },
    ...[
      { status: 'FAILED' }, { phase: 'INCOMPLETE' }, { packageType: 'SANITIZED_TEST' },
      { checkpointId: 'other' }, { operationId: 'drill-other-123' },
      { sourceKernelBootIdSha256: 'e'.repeat(64) },
      // A production host reboot changes boot ID but does not make it independent.
      { recoveryMachineUuidSha256: point.sourceMachineUuidSha256, recoveryKernelBootIdSha256: 'e'.repeat(64) },
      { stagedPostgresRestore: false }, { stagedSqliteIntegrity: false },
      { verifiedFiles: false }, { verifiedApplicationPayloads: false }, { verifiedBusinessData: false },
    ].map(change => ({ lastDrill: { ...point.lastDrill, ...change } })),
  ];
  for (const change of invalid) assert.equal(hasHealthyIndependentCheckpointDrill({ ...point, ...change }), false, JSON.stringify(change));
});

test('role-aware COMPLETE checkpoints require the exact role snapshot readback before counting as healthy', () => {
  const snapshotSha256 = '8'.repeat(64);
  const point = withHealthyDrill({
    id: 'role-point', releaseId: 'release', size: 100,
    manifest: { packageType: 'COMPLETE', components: [{ path: PROTECTED_DATABASE_ROLE_COMPONENT, sha256: snapshotSha256, size: 64 }] },
  });
  const roleEvidence = { snapshotSha256, targetSealSha256: '9'.repeat(64), owner: 'isolated_owner' };
  assert.equal(hasHealthyIndependentCheckpointDrill(point), false);
  assert.equal(hasHealthyIndependentCheckpointDrill({
    ...point, lastDrill: { ...point.lastDrill, verifiedDatabaseRoles: { ...roleEvidence, snapshotSha256: '7'.repeat(64) } },
  }), false);
  assert.equal(hasHealthyIndependentCheckpointDrill({
    ...point, lastDrill: { ...point.lastDrill, verifiedDatabaseRoles: roleEvidence },
  }), true);
});

test('role-aware drill refuses a target that differs from the sealed PostgreSQL identity', () => {
  const target = { name: 'drill', oid: '123', systemIdentifier: '555', owner: 'drill_owner' };
  const plan: RoleDrillTarget = {
    format: 'sabalan-independent-role-drill-target/v1', checkpointId: 'role-point',
    ciphertextSha256: '1'.repeat(64), ciphertextSize: 1024, snapshotSha256: '2'.repeat(64),
    sourceDatabase: { name: 'source', oid: '321', systemIdentifier: '444' },
    recoveryHost: { machineUuidSha256: '3'.repeat(64), kernelBootIdSha256: '4'.repeat(64) },
    targetDatabase: target,
  };
  const observed = { ...target, admitted: true, controlSchemaAvailable: true };
  assert.doesNotThrow(() => assertRoleDrillDatabase(plan, observed));
  const changes = [{ oid: '456' }, { systemIdentifier: '444' }, { owner: 'foreign' },
    { name: 'source' }, { admitted: false }, { controlSchemaAvailable: false }];
  for (const change of changes) {
    assert.throws(() => assertRoleDrillDatabase(plan, { ...observed, ...change }), { code: 'DEPLOYMENT_DRILL_ROLE_TARGET_UNPROVEN' });
  }
  assert.throws(() => assertRoleDrillDatabase(plan, observed, true), { code: 'DEPLOYMENT_DRILL_ROLE_TARGET_UNPROVEN' });
  assert.doesNotThrow(() => assertRoleDrillDatabase(plan, { ...observed, oid: '456' }, true));
});

test('new local-validation-only uploads cannot displace independently healthy recovery points', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-unqualified-retention-'));
  try {
    for (const value of [1, 2, 3, 4]) {
      const remotePath = path.join(root, `point-${value}.sabrec`), bytes = Buffer.from(`point-${value}`);
      const point = { id: `point-${value}`, releaseId: `release-${value}`, remotePath, size: bytes.length,
        checksum: createHash('sha256').update(bytes).digest('hex'), createdAt: `2026-10-0${value}T00:00:00Z`,
        remoteVerified: true, localVerified: true, restoreVerified: true, manifestReadable: true,
        compatibility: { local: { compatible: true } } };
      await fs.writeFile(remotePath, bytes);
      await fs.writeFile(`${remotePath}.json`, JSON.stringify(value <= 2 ? withHealthyDrill(point) : point));
    }
    const result = await enforceFilesystemRemoteRetention(root, 'point-4');
    assert.deepEqual(result.plan.deleteIds, []);
    assert.equal(result.retainedPoints.length, 2);
    for (const value of [1, 2, 3, 4]) assert.equal(await fs.readFile(path.join(root, `point-${value}.sabrec`), 'utf8'), `point-${value}`);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('withdrawn independent health between remote and local retention protects local originals', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-withdrawn-drill-'));
  try {
    const local = path.join(root, 'local'), remote = path.join(root, 'remote');
    await fs.mkdir(local); await fs.mkdir(remote);
    for (const value of [1, 2, 3]) {
      const id = `point-${value}`, bytes = Buffer.from(id);
      const point = withHealthyDrill({ id, releaseId: id, archivePath: path.join(local, `${id}.sabrec`),
        remotePath: path.join(remote, `${id}.sabrec`), size: bytes.length,
        checksum: createHash('sha256').update(bytes).digest('hex'), remoteVerified: true,
        createdAt: `2026-10-0${value}T00:00:00Z` });
      for (const file of [point.archivePath, point.remotePath]) {
        await fs.writeFile(file, bytes); await fs.writeFile(`${file}.json`, JSON.stringify(point));
      }
    }
    const result = await enforceFilesystemRemoteRetention(remote, 'point-3', local);
    const file = path.join(remote, 'point-2.sabrec.json'), point = JSON.parse(await fs.readFile(file, 'utf8'));
    await fs.writeFile(file, JSON.stringify({ ...point, lastDrill: { ...point.lastDrill, status: 'FAILED' } }));
    await assert.rejects(enforceLocalCheckpointRetention(local, remote, 'point-3', result), /REPLACEMENT_EVIDENCE_CHANGED/);
    assert.equal(await fs.readFile(path.join(local, 'point-1.sabrec'), 'utf8'), 'point-1');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('a third complete verified checkpoint retires the oldest while keeping two recovery points', () => {
  const artifacts = [1, 2, 3].map(value => withHealthyDrill({
    id: `backup-${value}`, releaseId: `release-${value}`, size: 100,
    createdAt: new Date(`2026-10-0${value}T00:00:00Z`), remoteVerified: true,
    restoreVerified: true, active: value === 3, incidentOpen: false,
  }));
  const plan = planRemoteCheckpointRetention(artifacts);
  assert.deepEqual(plan.deleteIds, ['backup-1']);
  assert.deepEqual(plan.keepIds.sort(), ['backup-2', 'backup-3']);
});

test('incomplete backups and incident evidence stay protected outside the normal two-point limit', () => {
  const base = { releaseId: 'release', size: 100, createdAt: new Date('2026-01-01'), remoteVerified: true, active: false, incidentOpen: false };
  const plan = planRemoteCheckpointRetention([
    { ...base, id: 'incomplete' },
    { ...base, id: 'incident', restoreVerified: true, incidentOpen: true },
    { ...base, id: 'first', restoreVerified: true, createdAt: new Date('2026-01-02') },
    { ...base, id: 'second', restoreVerified: true, createdAt: new Date('2026-01-03') },
  ]);
  assert.deepEqual(plan.deleteIds, []);
});

test('remote cleanup verifies replacement bytes before deleting any old checkpoint', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-retention-'));
  try {
    for (const value of [1, 2, 3]) {
      const archive = path.join(root, `backup-${value}.sabrec`);
      const bytes = Buffer.from(`checkpoint-${value}`);
      await fs.writeFile(archive, bytes);
      await fs.writeFile(`${archive}.json`, JSON.stringify(withHealthyDrill({
        id: `backup-${value}`, releaseId: `release-${value}`, remotePath: archive, size: bytes.length,
        checksum: createHash('sha256').update(bytes).digest('hex'),
        createdAt: `2026-10-0${value}T00:00:00Z`, remoteVerified: true, restoreVerified: true,
      })));
    }
    await fs.appendFile(path.join(root, 'backup-3.sabrec'), 'corrupt');
    await assert.rejects(enforceFilesystemRemoteRetention(root, 'backup-3'));
    assert.equal(await fs.readFile(path.join(root, 'backup-1.sabrec'), 'utf8'), 'checkpoint-1');
    await fs.writeFile(path.join(root, 'backup-3.sabrec'), 'checkpoint-3');
    const result = await enforceFilesystemRemoteRetention(root, 'backup-3');
    assert.deepEqual(result.plan.deleteIds, ['backup-1']);
    await assert.rejects(fs.stat(path.join(root, 'backup-1.sabrec')), { code: 'ENOENT' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('obsolete local copies are retired only after two independent replacements are proven', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-local-retention-'));
  try {
    const local = path.join(root, 'local'); const remote = path.join(root, 'remote');
    await fs.mkdir(local); await fs.mkdir(remote);
    for (const value of [1, 2, 3]) {
      const id = `backup-${value}`; const bytes = Buffer.from(`checkpoint-${value}`);
      const metadata = withHealthyDrill({ id, releaseId: id, createdAt: `2026-10-0${value}T00:00:00Z`, size: bytes.length,
        checksum: createHash('sha256').update(bytes).digest('hex'), remoteVerified: true, restoreVerified: true,
        remotePath: path.join(remote, `${id}.sabrec`), archivePath: path.join(local, `${id}.sabrec`) });
      await fs.writeFile(metadata.archivePath, bytes); await fs.writeFile(metadata.remotePath, bytes);
      await fs.writeFile(`${metadata.archivePath}.json`, JSON.stringify(metadata));
      await fs.writeFile(`${metadata.remotePath}.json`, JSON.stringify(metadata));
    }
    const heldMetadata = path.join(local, 'backup-1.sabrec.json');
    const held = JSON.parse(await fs.readFile(heldMetadata, 'utf8'));
    await fs.writeFile(heldMetadata, JSON.stringify({ ...held, incidentOpen: true }));
    const protectedPlan = await enforceFilesystemRemoteRetention(remote, 'backup-3', local);
    assert.deepEqual(protectedPlan.plan.deleteIds, []);
    await fs.writeFile(heldMetadata, '{broken');
    await assert.rejects(enforceFilesystemRemoteRetention(remote, 'backup-3', local));
    assert.equal(await fs.readFile(path.join(remote, 'backup-1.sabrec'), 'utf8'), 'checkpoint-1');
    await fs.writeFile(heldMetadata, JSON.stringify(held));
    const remoteHeldMetadata = path.join(remote, 'backup-1.sabrec.json');
    await fs.writeFile(remoteHeldMetadata, JSON.stringify({ ...held, incidentOpen: true }));
    const remoteHeld = await enforceFilesystemRemoteRetention(remote, 'backup-3', local);
    await enforceLocalCheckpointRetention(local, remote, 'backup-3', remoteHeld);
    assert.equal(await fs.readFile(path.join(local, 'backup-1.sabrec'), 'utf8'), 'checkpoint-1');
    await fs.writeFile(remoteHeldMetadata, JSON.stringify(held));
    const retained = await enforceFilesystemRemoteRetention(remote, 'backup-3', local);
    await enforceLocalCheckpointRetention(local, remote, 'backup-3', retained);
    await assert.rejects(fs.stat(path.join(local, 'backup-1.sabrec')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(local, 'backup-2.sabrec'), 'utf8'), 'checkpoint-2');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('retention resumes interrupted deletions and carries remote retirement evidence across pre/post upload passes', async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-retention-resume-'));
  const originalUnlink = fs.unlink.bind(fs);
  const originalOpen = fs.open.bind(fs);
  let completionFailure = true;
  try {
    const local = path.join(root, 'local'); const remote = path.join(root, 'remote');
    await fs.mkdir(local); await fs.mkdir(remote);
    const create = async (value: number) => {
      const id = `backup-${value}`; const bytes = Buffer.from(id);
      const metadata = withHealthyDrill({ id, releaseId: id, createdAt: `2026-10-0${value}T00:00:00Z`, size: bytes.length,
        checksum: createHash('sha256').update(bytes).digest('hex'), remoteVerified: true, restoreVerified: true,
        remotePath: path.join(remote, `${id}.sabrec`), archivePath: path.join(local, `${id}.sabrec`) });
      await fs.writeFile(metadata.archivePath, bytes); await fs.writeFile(metadata.remotePath, bytes);
      await fs.writeFile(`${metadata.archivePath}.json`, JSON.stringify(metadata));
      await fs.writeFile(`${metadata.remotePath}.json`, JSON.stringify(metadata));
    };
    for (const value of [1, 2, 3]) await create(value);
    const failures = new Set([path.join(remote, 'backup-1.sabrec.json'), path.join(local, 'backup-1.sabrec.json')]);
    context.mock.method(fs, 'unlink', async (file: Parameters<typeof fs.unlink>[0]) => {
      if (failures.delete(String(file))) throw Object.assign(new Error('simulated interruption'), { code: 'EIO' });
      return originalUnlink(file);
    });
    await assert.rejects(enforceFilesystemRemoteRetention(remote, 'backup-4', local), /simulated interruption/);
    context.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (String(args[0]) === path.join(remote, 'retention-audit.jsonl')) {
        const originalWrite = handle.writeFile.bind(handle);
        handle.writeFile = (async (...writeArgs: Parameters<typeof handle.writeFile>) => {
          if (String(writeArgs[0]).includes('RETENTION_COMPLETED') && completionFailure) {
            completionFailure = false;
            throw new Error('simulated completion interruption');
          }
          return originalWrite(...writeArgs);
        }) as typeof handle.writeFile;
      }
      return handle;
    });
    await assert.rejects(enforceFilesystemRemoteRetention(remote, 'backup-4', local), /simulated completion interruption/);
    await enforceFilesystemRemoteRetention(remote, 'backup-4', local);
    await create(4);
    const postUpload = await enforceFilesystemRemoteRetention(remote, 'backup-4', local);
    await assert.rejects(enforceLocalCheckpointRetention(local, remote, 'backup-4', postUpload), /simulated interruption/);
    await enforceLocalCheckpointRetention(local, remote, 'backup-4', postUpload);
    for (const id of [1, 2]) await assert.rejects(fs.stat(path.join(local, `backup-${id}.sabrec.json`)), { code: 'ENOENT' });
    for (const id of [3, 4]) assert.equal(await fs.readFile(path.join(local, `backup-${id}.sabrec`), 'utf8'), `backup-${id}`);
  } finally { context.mock.restoreAll(); await fs.rm(root, { recursive: true, force: true }); }
});

test('role drill evidence is replaced whole and an interrupted publish preserves the old receipt', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-role-sidecar-'));
  const sidecar = path.join(directory, 'point.sabrec.json');
  try {
    await fs.writeFile(sidecar, 'original evidence');
    await assert.rejects(replaceRoleDrillSidecar(sidecar, 'stale evidence', 'new evidence'),
      /DEPLOYMENT_DRILL_EVIDENCE_CHANGED/);
    context.mock.method(fs, 'rename', async () => { throw new Error('simulated interrupted publish'); });
    await assert.rejects(replaceRoleDrillSidecar(sidecar, 'original evidence', 'new evidence'),
      /simulated interrupted publish/);
    assert.equal(await fs.readFile(sidecar, 'utf8'), 'original evidence');
    assert.deepEqual(await fs.readdir(directory), ['point.sabrec.json']);
    context.mock.restoreAll();

    await replaceRoleDrillSidecar(sidecar, 'original evidence', 'new evidence');
    assert.equal(await fs.readFile(sidecar, 'utf8'), 'new evidence');
    assert.deepEqual(await fs.readdir(directory), ['point.sabrec.json']);
  } finally {
    context.mock.restoreAll();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
