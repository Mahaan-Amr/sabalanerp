import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { appendDeploymentHostJournal } from '../deploymentHostJournal';
import { checkpointMetadataTransport } from '../deploymentCheckpointMetadataIdentity';
import { verifyPredecessorRoleCutover } from '../protectedDatabaseRoleRecovery';
import { mandatoryReleaseDeploymentGateNames } from '../deploymentGates';
import { finishPredecessorRoleTerminal, predecessorRoleClockIdentity } from '../predecessorRoleTerminal';
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
    const graph = Object.fromEntries(['backend', 'frontend', 'inquiry', 'nginx', 'postgres', 'clamav']
      .map(name => [name, image]));
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
      remoteFingerprint: { size: remoteStat.size, mtimeMs: remoteStat.mtimeMs }, rollbackReleaseSet: graph,
    };
    await writeFile(path.join(root, 'deployment-checkpoint.json'), JSON.stringify(checkpointMetadataTransport(checkpoint)));
    const remoteSidecar = JSON.stringify({ ...checkpointMetadataTransport(checkpoint), localPath: undefined, archivePath: undefined });
    await writeFile(`${remotePath}.json`, remoteSidecar);
    const session = { deploymentId: id, leaseToken: token, releaseId: id, targetCommit: commit, owner,
      bootstrap: false, purpose: 'predecessor-role-cutover', controlImage: image, rollbackReleaseSet: graph };
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
    const control = (command: string, environment: NodeJS.ProcessEnv = {}, input?: Buffer, args: string[] = []) => {
      const run = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/scripts/deployment-control.ts', command, ...args], {
        input, encoding: 'utf8', env: { ...process.env, DATABASE_URL: fixture.databaseUrl, BACKEND_RUNTIME_ROLE: 'control',
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
    await db.deploymentOperation.update({ where: { id }, data: {
      checkpointJson: { ...checkpoint, checksum: '0'.repeat(64) },
    } });
    await db.$disconnect();
    const wrongLeaseCheckpoint = control('stage-predecessor-role-grants');
    assert.equal(wrongLeaseCheckpoint.status, 1, wrongLeaseCheckpoint.stderr);
    assert.match(wrongLeaseCheckpoint.stderr, /lease or verified checkpoint has changed/);
    await db.deploymentOperation.update({ where: { id }, data: {
      checkpointJson: { ...checkpoint, remoteFingerprint: { ...checkpoint.remoteFingerprint, mtimeMs: remoteStat.mtimeMs + 0.00025 } },
    } });
    await db.$queryRaw`SELECT 1`;
    const connected = control('stage-predecessor-role-grants');
    assert.equal(connected.status, 1, connected.stderr);
    assert.match(connected.stderr, /database to remain drained/);
    await db.$disconnect();
    assert.deepEqual(await verify('before-grants'), initial);
    const staged = control('stage-predecessor-role-grants');
    assert.equal(staged.status, 0, staged.stderr);
    const receipt = JSON.parse(staged.stdout).roleCutover;
    const holdPath = path.join(root, 'predecessor-role-cutover-active.json');
    const hold = JSON.parse(await readFile(holdPath, 'utf8'));
    assert.deepEqual(hold, {
      format: 'sabalan-predecessor-role-cutover-hold/v1', deploymentId: id, releaseId: id,
      checkpointMetadataSha256: receipt.checkpointMetadataSha256, controlImage: image,
    });
    assert.equal(receipt.outcome, 'staged');
    assert.equal(receipt.checkpointSha256, checkpoint.checksum);
    assert.equal(receipt.migrations, 477);
    assert.notEqual(receipt.preimageSha256, receipt.stagedAclSha256);
    assert.deepEqual(await verify('grants-staged'), { ...initial, stage: 'grants-staged' });
    const repeat = control('stage-predecessor-role-grants');
    assert.equal(repeat.status, 0, repeat.stderr);
    assert.deepEqual(JSON.parse(repeat.stdout).roleCutover, { ...receipt, outcome: 'already-staged' });
    const password = randomBytes(32).toString('base64url');
    const invalidFrame = control('activate-predecessor-runtime-login', {}, Buffer.from('invalid input'));
    assert.equal(invalidFrame.status, 1);
    assert.match(invalidFrame.stderr, /credential frame is invalid/);
    const wrongStage = control('activate-predecessor-runtime-login', {}, Buffer.from('0'.repeat(64) + password));
    assert.equal(wrongStage.status, 1);
    assert.match(wrongStage.stderr, /exact owned staged ACL receipt/);
    assert.ok(!wrongStage.stdout.includes(password) && !wrongStage.stderr.includes(password));
    assert.deepEqual(await verify('grants-staged'), { ...initial, stage: 'grants-staged' });
    const reopen = control('maintenance-off');
    assert.equal(reopen.status, 1, reopen.stderr);
    assert.match(reopen.stderr, /qualified host recovery/);
    const openIntentPath = path.join(root, 'predecessor-role-cutover-open-intent.json');
    await writeFile(openIntentPath, 'uncertain opening');
    const forbiddenTransition = control('transition', { DEPLOYMENT_PHASE: 'ROLLBACK_STARTED' });
    assert.equal(forbiddenTransition.status, 1, forbiddenTransition.stderr);
    assert.match(forbiddenTransition.stderr, /may have received public traffic/);
    await phase('ROLLBACK_STARTED');
    const forbiddenRestore = control('restore-predecessor-role-grants');
    assert.equal(forbiddenRestore.status, 1, forbiddenRestore.stderr);
    assert.match(forbiddenRestore.stderr, /may have received public traffic/);
    await rm(openIntentPath);
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
    assert.deepEqual(JSON.parse(await readFile(holdPath, 'utf8')), hold);
    const repeatedRestore = control('restore-predecessor-role-grants');
    assert.equal(repeatedRestore.status, 0, repeatedRestore.stderr);
    assert.deepEqual(JSON.parse(repeatedRestore.stdout).roleCutover, { ...receipt, outcome: 'already-restored' });
    const backendId = 'e'.repeat(64);
    const [{ address }] = await db.$queryRaw<Array<{ address: string }>>`SELECT host(inet_client_addr()) AS address`;
    await db.$disconnect();
    const missingSession = control('attest-predecessor-backend-runtime', {}, undefined, [address, backendId]);
    assert.equal(missingSession.status, 1, missingSession.stderr);
    assert.match(missingSession.stderr, /live backend session/);
    await db.$connect();
    await db.$queryRaw`SELECT 1`;
    const liveSession = control('attest-predecessor-backend-runtime', {}, undefined, [address, backendId]);
    assert.equal(liveSession.status, 0, liveSession.stderr);
    assert.deepEqual(JSON.parse(liveSession.stdout).runtimeProof, {
      deploymentId: id, checkpointSha256: checkpoint.checksum, backendId, backendAddress: address, role: 'postgres',
    });

    const terminalControl = (command: string, input?: Buffer) => control(command, { DEPLOYMENT_MODE: 'configuration' }, input);
    const unauthorised = terminalControl('open-predecessor-role-terminal');
    assert.equal(unauthorised.status, 1);
    const omitted = new Set(['migration-history', 'shipment-statement-runtime-state', 'contract-financial-evidence']);
    const gates = mandatoryReleaseDeploymentGateNames.filter(name => !omitted.has(name)).map(name => ({
      name, passed: true, durationMs: 1,
      ...(name === 'checkpoint-manifest' ? { details: { checksum: checkpoint.checksum, releaseId: id, remoteReadBack: true } } : {}),
    }));
    const mode = 'PREDECESSOR_ROLE_ROLLBACK';
    const gateReport = id + '.rollback.json';
    const reportRaw = Buffer.from(JSON.stringify({ format: 'sabalan-deployment-report', version: 1,
      mode, deploymentId: id, releaseId: id, targetCommit: commit, gates }));
    const hash = (raw: Buffer) => createHash('sha256').update(raw).digest('hex');
    await writeFile(path.join(root, gateReport), reportRaw, { mode: 0o600 });
    const gateAck = Buffer.from(JSON.stringify({
      format: 'sabalan-predecessor-role-gate-acknowledgement-v1', deploymentId: id, releaseId: id, targetCommit: commit,
      state: 'RESTORED', canOpenTraffic: false, gateMode: mode, gateCount: gates.length,
      checkpointSha256: checkpoint.checksum, checkpointMetadataSha256: receipt.checkpointMetadataSha256,
      scannerBindingSha256: '1'.repeat(64), roleProofSha256: '2'.repeat(64), nginxProofSha256: '3'.repeat(64),
      nativeClosureSha256: '4'.repeat(64), backendId, nginxId: '5'.repeat(64), gateReport,
      gateReportSha256: hash(reportRaw), rollbackReleaseSet: graph,
    }));
    const deadlineFile = path.join(root, 'predecessor-role-' + id + '-rollback-deadline.json');
    const writeDeadline = async (age: bigint) => {
      const start = process.hrtime.bigint() - age;
      await writeFile(deadlineFile, JSON.stringify({
        format: 'sabalan-predecessor-role-deadline-v1', kind: 'rollback', deploymentId: id, releaseId: id,
        targetCommit: commit, leaseTokenSha256: hash(Buffer.from(token)), budgetSeconds: 900,
        clock: await predecessorRoleClockIdentity(), startedNs: start.toString(), deadlineNs: (start + 900_000_000_000n).toString(),
      }), { mode: 0o600 });
    };
    await writeDeadline(901_000_000_000n);
    const expiredAuthority = terminalControl('authorise-predecessor-role-terminal', gateAck);
    assert.equal(expiredAuthority.status, 1);
    assert.match(expiredAuthority.stderr, /PREDECESSOR_ROLE_TERMINAL_UNPROVEN/);
    await writeDeadline(1_000_000_000n);
    const authorise = terminalControl('authorise-predecessor-role-terminal', gateAck);
    assert.equal(authorise.status, 0, authorise.stderr);
    const ready = JSON.parse(authorise.stdout).result;
    assert.equal(ready.gateAcknowledgementSha256, hash(gateAck));
    const originals = ['erp.fixture.test', 'inquiry.fixture.test'];
    const intent = Buffer.from(JSON.stringify({
      format: 'sabalan-predecessor-role-public-intent/v1', deploymentId: id, releaseId: id, targetCommit: commit,
      state: 'RESTORED', phase: 'ROLLBACK_STARTED', trafficMayHaveOpened: true, rollbackReleaseSet: graph,
      checkpointSha256: checkpoint.checksum, checkpointMetadataSha256: receipt.checkpointMetadataSha256,
      scannerBindingSha256: '1'.repeat(64), hostHoldSha256: '6'.repeat(64), reportHoldSha256: hash(await readFile(holdPath)),
      backendId, nginxId: ready.nginxId, gateAcknowledgementSha256: hash(gateAck), origins: originals, expectedTerminal: 'ROLLED_BACK',
    }));
    await writeFile(openIntentPath, intent, { mode: 0o600 });
    await writeDeadline(901_000_000_000n);
    const expiredOpening = terminalControl('open-predecessor-role-terminal');
    assert.equal(expiredOpening.status, 1);
    assert.ok(await stat(path.join(root, 'deployment-maintenance.json')));
    await writeDeadline(1_000_000_000n);
    const opened = terminalControl('open-predecessor-role-terminal');
    assert.equal(opened.status, 0, opened.stderr);
    assert.equal(JSON.parse(opened.stdout).result.intentSha256, hash(intent));
    const duplicateOpening = terminalControl('open-predecessor-role-terminal');
    assert.equal(duplicateOpening.status, 1, duplicateOpening.stderr);
    const observed = terminalControl('observe-predecessor-role-terminal');
    assert.equal(observed.status, 0, observed.stderr);
    const publicProof = {
      format: 'sabalan-predecessor-role-public-readback/v1', deploymentId: id, checkpointSha256: checkpoint.checksum,
      backendId, nginxId: ready.nginxId, gateAcknowledgementSha256: hash(gateAck),
      origins: Object.fromEntries(originals.map(origin => [origin, 200])),
      intentSha256: hash(intent), expectedTerminal: 'ROLLED_BACK',
    };
    const forged = terminalControl('finish-predecessor-role-terminal', Buffer.from(JSON.stringify({ ...publicProof, origins: {} })));
    assert.equal(forged.status, 1, forged.stderr);
    const publicFrame = Buffer.from(JSON.stringify(publicProof));
    assert.equal(await finishPredecessorRoleTerminal({ prisma: db, session: { ...session, phase: 'ROLLBACK_STARTED' },
      token, reportDir: root, coordinationDir: root }, publicFrame), 'ROLLED_BACK');
    const finish = terminalControl('finish-predecessor-role-terminal', publicFrame);
    assert.equal(finish.status, 0, finish.stderr);
    const terminal = terminalControl('read-predecessor-role-terminal');
    assert.equal(terminal.status, 0, terminal.stderr);
    assert.deepEqual(JSON.parse(terminal.stdout).result, {
      deploymentId: id, releaseId: id, targetCommit: commit, checkpointSha256: checkpoint.checksum,
      gateAcknowledgementSha256: hash(gateAck), phase: 'ROLLED_BACK', activeLeases: 0,
    });
  } finally {
    await db.$disconnect();
    try { await fixture.cleanup(); } finally { await rm(root, { recursive: true, force: true }); }
  }
});
