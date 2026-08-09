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
import { dispatchCorrectionIntegrityHash, dispatchLifecycleAuditEventHash } from '../dispatchCorrectionOutage';
import { guardPhysicalExitAuditIntegrityHash, guardPhysicalExitIntegrityHash } from '../physicalGateExit';
import { decryptRecoveryArchive, sha256File } from '../recoveryCrypto';

const execFileAsync = promisify(execFile);
export const DISPATCH_DOCUMENT_STORAGE_CLAIM_NAMESPACE = 'DISPATCH_DOCUMENT_STORAGE_KEY';
export const claimDispatchDocumentStorageKey = (tx: Prisma.TransactionClient, storageKey: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${DISPATCH_DOCUMENT_STORAGE_CLAIM_NAMESPACE}), hashtext(${storageKey}))`;

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
    else if (entry.isFile() && !entry.name.includes('.sabalan-restore-')) result.push(path.relative(root, absolute).replace(/\\/g, '/'));
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
  const restorePaths = (storageKey: string) => {
    const destination = safePath(artifactRoot, storageKey); const directory = path.dirname(destination); const name = path.basename(destination);
    return { destination, staged: path.join(directory, `.${name}.sabalan-restore-stage`), previous: path.join(directory, `.${name}.sabalan-restore-previous`), marker: path.join(directory, `.${name}.sabalan-restore-marker`) };
  };
  const syncFile = async (target: string, bytes: Buffer) => { const descriptor = await fs.promises.open(target, 'w'); try { await descriptor.writeFile(bytes); await descriptor.sync(); } finally { await descriptor.close(); } };
  const marker = async (target: string, value: unknown) => syncFile(target, Buffer.from(JSON.stringify(value), 'utf8'));
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
    recoverInterruptedWrite: async (storageKey: string, completed: boolean) => {
      const targets = restorePaths(storageKey); if (!fs.existsSync(targets.marker)) { await fs.promises.rm(targets.staged, { force: true }); return; }
      const state = JSON.parse(await fs.promises.readFile(targets.marker, 'utf8')) as { phase?: string; hadPrevious?: boolean };
      if (!completed && state.phase !== 'COMPLETED') {
        if (state.hadPrevious && fs.existsSync(targets.previous)) { const recovery = `${targets.staged}.rollback`; await fs.promises.copyFile(targets.previous, recovery); const handle = await fs.promises.open(recovery, 'r+'); try { await handle.sync(); } finally { await handle.close(); } await fs.promises.rename(recovery, targets.destination); }
        else if (!state.hadPrevious && state.phase === 'SWAPPED') await fs.promises.rm(targets.destination, { force: true });
      }
      await Promise.all([targets.staged, targets.previous, targets.marker].map(target => fs.promises.rm(target, { force: true })));
    },
    stageOriginal: async (storageKey: string, bytes: Buffer) => {
      const targets = restorePaths(storageKey); await fs.promises.mkdir(path.dirname(targets.destination), { recursive: true });
      await Promise.all([targets.staged, targets.previous, targets.marker].map(target => fs.promises.rm(target, { force: true })));
      await syncFile(targets.staged, bytes);
      const verified = await fs.promises.readFile(targets.staged); if (!verified.equals(bytes)) throw new Error('Staged original bytes failed verification.');
      const hadPrevious = fs.existsSync(targets.destination);
      if (hadPrevious) { await fs.promises.copyFile(targets.destination, targets.previous); const handle = await fs.promises.open(targets.previous, 'r+'); try { await handle.sync(); } finally { await handle.close(); } }
      await marker(targets.marker, { phase: 'STAGED', hadPrevious });
    },
    commitStagedOriginal: async (storageKey: string) => {
      const targets = restorePaths(storageKey); const state = JSON.parse(await fs.promises.readFile(targets.marker, 'utf8')) as { hadPrevious: boolean };
      await fs.promises.rename(targets.staged, targets.destination);
      await marker(targets.marker, { phase: 'SWAPPED', hadPrevious: state.hadPrevious });
      try { const directory = await fs.promises.open(path.dirname(targets.destination), 'r'); try { await directory.sync(); } finally { await directory.close(); } } catch { /* Windows may not fsync directory handles. */ }
    },
    markStagedOriginalCompleted: async (storageKey: string) => { const targets = restorePaths(storageKey); const state = JSON.parse(await fs.promises.readFile(targets.marker, 'utf8')) as { hadPrevious: boolean }; await marker(targets.marker, { phase: 'COMPLETED', hadPrevious: state.hadPrevious }); },
    finalizeStagedOriginal: async (storageKey: string) => {
      const targets = restorePaths(storageKey); await Promise.all([targets.staged, targets.previous, targets.marker].map(target => fs.promises.rm(target, { force: true })));
    },
    restorePrevious: async (storageKey: string, bytes: Buffer | null) => {
      const targets = restorePaths(storageKey);
      if (bytes !== null) { const rollback = `${targets.staged}.rollback`; await syncFile(rollback, bytes); await fs.promises.rename(rollback, targets.destination); }
      else await fs.promises.rm(targets.destination, { force: true });
      await Promise.all([targets.staged, targets.previous, targets.marker].map(target => fs.promises.rm(target, { force: true })));
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
  hasCompletedRestoration: async (artifactId: string, idempotencyKey: string) => Boolean(await prisma.dispatchLifecycleAudit.findFirst({
    where: { aggregateType: 'DISPATCH_DOCUMENT_RECOVERY', aggregateId: artifactId, eventType: 'RESTORATION_COMPLETED',
      payload: { path: ['idempotencyKey'], equals: idempotencyKey } }, select: { id: true },
  })),
});

const metadata = async (prisma: PrismaClient) => (await prisma.dispatchDocumentArtifact.findMany({
  select: { id: true, waybillId: true, storageKey: true, byteLength: true, sha256: true, sourceIntegrityHash: true },
})).map(item => ({ ...item, byteLength: Number(item.byteLength) }));

export const parsePersistedOrphanEvidence = (payloadValue: unknown, storageKey: string) => {
  const payload = payloadValue as Record<string, any>; const detail = payload?.detail as Record<string, any> | undefined;
  const orphans = Array.isArray(detail?.orphans) ? detail.orphans : [];
  const orphan = orphans.find(item => item?.storageKey === storageKey && item?.status === 'ORPHAN_CANDIDATE');
  if (!orphan) return null;
  const expected = dispatchRecoveryIntegrityHash({ artifacts: detail?.artifacts, orphans: detail?.orphans, observedAt: detail?.observedAt });
  if (typeof detail?.reportHash !== 'string' || typeof detail?.observedAt !== 'string' || expected !== detail.reportHash
    || !Number.isSafeInteger(orphan.observedByteLength) || orphan.observedByteLength < 0 || !/^[a-f0-9]{64}$/.test(orphan.observedSha256)
    || orphan.observedAt !== detail.observedAt) return null;
  return { reportHash: detail.reportHash, observedAt: detail.observedAt, observedByteLength: orphan.observedByteLength as number, observedSha256: orphan.observedSha256 as string };
};

export const verifyProductionDispatchAuditChains = (audits: readonly { aggregateType: string; aggregateId: string; eventType: string; payload: unknown; actorId: string; recordedAt: Date; previousHash: string | null; eventHash: string }[]) => {
  const issues: Array<{ code: string; subjectId: string; detail: string }> = []; const previous = new Map<string, string | null>();
  for (const audit of audits) {
    const key = `${audit.aggregateType}:${audit.aggregateId}`; const expectedPrevious = previous.get(key) ?? null; const payload = audit.payload as Record<string, any>;
    const expectedHash = audit.aggregateType === 'DISPATCH_CORRECTION'
      ? dispatchLifecycleAuditEventHash({ aggregateType: audit.aggregateType, aggregateId: audit.aggregateId, eventType: audit.eventType, payload, actorId: audit.actorId, authority: payload.effectiveAuthority, at: audit.recordedAt, previousHash: audit.previousHash })
      : audit.aggregateType === 'GUARD_PHYSICAL_EXIT'
        ? guardPhysicalExitAuditIntegrityHash({ aggregateType: audit.aggregateType, aggregateId: audit.aggregateId, eventType: audit.eventType, payload, actorId: audit.actorId, at: audit.recordedAt, previousHash: audit.previousHash })
        : dispatchRecoveryIntegrityHash({ aggregateType: audit.aggregateType, aggregateId: audit.aggregateId, eventType: audit.eventType, payload, actorId: audit.actorId, recordedAt: audit.recordedAt.toISOString(), previousHash: audit.previousHash });
    if (audit.previousHash !== expectedPrevious || audit.eventHash !== expectedHash || !audit.actorId) issues.push({ code: 'AUDIT_CHAIN_BROKEN', subjectId: audit.aggregateId, detail: 'Lifecycle audit predecessor, writer-specific hash, or actor is invalid.' });
    previous.set(key, audit.eventHash);
  }
  return issues;
};

export type DispatchReplayTruthVerifier = { verifyPrimarySource(input: { allocationRevisionId: string; allocationIntegrityHash: string; expectedSourceIntegrityHash: string; pricingVersionIds: readonly string[]; pricedEventIntegrityHashes: readonly string[] }): Promise<boolean> };

export const createPrismaDispatchReplayTruthVerifier = (prisma: PrismaClient): DispatchReplayTruthVerifier => ({
  verifyPrimarySource: async input => {
    const revision = await prisma.logisticsAllocationRevision.findUnique({ where: { id: input.allocationRevisionId }, include: {
      pricingReferences: { include: { pricingVersion: { include: { rows: { orderBy: { ordinal: 'asc' } } } } } }, pricedAllocationEvents: true,
      candidate: { include: { waybills: { include: { documentArtifacts: true } } } },
    } });
    if (!revision || revision.integrityHash !== input.allocationIntegrityHash) return false;
    const versionIds = revision.pricingReferences.map(item => item.pricingVersionId).sort(); const eventHashes = revision.pricedAllocationEvents.map(item => item.integrityHash).sort();
    if (JSON.stringify(versionIds) !== JSON.stringify([...input.pricingVersionIds].sort()) || JSON.stringify(eventHashes) !== JSON.stringify([...input.pricedEventIntegrityHashes].sort())) return false;
    for (const reference of revision.pricingReferences) {
      const version = reference.pricingVersion;
      if (reference.expectedPricingHash !== version.integrityHash || approvedPricingVersionIntegrityHash({ id: version.id, contractId: version.contractId,
        versionNumber: version.versionNumber, sourceFinancialRecordId: version.sourceFinancialRecordId, approvedAt: version.approvedAt, approvedBy: version.approvedBy,
        schemaVersion: version.schemaVersion, currency: version.currency, grossAmount: version.grossAmount.toFixed(12), discountAmount: version.discountAmount.toFixed(12),
        netAmount: version.netAmount.toFixed(12), sourceEvidence: version.sourceEvidence as Record<string, unknown>, rowHashes: version.rows.map(row => row.integrityHash) }) !== version.integrityHash) return false;
    }
    for (const event of revision.pricedAllocationEvents) if (pricedAllocationIntegrityHash({ allocationRevisionId: event.allocationRevisionId,
      allocationRevisionLineId: event.allocationRevisionLineId, pricingVersionId: event.pricingVersionId, pricingRowId: event.pricingRowId,
      quantity: event.quantity.toFixed(3), grossAmount: event.grossAmount.toFixed(12), discountAmount: event.discountAmount.toFixed(12), netAmount: event.netAmount.toFixed(12),
      consumesFinalRemainder: event.consumesFinalRemainder, evidence: event.evidence, recordedBy: event.recordedBy }) !== event.integrityHash) return false;
    return Boolean(revision.candidate?.waybills.some(waybill => {
      const provenance = (waybill.snapshot as Record<string, any>)?.documentProvenance as Record<string, any> | undefined;
      const primary = waybill.documentArtifacts.filter(artifact => !artifact.statementAdjustmentId && (artifact.kind === 'WAYBILL' || artifact.kind === 'STATEMENT'));
      return provenance?.sourceIntegrityHash === input.expectedSourceIntegrityHash && provenance?.allocationRevisionId === revision.id
        && provenance?.allocationIntegrityHash === revision.integrityHash && primary.length === 2
        && primary.every(artifact => artifact.sourceIntegrityHash === input.expectedSourceIntegrityHash);
    }));
  },
});

export const replayPersistedDispatchDocumentChain = async (prisma: PrismaClient, waybillId: string, truthVerifier: DispatchReplayTruthVerifier) => {
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
    if (waybill.physicalExit.allocationRevisionId !== revision.id || guardPhysicalExitIntegrityHash(waybill.physicalExit.snapshot) !== waybill.physicalExit.integrityHash) issues.push({ code: 'BROKEN_EVIDENCE_LINK', subjectId: waybill.physicalExit.id, detail: 'Guard exit identity or snapshot hash differs from the issued chain.' });
  }
  for (const correction of waybill.dispatchCorrections.filter(item => item.status === 'POSTED')) {
    const adjustment = correction.statementAdjustment;
    if (!correction.reason || !correction.postedAt || !correction.postedBy || !adjustment || !adjustment.artifact) issues.push({ code: 'MISSING_EVIDENCE', subjectId: correction.id, detail: 'Posted correction lacks reason/time/actor, adjustment, or retained artifact.' });
    if (adjustment && pricedAllocationIntegrityHash(adjustment.snapshot) !== adjustment.integrityHash) issues.push({ code: 'INTEGRITY_HASH_MISMATCH', subjectId: adjustment.id, detail: 'Statement-adjustment snapshot hash changed.' });
    const correctionHash = dispatchCorrectionIntegrityHash({ correctionId: correction.id, waybillId: correction.waybillId, reason: correction.reason,
      effectiveAt: correction.effectiveAt, lines: correction.lines, postedAt: correction.postedAt });
    if (correction.integrityHash !== correctionHash) issues.push({ code: 'INTEGRITY_HASH_MISMATCH', subjectId: correction.id, detail: 'Posted correction hash changed.' });
    for (const line of correction.lines) if (!line.contractId || !line.contractItemId || !line.productRowId || !line.unit || line.quantity.toFixed(3) === '0.000') issues.push({ code: 'QUANTITY_CONSERVATION_MISMATCH', subjectId: line.id, detail: 'Correction line identity/unit/quantity evidence is incomplete.' });
  }
  const waybillSnapshot = waybill.snapshot as Record<string, any>;
  const provenance = waybillSnapshot?.documentProvenance as Record<string, any> | undefined;
  const primaryArtifacts = waybill.documentArtifacts.filter(item => !item.statementAdjustmentId && (item.kind === 'WAYBILL' || item.kind === 'STATEMENT'));
  const primarySourceHash = typeof provenance?.sourceIntegrityHash === 'string' ? provenance.sourceIntegrityHash : null;
  if (!primarySourceHash || primaryArtifacts.length !== 2 || primaryArtifacts.some(artifact => artifact.sourceIntegrityHash !== primarySourceHash)) {
    issues.push({ code: 'AUDIT_SOURCE_MISMATCH', subjectId: waybill.id, detail: 'Retained primary artifacts do not bind the immutable waybill document-provenance snapshot.' });
  }
  if (primarySourceHash && !await truthVerifier.verifyPrimarySource({ allocationRevisionId: revision.id, allocationIntegrityHash: revision.integrityHash,
    expectedSourceIntegrityHash: primarySourceHash, pricingVersionIds: revision.pricingReferences.map(item => item.pricingVersionId).sort(),
    pricedEventIntegrityHashes: revision.pricedAllocationEvents.map(item => item.integrityHash).sort() })) issues.push({ code: 'AUDIT_SOURCE_MISMATCH', subjectId: waybill.id, detail: 'Writer-owned primary source verifier rejected the immutable pricing/allocation snapshot.' });
  const currencyByVersion = new Map(revision.pricingReferences.map(reference => [reference.pricingVersionId, reference.pricingVersion.currency]));
  const pricedMoney = new Map<string, { gross: Prisma.Decimal; discount: Prisma.Decimal; net: Prisma.Decimal }>();
  for (const event of revision.pricedAllocationEvents) {
    const currency = currencyByVersion.get(event.pricingVersionId) ?? '';
    const current = pricedMoney.get(currency) ?? { gross: new Prisma.Decimal(0), discount: new Prisma.Decimal(0), net: new Prisma.Decimal(0) };
    pricedMoney.set(currency, { gross: current.gross.plus(event.grossAmount), discount: current.discount.plus(event.discountAmount), net: current.net.plus(event.netAmount) });
  }
  const posted = waybill.dispatchCorrections.filter(item => item.status === 'POSTED');
  const runningNet = new Map([...pricedMoney].map(([currency, totals]) => [currency, totals.net]));
  const adjustmentWitnesses: Array<{ id: string; currency: string; before: string; delta: string; after: string }> = [];
  for (const correction of [...posted].sort((left, right) => (left.statementAdjustment?.sequence ?? 0) - (right.statementAdjustment?.sequence ?? 0))) {
    const adjustment = correction.statementAdjustment; const snapshot = adjustment?.snapshot as Record<string, any> | undefined; const totals = snapshot?.totals as Record<string, any> | undefined;
    if (!adjustment || !totals || typeof snapshot?.currency !== 'string' || adjustment.artifact?.sourceIntegrityHash !== adjustment.integrityHash) continue;
    const before = runningNet.get(snapshot.currency); const delta = new Prisma.Decimal(String(totals.netAmountDelta ?? 'NaN'));
    if (!before || !delta.isFinite()) continue;
    const after = before.plus(delta); runningNet.set(snapshot.currency, after);
    adjustmentWitnesses.push({ id: adjustment.id, currency: snapshot.currency, before: before.toFixed(12), delta: delta.toFixed(12), after: after.toFixed(12) });
  }
  issues.push(...validateDispatchLifecycleConservation({
    candidate: { status: waybill.candidate.status, dispositionAt: waybill.candidate.dispositionAt?.toISOString() ?? null, dispositionBy: waybill.candidate.dispositionBy },
    lifecycle: { requiresPrintHandoff: waybill.printHandoffs.some(item => item.status === 'SUCCEEDED'), hasPrintHandoff: waybill.printHandoffs.some(item => item.status === 'SUCCEEDED'), requiresGuardExit: waybill.status === 'EXIT_RECORDED', hasGuardExit: Boolean(waybill.physicalExit), requiredAdjustmentIds: posted.map(item => item.statementAdjustment?.id ?? `missing:${item.id}`), actualAdjustmentIds: posted.flatMap(item => item.statementAdjustment ? [item.statementAdjustment.id] : []) },
    quantityWitnesses: [
      ...revision.lines.map(line => ({ stage: 'ALLOCATION' as const, rowId: line.productRowId, unit: line.unit, value: line.quantity.toFixed(3) })),
      ...revision.pricedAllocationEvents.map(event => { const line = lineById.get(event.allocationRevisionLineId); return { stage: 'PRICED' as const, rowId: line?.productRowId ?? '', unit: line?.unit ?? '', value: event.quantity.toFixed(3) }; }),
      ...(primarySourceHash ? revision.pricedAllocationEvents.map(event => { const line = lineById.get(event.allocationRevisionLineId); return { stage: 'DOCUMENTED' as const, rowId: line?.productRowId ?? '', unit: line?.unit ?? '', value: event.quantity.toFixed(3) }; }) : []),
      ...(waybill.physicalExit ? revision.lines.map(line => ({ stage: 'EXIT' as const, rowId: line.productRowId, unit: line.unit, value: line.quantity.toFixed(3) })) : []),
    ],
    moneyWitnesses: [
      ...[...pricedMoney].map(([currency, value]) => ({ stage: 'PRICED' as const, currency, gross: value.gross.toFixed(12), discount: value.discount.toFixed(12), net: value.net.toFixed(12) })),
      ...(primarySourceHash ? [...pricedMoney].map(([currency, value]) => ({ stage: 'DOCUMENTED' as const, currency, gross: value.gross.toFixed(12), discount: value.discount.toFixed(12), net: value.net.toFixed(12) })) : []),
    ],
    adjustmentWitnesses,
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
    const payloads = rows.map(row => row.payload as Record<string, any>);
    const contains = (value: unknown, expectedValue: string): boolean => value === expectedValue || (Array.isArray(value) ? value.some(item => contains(item, expectedValue))
      : Boolean(value && typeof value === 'object' && Object.values(value as Record<string, unknown>).some(item => contains(item, expectedValue))));
    const linked = payloads.some(payload => contains(payload, expected.sourceHash)
      || (expected.aggregateType === 'ACCOUNTING_DISPATCH_CANDIDATE' && payload.allocationRevisionId === revision.id)
      || (expected.aggregateType === 'ACCOUNTING_DISPATCH_WAYBILL' && payload.candidateId === waybill.candidate.id)
      || (expected.aggregateType === 'GUARD_PHYSICAL_EXIT' && payload.waybillId === waybill.id)
      || (expected.aggregateType === 'DISPATCH_CORRECTION' && payload.waybillId === waybill.id && payload.integrityHash === expected.sourceHash));
    if (!linked) issues.push({ code: 'AUDIT_SOURCE_MISMATCH', subjectId: expected.aggregateId, detail: 'Parent audit does not bind the expected immutable source identity/hash.' });
    if (expected.aggregateType === 'ACCOUNTING_DISPATCH_WAYBILL') {
      const issued = rows.find(row => row.eventType === 'PRIMARY_BUNDLE_ISSUED'); const payload = issued?.payload as Record<string, any> | undefined;
      if (!issued || !payload?.correlationId || !payload?.idempotencyKey || payload?.sourceIntegrityHash !== primarySourceHash
        || !primaryArtifacts.every(artifact => Array.isArray(payload?.artifactIds) && payload.artifactIds.includes(artifact.id))) issues.push({ code: 'INCOMPLETE_AUDIT_METADATA', subjectId: waybill.id, detail: 'Primary issuance audit lacks source/artifact/correlation/idempotency binding.' });
      for (const handoff of waybill.printHandoffs) if (!rows.some(row => {
        const handoffPayload = row.payload as Record<string, any>; return row.eventType === 'PRINT_BYTES_HANDED_OFF' && handoffPayload.handoffId === handoff.id
          && handoffPayload.correlationId === handoff.correlationId && Boolean(handoffPayload.operationIdempotencyKey);
      })) issues.push({ code: 'AUDIT_SOURCE_MISMATCH', subjectId: handoff.id, detail: 'Print handoff is not bound by its waybill parent audit.' });
    }
    if (expected.aggregateType === 'LOGISTICS_ALLOCATION_REVISION') {
      const finalized = rows.find(row => contains(row.payload, revision.integrityHash));
      if (!finalized || revision.pricingReferences.some(reference => !contains(finalized.payload, reference.pricingVersionId))
        || revision.pricedAllocationEvents.some(event => !contains(finalized.payload, event.integrityHash))) issues.push({ code: 'AUDIT_SOURCE_MISMATCH', subjectId: revision.id, detail: 'Allocation parent audit does not bind every pricing version and priced-event hash.' });
    }
    if (expected.aggregateType === 'DISPATCH_CORRECTION') {
      const postedAudit = rows.find(row => row.eventType === 'CORRECTION_POSTED'); const payload = postedAudit?.payload as Record<string, any> | undefined;
      const adjustment = waybill.dispatchCorrections.find(item => item.id === expected.aggregateId)?.statementAdjustment;
      if (!postedAudit || payload?.reason !== waybill.dispatchCorrections.find(item => item.id === expected.aggregateId)?.reason
        || !payload?.effectiveAuthority || !payload?.workspace || (adjustment && (payload.statementAdjustmentId !== adjustment.id
          || payload.statementAdjustmentIntegrityHash !== adjustment.integrityHash || payload.statementAdjustmentArtifactId !== adjustment.artifact?.id))) issues.push({ code: 'INCOMPLETE_AUDIT_METADATA', subjectId: expected.aggregateId, detail: 'Correction audit lacks reason/authority or immutable adjustment/artifact binding.' });
    }
  }
  issues.push(...verifyProductionDispatchAuditChains(audits));
  return { status: issues.length ? 'UNRESOLVED_INCIDENT' as const : 'VERIFIED' as const, waybillId, issues, evidenceCount: expectedAggregates.length, auditCount: audits.length,
    reportHash: dispatchRecoveryIntegrityHash({ waybillId, expectedAggregates, auditHashes: audits.map(item => item.eventHash), issues }) };
};

export const createDispatchDocumentRecoveryOperations = (prisma: PrismaClient, filesystem: ReturnType<typeof createDispatchDocumentFilesystem>, truthVerifier: DispatchReplayTruthVerifier) => {
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
        const parsed = parsePersistedOrphanEvidence(row.payload, storageKey); if (parsed) return parsed;
      }
      return null;
    },
  };
  return {
    replay: async (command: { waybillId: string; actorId: string; correlationId: string; idempotencyKey: string; authority: DispatchRecoveryAuthority; now?: Date }) => {
      const report = await replayPersistedDispatchDocumentChain(prisma, command.waybillId, truthVerifier);
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
        await claimDispatchDocumentStorageKey(tx, command.storageKey);
        const rows = await tx.$queryRaw<Array<{ payload: unknown }>>`SELECT payload FROM dispatch_lifecycle_audits WHERE "aggregateType" = 'DISPATCH_DOCUMENT_RECOVERY' AND "eventType" = 'RECONCILIATION_COMPLETED' ORDER BY "recordedAt" DESC, id DESC FOR UPDATE`;
        const lockedRepository = { ...repository,
          isReferenced: async (storageKey: string) => Boolean(await tx.dispatchDocumentArtifact.findUnique({ where: { storageKey }, select: { id: true } })),
          readPersistedOrphanEvidence: async (storageKey: string) => {
          for (const row of rows) {
            const parsed = parsePersistedOrphanEvidence(row.payload, storageKey); if (parsed) return parsed;
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
