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
  type DispatchRecoveryAuthority,
  createDispatchDocumentFilesystem,
  validateDispatchLifecycleConservation,
  parsePersistedOrphanEvidence,
  verifyProductionDispatchAuditChains,
  createPrismaDispatchReplayTruthVerifier,
  validatePersistedDocumentTransition,
} from '../dispatchDocumentAuditRecovery';
import { recoveryEngineInternals, sanitizedDispatchArtifactMetadata } from '../systemRecoveryEngine';
import { dispatchCorrectionIntegrityHash, dispatchLifecycleAuditEventHash } from '../dispatchCorrectionOutage';
import { guardPhysicalExitAuditIntegrityHash, guardPhysicalExitIntegrityHash } from '../physicalGateExit';
import { approvedPricingRowIntegrityHash, approvedPricingVersionIntegrityHash } from '../approvedPricing/domain';
import { pricedAllocationIntegrityHash } from '../pricedAllocationLedger';
import { dispatchDocumentLifecycleAuditEventHash } from '../dispatchDocuments/prismaRepository';
import { dispatchDocumentSourceIntegrityHash } from '../dispatchDocuments/prismaSourceReader';

const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)])) : value;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const authority: DispatchRecoveryAuthority = {
  effectiveAuthority: 'SYSTEM_RECOVERY_ADMIN', workspace: 'SYSTEM_RECOVERY', feature: 'accounting_audit_view', permission: 'ADMIN',
  subjectType: 'DISPATCH_DOCUMENT', subjectId: 'waybill-1', sessionId: 'session-1', deviceId: 'device-1',
  beforeHash: 'a'.repeat(64), afterHash: 'b'.repeat(64),
};
const orphanBytes = Buffer.from('orphan');
const orphanEvidence = { reportHash: 'c'.repeat(64), observedAt: '2026-08-09T00:00:00.000Z', observedByteLength: orphanBytes.length, observedSha256: createHash('sha256').update(orphanBytes).digest('hex') };

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
      previousHash: index ? undefined : null, authority,
    };
    const previousHash = index ? '' : null;
    return { ...body, previousHash, eventHash: '' };
  });
  for (const audit of audits) {
    audit.previousHash = null;
    audit.eventHash = digest({ ...audit, eventHash: undefined });
  }
  return { nodes, audits, lifecycle: { requiresPrintHandoff: true, requiresGuardExit: true, requiredAdjustmentIds: ['adjustment-1'] }, conservation: {
    quantityWitnesses: ['ALLOCATION', 'PRICED', 'DOCUMENTED', 'EXIT'].map(stage => ({ stage: stage as 'ALLOCATION' | 'PRICED' | 'DOCUMENTED' | 'EXIT', rowId: 'row-1', unit: 'squareMeter', value: '2.000' })),
    moneyWitnesses: ['PRICED', 'DOCUMENTED'].map(stage => ({ stage: stage as 'PRICED' | 'DOCUMENTED', currency: 'TOMAN', gross: '100.000000000000', discount: '10.000000000000', net: '90.000000000000' })),
    adjustmentWitnesses: [{ id: 'adjustment-1', currency: 'TOMAN', before: '90.000000000000', delta: '5.000000000000', after: '95.000000000000' }],
  } };
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

test('replay distinguishes lifecycle-optional evidence and fails closed on quantity or money conservation', () => {
  const optional = completeChain();
  optional.nodes = optional.nodes.filter(item => !['PRINT_HANDOFF', 'GUARD_EXIT', 'STATEMENT_ADJUSTMENT'].includes(item.kind));
  optional.audits = optional.audits.filter(item => optional.nodes.some(node => node.id === item.aggregateId));
  optional.lifecycle = { requiresPrintHandoff: false, requiresGuardExit: false, requiredAdjustmentIds: [] };
  optional.conservation.quantityWitnesses = optional.conservation.quantityWitnesses.filter(item => item.stage !== 'EXIT');
  optional.conservation.adjustmentWitnesses = [];
  assert.equal(replayDispatchDocumentEvidence(optional).status, 'VERIFIED');
  optional.conservation.quantityWitnesses[1] = { ...optional.conservation.quantityWitnesses[1], value: '1.000' };
  optional.conservation.moneyWitnesses[1] = { ...optional.conservation.moneyWitnesses[1], net: '89.000000000000' };
  const failed = replayDispatchDocumentEvidence(optional);
  assert.ok(failed.issues.some(item => item.code === 'QUANTITY_CONSERVATION_MISMATCH'));
  assert.ok(failed.issues.some(item => item.code === 'MONEY_CONSERVATION_MISMATCH'));
});

test('state-aware production validator covers disposition, required lifecycle, document, and before-delta-after witnesses', () => {
  const issues = validateDispatchLifecycleConservation({
    candidate: { status: 'PENDING', dispositionAt: null, dispositionBy: null },
    lifecycle: { requiresPrintHandoff: true, hasPrintHandoff: false, requiresGuardExit: true, hasGuardExit: false, requiredAdjustmentIds: ['adjustment-1'], actualAdjustmentIds: [] },
    quantityWitnesses: [{ stage: 'ALLOCATION', rowId: 'row-1', unit: 'squareMeter', value: '2.000' }, { stage: 'PRICED', rowId: 'row-1', unit: 'squareMeter', value: '2.000' }],
    moneyWitnesses: [{ stage: 'PRICED', currency: 'TOMAN', gross: '100.000000000000', discount: '10.000000000000', net: '90.000000000000' }],
    adjustmentWitnesses: [{ id: 'adjustment-1', currency: 'TOMAN', before: '90.000000000000', delta: '5.000000000000', after: '94.000000000000' }],
  });
  assert.ok(issues.some(item => item.subjectId === 'CANDIDATE_DISPOSITION'));
  assert.ok(issues.some(item => item.subjectId === 'PRINT_HANDOFF'));
  assert.ok(issues.some(item => item.subjectId === 'GUARD_EXIT'));
  assert.ok(issues.some(item => item.code === 'QUANTITY_CONSERVATION_MISMATCH'));
  assert.ok(issues.some(item => item.code === 'MONEY_CONSERVATION_MISMATCH'));
});

test('production replay uses writer-owned Guard and correction hash formats', () => {
  const correction = { correctionId: 'correction-1', waybillId: 'waybill-1', reason: 'verified return', effectiveAt: new Date('2026-08-09T08:00:00.000Z'), lines: [{ id: 'line-1', quantity: { toFixed: () => '1.000' } }], postedAt: new Date('2026-08-09T09:00:00.000Z') };
  assert.match(dispatchCorrectionIntegrityHash(correction), /^[a-f0-9]{64}$/);
  const correctionPayload = { workspace: 'accounting', effectiveAuthority: { actorRole: 'ADMIN' }, waybillId: 'waybill-1', reason: 'verified return', integrityHash: dispatchCorrectionIntegrityHash(correction) };
  const correctionAudit = dispatchLifecycleAuditEventHash({ aggregateType: 'DISPATCH_CORRECTION', aggregateId: 'correction-1', eventType: 'CORRECTION_POSTED', payload: correctionPayload, actorId: 'actor-1', authority: correctionPayload.effectiveAuthority as never, at: new Date('2026-08-09T09:00:00.000Z'), previousHash: null });
  assert.notEqual(correctionAudit, dispatchLifecycleAuditEventHash({ aggregateType: 'DISPATCH_CORRECTION', aggregateId: 'correction-1', eventType: 'CORRECTION_POSTED', payload: { ...correctionPayload, reason: 'tampered' }, actorId: 'actor-1', authority: correctionPayload.effectiveAuthority as never, at: new Date('2026-08-09T09:00:00.000Z'), previousHash: null }));
  const exitSnapshot = { waybillId: 'waybill-1', allocationRevisionId: 'revision-1', occurredAt: new Date('2026-08-09T10:00:00.000Z') };
  assert.match(guardPhysicalExitIntegrityHash(exitSnapshot), /^[a-f0-9]{64}$/);
  const exitAudit = guardPhysicalExitAuditIntegrityHash({ aggregateType: 'GUARD_PHYSICAL_EXIT', aggregateId: 'exit-1', eventType: 'PHYSICAL_EXIT_RECORDED', payload: { ...exitSnapshot, integrityHash: guardPhysicalExitIntegrityHash(exitSnapshot) }, actorId: 'guard-1', at: '2026-08-09T10:00:00.000Z', previousHash: null });
  assert.match(exitAudit, /^[a-f0-9]{64}$/);
  const issuance = { aggregateType: 'ACCOUNTING_DISPATCH_WAYBILL', aggregateId: 'waybill-1', eventType: 'PRIMARY_BUNDLE_ISSUED',
    payload: { candidateId: 'candidate-1', allocationRevisionId: 'revision-1', artifactIds: ['waybill-pdf', 'statement-pdf'], sourceIntegrityHash: 'f'.repeat(64), idempotencyKey: 'issue-1', correlationId: 'correlation-1' },
    actorId: 'accounting-1', at: new Date('2026-08-09T08:00:00.000Z'), previousHash: null };
  const issuanceHash = dispatchDocumentLifecycleAuditEventHash(issuance);
  assert.deepEqual(verifyProductionDispatchAuditChains([
    { ...issuance, recordedAt: issuance.at, eventHash: issuanceHash },
    { aggregateType: 'DISPATCH_CORRECTION', aggregateId: 'correction-1', eventType: 'CORRECTION_POSTED', payload: correctionPayload, actorId: 'actor-1', recordedAt: new Date('2026-08-09T09:00:00.000Z'), previousHash: null, eventHash: correctionAudit },
    { aggregateType: 'GUARD_PHYSICAL_EXIT', aggregateId: 'exit-1', eventType: 'PHYSICAL_EXIT_RECORDED', payload: { ...exitSnapshot, integrityHash: guardPhysicalExitIntegrityHash(exitSnapshot) }, actorId: 'guard-1', recordedAt: new Date('2026-08-09T10:00:00.000Z'), previousHash: null, eventHash: exitAudit },
  ]), []);
});

test('replacement replay follows the predecessor audit and does not require successor primary issuance', () => {
  const at = new Date('2026-08-09T11:00:00.000Z');
  const command = { id: 'replace-command', scope: 'WAYBILL', scopeId: 'waybill-old', command: 'REPLACE', status: 'SUCCEEDED',
    waybillId: 'waybill-new', actorId: 'accounting-1', correlationId: 'replace-correlation', idempotencyKey: 'replace-1', completedAt: at };
  const audit = { eventType: 'DOCUMENT_BUNDLE_REPLACED', actorId: 'accounting-1', recordedAt: at,
    payload: { replacementWaybillId: 'waybill-new', reason: 'Damaged print', authority: { workspace: 'accounting' },
      correlationId: 'replace-correlation', idempotencyKey: 'replace-1' } };
  assert.equal(validatePersistedDocumentTransition({ waybill: { id: 'waybill-new', candidateId: 'candidate-1', replacesWaybillId: 'waybill-old',
    issuedAt: at, issuedBy: 'accounting-1' }, primarySourceHash: 'a'.repeat(64), primaryArtifactIds: ['new-waybill', 'new-statement'], command, audit }), null);
  assert.equal(validatePersistedDocumentTransition({ waybill: { id: 'waybill-new', candidateId: 'candidate-1', replacesWaybillId: 'waybill-old',
    issuedAt: at, issuedBy: 'accounting-1' }, primarySourceHash: 'a'.repeat(64), primaryArtifactIds: [], command: undefined, audit }), 'LEGACY_UNRECONCILED');
});

test('mandatory Prisma truth verifier accepts only immutable writer-owned pricing/event/provenance sources', async () => {
  const decimal = (value: string) => ({ toFixed: () => value });
  const versionBase = { id: 'pricing-1', contractId: 'contract-1', versionNumber: 1, sourceFinancialRecordId: 'financial-1',
    approvedAt: new Date('2026-08-09T07:00:00.000Z'), approvedBy: 'finance-1', schemaVersion: 1, currency: 'TOMAN',
    grossAmount: '100.000000000000', discountAmount: '10.000000000000', netAmount: '90.000000000000', sourceEvidence: { source: 'approved' } };
  const rowBase = { versionId: versionBase.id, contractId: versionBase.contractId, sourceFinancialRecordId: versionBase.sourceFinancialRecordId,
    versionNumber: 1, contractItemId: 'item-1', productRowId: 'product-row-1', ordinal: 1, contractedQuantity: '2.000', unit: 'M3',
    canonicalAllInTotal: '100.000000000000', discountEligible: true, componentEvidence: { material: '100.000000000000' } };
  const row = { id: 'pricing-row-1', pricingVersionId: versionBase.id, ...rowBase,
    contractedQuantity: decimal(rowBase.contractedQuantity), canonicalAllInTotal: decimal(rowBase.canonicalAllInTotal), integrityHash: approvedPricingRowIntegrityHash(rowBase) };
  const versionHashInput = { ...versionBase, rowHashes: [row.integrityHash] };
  const version = { ...versionBase, grossAmount: { toFixed: () => versionBase.grossAmount }, discountAmount: { toFixed: () => versionBase.discountAmount }, netAmount: { toFixed: () => versionBase.netAmount },
    rows: [row], integrityHash: approvedPricingVersionIntegrityHash(versionHashInput) };
  const eventPayload = { allocationRevisionId: 'revision-1', allocationRevisionLineId: 'line-1', pricingVersionId: version.id, pricingRowId: 'pricing-row-1',
    quantity: '2.000', grossAmount: '100.000000000000', discountAmount: '10.000000000000', netAmount: '90.000000000000', consumesFinalRemainder: true,
    evidence: { ledgerSequence: 1 }, recordedBy: 'logistics-1' };
  const revisionLine = { id: 'line-1', sourceContractId: 'contract-1', sourceContractItemId: 'item-1', productRowId: 'product-row-1', unit: 'M3', quantity: decimal('2.000') };
  const event = { ...eventPayload, quantity: decimal(eventPayload.quantity), grossAmount: decimal(eventPayload.grossAmount), discountAmount: decimal(eventPayload.discountAmount), netAmount: decimal(eventPayload.netAmount), integrityHash: pricedAllocationIntegrityHash(eventPayload),
    allocationRevisionLine: revisionLine, pricingRow: row };
  const pricedAllocation = { currency: 'TOMAN', pricingVersions: [{ contractId: 'contract-1', pricingVersionId: version.id, integrityHash: version.integrityHash, readinessEvidenceHash: 'd'.repeat(64) }],
    lines: [{ allocationRevisionLineId: 'line-1', contractId: 'contract-1', contractItemId: 'item-1', productRowId: 'product-row-1', unit: 'M3', quantity: '2.000', grossAmount: '100.000000000000', discountAmount: '10.000000000000', netAmount: '90.000000000000', ledgerSequence: 1 }],
    totals: { grossAmount: '100.000000000000', discountAmount: '10.000000000000', netAmount: '90.000000000000' } };
  const sourceHash = dispatchDocumentSourceIntegrityHash({ allocationRevisionId: 'revision-1', allocationIntegrityHash: 'c'.repeat(64), pricedAllocation });
  const revision = { id: 'revision-1', integrityHash: 'c'.repeat(64), pricingReferences: [{ pricingVersionId: version.id, expectedPricingHash: version.integrityHash, pricingVersion: version }],
    pricedAllocationEvents: [event], candidate: { waybills: [{ snapshot: { documentProvenance: { sourceIntegrityHash: sourceHash, allocationRevisionId: 'revision-1', allocationIntegrityHash: 'c'.repeat(64) } },
      documentArtifacts: [{ kind: 'WAYBILL', statementAdjustmentId: null, sourceIntegrityHash: sourceHash }, { kind: 'STATEMENT', statementAdjustmentId: null, sourceIntegrityHash: sourceHash }] }] } };
  const tx = { logisticsAllocationRevision: { findUnique: async () => revision },
    logisticsAllocationRevisionPricing: { findMany: async () => [{ contractId: 'contract-1', pricingVersionId: version.id, expectedPricingHash: version.integrityHash, readinessEvidenceHash: 'd'.repeat(64), pricingVersion: version }] },
    dispatchPricedAllocationEvent: { findMany: async () => [event] } };
  const verifier = createPrismaDispatchReplayTruthVerifier({ $transaction: async (work: (database: typeof tx) => unknown) => work(tx) } as never);
  const input = { allocationRevisionId: revision.id, allocationIntegrityHash: revision.integrityHash, expectedSourceIntegrityHash: sourceHash, pricingVersionIds: [version.id], pricedEventIntegrityHashes: [event.integrityHash] };
  assert.equal(await verifier.verifyPrimarySource(input), true);
  assert.equal(await verifier.verifyPrimarySource({ ...input, pricedEventIntegrityHashes: ['0'.repeat(64)] }), false);
  row.canonicalAllInTotal = decimal('101.000000000000');
  assert.equal(await verifier.verifyPrimarySource(input), false);
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
    actorId: 'support-1', correlationId: 'reconcile-1', idempotencyKey: 'reconcile-command-1', metadata, authority,
    storage: {
      listKeys: async () => ['issued/healthy.pdf', 'issued/corrupt.pdf', 'staging/unreferenced.pdf'],
      read: async key => key === 'issued/healthy.pdf' ? healthy : key === 'issued/corrupt.pdf' ? Buffer.from('changed') : key === 'staging/unreferenced.pdf' ? orphanBytes : null,
    },
    audit: { append: async event => { audits.push(event); } },
    now: new Date('2026-08-09T08:00:00.000Z'),
  });
  assert.deepEqual(report.artifacts.map(item => [item.artifactId, item.status]), [
    ['a-corrupt', 'CORRUPT'], ['a-healthy', 'HEALTHY'], ['a-missing', 'MISSING'],
  ]);
  assert.deepEqual(report.orphans, [{ storageKey: 'staging/unreferenced.pdf', status: 'ORPHAN_CANDIDATE', observedByteLength: orphanBytes.length,
    observedSha256: createHash('sha256').update(orphanBytes).digest('hex'), observedAt: '2026-08-09T08:00:00.000Z' }]);
  assert.equal(report.status, 'UNRESOLVED_INCIDENT');
  assert.deepEqual(audits.map(item => item.action), ['RECONCILIATION_COMPLETED', 'INCIDENT_RECORDED', 'INCIDENT_RECORDED', 'INCIDENT_RECORDED']);
  assert.equal(audits[0].detail.reportHash, report.reportHash);
  assert.deepEqual(audits[0].detail.orphans, report.orphans);
  assert.deepEqual(parsePersistedOrphanEvidence({ detail: audits[0].detail }, 'staging/unreferenced.pdf'), {
    reportHash: report.reportHash, observedAt: '2026-08-09T08:00:00.000Z', observedByteLength: orphanBytes.length,
    observedSha256: createHash('sha256').update(orphanBytes).digest('hex'),
  });
});

test('restore accepts only original verified bytes and records failures without changing metadata', async () => {
  const original = Buffer.from('original-pdf-bytes');
  const metadata = artifact('artifact-1', 'issued/original.pdf', original);
  const writes: Buffer[] = [];
  const audits: DispatchArtifactAuditEvent[] = [];
  const restored = await restoreDispatchDocumentArtifact({
    actorId: 'support-1', reason: 'restore drill', correlationId: 'restore-1', idempotencyKey: 'restore-command-1', metadata, authority,
    encryptedBackup: { readOriginal: async () => ({ bytes: original, recoveryPackageId: 'backup-1', encrypted: true }) },
    storage: { recoverInterruptedWrite: async () => {}, stageOriginal: async (_key, bytes) => { writes.push(bytes); }, commitStagedOriginal: async () => {}, markStagedOriginalCompleted: async () => {}, finalizeStagedOriginal: async () => {}, read: async () => original, restorePrevious: async () => {} },
    audit: { append: async event => { audits.push(event); } },
  });
  assert.equal(restored.status, 'RESTORED');
  assert.deepEqual(writes, [original]);
  assert.equal(audits.at(-1)?.action, 'RESTORATION_COMPLETED');

  const rejectedWrites: Buffer[] = [];
  const rejected = await restoreDispatchDocumentArtifact({
    actorId: 'support-1', reason: 'restore drill', correlationId: 'restore-2', idempotencyKey: 'restore-command-2', metadata, authority,
    encryptedBackup: { readOriginal: async () => ({ bytes: Buffer.from('regenerated-or-corrupt'), recoveryPackageId: 'backup-2', encrypted: true }) },
    storage: { recoverInterruptedWrite: async () => {}, stageOriginal: async (_key, bytes) => { rejectedWrites.push(bytes); }, commitStagedOriginal: async () => {}, markStagedOriginalCompleted: async () => {}, finalizeStagedOriginal: async () => {}, read: async () => null, restorePrevious: async () => {} },
    audit: { append: async event => { audits.push(event); } },
  });
  assert.equal(rejected.status, 'UNRESOLVED_INCIDENT');
  assert.deepEqual(rejectedWrites, []);
  assert.equal(audits.at(-1)?.action, 'RESTORATION_FAILED');

  let auditCount = 0; let readCount = 0; const compensated: Array<Buffer | null> = [];
  const failedAudit = await restoreDispatchDocumentArtifact({
    actorId: 'support-1', reason: 'restore drill', correlationId: 'restore-3', idempotencyKey: 'restore-command-3', metadata, authority,
    encryptedBackup: { readOriginal: async () => ({ bytes: original, recoveryPackageId: 'backup-3', encrypted: true }) },
    storage: { recoverInterruptedWrite: async () => {}, stageOriginal: async () => {}, commitStagedOriginal: async () => {}, markStagedOriginalCompleted: async () => {}, finalizeStagedOriginal: async () => {}, read: async () => ++readCount === 1 ? Buffer.from('previous-corrupt') : original, restorePrevious: async (_key, bytes) => { compensated.push(bytes); } },
    audit: { append: async () => { auditCount += 1; if (auditCount === 2) throw new Error('completion audit unavailable'); } },
  });
  assert.equal(failedAudit.status, 'UNRESOLVED_INCIDENT');
  assert.equal(compensated[0]?.toString(), 'previous-corrupt');

  for (const failurePhase of ['marker', 'finalize'] as const) {
    let reads = 0; let rollbackCalled = false; const phaseAudits: DispatchArtifactAuditEvent[] = [];
    const completed = await restoreDispatchDocumentArtifact({
      actorId: 'support-1', reason: 'restore drill', correlationId: `restore-${failurePhase}`, idempotencyKey: `restore-${failurePhase}`, metadata, authority,
      encryptedBackup: { readOriginal: async () => ({ bytes: original, recoveryPackageId: 'backup-cleanup', encrypted: true }) },
      storage: { recoverInterruptedWrite: async () => {}, stageOriginal: async () => {}, commitStagedOriginal: async () => {},
        markStagedOriginalCompleted: async () => { if (failurePhase === 'marker') throw new Error('marker cleanup failed'); },
        finalizeStagedOriginal: async () => { if (failurePhase === 'finalize') throw new Error('finalize cleanup failed'); },
        read: async () => ++reads === 1 ? Buffer.from('previous-corrupt') : original, restorePrevious: async () => { rollbackCalled = true; } },
      audit: { append: async event => { phaseAudits.push(event); } },
    });
    assert.equal(completed.status, 'RESTORED');
    assert.equal(rollbackCalled, false);
    assert.equal(phaseAudits.at(-1)?.action, 'INCIDENT_RECORDED');
    assert.equal(phaseAudits.at(-1)?.detail.code, 'RESTORATION_COMPLETED_CLEANUP_PENDING');
  }
  let ambiguousReads = 0; let ambiguousRollback = false; let ambiguousAuditCalls = 0;
  const ambiguous = await restoreDispatchDocumentArtifact({
    actorId: 'support-1', reason: 'restore drill', correlationId: 'restore-ambiguous', idempotencyKey: 'restore-ambiguous', metadata, authority,
    encryptedBackup: { readOriginal: async () => ({ bytes: original, recoveryPackageId: 'backup-ambiguous', encrypted: true }) },
    storage: { recoverInterruptedWrite: async () => {}, stageOriginal: async () => {}, commitStagedOriginal: async () => {}, markStagedOriginalCompleted: async () => {}, finalizeStagedOriginal: async () => {},
      read: async () => ++ambiguousReads === 1 ? Buffer.from('previous-corrupt') : original, restorePrevious: async () => { ambiguousRollback = true; } },
    audit: { append: async () => { ambiguousAuditCalls += 1; if (ambiguousAuditCalls === 2) throw new Error('connection lost after commit'); }, hasCompletedRestoration: async () => true },
  });
  assert.equal(ambiguous.status, 'RESTORED');
  assert.equal(ambiguousRollback, false);
});

test('orphan quarantine rechecks references and cleanup waits for the safety window', async () => {
  const actions: string[] = [];
  const audit: DispatchArtifactAuditEvent[] = [];
  await assert.rejects(quarantineDispatchDocumentOrphan({
    storageKey: 'staging/file.pdf', actorId: 'support-1', reason: 'candidate', correlationId: 'q-1', idempotencyKey: 'q-command-1', authority,
    repository: { isReferenced: async () => true, readPersistedOrphanEvidence: async () => orphanEvidence }, storage: { read: async () => orphanBytes, quarantine: async () => { actions.push('quarantine'); }, restoreQuarantined: async () => {} },
    audit: { append: async event => { audit.push(event); } },
  }), /referenced/);
  assert.equal(actions.length, 0);

  await assert.rejects(quarantineDispatchDocumentOrphan({
    storageKey: 'staging/not-in-report.pdf', actorId: 'support-1', reason: 'candidate', correlationId: 'q-unknown', idempotencyKey: 'q-command-unknown', authority,
    repository: { isReferenced: async () => false, readPersistedOrphanEvidence: async () => null },
    storage: { read: async () => orphanBytes, quarantine: async () => { actions.push('quarantine'); }, restoreQuarantined: async () => {} }, audit: { append: async event => { audit.push(event); } },
  }), /does not prove/);

  const quarantined = await quarantineDispatchDocumentOrphan({
    storageKey: 'staging/file.pdf', actorId: 'support-1', reason: 'confirmed orphan', correlationId: 'q-2', idempotencyKey: 'q-command-2', authority,
    repository: { isReferenced: async () => false, readPersistedOrphanEvidence: async () => orphanEvidence }, storage: { read: async () => orphanBytes, quarantine: async () => { actions.push('quarantine'); }, restoreQuarantined: async () => {} },
    audit: { append: async event => { audit.push(event); } },
  });
  assert.equal(quarantined.status, 'QUARANTINED');
  await assert.rejects(quarantineDispatchDocumentOrphan({
    storageKey: 'staging/reused.pdf', actorId: 'support-1', reason: 'stale evidence', correlationId: 'q-reused', idempotencyKey: 'q-reused', authority,
    repository: { isReferenced: async () => false, readPersistedOrphanEvidence: async () => orphanEvidence },
    storage: { read: async () => Buffer.from('replacement'), quarantine: async () => { actions.push('should-not-quarantine'); }, restoreQuarantined: async () => {} },
    audit: { append: async event => { audit.push(event); } },
  }), /changed or was reused/);
  const cleanup = await cleanupQuarantinedDispatchDocumentOrphan({
    storageKey: quarantined.storageKey, actorId: 'support-2', reason: 'safety window elapsed', correlationId: 'cleanup-1', idempotencyKey: 'cleanup-command-1', authority,
    now: new Date('2026-08-20T00:00:00.000Z'),
    repository: { isReferenced: async () => false, readQuarantineEvidence: async () => ({ quarantinedAt: quarantined.quarantinedAt, reconciliationReportHash: 'c'.repeat(64) }) },
    storage: { stageCleanup: async () => { actions.push('cleanup'); }, restoreStagedCleanup: async () => {}, finalizeCleanup: async () => {} },
    audit: { append: async event => { audit.push(event); } },
  });
  assert.equal(cleanup.status, 'REMOVED');
  assert.deepEqual(actions, ['quarantine', 'cleanup']);
  assert.ok(audit.some(item => item.action === 'QUARANTINE_COMPLETED'));
  assert.ok(audit.some(item => item.action === 'CLEANUP_COMPLETED'));
});

test('quarantine and cleanup compensate filesystem mutations when durable completion audit fails', async () => {
  const movements: string[] = [];
  let appendCount = 0;
  await assert.rejects(quarantineDispatchDocumentOrphan({
    storageKey: 'staging/fail.pdf', actorId: 'support-1', reason: 'confirmed orphan', correlationId: 'q-fail', idempotencyKey: 'q-fail', authority,
    repository: { isReferenced: async () => false, readPersistedOrphanEvidence: async () => orphanEvidence },
    storage: { read: async () => orphanBytes, quarantine: async () => { movements.push('quarantine'); }, restoreQuarantined: async () => { movements.push('restore'); } },
    audit: { append: async () => { appendCount += 1; if (appendCount === 2) throw new Error('audit unavailable'); } },
  }), /audit unavailable/);
  assert.deepEqual(movements, ['quarantine', 'restore']);

  movements.length = 0; appendCount = 0;
  await assert.rejects(cleanupQuarantinedDispatchDocumentOrphan({
    storageKey: 'staging/fail.pdf', actorId: 'support-1', reason: 'cleanup', correlationId: 'c-fail', idempotencyKey: 'c-fail', authority,
    now: new Date('2026-08-20T00:00:00.000Z'), repository: { isReferenced: async () => false, readQuarantineEvidence: async () => ({ quarantinedAt: '2026-08-09T00:00:00.000Z', reconciliationReportHash: 'c'.repeat(64) }) },
    storage: { stageCleanup: async () => { movements.push('stage'); }, restoreStagedCleanup: async () => { movements.push('restore'); }, finalizeCleanup: async () => { movements.push('delete'); } },
    audit: { append: async () => { appendCount += 1; if (appendCount === 2) throw new Error('audit unavailable'); } },
  }), /audit unavailable/);
  assert.deepEqual(movements, ['stage', 'restore']);
});

test('compensation failure still records a terminal unresolved incident', async () => {
  const events: DispatchArtifactAuditEvent[] = []; let calls = 0;
  await assert.rejects(quarantineDispatchDocumentOrphan({
    storageKey: 'staging/compensation-fails.pdf', actorId: 'support-1', reason: 'confirmed orphan', correlationId: 'q-compensation', idempotencyKey: 'q-compensation', authority,
    repository: { isReferenced: async () => false, readPersistedOrphanEvidence: async () => orphanEvidence },
    storage: { read: async () => orphanBytes, quarantine: async () => {}, restoreQuarantined: async () => { throw new Error('restore failed'); } },
    audit: { append: async event => { calls += 1; if (calls === 2) throw new Error('completion audit failed'); events.push(event); } },
  }), /completion audit failed/);
  assert.equal(events.at(-1)?.action, 'INCIDENT_RECORDED');
  assert.equal(events.at(-1)?.detail.code, 'QUARANTINE_AUDIT_AND_COMPENSATION_FAILED');
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

test('production filesystem adapter performs reversible quarantine and staged cleanup without path escape', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dispatch-recovery-storage-'));
  const artifactRoot = path.join(root, 'artifacts'); const quarantineRoot = path.join(root, 'quarantine'); const cleanupStagingRoot = path.join(root, 'cleanup');
  const storage = createDispatchDocumentFilesystem({ artifactRoot, quarantineRoot, cleanupStagingRoot });
  try {
    const target = path.join(artifactRoot, 'staging', 'orphan.pdf');
    await fs.promises.mkdir(path.dirname(target), { recursive: true }); await fs.promises.writeFile(target, 'original');
    await storage.quarantine('staging/orphan.pdf');
    assert.equal(fs.existsSync(target), false);
    await storage.restoreQuarantined('staging/orphan.pdf');
    assert.equal((await storage.read('staging/orphan.pdf'))?.toString(), 'original');
    await storage.quarantine('staging/orphan.pdf'); await storage.stageCleanup('staging/orphan.pdf'); await storage.finalizeCleanup('staging/orphan.pdf');
    assert.equal(fs.existsSync(path.join(cleanupStagingRoot, 'staging', 'orphan.pdf')), false);
    await assert.rejects(storage.read('../outside.pdf'), /unsafe/);
  } finally { await fs.promises.rm(root, { recursive: true, force: true }); }
});

test('production restore stages and fsyncs bytes, atomically swaps, and recovers interrupted completion', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dispatch-atomic-restore-'));
  const artifactRoot = path.join(root, 'artifacts'); const storage = createDispatchDocumentFilesystem({ artifactRoot });
  try {
    const destination = path.join(artifactRoot, 'issued', 'document.pdf'); await fs.promises.mkdir(path.dirname(destination), { recursive: true }); await fs.promises.writeFile(destination, 'corrupt');
    await storage.stageOriginal('issued/document.pdf', Buffer.from('original')); await storage.commitStagedOriginal('issued/document.pdf');
    assert.equal((await storage.read('issued/document.pdf'))?.toString(), 'original');
    await storage.recoverInterruptedWrite('issued/document.pdf', false);
    assert.equal((await storage.read('issued/document.pdf'))?.toString(), 'corrupt');
    await storage.stageOriginal('issued/document.pdf', Buffer.from('original')); await storage.commitStagedOriginal('issued/document.pdf'); await storage.markStagedOriginalCompleted('issued/document.pdf');
    await storage.recoverInterruptedWrite('issued/document.pdf', true);
    assert.equal((await storage.read('issued/document.pdf'))?.toString(), 'original');
  } finally { await fs.promises.rm(root, { recursive: true, force: true }); }
});

test('production restore sidecars are isolated by run identity', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dispatch-run-restore-'));
  const artifactRoot = path.join(root, 'artifacts'); const storage = createDispatchDocumentFilesystem({ artifactRoot });
  try {
    const destination = path.join(artifactRoot, 'issued', 'document.pdf'); await fs.promises.mkdir(path.dirname(destination), { recursive: true }); await fs.promises.writeFile(destination, 'corrupt');
    await storage.stageOriginal('issued/document.pdf', Buffer.from('first'), 'run-a');
    await storage.stageOriginal('issued/document.pdf', Buffer.from('second'), 'run-b');
    const names = await fs.promises.readdir(path.dirname(destination));
    assert.ok(names.some(name => name.includes('run-a-stage')));
    assert.ok(names.some(name => name.includes('run-b-stage')));
    await storage.recoverInterruptedWrite('issued/document.pdf', false, 'run-a');
    assert.ok((await fs.promises.readdir(path.dirname(destination))).some(name => name.includes('run-b-stage')));
    await storage.recoverInterruptedWrite('issued/document.pdf', false, 'run-b');
  } finally { await fs.promises.rm(root, { recursive: true, force: true }); }
});

test('system recovery rejects an incomplete backup until every referenced original artifact is included', async () => {
  const payloadRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dispatch-recovery-coverage-'));
  const original = Buffer.from('original-pdf');
  const database = {
    $queryRawUnsafe: async () => [],
    dispatchDocumentArtifact: { findMany: async () => [{ id: 'artifact-1', storageKey: 'issued/original.pdf', byteLength: BigInt(original.length), sha256: createHash('sha256').update(original).digest('hex') }] },
  };
  try {
    await assert.rejects(
      recoveryEngineInternals.validateStoredFileReferences(database as never, payloadRoot),
      (error: any) => error?.code === 'RECOVERY_DISPATCH_ARTIFACT_MISSING',
    );
    const originalPath = recoveryEngineInternals.dispatchArtifactBackupPath(payloadRoot, 'issued/original.pdf');
    await fs.promises.mkdir(path.dirname(originalPath), { recursive: true });
    await fs.promises.writeFile(originalPath, Buffer.from('same-length!'));
    await assert.rejects(
      recoveryEngineInternals.validateStoredFileReferences(database as never, payloadRoot),
      (error: any) => error?.code === 'RECOVERY_DISPATCH_ARTIFACT_CORRUPT',
    );
    await fs.promises.writeFile(originalPath, original);
    await recoveryEngineInternals.validateStoredFileReferences(database as never, payloadRoot);
  } finally {
    await fs.promises.rm(payloadRoot, { recursive: true, force: true });
  }
});

test('sanitized dispatch backup validates only against placeholder metadata in the sanitized database copy', async () => {
  const payloadRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dispatch-sanitized-coverage-'));
  const storageKey = 'issued/statement.pdf'; const placeholder = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  const placeholderMetadata = sanitizedDispatchArtifactMetadata(storageKey);
  const database = { $queryRawUnsafe: async () => [], dispatchDocumentArtifact: { findMany: async () => [{ id: 'artifact-1', storageKey,
    byteLength: BigInt(placeholderMetadata.byteLength), sha256: placeholderMetadata.sha256 }] } };
  try {
    const target = recoveryEngineInternals.dispatchArtifactBackupPath(payloadRoot, storageKey); await fs.promises.mkdir(path.dirname(target), { recursive: true }); await fs.promises.writeFile(target, placeholder);
    await recoveryEngineInternals.validateStoredFileReferences(database as never, payloadRoot);
    assert.notEqual(placeholderMetadata.sha256, createHash('sha256').update('original-production-pdf').digest('hex'));
  } finally { await fs.promises.rm(payloadRoot, { recursive: true, force: true }); }
});
