import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  reconcileDispatchDocumentArtifacts,
  replayDispatchDocumentEvidence,
  restoreDispatchDocumentArtifact,
  quarantineDispatchDocumentOrphan,
  cleanupQuarantinedDispatchDocumentOrphan,
  listDispatchDocumentRecoveryAudit,
  type DispatchArtifactAuditEvent,
  type DispatchArtifactMetadata,
  type DispatchEvidenceNode,
  type DispatchEvidenceAudit,
} from '../dispatchDocumentAuditRecovery';
import { recoveryEngineInternals } from '../systemRecoveryEngine';

const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)])) : value;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

const node = (kind: DispatchEvidenceNode['kind'], id: string, parents: string[] = []): DispatchEvidenceNode => {
  const evidence = { kind, id, parents };
  return {
    kind, id, parents, evidence, integrityHash: digest(evidence), actorId: 'actor-1',
    serverTime: '2026-08-09T08:00:00.000Z', effectiveTime: null, reason: null,
    correlationId: 'correlation-1', idempotencyKey: `command:${id}`,
    quantities: kind === 'PRICED_ALLOCATION_EVENT' ? [{ rowId: 'row-1', unit: 'squareMeter', value: '2.000' }] : [],
    amounts: kind === 'PRICED_ALLOCATION_EVENT' ? [{ currency: 'تومان', value: '90.000000000000' }] : [],
  };
};

const completeChain = () => {
  const nodes = [
    node('APPROVED_PRICING_VERSION', 'pricing-1'),
    node('FINALIZED_ALLOCATION_REVISION', 'allocation-1', ['pricing-1']),
    node('PRICED_ALLOCATION_EVENT', 'priced-event-1', ['allocation-1', 'pricing-1']),
    node('ACCOUNTING_CANDIDATE_DECISION', 'candidate-1', ['allocation-1', 'priced-event-1']),
    node('WAYBILL_ARTIFACT', 'waybill-artifact-1', ['candidate-1']),
    node('STATEMENT_ARTIFACT', 'statement-artifact-1', ['candidate-1']),
    node('PRINT_HANDOFF', 'handoff-1', ['waybill-artifact-1', 'statement-artifact-1']),
    node('GUARD_EXIT', 'exit-1', ['candidate-1']),
    node('STATEMENT_ADJUSTMENT', 'adjustment-1', ['exit-1', 'statement-artifact-1']),
  ];
  const audits: DispatchEvidenceAudit[] = nodes.map((item, index) => {
    const body = {
      aggregateId: item.id, eventType: `${item.kind}_RECORDED`, actorId: item.actorId,
      recordedAt: item.serverTime, reason: item.reason, correlationId: item.correlationId,
      idempotencyKey: item.idempotencyKey, sourceHash: item.integrityHash,
      previousHash: index ? undefined : null,
    };
    const previousHash = index ? '' : null;
    return { ...body, previousHash, eventHash: '' };
  });
  for (const audit of audits) {
    audit.previousHash = null;
    audit.eventHash = digest({ ...audit, eventHash: undefined });
  }
  return { nodes, audits };
};

test('replay verifies the complete pricing-to-adjustment evidence and audit chain', () => {
  const report = replayDispatchDocumentEvidence(completeChain());
  assert.equal(report.status, 'VERIFIED');
  assert.deepEqual(report.issues, []);
  assert.equal(report.quantityTotals[0].value, '2.000');
  assert.equal(report.amountTotals[0].value, '90.000000000000');
});

test('replay fails closed for a missing link, changed hash, or broken audit predecessor', () => {
  const source = completeChain();
  source.nodes = source.nodes.filter(item => item.kind !== 'STATEMENT_ARTIFACT');
  source.nodes[2] = { ...source.nodes[2], integrityHash: '0'.repeat(64) };
  source.audits[4] = { ...source.audits[4], previousHash: 'f'.repeat(64) };
  source.audits = source.audits.filter(item => item.aggregateId !== 'priced-event-1');
  const report = replayDispatchDocumentEvidence(source);
  assert.equal(report.status, 'UNRESOLVED_INCIDENT');
  assert.ok(report.issues.some(item => item.code === 'MISSING_EVIDENCE'));
  assert.ok(report.issues.some(item => item.code === 'INTEGRITY_HASH_MISMATCH'));
  assert.ok(report.issues.some(item => item.code === 'AUDIT_CHAIN_BROKEN'));
  assert.ok(report.issues.some(item => item.code === 'MISSING_EVIDENCE' && item.subjectId === 'priced-event-1'));
});

const artifact = (id: string, storageKey: string, bytes: Buffer): DispatchArtifactMetadata => ({
  id, waybillId: 'waybill-1', storageKey, byteLength: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'), sourceIntegrityHash: 'a'.repeat(64),
});

test('reconciliation distinguishes healthy, missing, corrupt, and unreferenced staged files', async () => {
  const healthy = Buffer.from('healthy-original');
  const missing = Buffer.from('missing-original');
  const corrupt = Buffer.from('corrupt-original');
  const metadata = [artifact('a-healthy', 'issued/healthy.pdf', healthy), artifact('a-missing', 'issued/missing.pdf', missing), artifact('a-corrupt', 'issued/corrupt.pdf', corrupt)];
  const audits: DispatchArtifactAuditEvent[] = [];
  const report = await reconcileDispatchDocumentArtifacts({
    actorId: 'support-1', correlationId: 'reconcile-1', idempotencyKey: 'reconcile-command-1', metadata,
    storage: {
      listKeys: async () => ['issued/healthy.pdf', 'issued/corrupt.pdf', 'staging/unreferenced.pdf'],
      read: async key => key === 'issued/healthy.pdf' ? healthy : key === 'issued/corrupt.pdf' ? Buffer.from('changed') : null,
    },
    audit: { append: async event => { audits.push(event); } },
  });
  assert.deepEqual(report.artifacts.map(item => [item.artifactId, item.status]), [
    ['a-corrupt', 'CORRUPT'], ['a-healthy', 'HEALTHY'], ['a-missing', 'MISSING'],
  ]);
  assert.deepEqual(report.orphans, [{ storageKey: 'staging/unreferenced.pdf', status: 'ORPHAN_CANDIDATE' }]);
  assert.equal(report.status, 'UNRESOLVED_INCIDENT');
  assert.deepEqual(audits.map(item => item.action), ['RECONCILIATION_COMPLETED', 'INCIDENT_RECORDED', 'INCIDENT_RECORDED', 'INCIDENT_RECORDED']);
});

test('restore accepts only original verified bytes and records failures without changing metadata', async () => {
  const original = Buffer.from('original-pdf-bytes');
  const metadata = artifact('artifact-1', 'issued/original.pdf', original);
  const writes: Buffer[] = [];
  const audits: DispatchArtifactAuditEvent[] = [];
  const restored = await restoreDispatchDocumentArtifact({
    actorId: 'support-1', reason: 'restore drill', correlationId: 'restore-1', idempotencyKey: 'restore-command-1', metadata,
    encryptedBackup: { readOriginal: async () => ({ bytes: original, recoveryPackageId: 'backup-1', encrypted: true }) },
    storage: { writeOriginal: async (_key, bytes) => { writes.push(bytes); }, read: async () => original },
    audit: { append: async event => { audits.push(event); } },
  });
  assert.equal(restored.status, 'RESTORED');
  assert.deepEqual(writes, [original]);
  assert.equal(audits.at(-1)?.action, 'RESTORATION_COMPLETED');

  const rejectedWrites: Buffer[] = [];
  const rejected = await restoreDispatchDocumentArtifact({
    actorId: 'support-1', reason: 'restore drill', correlationId: 'restore-2', idempotencyKey: 'restore-command-2', metadata,
    encryptedBackup: { readOriginal: async () => ({ bytes: Buffer.from('regenerated-or-corrupt'), recoveryPackageId: 'backup-2', encrypted: true }) },
    storage: { writeOriginal: async (_key, bytes) => { rejectedWrites.push(bytes); }, read: async () => null },
    audit: { append: async event => { audits.push(event); } },
  });
  assert.equal(rejected.status, 'UNRESOLVED_INCIDENT');
  assert.deepEqual(rejectedWrites, []);
  assert.equal(audits.at(-1)?.action, 'RESTORATION_FAILED');
});

test('orphan quarantine rechecks references and cleanup waits for the safety window', async () => {
  const actions: string[] = [];
  const audit: DispatchArtifactAuditEvent[] = [];
  await assert.rejects(quarantineDispatchDocumentOrphan({
    storageKey: 'staging/file.pdf', actorId: 'support-1', reason: 'candidate', correlationId: 'q-1', idempotencyKey: 'q-command-1',
    repository: { isReferenced: async () => true }, storage: { quarantine: async () => { actions.push('quarantine'); } },
    audit: { append: async event => { audit.push(event); } },
  }), /referenced/);
  assert.equal(actions.length, 0);

  const quarantined = await quarantineDispatchDocumentOrphan({
    storageKey: 'staging/file.pdf', actorId: 'support-1', reason: 'confirmed orphan', correlationId: 'q-2', idempotencyKey: 'q-command-2',
    repository: { isReferenced: async () => false }, storage: { quarantine: async () => { actions.push('quarantine'); } },
    audit: { append: async event => { audit.push(event); } },
  });
  assert.equal(quarantined.status, 'QUARANTINED');
  const cleanup = await cleanupQuarantinedDispatchDocumentOrphan({
    ...quarantined, actorId: 'support-2', reason: 'safety window elapsed', correlationId: 'cleanup-1', idempotencyKey: 'cleanup-command-1',
    now: new Date('2026-08-20T00:00:00.000Z'), safetyWindowMs: 7 * 24 * 60 * 60 * 1000,
    repository: { isReferenced: async () => false }, storage: { removeQuarantined: async () => { actions.push('cleanup'); } },
    audit: { append: async event => { audit.push(event); } },
  });
  assert.equal(cleanup.status, 'REMOVED');
  assert.deepEqual(actions, ['quarantine', 'cleanup']);
  assert.ok(audit.some(item => item.action === 'QUARANTINE_COMPLETED'));
  assert.ok(audit.some(item => item.action === 'CLEANUP_COMPLETED'));
});

test('Accounting recovery audit query is scoped, filtered, and paginated', async () => {
  const calls: unknown[] = [];
  const database = { dispatchLifecycleAudit: {
    findMany: async (args: unknown) => { calls.push(args); return [{ id: 'audit-1' }]; },
    count: async (args: unknown) => { calls.push(args); return 1; },
  } };
  const result = await listDispatchDocumentRecoveryAudit(database, {
    page: 2, pageSize: 10, actorId: 'support-1', eventType: 'RESTORATION_COMPLETED',
    dateFrom: '2026-08-01T00:00:00.000Z', dateTo: '2026-08-31T23:59:59.999Z',
  });
  assert.deepEqual(result, { items: [{ id: 'audit-1' }], total: 1, page: 2, pageSize: 10 });
  assert.deepEqual((calls[0] as any).where, {
    aggregateType: 'DISPATCH_DOCUMENT_RECOVERY', actorId: 'support-1', eventType: 'RESTORATION_COMPLETED',
    recordedAt: { gte: new Date('2026-08-01T00:00:00.000Z'), lte: new Date('2026-08-31T23:59:59.999Z') },
  });
  assert.equal((calls[0] as any).skip, 10);
});

test('system recovery maps dispatch artifacts into encrypted package paths and rejects traversal', () => {
  const resolved = recoveryEngineInternals.dispatchArtifactBackupPath('C:\\recovery-payload', 'issued/waybill-1.pdf');
  assert.ok(resolved.replace(/\\/g, '/').endsWith('/files/dispatch-documents/issued/waybill-1.pdf'));
  assert.throws(() => recoveryEngineInternals.dispatchArtifactBackupPath('C:\\recovery-payload', '../outside.pdf'), /unsafe/);
  assert.ok(recoveryEngineInternals.dispatchDocumentStorageDirectory.replace(/\\/g, '/').endsWith('/storage/dispatch-documents'));
});

test('system recovery rejects an incomplete backup until every referenced original artifact is included', async () => {
  const payloadRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dispatch-recovery-coverage-'));
  const database = {
    $queryRawUnsafe: async () => [],
    dispatchDocumentArtifact: { findMany: async () => [{ id: 'artifact-1', storageKey: 'issued/original.pdf' }] },
  };
  try {
    await assert.rejects(
      recoveryEngineInternals.validateStoredFileReferences(database as never, payloadRoot),
      (error: any) => error?.code === 'RECOVERY_DISPATCH_ARTIFACT_MISSING',
    );
    const originalPath = recoveryEngineInternals.dispatchArtifactBackupPath(payloadRoot, 'issued/original.pdf');
    await fs.promises.mkdir(path.dirname(originalPath), { recursive: true });
    await fs.promises.writeFile(originalPath, Buffer.from('original-pdf'));
    await recoveryEngineInternals.validateStoredFileReferences(database as never, payloadRoot);
  } finally {
    await fs.promises.rm(payloadRoot, { recursive: true, force: true });
  }
});
