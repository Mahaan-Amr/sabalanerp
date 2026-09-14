import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { canonicalPerformanceHash } from '../personnelPerformancePolicy';
import { performanceVaultKeyFromEnvironment, persistPerformancePayload } from '../personnelPerformancePayloadStore';
import { assessPerformanceEvaluationRetention } from '../personnelPerformanceRetentionStore';
import {
  approvePerformanceErasureImpact,
  executePerformanceErasureOperation,
  preparePerformanceErasureOperations,
  recordPerformanceRecoverableCopy,
  replayPerformanceErasureAfterRestore,
} from '../personnelPerformanceErasureStore';
import { enablePerformanceTestRelease, publishPerformanceTestRetentionPolicy } from './personnelPerformanceTestRelease';
import { decryptRecoveryArchive, encryptRecoveryArchive, sha256File } from '../recoveryCrypto';

const configuredUrl = process.env.DATABASE_URL!;
const databaseUrl = (database: string) => {
  const parsed = new URL(configuredUrl);
  parsed.pathname = `/${database}`;
  return parsed.toString();
};
const containerDatabaseUrl = (database: string) => {
  const parsed = new URL(configuredUrl);
  parsed.hostname = 'postgres';
  parsed.port = '5432';
  parsed.pathname = `/${database}`;
  parsed.search = '';
  return parsed.toString();
};
const composeArgs = ['compose', '-f', path.resolve(process.cwd(), '../docker-compose.local.yml'), '-p', 'sabalanerp-local'];
const runProcess = (command: string, args: string[], input?: Buffer) => new Promise<Buffer>((resolve, reject) => {
  const child = spawn(command, args, { cwd: process.cwd(), env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  child.once('error', reject);
  child.once('close', (code) => {
    if (code !== 0) {
      reject(new Error(`${command} ${args.join(' ')} failed: ${Buffer.concat(stderr).toString('utf8').trim()}`));
      return;
    }
    resolve(Buffer.concat(stdout));
  });
  child.stdin.end(input);
});
const verifyComposeTarget = async () => {
  const output = await runProcess('docker', [...composeArgs, 'ps', '--format', 'json']);
  assert.match(output.toString('utf8'), /sabalanerp-local-backend-1/, 'the recovery rehearsal must target the existing local Compose project');
};
const databaseCheckpoint = async (database: string) => runProcess('docker', [...composeArgs, 'exec', '-T', 'backend',
  'pg_dump', '--format=custom', '--no-owner', '--no-privileges', containerDatabaseUrl(database)]);
const restoreDatabaseCheckpoint = async (database: string, bytes: Buffer) => runProcess('docker', [...composeArgs, 'exec', '-T', 'backend',
  'pg_restore', '--no-owner', '--no-privileges', '--exit-on-error', '--dbname', containerDatabaseUrl(database)], bytes);
const runCrashWorker = (url: string, operationId: string) => new Promise<number | null>((resolve, reject) => {
  const child = spawn(path.join(process.cwd(), 'node_modules', '.bin', 'tsx'), [
    'src/services/__tests__/personnelPerformanceErasureCrashWorker.ts',
  ], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: url, PERFORMANCE_ERASURE_CRASH_OPERATION_ID: operationId }, stdio: 'ignore' });
  child.once('error', reject);
  child.once('exit', resolve);
});

const main = async () => {
const acceptanceEvidence = process.env.PERFORMANCE_ACCEPTANCE_FAILURE_RECOVERY === '1';
const rehearsalMode = acceptanceEvidence ? process.env.PERFORMANCE_ACCEPTANCE_RESTORE_REHEARSAL_MODE : 'correctness';
assert.ok(rehearsalMode === 'correctness' || rehearsalMode === 'timed-dress', 'an explicit recovery rehearsal mode is required');
const operatorId = acceptanceEvidence ? process.env.PERFORMANCE_ACCEPTANCE_OPERATOR_ID?.trim() : 'non-promotion-integration';
assert.ok(operatorId && !/^(fixture|test|local|example|placeholder)$/i.test(operatorId), 'a real operator identity is required');
const suffix = randomUUID().replace(/-/g, '');
const safetyDatabase = `sabalan_erasure_safety_${suffix}`;
const restoredDatabase = `sabalan_erasure_restored_${suffix}`;
const checkpointRoot = await mkdtemp(path.join(os.tmpdir(), 'performance-recovery-checkpoint-'));
const plaintextCheckpoint = path.join(checkpointRoot, 'checkpoint.dump');
const encryptedCheckpoint = path.join(checkpointRoot, 'checkpoint.sabrec');
const decryptedCheckpoint = path.join(checkpointRoot, 'restored.dump');
const checkpointPassphrase = `${randomUUID()}-${randomUUID()}`;
const runbookPath = path.resolve(process.cwd(), '../docs/operations/personnel-performance-operations.md');
const runbookHash = createHash('sha256').update(await readFile(runbookPath)).digest('hex');
const rehearsalStarted = performance.now();
let safety: PrismaClient | undefined;
let restored: PrismaClient | undefined;

try {
  await prisma.$executeRawUnsafe(`CREATE DATABASE "${safetyDatabase}"`);
  const migration = spawn('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl(safetyDatabase) }, stdio: 'ignore',
  });
  assert.equal(await new Promise<number | null>((resolve, reject) => {
    migration.once('error', reject); migration.once('exit', resolve);
  }), 0, 'the isolated safety database migrations must apply');
  safety = new PrismaClient({ datasources: { db: { url: databaseUrl(safetyDatabase) } } });
  await safety.$connect();

  const actorPersonnel = await safety.personnel.create({ data: { firstName: 'بازیابی', lastName: 'حذف' } });
  const actor = await safety.user.create({ data: { email: `${suffix}@example.invalid`, username: suffix, password: 'not-used',
    firstName: 'بازیابی', lastName: 'حذف', personnelId: actorPersonnel.id } });
  await enablePerformanceTestRelease(safety, actor.id);
  await safety.hrFeatureAccessGrant.create({ data: { stableKey: `${suffix}:retention`, userId: actor.id,
    featureCode: 'MANAGE_PERFORMANCE_RETENTION', level: 'ADMIN', effectiveFrom: new Date('2020-01-01Z'),
    grantedByUserId: actor.id, reason: 'Crash and recovery acceptance' } });
  const personnel = await safety.personnel.create({ data: { firstName: 'موضوع', lastName: 'بازیابی' } });
  const relationship = await safety.hrEmploymentRelationship.create({ data: { personnelId: personnel.id, status: 'ENDED',
    effectiveFrom: new Date('2010-01-01Z'), effectiveTo: new Date('2011-01-01Z'), createdBy: actor.id } });
  const assignment = await safety.hrEmploymentAssignment.create({ data: { employmentRelationshipId: relationship.id, type: 'PRIMARY',
    effectiveFrom: new Date('2010-01-01Z'), effectiveTo: new Date('2011-01-01Z'), performanceAllocationPercent: 100, createdBy: actor.id } });
  const subject = await safety.performanceSubject.create({ data: { stableKey: `${suffix}:subject`, nonDisplayKey: `${suffix}:hidden`,
    personnelId: personnel.id, employmentRelationshipId: relationship.id, createdByUserId: actor.id } });
  const evaluation = await safety.performanceEvaluation.create({ data: { stableKey: `${suffix}:evaluation`, subjectId: subject.id,
    measurementFrom: new Date('2010-01-01Z'), measurementTo: new Date('2010-12-31Z'), createdByUserId: actor.id } });
  const section = await safety.performanceEvaluationSection.create({ data: { evaluationId: evaluation.id,
    employmentAssignmentId: assignment.id, responsibleSupervisorPersonnelId: actorPersonnel.id,
    effectiveFrom: new Date('2010-01-01Z'), effectiveTo: new Date('2010-12-31Z'), allocationPercent: 100 } });
  const draftId = randomUUID();
  const payload = await persistPerformancePayload(safety, { aggregateType: 'PERFORMANCE_DRAFT', aggregateId: draftId,
    payloadKind: 'DRAFT_CONTENT', schemaVersion: 1, payload: { narrative: 'restored checkpoint content' }, keyring: performanceVaultKeyFromEnvironment() });
  await safety.performanceDraft.create({ data: { id: draftId, sectionId: section.id, supervisorUserId: actor.id,
    supervisorPersonnelId: actorPersonnel.id, revision: 1, encryptedPayloadId: payload.id,
    contentHash: canonicalPerformanceHash({ narrative: 'restored checkpoint content' }), createdAt: new Date('2010-01-01Z') } });
  await safety.performanceEvaluationSection.update({ where: { id: section.id }, data: { status: 'CANCELLED' } });
  await safety.performanceEvaluation.update({ where: { id: evaluation.id }, data: { status: 'CANCELLED', writerVersion: { increment: 1 } } });
  await safety.performanceAuditEvent.create({ data: { id: randomUUID(), aggregateType: 'EVALUATION', aggregateId: evaluation.id,
    eventType: 'EVALUATION_CANCELLED', actorUserId: actor.id, eventHash: canonicalPerformanceHash({ suffix, event: 'cancelled' }),
    occurredAt: new Date('2011-01-01Z') } });
  const firstPolicy = await publishPerformanceTestRetentionPolicy(safety, actor.id);

  await safety.$disconnect();
  safety = undefined;
  await verifyComposeTarget();
  const dump = await databaseCheckpoint(safetyDatabase);
  assert.ok(dump.length > 0, 'the PostgreSQL checkpoint must contain the source database');
  await writeFile(plaintextCheckpoint, dump, { mode: 0o600, flag: 'wx' });
  await encryptRecoveryArchive(plaintextCheckpoint, encryptedCheckpoint, checkpointPassphrase);
  const encryptedChecksum = await sha256File(encryptedCheckpoint);
  assert.notEqual(encryptedChecksum, createHash('sha256').update(dump).digest('hex'), 'the encrypted checkpoint must differ from plaintext');
  await decryptRecoveryArchive(encryptedCheckpoint, decryptedCheckpoint, checkpointPassphrase);
  assert.deepEqual(await readFile(decryptedCheckpoint), dump, 'authenticated checkpoint decryption must reproduce the exact dump');
  await prisma.$executeRawUnsafe(`CREATE DATABASE "${restoredDatabase}"`);
  await restoreDatabaseCheckpoint(restoredDatabase, await readFile(decryptedCheckpoint));
  safety = new PrismaClient({ datasources: { db: { url: databaseUrl(safetyDatabase) } } });
  await safety.$connect();
  await safety.performancePolicyVersion.update({ where: { id: firstPolicy.id }, data: { lifecycle: 'RETIRED', retiredAt: new Date() } });
  const secondPolicy = await publishPerformanceTestRetentionPolicy(safety, actor.id);
  assert.equal(secondPolicy.version, 2);
  const assessment = await assessPerformanceEvaluationRetention(safety, { actorUserId: actor.id, evaluationId: evaluation.id });
  const operation = (await preparePerformanceErasureOperations(safety, new Date('2026-09-09Z'), 1_000))
    .find(({ retentionStateId }) => retentionStateId === assessment.id)!;
  await approvePerformanceErasureImpact(safety, { actorUserId: actor.id, policyVersionId: secondPolicy.id });
  for (const location of ['TEMPORARY_STORAGE', 'DATABASE_REPLICA', 'ARTIFACT_STORAGE', 'INDEPENDENT_BACKUP'] as const) {
    await recordPerformanceRecoverableCopy(safety, { actorUserId: actor.id, operationId: operation.id, location,
      copyKey: `${suffix}:${location}`, status: 'VERIFIED_ABSENT', evidenceHash: canonicalPerformanceHash({ suffix, location }) });
  }
  assert.equal((await safety.performanceErasureOperation.findUniqueOrThrow({ where: { id: operation.id } })).status, 'READY');

  assert.equal(await runCrashWorker(databaseUrl(safetyDatabase), operation.id), 91, 'the worker must terminate at the crash barrier');
  assert.equal((await safety.performanceErasureOperation.findUniqueOrThrow({ where: { id: operation.id } })).status, 'RUNNING');
  assert.equal(await safety.performanceDraft.count({ where: { id: draftId } }), 1);
  assert.equal(await safety.performanceDeletionReceipt.count({ where: { deletedRecordId: draftId } }), 0);
  const retried = await executePerformanceErasureOperation(safety, operation.id, new Date('2026-09-09T00:16:00Z'));
  assert.equal(retried.id, operation.id);
  assert.equal(retried.status, 'COMPLETED');

  restored = new PrismaClient({ datasources: { db: { url: databaseUrl(restoredDatabase) } } });
  await restored.$connect();
  const replay = await replayPerformanceErasureAfterRestore(restored, safety, new Date('2026-09-10Z'));
  assert.equal(replay.replayed, 1);
  assert.equal(await restored.performanceDraft.count({ where: { id: draftId } }), 0);
  const restoredPolicy = await restored.performancePolicyVersion.findUniqueOrThrow({ where: { id: secondPolicy.id } });
  assert.equal(restoredPolicy.version, 2);
  assert.equal(restoredPolicy.predecessorId, firstPolicy.id, 'replay restores the exact immutable retention-policy lineage');
  assert.equal(await restored.performanceDeletionReceipt.count({ where: { deletedRecordId: draftId } }), 1);
  const rehearsalDurationMs = performance.now() - rehearsalStarted;
  const timedDressRehearsalPassed = rehearsalMode === 'timed-dress' && rehearsalDurationMs > 0 && rehearsalDurationMs <= 30 * 60_000;
  const correctnessRehearsalPassed = rehearsalMode === 'correctness';
  if (acceptanceEvidence) {
    console.log(`PERFORMANCE_FAILURE_RECOVERY:${JSON.stringify({ contract: 'PERSONNEL_PERFORMANCE_FAILURE_RECOVERY_V1', scenarios: [
      { name: 'restore', injected: true, failClosed: true, lostAcknowledgedWrites: 0 },
    ], rehearsal: { rehearsalMode, operatorId, runbookHash, durationMs: rehearsalDurationMs,
      checkpointChecksum: encryptedChecksum, sourceDatabase: safetyDatabase, restoredDatabase,
      encryptedCheckpointVerified: true, independentCopy: safetyDatabase !== restoredDatabase,
      fullEncryptedCheckpointRestored: true, rpoAcknowledgedWritesLost: 0,
      correctnessRehearsalPassed, timedDressRehearsalPassed } })}`);
  }
} finally {
  await restored?.$disconnect().catch(() => undefined);
  await safety?.$disconnect().catch(() => undefined);
  await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${restoredDatabase}" WITH (FORCE)`).catch(() => undefined);
  await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${safetyDatabase}" WITH (FORCE)`).catch(() => undefined);
  await rm(checkpointRoot, { recursive: true, force: true });
  await prisma.$disconnect();
}
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
