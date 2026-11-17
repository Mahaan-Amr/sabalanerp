import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { appendDeploymentHostJournal } from '../deploymentHostJournal';
import { checkpointMetadataTransport } from '../deploymentCheckpointMetadataIdentity';
import { verifyPredecessorRoleCutover } from '../protectedDatabaseRoleRecovery';
import { createTemporaryConcurrencyDatabase } from './shipmentStatementConcurrency/database';

const source = process.env.ACCOUNTING_LEDGER_TEST_DATABASE_URL;

test('owned deployment stages manifest ACLs and restores the matching preimage with both principals dormant', {
  skip: !source, timeout: 240_000,
}, async () => {
  const repositoryRoot = path.resolve('..');
  const fixture = await createTemporaryConcurrencyDatabase({
    repositoryRoot, sourceDatabaseUrl: source!, migrateEmptySchema: true,
  });
  const db = fixture.client();
  const root = await mkdtemp(path.join(os.tmpdir(), 'sabalan-role-cutover-'));
  try {
    const id = `deploy-${fixture.runId}`;
    const token = 'b'.repeat(64);
    const commit = 'c'.repeat(40);
    const image = `sha256:${'d'.repeat(64)}`;
    const owner = 'fixture';
    const now = new Date();
    const localPath = path.join(root, 'checkpoint.sabrec');
    const remoteRoot = path.join(root, 'remote');
    const remotePath = path.join(remoteRoot, 'checkpoint.sabrec');
    const archive = 'checkpoint-verification fixture';
    await writeFile(localPath, archive);
    await mkdir(remoteRoot);
    await writeFile(remotePath, archive);
    const remoteStat = await stat(remotePath);
    const [sourceDatabase] = await db.$queryRaw<Array<{ name: string; oid: string; systemIdentifier: string }>>`
      SELECT current_database() AS name, (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS oid,
        (SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier"`;
    const checkpoint = {
      captureMethod: 'PROTECTED_MAINTENANCE_COMPLETE', id, deploymentId: id, releaseId: id, targetCommit: commit,
      sourceDatabase, createdAt: now.toISOString(), archivePath: localPath, localPath, size: Buffer.byteLength(archive),
      localVerified: true, remoteVerified: true, localRestoreVerified: true, manifestReadable: true,
      checksum: createHash('sha256').update(archive).digest('hex'), remotePath,
      remoteFingerprint: { size: remoteStat.size, mtimeMs: remoteStat.mtimeMs },
    };
    await writeFile(path.join(root, 'deployment-checkpoint.json'), JSON.stringify(checkpointMetadataTransport(checkpoint)));
    const remoteSidecar = JSON.stringify({ ...checkpointMetadataTransport(checkpoint), localPath: undefined, archivePath: undefined });
    await writeFile(`${remotePath}.json`, remoteSidecar);
    const session = { deploymentId: id, leaseToken: token, releaseId: id, targetCommit: commit, owner,
      bootstrap: false, purpose: 'predecessor-role-cutover', controlImage: image };
    const phase = async (value: string) => {
      await writeFile(path.join(root, 'active-deployment-session.json'), JSON.stringify({ ...session, phase: value }));
      await db.deploymentOperation.update({ where: { id }, data: { phase: value } });
      await db.$disconnect();
      await appendDeploymentHostJournal(path.join(root, 'active-deployment.jsonl'), { deploymentId: id, phase: value, event: 'phase-transition' });
    };
    await db.deploymentOperation.create({ data: { id, activeKey: 'production', releaseId: id, targetCommit: commit, owner,
      phase: 'PREFLIGHT', leaseToken: token, startedAt: now, heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + 180_000),
      checkpointJson: checkpoint } });
    await appendDeploymentHostJournal(path.join(root, 'active-deployment.jsonl'), {
      deploymentId: id, phase: 'MAINTENANCE_REQUESTED', event: 'maintenance-activated',
    });
    for (const value of ['SERVICES_DRAINED', 'LOCAL_CHECKPOINT_VERIFIED', 'REMOTE_CHECKPOINT_VERIFIED', 'MUTATION_STARTED']) {
      await phase(value);
    }
    const control = (command: string, environment: NodeJS.ProcessEnv = {}) => {
      const run = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/scripts/deployment-control.ts', command], {
        encoding: 'utf8', env: { ...process.env, DATABASE_URL: fixture.databaseUrl, BACKEND_RUNTIME_ROLE: 'control',
          DEPLOYMENT_ID: id, DEPLOYMENT_LEASE_TOKEN: token, DEPLOYMENT_CONTROL_IMAGE: image,
          DEPLOYMENT_REPORT_DIR: root, RECOVERY_COORDINATION_DIR: root, DEPLOYMENT_REMOTE_MOUNT: remoteRoot, ...environment },
      });
      if (run.error) throw run.error;
      return run;
    };
    const verify = (stage: 'before-grants' | 'grants-staged') => verifyPredecessorRoleCutover({
      databaseUrl: fixture.databaseUrl, stage, migrationsDirectory: path.resolve('prisma/migrations'),
      catalogFile: path.resolve('scripts/predecessor-role-catalog.json'),
    });
    const initial = await verify('before-grants');
    const denied = control('stage-predecessor-role-grants');
    assert.equal(denied.status, 1, denied.stderr);
    assert.match(denied.stderr, /owned maintenance/);
    await writeFile(path.join(root, 'deployment-maintenance.json'), JSON.stringify({ deploymentId: id, releaseId: id, activatedAt: now.toISOString() }));
    const wrongToken = control('stage-predecessor-role-grants', { DEPLOYMENT_LEASE_TOKEN: 'f'.repeat(64) });
    assert.equal(wrongToken.status, 1, wrongToken.stderr);
    assert.match(wrongToken.stderr, /owned maintenance session/);
    await writeFile(localPath, 'drifted checkpoint proof');
    const wrongArchive = control('stage-predecessor-role-grants');
    assert.equal(wrongArchive.status, 1, wrongArchive.stderr);
    assert.match(wrongArchive.stderr, /checkpoint bytes changed/);
    await writeFile(localPath, archive);
    await writeFile(`${remotePath}.json`, JSON.stringify({ ...JSON.parse(remoteSidecar), id: 'another-deployment' }));
    const wrongRemote = control('stage-predecessor-role-grants');
    assert.equal(wrongRemote.status, 1, wrongRemote.stderr);
    assert.match(wrongRemote.stderr, /CHECKPOINT_METADATA_UNPROVEN/);
    await writeFile(`${remotePath}.json`, remoteSidecar);
    await db.$queryRaw`SELECT 1`;
    const connected = control('stage-predecessor-role-grants');
    assert.equal(connected.status, 1, connected.stderr);
    assert.match(connected.stderr, /database to remain drained/);
    await db.$disconnect();
    assert.deepEqual(await verify('before-grants'), initial);
    const staged = control('stage-predecessor-role-grants');
    assert.equal(staged.status, 0, staged.stderr);
    const receipt = JSON.parse(staged.stdout).roleCutover;
    assert.equal(receipt.outcome, 'staged');
    assert.equal(receipt.checkpointSha256, checkpoint.checksum);
    assert.equal(receipt.migrations, 477);
    assert.notEqual(receipt.preimageSha256, receipt.stagedAclSha256);
    assert.deepEqual(await verify('grants-staged'), { ...initial, stage: 'grants-staged' });
    const repeat = control('stage-predecessor-role-grants');
    assert.equal(repeat.status, 0, repeat.stderr);
    assert.deepEqual(JSON.parse(repeat.stdout).roleCutover, { ...receipt, outcome: 'already-staged' });
    const reopen = control('maintenance-off');
    assert.equal(reopen.status, 1, reopen.stderr);
    assert.match(reopen.stderr, /qualified host recovery/);
    await phase('ROLLBACK_STARTED');
    await db.$executeRaw`REVOKE UPDATE ON public.recovery_operations FROM postgres`;
    await db.$disconnect();
    const drifted = control('restore-predecessor-role-grants');
    assert.equal(drifted.status, 1, drifted.stderr);
    assert.match(drifted.stderr, /live ACLs differ from the owned cutover receipt/);
    assert.deepEqual(await verify('grants-staged'), { ...initial, stage: 'grants-staged' });
    await db.$executeRaw`GRANT UPDATE ON public.recovery_operations TO postgres`;
    await db.$disconnect();
    const restored = control('restore-predecessor-role-grants');
    assert.equal(restored.status, 0, restored.stderr);
    assert.deepEqual(JSON.parse(restored.stdout).roleCutover, { ...receipt, outcome: 'restored' });
    assert.deepEqual(await verify('before-grants'), initial);
    const repeatedRestore = control('restore-predecessor-role-grants');
    assert.equal(repeatedRestore.status, 0, repeatedRestore.stderr);
    assert.deepEqual(JSON.parse(repeatedRestore.stdout).roleCutover, { ...receipt, outcome: 'already-restored' });
  } finally {
    await db.$disconnect();
    try { await fixture.cleanup(); } finally { await rm(root, { recursive: true, force: true }); }
  }
});
