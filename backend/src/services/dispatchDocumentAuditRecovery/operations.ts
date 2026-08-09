import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  cleanupQuarantinedDispatchDocumentOrphan,
  quarantineDispatchDocumentOrphan,
  reconcileDispatchDocumentArtifacts,
  restoreDispatchDocumentArtifact,
  type DispatchRecoveryAuthority,
  dispatchRecoveryIntegrityHash,
  validateDispatchLifecycleConservation,
} from './index';
import { createPrismaDispatchArtifactAuditPort } from './prisma';
import { approvedPricingVersionIntegrityHash } from '../approvedPricing/domain';
import { pricedAllocationIntegrityHash } from '../pricedAllocationLedger';
import { decryptRecoveryArchive, sha256File } from '../recoveryCrypto';

const execFileAsync = promisify(execFile);

const safePath = (root: string, storageKey: string) => {
  const normalized = storageKey.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error('Dispatch artifact storage key is unsafe.');
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, normalized);
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error('Dispatch artifact storage key is unsafe.');
  return resolved;
};

const regularFiles = async (root: string, current = root): Promise<string[]> => {
  if (!fs.existsSync(current)) return [];
  const entries = await fs.promises.readdir(current, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) result.push(...await regularFiles(root, absolute));
    else if (entry.isFile()) result.push(path.relative(root, absolute).replace(/\\/g, '/'));
  }
  return result;
};

export const createDispatchDocumentFilesystem = (input: {
  artifactRoot?: string;
  quarantineRoot?: string;
  cleanupStagingRoot?: string;
} = {}) => {
  const artifactRoot = input.artifactRoot ?? path.join(process.cwd(), 'storage', 'dispatch-documents');
  const quarantineRoot = input.quarantineRoot ?? path.join(process.cwd(), 'storage', 'dispatch-documents-quarantine');
  const cleanupStagingRoot = input.cleanupStagingRoot ?? path.join(process.cwd(), 'storage', 'dispatch-documents-cleanup-staging');
  const restoreStagingRoot = `${artifactRoot}-restore-staging`;
  const restorePreviousRoot = `${artifactRoot}-restore-previous`;
  const move = async (fromRoot: string, toRoot: string, storageKey: string) => {
    const source = safePath(fromRoot, storageKey); const destination = safePath(toRoot, storageKey);
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.rename(source, destination);
  };
  return {
    listKeys: () => regularFiles(artifactRoot),
    read: async (storageKey: string) => {
      const target = safePath(artifactRoot, storageKey);
      try { return await fs.promises.readFile(target); } catch (error: any) { if (error?.code === 'ENOENT') return null; throw error; }
    },
    recoverInterruptedWrite: async (storageKey: string) => {
      const destination = safePath(artifactRoot, storageKey); const staged = safePath(restoreStagingRoot, storageKey); const previous = safePath(restorePreviousRoot, storageKey);
      if (fs.existsSync(previous)) { await fs.promises.rm(destination, { force: true }); await fs.promises.mkdir(path.dirname(destination), { recursive: true }); await fs.promises.rename(previous, destination); }
      await fs.promises.rm(staged, { force: true });
    },
    stageOriginal: async (storageKey: string, bytes: Buffer) => {
      const staged = safePath(restoreStagingRoot, storageKey); await fs.promises.mkdir(path.dirname(staged), { recursive: true }); await fs.promises.rm(staged, { force: true });
      const descriptor = await fs.promises.open(staged, 'wx');
      try { await descriptor.writeFile(bytes); await descriptor.sync(); } finally { await descriptor.close(); }
      const verified = await fs.promises.readFile(staged); if (!verified.equals(bytes)) throw new Error('Staged original bytes failed verification.');
    },
    commitStagedOriginal: async (storageKey: string) => {
      const destination = safePath(artifactRoot, storageKey); const staged = safePath(restoreStagingRoot, storageKey); const previous = safePath(restorePreviousRoot, storageKey);
      await fs.promises.mkdir(path.dirname(destination), { recursive: true }); await fs.promises.mkdir(path.dirname(previous), { recursive: true });
      if (fs.existsSync(previous)) throw new Error('An interrupted restore must be recovered before another commit.');
      if (fs.existsSync(destination)) await fs.promises.rename(destination, previous);
      try { await fs.promises.rename(staged, destination); } catch (error) { if (fs.existsSync(previous)) await fs.promises.rename(previous, destination); throw error; }
      try { const directory = await fs.promises.open(path.dirname(destination), 'r'); try { await directory.sync(); } finally { await directory.close(); } } catch { /* Windows may not fsync directory handles. File bytes were fsynced before rename. */ }
    },
    finalizeStagedOriginal: async (storageKey: string) => {
      await fs.promises.rm(safePath(restorePreviousRoot, storageKey), { force: true }); await fs.promises.rm(safePath(restoreStagingRoot, storageKey), { force: true });
    },
    restorePrevious: async (storageKey: string, bytes: Buffer | null) => {
      const destination = safePath(artifactRoot, storageKey); const staged = safePath(restoreStagingRoot, storageKey); const previous = safePath(restorePreviousRoot, storageKey);
      if (fs.existsSync(previous)) { await fs.promises.rm(destination, { force: true }); await fs.promises.mkdir(path.dirname(destination), { recursive: true }); await fs.promises.rename(previous, destination); }
      else if (bytes === null) await fs.promises.rm(destination, { force: true });
      await fs.promises.rm(staged, { force: true });
    },
    quarantine: (storageKey: string) => move(artifactRoot, quarantineRoot, storageKey),
    restoreQuarantined: (storageKey: string) => move(quarantineRoot, artifactRoot, storageKey),
    stageCleanup: (storageKey: string) => move(quarantineRoot, cleanupStagingRoot, storageKey),
    restoreStagedCleanup: (storageKey: string) => move(cleanupStagingRoot, quarantineRoot, storageKey),
    finalizeCleanup: (storageKey: string) => fs.promises.rm(safePath(cleanupStagingRoot, storageKey), { force: false }),
  };
};

export const createEncryptedRecoveryPackageReader = (input: { sourcePath: string; passphrase: string }) => ({
  readOriginal: async (storageKey: string) => {
    const work = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dispatch-artifact-restore-'));
    const archive = path.join(work, 'payload.tar.gz'); const payload = path.join(work, 'payload');
    try {
      await decryptRecoveryArchive(input.sourcePath, archive, input.passphrase);
      const listed = await execFileAsync('tar', ['-tzf', archive], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
      const entries = listed.stdout.split(/\r?\n/).filter(Boolean);
      for (const entry of entries) {
        const normalized = entry.replace(/\\/g, '/').replace(/^\.\//, '');
        if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.split('/').includes('..')) throw new Error('Recovery archive contains an unsafe path.');
      }
      const targetRelative = `files/dispatch-documents/${storageKey.replace(/\\/g, '/')}`;
      safePath(path.join(payload, 'files', 'dispatch-documents'), storageKey);
      if (!entries.some(entry => entry.replace(/^\.\//, '').replace(/\\/g, '/') === targetRelative)) return null;
      await fs.promises.mkdir(payload, { recursive: true });
      await execFileAsync('tar', ['-xzf', archive, '-C', payload, '--no-same-owner', '--no-same-permissions', targetRelative], { windowsHide: true });
      const target = safePath(path.join(payload, 'files', 'dispatch-documents'), storageKey);
      const stat = await fs.promises.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Recovery artifact is not an original regular file.');
      return { bytes: await fs.promises.readFile(target), recoveryPackageId: await sha256File(input.sourcePath), encrypted: true };
    } finally { await fs.promises.rm(work, { recursive: true, force: true }); }
  },
});

const durableAudit = (prisma: PrismaClient) => ({
  append: (event: Parameters<ReturnType<typeof createPrismaDispatchArtifactAuditPort>['append']>[0]) =>
    prisma.$transaction(tx => createPrismaDispatchArtifactAuditPort(tx).append(event), {
      // The advisory lock is the serialization primitive. READ COMMITTED takes the
      // predecessor snapshot after a contending writer releases that lock.
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    }).then(() => undefined),
});

const metadata = async (prisma: PrismaClient) => (await prisma.dispatchDocumentArtifact.findMany({
  select: { id: true, waybillId: true, storageKey: true, byteLength: true, sha256: true, sourceIntegrityHash: true },
})).map(item => ({ ...item, byteLength: Number(item.byteLength) }));

export const replayPersistedDispatchDocumentChain = async (prisma: PrismaClient, waybillId: string) => {
  const waybill = await prisma.accountingDispatchWaybill.findUnique({ where: { id: waybillId }, include: {
    candidate: { include: { allocationRevision: { include: {
      lines: true,
      pricingReferences: { include: { pricingVersion: { include: { rows: { orderBy: { ordinal: 'asc' } } } } } },
      pricedAllocationEvents: true,
    } } } },
    documentArtifacts: true,
    printHandoffs: { include: { items: true } },
    physicalExit: true,
    dispatchCorrections: { include: { lines: true, statementAdjustment: { include: { artifact: true } } } },
    commandResults: true,
  } });
  if (!waybill) throw new Error('Dispatch waybill does not exist.');
  const issues: Array<{ code: string; subjectId: string; detail: string }> = [];
  const revision = waybill.candidate.allocationRevision;
  if (waybill.candidate.status !== 'ACCEPTED' || !waybill.candidate.dispositionAt || !waybill.candidate.dispositionBy) issues.push({ code: 'BROKEN_EVIDENCE_LINK', subjectId: waybill.candidate.id, detail: 'Issued documents require an accepted candidate disposition with actor/time.' });
  if (!revision.finalizedAt || !revision.finalizedBy) issues.push({ code: 'INCOMPLETE_AUDIT_METADATA', subjectId: revision.id, detail: 'Allocation finalization actor/time is missing.' });
  if (dispatchRecoveryIntegrityHash(revision.snapshot) !== revision.integrityHash) issues.push({ code: 'INTEGRITY_HASH_MISMATCH', subjectId: revision.id, detail: 'Allocation snapshot hash changed.' });
  if (dispatchRecoveryIntegrityHash(waybill.snapshot) !== waybill.integrityHash) issues.push({ code: 'INTEGRITY_HASH_MISMATCH', subjectId: waybill.id, detail: 'Waybill snapshot hash changed.' });
  for (const reference of revision.pricingReferences) {
    const version = reference.pricingVersion;
    const recomputed = approvedPricingVersionIntegrityHash({
      id: version.id, contractId: version.contractId, versionNumber: version.versionNumber,
      sourceFinancialRecordId: version.sourceFinancialRecordId, approvedAt: version.approvedAt, approvedBy: version.approvedBy,
      schemaVersion: version.schemaVersion, currency: version.currency, grossAmount: version.grossAmount.toFixed(12),
      discountAmount: version.discountAmount.toFixed(12), netAmount: version.netAmount.toFixed(12),
      sourceEvidence: version.sourceEvidence as Record<string, unknown>, rowHashes: version.rows.map(row => row.integrityHash),
    });
    if (recomputed !== version.integrityHash || reference.expectedPricingHash !== version.integrityHash) issues.push({ code: 'INTEGRITY_HASH_MISMATCH', subjectId: version.id, detail: 'Approved-pricing binding or immutable hash changed.' });
  }
  const lineById = new Map(revision.lines.map(line => [line.id, line]));
  for (const event of revision.pricedAllocationEvents) {
    const payload = { allocationRevisionId: event.allocationRevisionId, allocationRevisionLineId: event.allocationRevisionLineId,
      pricingVersionId: event.pricingVersionId, pricingRowId: event.pricingRowId, quantity: event.quantity.toFixed(3),
      grossAmount: event.grossAmount.toFixed(12), discountAmount: event.discountAmount.toFixed(12), netAmount: event.netAmount.toFixed(12),
      consumesFinalRemainder: event.consumesFinalRemainder, evidence: event.evidence, recordedBy: event.recordedBy };
    const line = lineById.get(event.allocationRevisionLineId);
    if (!event.recordedAt || !event.recordedBy) issues.push({ code: 'INCOMPLETE_AUDIT_METADATA', subjectId: event.id, detail: 'Priced allocation actor/time is missing.' });
    if (!line || line.quantity.toFixed(3) !== event.quantity.toFixed(3)) issues.push({ code: 'QUANTITY_CONSERVATION_MISMATCH', subjectId: event.id, detail: 'Allocation line and priced-event quantity differ.' });
    if (event.grossAmount.minus(event.discountAmount).toFixed(12) !== event.netAmount.toFixed(12)) issues.push({ code: 'MONEY_CONSERVATION_MISMATCH', subjectId: event.id, detail: 'Priced-event gross minus discount differs from net.' });
    if (pricedAllocationIntegrityHash(payload) !== event.integrityHash) issues.push({ code: 'INTEGRITY_HASH_MISMATCH', subjectId: event.id, detail: 'Priced-allocation evidence hash changed.' });
  }
  for (const requiredKind of ['WAYBILL', 'STATEMENT'] as const) if (!waybill.documentArtifacts.some(item => item.kind === requiredKind && !item.statementAdjustmentId)) {
    issues.push({ code: 'MISSING_EVIDENCE', subjectId: requiredKind, detail: `Primary ${requiredKind.toLowerCase()} artifact is missing.` });
  }
  for (const artifact of waybill.documentArtifacts) if (artifact.waybillId !== waybill.id || !/^[a-f0-9]{64}$/.test(artifact.sourceIntegrityHash) || !/^[a-f0-9]{64}$/.test(artifact.sha256)) {
    issues.push({ code: 'BROKEN_EVIDENCE_LINK', subjectId: artifact.id, detail: 'Artifact waybill, source hash, or byte hash evidence is invalid.' });
  }
  const artifactById = new Map(waybill.documentArtifacts.map(artifact => [artifact.id, artifact]));
  for (const handoff of waybill.printHandoffs) {
    if (!handoff.correlationId || !handoff.idempotencyKey || (handoff.status === 'SUCCEEDED' && handoff.items.length !== handoff.requestedKinds.length)) issues.push({ code: 'INCOMPLETE_AUDIT_METADATA', subjectId: handoff.id, detail: 'Print handoff identity or ordered retained artifacts are incomplete.' });
    for (const item of handoff.items) {
      const artifact = artifactById.get(item.artifactId);
      if (!artifact || item.byteLength !== artifact.byteLength || item.sha256 !== artifact.sha256) issues.push({ code: 'BROKEN_EVIDENCE_LINK', subjectId: item.id, detail: 'Print handoff bytes do not bind the retained artifact.' });
    }
  }
  if (waybill.physicalExit) {
    if (waybill.physicalExit.allocationRevisionId !== revision.id || dispatchRecoveryIntegrityHash(waybill.physicalExit.snapshot) !== waybill.physicalExit.integrityHash) issues.push({ code: 'BROKEN_EVIDENCE_LINK', subjectId: waybill.physicalExit.id, detail: 'Guard exit identity or snapshot hash differs from the issued chain.' });
  }
  for (const correction of waybill.dispatchCorrections.filter(item => item.status === 'POSTED')) {
    const adjustment = correction.statementAdjustment;
    if (!correction.reason || !correction.postedAt || !correction.postedBy || !adjustment || !adjustment.artifact) issues.push({ code: 'MISSING_EVIDENCE', subjectId: correction.id, detail: 'Posted correction lacks reason/time/actor, adjustment, or retained artifact.' });
    if (adjustment && dispatchRecoveryIntegrityHash(adjustment.snapshot) !== adjustment.integrityHash) issues.push({ code: 'INTEGRITY_HASH_MISMATCH', subjectId: adjustment.id, detail: 'Statement-adjustment snapshot hash changed.' });
    for (const line of correction.lines) if (!line.contractId || !line.contractItemId || !line.productRowId || !line.unit || line.quantity.toFixed(3) === '0.000') issues.push({ code: 'QUANTITY_CONSERVATION_MISMATCH', subjectId: line.id, detail: 'Correction line identity/unit/quantity evidence is incomplete.' });
  }
  const objects = (value: unknown): Record<string, any>[] => {
    if (Array.isArray(value)) return value.flatMap(objects);
    if (!value || typeof value !== 'object') return [];
    return [value as Record<string, any>, ...Object.values(value as Record<string, unknown>).flatMap(objects)];
  };
  const renderObjects = waybill.commandResults.flatMap(command => objects(command.result));
  const statement = renderObjects.find(value => value.kind === 'STATEMENT' && value.payload && typeof value.payload === 'object');
  const documentedLines = statement ? objects(statement.payload.contracts).filter(value => typeof value.productRowId === 'string' && typeof value.quantity === 'string') : [];
  const currencyByVersion = new Map(revision.pricingReferences.map(reference => [reference.pricingVersionId, reference.pricingVersion.currency]));
  const pricedMoney = new Map<string, { gross: Prisma.Decimal; discount: Prisma.Decimal; net: Prisma.Decimal }>();
  for (const event of revision.pricedAllocationEvents) {
    const currency = currencyByVersion.get(event.pricingVersionId) ?? '';
    const current = pricedMoney.get(currency) ?? { gross: new Prisma.Decimal(0), discount: new Prisma.Decimal(0), net: new Prisma.Decimal(0) };
    pricedMoney.set(currency, { gross: current.gross.plus(event.grossAmount), discount: current.discount.plus(event.discountAmount), net: current.net.plus(event.netAmount) });
  }
  const posted = waybill.dispatchCorrections.filter(item => item.status === 'POSTED');
  issues.push(...validateDispatchLifecycleConservation({
    candidate: { status: waybill.candidate.status, dispositionAt: waybill.candidate.dispositionAt?.toISOString() ?? null, dispositionBy: waybill.candidate.dispositionBy },
    lifecycle: { requiresPrintHandoff: waybill.printHandoffs.some(item => item.status === 'SUCCEEDED'), hasPrintHandoff: waybill.printHandoffs.some(item => item.status === 'SUCCEEDED'), requiresGuardExit: waybill.status === 'EXIT_RECORDED', hasGuardExit: Boolean(waybill.physicalExit), requiredAdjustmentIds: posted.map(item => item.statementAdjustment?.id ?? `missing:${item.id}`), actualAdjustmentIds: posted.flatMap(item => item.statementAdjustment ? [item.statementAdjustment.id] : []) },
    quantityWitnesses: [
      ...revision.lines.map(line => ({ stage: 'ALLOCATION' as const, rowId: line.productRowId, unit: line.unit, value: line.quantity.toFixed(3) })),
      ...revision.pricedAllocationEvents.map(event => { const line = lineById.get(event.allocationRevisionLineId); return { stage: 'PRICED' as const, rowId: line?.productRowId ?? '', unit: line?.unit ?? '', value: event.quantity.toFixed(3) }; }),
      ...documentedLines.map(line => ({ stage: 'DOCUMENTED' as const, rowId: String(line.productRowId), unit: String(line.unit ?? ''), value: String(line.quantity) })),
      ...(waybill.physicalExit ? revision.lines.map(line => ({ stage: 'EXIT' as const, rowId: line.productRowId, unit: line.unit, value: line.quantity.toFixed(3) })) : []),
    ],
    moneyWitnesses: [
      ...[...pricedMoney].map(([currency, value]) => ({ stage: 'PRICED' as const, currency, gross: value.gross.toFixed(12), discount: value.discount.toFixed(12), net: value.net.toFixed(12) })),
      ...(statement?.payload ? [{ stage: 'DOCUMENTED' as const, currency: String(statement.payload.currency ?? ''), gross: String(statement.payload.grossAmount ?? ''), discount: String(statement.payload.allocatedDiscount ?? statement.payload.discountAmount ?? ''), net: String(statement.payload.netAmount ?? '') }] : []),
    ],
    adjustmentWitnesses: posted.flatMap(item => {
      const values = item.statementAdjustment ? objects(item.statementAdjustment.snapshot).find(value => value.beforeNetAmount !== undefined && value.netAmountDelta !== undefined && value.afterNetAmount !== undefined) : undefined;
      return item.statementAdjustment && values ? [{ id: item.statementAdjustment.id, currency: String(values.currency ?? statement?.payload?.currency ?? ''), before: String(values.beforeNetAmount), delta: String(values.netAmountDelta), after: String(values.afterNetAmount) }] : [];
    }),
  }));
  const expectedAggregates = [
    { aggregateType: 'LOGISTICS_ALLOCATION_REVISION', aggregateId: revision.id, sourceHash: revision.integrityHash },
    { aggregateType: 'ACCOUNTING_DISPATCH_CANDIDATE', aggregateId: waybill.candidate.id, sourceHash: revision.integrityHash },
    { aggregateType: 'ACCOUNTING_DISPATCH_WAYBILL', aggregateId: waybill.id, sourceHash: waybill.integrityHash },
    ...(waybill.physicalExit ? [{ aggregateType: 'GUARD_PHYSICAL_EXIT', aggregateId: waybill.physicalExit.id, sourceHash: waybill.physicalExit.integrityHash }] : []),
    ...waybill.dispatchCorrections.filter(item => item.status === 'POSTED').map(item => ({ aggregateType: 'DISPATCH_CORRECTION', aggregateId: item.id, sourceHash: item.integrityHash! })),
  ];
  const audits = await prisma.dispatchLifecycleAudit.findMany({ where: { OR: expectedAggregates.map(item => ({ aggregateType: item.aggregateType, aggregateId: item.aggregateId })) }, orderBy: [{ aggregateType: 'asc' }, { aggregateId: 'asc' }, { recordedAt: 'asc' }, { id: 'asc' }] });
  for (const expected of expectedAggregates) {
    const rows = audits.filter(audit => audit.aggregateType === expected.aggregateType && audit.aggregateId === expected.aggregateId);
    if (!rows.length) { issues.push({ code: 'MISSING_EVIDENCE', subjectId: expected.aggregateId, detail: `No ${expected.aggregateType} parent audit binds this evidence.` }); continue; }
    const payloads = rows.map(row => row.payload as Record<string, unknown>);
    const linked = payloads.some(payload => Object.values(payload).some(value => value === expected.sourceHash)
      || (expected.aggregateType === 'ACCOUNTING_DISPATCH_CANDIDATE' && payload.allocationRevisionId === revision.id)
      || (expected.aggregateType === 'ACCOUNTING_DISPATCH_WAYBILL' && payload.candidateId === waybill.candidate.id)
      || (expected.aggregateType === 'GUARD_PHYSICAL_EXIT' && payload.waybillId === waybill.id)
      || (expected.aggregateType === 'DISPATCH_CORRECTION' && payload.waybillId === waybill.id && payload.integrityHash === expected.sourceHash));
    if (!linked) issues.push({ code: 'AUDIT_SOURCE_MISMATCH', subjectId: expected.aggregateId, detail: 'Parent audit does not bind the expected immutable source identity/hash.' });
  }
  const previous = new Map<string, string | null>();
  for (const audit of audits) {
    const key = `${audit.aggregateType}:${audit.aggregateId}`; const expectedPrevious = previous.get(key) ?? null;
    const expectedHash = dispatchRecoveryIntegrityHash({ aggregateType: audit.aggregateType, aggregateId: audit.aggregateId, eventType: audit.eventType,
      payload: audit.payload, actorId: audit.actorId, recordedAt: audit.recordedAt.toISOString(), previousHash: audit.previousHash });
    if (audit.previousHash !== expectedPrevious || audit.eventHash !== expectedHash || !audit.actorId) issues.push({ code: 'AUDIT_CHAIN_BROKEN', subjectId: audit.aggregateId, detail: 'Lifecycle audit predecessor, hash, or actor is invalid.' });
    previous.set(key, audit.eventHash);
  }
  return { status: issues.length ? 'UNRESOLVED_INCIDENT' as const : 'VERIFIED' as const, waybillId, issues, evidenceCount: expectedAggregates.length, auditCount: audits.length,
    reportHash: dispatchRecoveryIntegrityHash({ waybillId, expectedAggregates, auditHashes: audits.map(item => item.eventHash), issues }) };
};

export const createDispatchDocumentRecoveryOperations = (prisma: PrismaClient, filesystem = createDispatchDocumentFilesystem()) => {
  const audit = durableAudit(prisma);
  const repository = {
    isReferenced: async (storageKey: string) => Boolean(await prisma.dispatchDocumentArtifact.findUnique({ where: { storageKey }, select: { id: true } })),
    readQuarantineEvidence: async (storageKey: string) => {
      const aggregateId = dispatchRecoveryIntegrityHash({ storageKey });
      const row = await prisma.dispatchLifecycleAudit.findFirst({
        where: { aggregateType: 'DISPATCH_DOCUMENT_RECOVERY', aggregateId, eventType: 'QUARANTINE_COMPLETED' },
        orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }], select: { payload: true },
      });
      const payload = row?.payload as Record<string, any> | undefined;
      const detail = payload?.detail as Record<string, unknown> | undefined;
      return typeof detail?.quarantinedAt === 'string' && typeof detail?.reconciliationReportHash === 'string'
        ? { quarantinedAt: detail.quarantinedAt, reconciliationReportHash: detail.reconciliationReportHash } : null;
    },
    readPersistedOrphanEvidence: async (storageKey: string) => {
      const rows = await prisma.dispatchLifecycleAudit.findMany({ where: { aggregateType: 'DISPATCH_DOCUMENT_RECOVERY', eventType: 'RECONCILIATION_COMPLETED' }, orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }], take: 100 });
      for (const row of rows) {
        const payload = row.payload as Record<string, any>; const detail = payload?.detail as Record<string, any> | undefined;
        const orphans = Array.isArray(detail?.orphans) ? detail.orphans : [];
        if (!orphans.some(item => item?.storageKey === storageKey && item?.status === 'ORPHAN_CANDIDATE')) continue;
        const expected = dispatchRecoveryIntegrityHash({ artifacts: detail?.artifacts, orphans: detail?.orphans, observedAt: detail?.observedAt });
        if (typeof detail?.reportHash === 'string' && typeof detail?.observedAt === 'string' && expected === detail.reportHash) return { reportHash: detail.reportHash, observedAt: detail.observedAt };
      }
      return null;
    },
  };
  return {
    replay: async (command: { waybillId: string; actorId: string; correlationId: string; idempotencyKey: string; authority: DispatchRecoveryAuthority; now?: Date }) => {
      const report = await replayPersistedDispatchDocumentChain(prisma, command.waybillId);
      await audit.append({ action: report.status === 'VERIFIED' ? 'RECONCILIATION_COMPLETED' : 'INCIDENT_RECORDED', actorId: command.actorId,
        correlationId: command.correlationId, idempotencyKey: command.idempotencyKey, occurredAt: (command.now ?? new Date()).toISOString(),
        authority: command.authority, reason: 'Persisted dispatch evidence replay', detail: { reportHash: report.reportHash, status: report.status, issues: report.issues } });
      return report;
    },
    reconcile: (command: { actorId: string; correlationId: string; idempotencyKey: string; authority: DispatchRecoveryAuthority; now?: Date }) =>
      metadata(prisma).then(items => reconcileDispatchDocumentArtifacts({ ...command, metadata: items, storage: filesystem, audit })),
    restore: async (command: { artifactId: string; actorId: string; reason: string; correlationId: string; idempotencyKey: string; authority: DispatchRecoveryAuthority; encryptedBackup: { readOriginal(storageKey: string): Promise<{ bytes: Buffer; recoveryPackageId: string; encrypted: boolean } | null> }; now?: Date }) => {
      const item = (await metadata(prisma)).find(candidate => candidate.id === command.artifactId);
      if (!item) throw new Error('Dispatch artifact does not exist.');
      return restoreDispatchDocumentArtifact({ ...command, metadata: item, storage: filesystem, audit });
    },
    restoreFromRecoveryPackage: async (command: { artifactId: string; recoveryPackagePath: string; passphrase: string; actorId: string; reason: string; correlationId: string; idempotencyKey: string; authority: DispatchRecoveryAuthority; now?: Date }) => {
      const item = (await metadata(prisma)).find(candidate => candidate.id === command.artifactId);
      if (!item) throw new Error('Dispatch artifact does not exist.');
      return restoreDispatchDocumentArtifact({ ...command, metadata: item, encryptedBackup: createEncryptedRecoveryPackageReader({ sourcePath: command.recoveryPackagePath, passphrase: command.passphrase }), storage: filesystem, audit });
    },
    quarantine: (command: { storageKey: string; actorId: string; reason: string; correlationId: string; idempotencyKey: string; authority: DispatchRecoveryAuthority; now?: Date }) =>
      prisma.$transaction(async tx => {
        const rows = await tx.$queryRaw<Array<{ payload: unknown }>>`SELECT payload FROM dispatch_lifecycle_audits WHERE "aggregateType" = 'DISPATCH_DOCUMENT_RECOVERY' AND "eventType" = 'RECONCILIATION_COMPLETED' ORDER BY "recordedAt" DESC, id DESC FOR UPDATE`;
        const lockedRepository = { ...repository,
          isReferenced: async (storageKey: string) => Boolean(await tx.dispatchDocumentArtifact.findUnique({ where: { storageKey }, select: { id: true } })),
          readPersistedOrphanEvidence: async (storageKey: string) => {
          for (const row of rows) {
            const payload = row.payload as Record<string, any>; const detail = payload?.detail as Record<string, any> | undefined;
            const orphans = Array.isArray(detail?.orphans) ? detail.orphans : [];
            if (!orphans.some(item => item?.storageKey === storageKey && item?.status === 'ORPHAN_CANDIDATE')) continue;
            const expected = dispatchRecoveryIntegrityHash({ artifacts: detail?.artifacts, orphans: detail?.orphans, observedAt: detail?.observedAt });
            if (typeof detail?.reportHash === 'string' && typeof detail?.observedAt === 'string' && expected === detail.reportHash) return { reportHash: detail.reportHash, observedAt: detail.observedAt };
          }
          return null;
        } };
        return quarantineDispatchDocumentOrphan({ ...command, repository: lockedRepository, storage: filesystem, audit });
      }),
    cleanup: (command: { storageKey: string; actorId: string; reason: string; correlationId: string; idempotencyKey: string; authority: DispatchRecoveryAuthority; now: Date }) =>
      cleanupQuarantinedDispatchDocumentOrphan({ ...command, repository, storage: filesystem, audit }),
  };
};

export const dispatchDocumentRecoveryOperationInternals = { safePath, regularFiles };
