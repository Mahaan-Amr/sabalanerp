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
  type DispatchArtifactAuditEvent,
  type DispatchRecoveryAuthority,
  dispatchRecoveryIntegrityHash,
  validateDispatchLifecycleConservation,
} from './index';
import { createPrismaDispatchArtifactAuditPort } from './prisma';
import { approvedPricingVersionIntegrityHash } from '../approvedPricing/domain';
import { persistedApprovedPricingRowIntegrityMatches, persistedApprovedPricingVersionIntegrityMatches } from '../approvedPricing/prismaEvidence';
import { pricedAllocationIntegrityHash } from '../pricedAllocationLedger';
import { dispatchCorrectionIntegrityHash, dispatchLifecycleAuditEventHash } from '../dispatchCorrectionOutage';
import { guardPhysicalExitAuditIntegrityHash, guardPhysicalExitIntegrityHash } from '../physicalGateExit';
import { decryptRecoveryArchive, sha256File } from '../recoveryCrypto';
import { acquireDispatchArtifactStorageKeyLocks } from '../dispatchDocuments/artifactStorageLock';
import { dispatchDocumentLifecycleAuditEventHash } from '../dispatchDocuments/prismaRepository';
import { dispatchDocumentSourceIntegrityHash } from '../dispatchDocuments/prismaSourceReader';
import { readBoundPricedAllocation } from '../allocationPricingReadModel';
import { approvedPricingLifecycleAuditHash } from '../approvedPricing/prismaRepository';
import { dispatchAllocationLifecycleAuditHash } from '../dispatchAllocation';
import { shipmentQuantityEvidenceIntegrityHash } from '../shipmentQuantityProjectionStore';

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
  const restorePaths = (storageKey: string, runId = 'legacy') => {
    const destination = safePath(artifactRoot, storageKey); const directory = path.dirname(destination); const name = path.basename(destination);
    if (!/^[a-z0-9-]{1,64}$/.test(runId)) throw new Error('Restoration run identity is invalid.');
    return { destination, staged: path.join(directory, `.${name}.sabalan-restore-${runId}-stage`), previous: path.join(directory, `.${name}.sabalan-restore-${runId}-previous`), marker: path.join(directory, `.${name}.sabalan-restore-${runId}-marker`) };
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
    recoverInterruptedWrite: async (storageKey: string, completed: boolean, runId?: string) => {
      const targets = restorePaths(storageKey, runId); if (!fs.existsSync(targets.marker)) { await fs.promises.rm(targets.staged, { force: true }); return; }
      const state = JSON.parse(await fs.promises.readFile(targets.marker, 'utf8')) as { phase?: string; hadPrevious?: boolean };
      if (!completed && state.phase !== 'COMPLETED') {
        if (state.hadPrevious && fs.existsSync(targets.previous)) { const recovery = `${targets.staged}.rollback`; await fs.promises.copyFile(targets.previous, recovery); const handle = await fs.promises.open(recovery, 'r+'); try { await handle.sync(); } finally { await handle.close(); } await fs.promises.rename(recovery, targets.destination); }
        else if (!state.hadPrevious && (state.phase === 'SWAPPED' || state.phase === 'PRE_SWAP')
          && !fs.existsSync(targets.staged)) await fs.promises.rm(targets.destination, { force: true });
      }
      await Promise.all([targets.staged, targets.previous, targets.marker].map(target => fs.promises.rm(target, { force: true })));
    },
    stageOriginal: async (storageKey: string, bytes: Buffer, runId?: string) => {
      const targets = restorePaths(storageKey, runId); await fs.promises.mkdir(path.dirname(targets.destination), { recursive: true });
      await Promise.all([targets.staged, targets.previous, targets.marker].map(target => fs.promises.rm(target, { force: true })));
      await syncFile(targets.staged, bytes);
      const verified = await fs.promises.readFile(targets.staged); if (!verified.equals(bytes)) throw new Error('Staged original bytes failed verification.');
      const hadPrevious = fs.existsSync(targets.destination);
      if (hadPrevious) { await fs.promises.copyFile(targets.destination, targets.previous); const handle = await fs.promises.open(targets.previous, 'r+'); try { await handle.sync(); } finally { await handle.close(); } }
      await marker(targets.marker, { phase: 'STAGED', hadPrevious });
    },
    commitStagedOriginal: async (storageKey: string, runId?: string) => {
      const targets = restorePaths(storageKey, runId); const state = JSON.parse(await fs.promises.readFile(targets.marker, 'utf8')) as { hadPrevious: boolean };
      await marker(targets.marker, { phase: 'PRE_SWAP', hadPrevious: state.hadPrevious });
      await fs.promises.rename(targets.staged, targets.destination);
      await marker(targets.marker, { phase: 'SWAPPED', hadPrevious: state.hadPrevious });
      try { const directory = await fs.promises.open(path.dirname(targets.destination), 'r'); try { await directory.sync(); } finally { await directory.close(); } } catch { /* Windows may not fsync directory handles. */ }
    },
    markStagedOriginalCompleted: async (storageKey: string, runId?: string) => { const targets = restorePaths(storageKey, runId); const state = JSON.parse(await fs.promises.readFile(targets.marker, 'utf8')) as { hadPrevious: boolean }; await marker(targets.marker, { phase: 'COMPLETED', hadPrevious: state.hadPrevious }); },
    finalizeStagedOriginal: async (storageKey: string, runId?: string) => {
      const targets = restorePaths(storageKey, runId); await Promise.all([targets.staged, targets.previous, targets.marker].map(target => fs.promises.rm(target, { force: true })));
    },
    restorePrevious: async (storageKey: string, bytes: Buffer | null, runId?: string) => {
      const targets = restorePaths(storageKey, runId);
      if (bytes !== null) { const rollback = `${targets.staged}.rollback`; await syncFile(rollback, bytes); await fs.promises.rename(rollback, targets.destination); }
      else await fs.promises.rm(targets.destination, { force: true });
      await Promise.all([targets.staged, targets.previous, targets.marker].map(target => fs.promises.rm(target, { force: true })));
    },
    quarantine: (storageKey: string) => move(artifactRoot, quarantineRoot, storageKey),
    restoreQuarantined: (storageKey: string) => move(quarantineRoot, artifactRoot, storageKey),
    stageCleanup: (storageKey: string) => move(quarantineRoot, cleanupStagingRoot, storageKey),
    restoreStagedCleanup: (storageKey: string) => move(cleanupStagingRoot, quarantineRoot, storageKey),
    finalizeCleanup: (storageKey: string) => fs.promises.rm(safePath(cleanupStagingRoot, storageKey), { force: true }),
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

export const createDurableDispatchRecoveryAuditPort = (prisma: PrismaClient) => ({
  append: (event: Parameters<ReturnType<typeof createPrismaDispatchArtifactAuditPort>['append']>[0]) =>
    prisma.$transaction(tx => createPrismaDispatchArtifactAuditPort(tx).append(event), {
      // The advisory lock is the serialization primitive. READ COMMITTED takes the
      // predecessor snapshot after a contending writer releases that lock.
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    }).then(() => undefined),
  readCompletedRestoration: async (artifactId: string, idempotencyKey: string): Promise<DispatchArtifactAuditEvent | null> => {
    const row = await prisma.dispatchLifecycleAudit.findFirst({
      where: { aggregateType: 'DISPATCH_DOCUMENT_RECOVERY', aggregateId: artifactId, eventType: 'RESTORATION_COMPLETED',
        payload: { path: ['idempotencyKey'], equals: idempotencyKey } },
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }], select: { payload: true, actorId: true, recordedAt: true },
    });
    if (!row) return null;
    const payload = row.payload as Record<string, unknown>;
    return { ...(payload as Omit<DispatchArtifactAuditEvent, 'actorId' | 'occurredAt'>), actorId: row.actorId,
      occurredAt: row.recordedAt.toISOString() } as DispatchArtifactAuditEvent;
  },
  hasCompletedRestoration: async (artifactId: string, idempotencyKey: string) => Boolean(await prisma.dispatchLifecycleAudit.findFirst({
    where: { aggregateType: 'DISPATCH_DOCUMENT_RECOVERY', aggregateId: artifactId, eventType: 'RESTORATION_COMPLETED',
      payload: { path: ['idempotencyKey'], equals: idempotencyKey } }, select: { id: true },
  })),
  hasCompletedCleanup: async (storageKey: string, idempotencyKey: string) => Boolean(await prisma.dispatchLifecycleAudit.findFirst({
    where: { aggregateType: 'DISPATCH_DOCUMENT_RECOVERY', aggregateId: dispatchRecoveryIntegrityHash({ storageKey }), eventType: 'CLEANUP_COMPLETED',
      payload: { path: ['idempotencyKey'], equals: idempotencyKey } }, select: { id: true },
  })),
});

const metadata = async (prisma: PrismaClient) => (await prisma.dispatchDocumentArtifact.findMany({
  select: { id: true, waybillId: true, storageKey: true, byteLength: true, sha256: true, sourceIntegrityHash: true },
})).map(item => ({ ...item, byteLength: Number(item.byteLength) }));
const lockedMetadata = async (tx: Prisma.TransactionClient, artifactId: string) => {
  const item = await tx.dispatchDocumentArtifact.findUnique({ where: { id: artifactId },
    select: { id: true, waybillId: true, storageKey: true, byteLength: true, sha256: true, sourceIntegrityHash: true } });
  if (!item) throw new Error('Dispatch artifact does not exist.');
  await acquireDispatchArtifactStorageKeyLocks(tx, [item.storageKey]);
  return { ...item, byteLength: Number(item.byteLength) };
};

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
    const expectedHash = audit.aggregateType === 'DISPATCH_CORRECTION' || audit.aggregateType === 'MANUAL_OUTAGE_EXIT'
      ? dispatchLifecycleAuditEventHash({ aggregateType: audit.aggregateType, aggregateId: audit.aggregateId, eventType: audit.eventType, payload, actorId: audit.actorId, authority: payload.effectiveAuthority, at: audit.recordedAt, previousHash: audit.previousHash })
      : audit.aggregateType === 'APPROVED_PRICING_VERSION'
        ? approvedPricingLifecycleAuditHash({ aggregateType: 'APPROVED_PRICING_VERSION', aggregateId: audit.aggregateId,
          eventType: 'APPROVED_PRICING_VERSION_CREATED', payload, actorId: audit.actorId, recordedAt: audit.recordedAt, previousHash: audit.previousHash })
      : audit.aggregateType === 'PRICED_ALLOCATION_EVENT' || audit.aggregateType === 'LOGISTICS_ALLOCATION_REVISION' || audit.aggregateType === 'ACCOUNTING_DISPATCH_CANDIDATE'
        ? dispatchAllocationLifecycleAuditHash({ aggregateType: audit.aggregateType, aggregateId: audit.aggregateId,
          eventType: audit.eventType, payload, actorId: audit.actorId, recordedAt: audit.recordedAt, previousHash: audit.previousHash })
      : audit.aggregateType === 'GUARD_PHYSICAL_EXIT'
        ? guardPhysicalExitAuditIntegrityHash({ aggregateType: audit.aggregateType, aggregateId: audit.aggregateId, eventType: audit.eventType, payload, actorId: audit.actorId, at: audit.recordedAt, previousHash: audit.previousHash })
        : audit.aggregateType === 'ACCOUNTING_DISPATCH_WAYBILL'
          ? dispatchDocumentLifecycleAuditEventHash({ aggregateType: audit.aggregateType, aggregateId: audit.aggregateId, eventType: audit.eventType, payload, actorId: audit.actorId, at: audit.recordedAt, previousHash: audit.previousHash })
        : dispatchRecoveryIntegrityHash({ aggregateType: audit.aggregateType, aggregateId: audit.aggregateId, eventType: audit.eventType, payload, actorId: audit.actorId, recordedAt: audit.recordedAt.toISOString(), previousHash: audit.previousHash });
    if (audit.previousHash !== expectedPrevious || audit.eventHash !== expectedHash || !audit.actorId) issues.push({ code: 'AUDIT_CHAIN_BROKEN', subjectId: audit.aggregateId, detail: 'Lifecycle audit predecessor, writer-specific hash, or actor is invalid.' });
    previous.set(key, audit.eventHash);
  }
  return issues;
};

export type DispatchReplayTruthVerifier = { verifyPrimarySource(input: { allocationRevisionId: string; allocationIntegrityHash: string; expectedSourceIntegrityHash: string; pricingVersionIds: readonly string[]; pricedEventIntegrityHashes: readonly string[] }): Promise<boolean> };

export const validatePersistedDocumentTransition = (input: {
  waybill: { id: string; candidateId: string; integrityHash: string; replacesWaybillId: string | null; issuedAt: Date; issuedBy: string };
  predecessor?: { id: string; status: string; integrityHash: string; voidedAt: Date | null; voidedBy: string | null;
    voidReason: string | null; replacementWaybillId: string | null; physicalExit?: unknown; manualOutageExit?: unknown };
  primarySourceHash: string | null; primaryArtifactIds: readonly string[];
  command: { id: string; scope: string; scopeId: string; command: string; status: string; waybillId: string | null;
    actorId: string; correlationId: string; idempotencyKey: string; completedAt: Date | null } | undefined;
  audit: { eventType: string; payload: unknown; actorId: string; recordedAt: Date } | undefined;
}) => {
  const replacement = Boolean(input.waybill.replacesWaybillId);
  const expectedCommand = replacement ? 'REPLACE' : 'ACCEPT_AND_ISSUE'; const expectedScope = replacement ? 'WAYBILL' : 'CANDIDATE';
  const expectedScopeId = input.waybill.replacesWaybillId ?? input.waybill.candidateId;
  const command = input.command; const audit = input.audit; const payload = audit?.payload as Record<string, any> | undefined;
  if (!command || command.scope !== expectedScope || command.scopeId !== expectedScopeId || command.command !== expectedCommand
    || command.status !== 'SUCCEEDED' || command.waybillId !== input.waybill.id) return 'LEGACY_UNRECONCILED' as const;
  const invalidAudit = replacement
    ? audit?.eventType !== 'DOCUMENT_BUNDLE_REPLACED' || payload?.replacementWaybillId !== input.waybill.id || !payload?.reason
      || !validAccountingDispatchAuthority(payload?.authority)
      || input.predecessor?.status !== 'VOIDED' || input.predecessor?.replacementWaybillId !== input.waybill.id
      || Boolean(input.predecessor?.physicalExit) || Boolean(input.predecessor?.manualOutageExit)
      || input.predecessor?.voidedAt?.toISOString() !== input.waybill.issuedAt.toISOString() || input.predecessor?.voidedBy !== input.waybill.issuedBy
      || input.predecessor?.voidReason !== payload.reason || payload?.predecessorWaybillIntegrityHash !== input.predecessor?.integrityHash
      || payload?.replacementWaybillIntegrityHash !== input.waybill.integrityHash || payload?.primarySourceHash !== input.primarySourceHash
      || JSON.stringify(payload?.primaryArtifactIds) !== JSON.stringify(input.primaryArtifactIds)
      || payload?.before?.predecessorStatus !== 'ISSUED' || payload?.before?.successorId !== null
      || payload?.after?.predecessorStatus !== 'VOIDED' || payload?.after?.successorId !== input.waybill.id
    : audit?.eventType !== 'PRIMARY_BUNDLE_ISSUED' || payload?.sourceIntegrityHash !== input.primarySourceHash
      || !input.primaryArtifactIds.every(id => Array.isArray(payload?.artifactIds) && payload.artifactIds.includes(id));
  if (invalidAudit || !payload?.correlationId || !payload?.idempotencyKey || !command.actorId || !command.correlationId
    || !command.idempotencyKey || !command.completedAt || command.actorId !== input.waybill.issuedBy
    || command.completedAt.toISOString() !== input.waybill.issuedAt.toISOString() || audit?.actorId !== command.actorId
    || audit?.recordedAt.toISOString() !== input.waybill.issuedAt.toISOString() || payload.correlationId !== command.correlationId
    || payload.idempotencyKey !== command.idempotencyKey) return 'INCOMPLETE_AUDIT_METADATA' as const;
  return null;
};
export const validatesRetainedPrimaryPair = (artifacts: readonly { kind: string; sourceIntegrityHash: string; sha256: string }[], sourceHash: string | null) =>
  Boolean(sourceHash && artifacts.length === 2 && ['WAYBILL', 'STATEMENT'].every(kind => artifacts.filter(item => item.kind === kind).length === 1)
    && artifacts.every(item => item.sourceIntegrityHash === sourceHash && /^[a-f0-9]{64}$/.test(item.sha256)));
export const validAccountingDispatchAuthority = (value: unknown) => {
  const authority = value as Record<string, unknown> | undefined;
  return authority?.workspace === 'accounting' && authority?.feature === 'accounting_dispatch_candidates_manage'
    && Boolean(authority?.actorRole) && ['edit', 'admin'].includes(String(authority?.workspacePermission || '').toLowerCase())
    && ['edit', 'admin'].includes(String(authority?.featurePermission || '').toLowerCase());
};
const validGuardAdminAuthority = (value: unknown) => { const authority = value as Record<string, unknown> | undefined;
  return authority?.workspace === 'security' && String(authority?.workspacePermission || '').toLowerCase() === 'admin'
    && Boolean(authority?.actorRole); };
export const validatesManualOutageExitEvidence = (input: {
  waybill: { id: string; integrityHash: string };
  revision: { id: string; integrityHash: string; queueTurnId: string };
  exit: { id: string; paperNumber: string; outageId: string; waybillId: string; allocationRevisionId: string; queueTurnId: string;
    status: string; actualOccurredAt: Date; recordedAt: Date | null; recordedBy: string | null; accountingApprovedBy: string | null;
    guardApprovedBy: string | null; paperEvidence: unknown; snapshot: unknown; integrityHash: string | null };
  audit?: { eventType: string; actorId: string; recordedAt: Date; payload: unknown };
}) => {
  const { exit, waybill, revision, audit } = input; const snapshot = exit.snapshot as Record<string, any> | null;
  const payload = audit?.payload as Record<string, any> | undefined;
  return Boolean(snapshot && exit.status === 'REGISTERED' && exit.integrityHash && dispatchRecoveryIntegrityHash(snapshot) === exit.integrityHash
    && exit.waybillId === waybill.id && exit.allocationRevisionId === revision.id && exit.queueTurnId === revision.queueTurnId
    && snapshot.schemaVersion === 1 && snapshot.method === 'MANUAL_OUTAGE_EXIT' && snapshot.paperNumber === exit.paperNumber
    && snapshot.outageId === exit.outageId && snapshot.waybillId === waybill.id && snapshot.waybillIntegrityHash === waybill.integrityHash
    && snapshot.allocationRevisionId === revision.id && snapshot.allocationIntegrityHash === revision.integrityHash
    && snapshot.queueTurnId === revision.queueTurnId && snapshot.actualOccurredAt === exit.actualOccurredAt.toISOString()
    && snapshot.recordedAt === exit.recordedAt?.toISOString() && snapshot.accountingApprovedBy === exit.accountingApprovedBy
    && snapshot.guardApprovedBy === exit.guardApprovedBy && JSON.stringify(snapshot.paperEvidence) === JSON.stringify(exit.paperEvidence)
    && audit?.eventType === 'MANUAL_OUTAGE_EXIT_REGISTERED' && audit.actorId === exit.recordedBy
    && audit.recordedAt.toISOString() === exit.recordedAt?.toISOString() && payload?.paperNumber === exit.paperNumber
    && payload?.waybillId === waybill.id && payload?.actualOccurredAt === exit.actualOccurredAt.toISOString()
    && payload?.recordedAt === exit.recordedAt?.toISOString() && payload?.integrityHash === exit.integrityHash
    && payload?.before?.waybill === 'ISSUED' && payload?.before?.queueTurn === 'LOADING_FINALIZED'
    && payload?.after?.waybill === 'EXIT_RECORDED' && payload?.after?.queueTurn === 'EXIT_RECORDED'
    && validGuardAdminAuthority(payload?.effectiveAuthority));
};
export const validatesPersistedShipmentQuantityEvidence = (evidence: {
  id: string; contractId: string; contractItemId: string; productRowId: string; unit: string; kind: string; quantity: string;
  effectiveAt: string; recordedAt: string; sourceType: string; sourceId: string; sourceVersion: number; integrityHash: string;
  metadata: Record<string, unknown>; guardReturnMovementId?: string; returnEvidenceId?: string; dispatchEvidenceId?: string;
}, expected: {
  lineId: string; contractId: string; contractItemId: string; productRowId: string; unit: string; quantity: string;
  sourceType: string; sourceId: string; kind: string; effectiveAt: string; recordedAt: string; waybillId: string;
  allocationRevisionId: string;
}) => evidence.contractId === expected.contractId && evidence.contractItemId === expected.contractItemId
  && evidence.productRowId === expected.productRowId && evidence.unit === expected.unit && evidence.kind === expected.kind
  && evidence.quantity === expected.quantity && evidence.effectiveAt === expected.effectiveAt && evidence.recordedAt === expected.recordedAt
  && evidence.sourceType === expected.sourceType && evidence.sourceId === `${expected.sourceId}:${expected.lineId}`
  && evidence.sourceVersion === 1 && evidence.metadata.waybillId === expected.waybillId
  && evidence.metadata.allocationRevisionId === expected.allocationRevisionId
  && shipmentQuantityEvidenceIntegrityHash(evidence as never) === evidence.integrityHash;

export const requiresCurrentWaybillAudit = (waybill: { replacesWaybillId: string | null; printHandoffs: readonly unknown[] }) =>
  !waybill.replacesWaybillId || waybill.printHandoffs.length > 0;
const orderedPrimaryArtifacts = <T extends { kind: string; statementAdjustmentId?: string | null }>(artifacts: readonly T[]) =>
  artifacts.filter(item => !item.statementAdjustmentId && (item.kind === 'WAYBILL' || item.kind === 'STATEMENT'))
    .sort((left, right) => (left.kind === 'WAYBILL' ? 0 : 1) - (right.kind === 'WAYBILL' ? 0 : 1));
export const validatesReplacementEvidenceGeneration = (input: { successorId: string; linkedSuccessorId: string | null;
  successorProvenance: Record<string, any>; predecessorProvenance: Record<string, any>;
  predecessorArtifacts: readonly { kind: string; sourceIntegrityHash: string; sha256: string }[] }) =>
  input.linkedSuccessorId === input.successorId
  && input.predecessorProvenance.sourceIntegrityHash === input.successorProvenance.sourceIntegrityHash
  && input.predecessorProvenance.allocationIntegrityHash === input.successorProvenance.allocationIntegrityHash
  && JSON.stringify(input.predecessorProvenance.sourceVersionIdentities) === JSON.stringify(input.successorProvenance.sourceVersionIdentities)
  && validatesRetainedPrimaryPair(input.predecessorArtifacts, input.successorProvenance.sourceIntegrityHash);
export const validatesStaleSuccessorTransfer = (input: { predecessorStatus: string | null; auditMarksStaleTransfer: boolean;
  predecessorLines: readonly unknown[]; successorLines: readonly unknown[] }) => input.predecessorStatus === 'STALE_REQUIRES_SUCCESSOR'
  ? input.auditMarksStaleTransfer && JSON.stringify(input.predecessorLines) === JSON.stringify(input.successorLines)
  : !input.auditMarksStaleTransfer;
export const validatesPrintHandoffTransition = (input: {
  handoff: { id: string; status: string; idempotencyKey: string; correlationId: string; requestedBy: string;
    completedAt: Date | null; failureCode: string | null; requestedKinds: readonly string[];
    items: readonly { artifactId: string; ordinal: number }[] };
  audit?: { eventType: string; actorId: string; recordedAt: Date; payload: unknown };
  artifactKinds: ReadonlyMap<string, string>;
}) => {
  const { handoff, audit } = input; const payload = audit?.payload as Record<string, any> | undefined;
  const artifactIds = Array.isArray(payload?.artifactIds) ? payload.artifactIds as string[] : [];
  const common = Boolean(handoff.completedAt) && audit?.actorId === handoff.requestedBy
    && audit.recordedAt.toISOString() === handoff.completedAt?.toISOString()
    && payload?.handoffId === handoff.id && payload?.attemptId === handoff.idempotencyKey
    && payload?.correlationId === handoff.correlationId && typeof payload?.operationIdempotencyKey === 'string'
    && Boolean(payload.operationIdempotencyKey) && JSON.stringify(payload?.requestedKinds) === JSON.stringify(handoff.requestedKinds)
    && artifactIds.every(id => handoff.requestedKinds.includes(input.artifactKinds.get(id) ?? ''));
  if (!common) return false;
  if (handoff.status === 'SUCCEEDED') return audit?.eventType === 'PRINT_BYTES_HANDED_OFF' && payload?.failureCode === null
    && JSON.stringify(artifactIds) === JSON.stringify([...handoff.items].sort((a, b) => a.ordinal - b.ordinal).map(item => item.artifactId));
  return handoff.status === 'FAILED' && audit?.eventType === 'PRINT_BYTES_HANDOFF_FAILED' && Boolean(handoff.failureCode)
    && payload?.failureCode === handoff.failureCode && handoff.items.length === 0;
};
export const validatesStatementAdjustmentEvidence = (input: {
  waybillId: string;
  correction: { id: string; reason: string; integrityHash: string | null; postedAt: Date | null; postedBy: string | null;
    lines: readonly { id: string; contractId: string; contractItemId: string; productRowId: string; unit: string; quantity: { toFixed(scale: number): string } }[] };
  adjustment?: { id: string; waybillId: string; correctionId: string; sequence: number; integrityHash: string; issuedAt: Date; issuedBy: string;
    snapshot: unknown; artifact?: { id: string; waybillId: string; statementAdjustmentId: string | null; sourceIntegrityHash: string;
      publishedAt: Date; publishedBy: string } | null } | null;
  originalStatement?: { id: string; sourceIntegrityHash: string; sha256: string };
  pricingReferences: readonly { contractId: string; pricingVersionId: string; expectedPricingHash: string; readinessEvidenceHash: string;
    pricingVersion?: { rows: readonly { id: string; contractItemId: string; productRowId: string; unit: string; integrityHash: string }[] } }[];
  command?: { command: string; status: string; waybillId: string | null; actorId: string; completedAt: Date | null;
    correlationId: string; idempotencyKey: string };
  audit?: { actorId: string; recordedAt: Date; payload: unknown };
}) => {
  const { correction, adjustment, originalStatement, command, audit } = input;
  if (!adjustment || !adjustment.artifact || !originalStatement || !command || !audit || !correction.integrityHash) return false;
  const snapshot = adjustment.snapshot as Record<string, any>; const payload = audit.payload as Record<string, any>;
  const expectedPricing = [...input.pricingReferences].sort((a, b) => a.contractId.localeCompare(b.contractId)).map(reference => ({
    contractId: reference.contractId, pricingVersionId: reference.pricingVersionId, integrityHash: reference.expectedPricingHash,
    readinessEvidenceHash: reference.readinessEvidenceHash }));
  const correctionLines = new Map(correction.lines.map(line => [line.id, line])); const snapshotLines = Array.isArray(snapshot.lines) ? snapshot.lines : [];
  if (snapshotLines.length !== correction.lines.length || new Set(snapshotLines.map((line: any) => line.correctionLineId)).size !== correction.lines.length
    || snapshotLines.some((line: any) => { const source = correctionLines.get(line.correctionLineId); return !source
      || line.contractId !== source.contractId || line.contractItemId !== source.contractItemId || line.productRowId !== source.productRowId
      || line.unit !== source.unit || line.quantityDelta !== source.quantity.toFixed(3); })) return false;
  if (snapshotLines.some((line: any) => {
    const reference = input.pricingReferences.find(item => item.contractId === line.contractId && item.pricingVersionId === line.pricingVersionId);
    const pricingRow = reference?.pricingVersion?.rows.find(row => row.id === line.pricingRowId);
    const evidence = line.evidence as Record<string, unknown> | undefined;
    return !reference || !pricingRow || pricingRow.contractItemId !== line.contractItemId
      || pricingRow.productRowId !== line.productRowId || pricingRow.unit !== line.unit
      || evidence?.pricingIntegrityHash !== reference.expectedPricingHash
      || evidence?.pricingRowIntegrityHash !== pricingRow.integrityHash
      || evidence?.readinessEvidenceHash !== reference.readinessEvidenceHash
      || !Number.isSafeInteger(line.ledgerSequence) || line.ledgerSequence < 1 || evidence?.ledgerSequence !== line.ledgerSequence
      || line.afterQuantity !== evidence?.afterQuantity;
  })) return false;
  try {
    const sums = snapshotLines.reduce((total: Prisma.Decimal[], line: any) => [total[0].plus(line.grossAmountDelta),
      total[1].plus(line.discountDelta), total[2].plus(line.netAmountDelta)], [new Prisma.Decimal(0), new Prisma.Decimal(0), new Prisma.Decimal(0)]);
    if (snapshotLines.some((line: any) => !new Prisma.Decimal(line.grossAmountDelta).minus(line.discountDelta).equals(line.netAmountDelta))
      || sums[0].toFixed(12) !== snapshot.totals?.grossAmountDelta || sums[1].toFixed(12) !== snapshot.totals?.discountDelta
      || sums[2].toFixed(12) !== snapshot.totals?.netAmountDelta) return false;
  } catch { return false; }
  return snapshot.schemaVersion === 1 && snapshot.adjustmentId === adjustment.id && adjustment.waybillId === input.waybillId
    && snapshot.waybillId === input.waybillId && adjustment.correctionId === correction.id && snapshot.correctionId === correction.id
    && snapshot.sequence === adjustment.sequence && snapshot.reason === correction.reason
    && snapshot.correctionIntegrityHash === correction.integrityHash && snapshot.originalStatementDocumentId === originalStatement.id
    && snapshot.originalStatementSourceIntegrityHash === originalStatement.sourceIntegrityHash && snapshot.originalStatementSha256 === originalStatement.sha256
    && JSON.stringify(snapshot.pricingVersions) === JSON.stringify(expectedPricing) && snapshot.issuedAt === adjustment.issuedAt.toISOString()
    && snapshot.issuedBy === adjustment.issuedBy && adjustment.issuedAt.toISOString() === correction.postedAt?.toISOString()
    && adjustment.issuedBy === correction.postedBy && pricedAllocationIntegrityHash(snapshot) === adjustment.integrityHash
    && adjustment.artifact.waybillId === input.waybillId && adjustment.artifact.statementAdjustmentId === adjustment.id
    && adjustment.artifact.sourceIntegrityHash === adjustment.integrityHash && adjustment.artifact.publishedBy === adjustment.issuedBy
    && adjustment.artifact.publishedAt.toISOString() === adjustment.issuedAt.toISOString()
    && command.command === 'ISSUE_ADJUSTMENT' && command.status === 'SUCCEEDED'
    && command.waybillId === input.waybillId && command.actorId === adjustment.issuedBy
    && command.completedAt?.toISOString() === adjustment.issuedAt.toISOString() && audit.actorId === adjustment.issuedBy
    && audit.recordedAt.toISOString() === adjustment.issuedAt.toISOString() && payload.correlationId === command.correlationId
    && payload.idempotencyKey === command.idempotencyKey && payload.statementAdjustmentId === adjustment.id
    && payload.statementAdjustmentSequence === adjustment.sequence && payload.statementAdjustmentIntegrityHash === adjustment.integrityHash
    && payload.statementAdjustmentArtifactId === adjustment.artifact.id
    && payload.statementAdjustmentArtifactSourceIntegrityHash === adjustment.artifact.sourceIntegrityHash;
};
export const validatesAdjustmentLedgerContinuity = (input: {
  baseEvents: readonly { pricingRowId: string; quantity: { toFixed(scale: number): string };
    grossAmount: { toFixed(scale: number): string }; discountAmount: { toFixed(scale: number): string }; evidence: unknown }[];
  adjustments: readonly { sequence: number; snapshot: unknown }[];
}) => {
  const state = new Map<string, { sequence: number; quantity: string; gross: string; discount: string }>();
  try {
    for (const event of [...input.baseEvents].sort((a, b) => a.pricingRowId.localeCompare(b.pricingRowId)
      || Number((a.evidence as Record<string, unknown>).ledgerSequence) - Number((b.evidence as Record<string, unknown>).ledgerSequence))) {
      const evidence = event.evidence as Record<string, unknown>; const prior = state.get(event.pricingRowId);
      const ledgerSequence = Number(evidence.ledgerSequence);
      if (!Number.isSafeInteger(ledgerSequence) || ledgerSequence !== (prior?.sequence ?? 0) + 1
        || (prior && (evidence.beforeQuantity !== prior.quantity || evidence.beforeGross !== prior.gross || evidence.beforeDiscount !== prior.discount))) return false;
      state.set(event.pricingRowId, { sequence: ledgerSequence, quantity: String(evidence.afterQuantity),
        gross: String(evidence.afterGross), discount: String(evidence.afterDiscount) });
    }
    let expectedAdjustmentSequence = 1;
    for (const adjustment of [...input.adjustments].sort((a, b) => a.sequence - b.sequence)) {
      if (adjustment.sequence !== expectedAdjustmentSequence++) return false;
      const snapshot = adjustment.snapshot as Record<string, any>;
      for (const line of Array.isArray(snapshot.lines) ? snapshot.lines : []) {
        const evidence = line.evidence as Record<string, unknown>; const prior = state.get(line.pricingRowId);
        if (!prior || line.ledgerSequence !== prior.sequence + 1 || evidence.ledgerSequence !== line.ledgerSequence
          || evidence.beforeQuantity !== prior.quantity || evidence.beforeGross !== prior.gross || evidence.beforeDiscount !== prior.discount
          || line.afterQuantity !== evidence.afterQuantity
          || new Prisma.Decimal(String(evidence.afterQuantity)).minus(String(evidence.beforeQuantity)).toFixed(3) !== line.quantityDelta
          || new Prisma.Decimal(String(evidence.afterGross)).minus(String(evidence.beforeGross)).toFixed(12) !== line.grossAmountDelta
          || new Prisma.Decimal(String(evidence.afterDiscount)).minus(String(evidence.beforeDiscount)).toFixed(12) !== line.discountDelta) return false;
        state.set(line.pricingRowId, { sequence: line.ledgerSequence, quantity: String(evidence.afterQuantity),
          gross: String(evidence.afterGross), discount: String(evidence.afterDiscount) });
      }
    }
    return true;
  } catch { return false; }
};
export const validatesTerminalVoidTransition = (input: {
  waybill: { id: string; integrityHash: string; voidedAt: Date | null; voidedBy: string | null; voidReason: string | null;
    physicalExit?: unknown; manualOutageExit?: unknown };
  command?: { scope: string; scopeId: string; command: string; status: string; waybillId: string | null; actorId: string;
    correlationId: string; idempotencyKey: string; completedAt: Date | null };
  audit?: { eventType: string; actorId: string; recordedAt: Date; payload: unknown };
}) => {
  const { waybill, command, audit } = input; const payload = audit?.payload as Record<string, any> | undefined;
  return Boolean(command && audit && command.scope === 'WAYBILL' && command.scopeId === waybill.id && command.command === 'VOID'
    && command.status === 'SUCCEEDED' && command.waybillId === waybill.id && command.actorId === waybill.voidedBy
    && command.completedAt?.toISOString() === waybill.voidedAt?.toISOString() && audit.eventType === 'DOCUMENT_BUNDLE_VOIDED'
    && audit.actorId === waybill.voidedBy && audit.recordedAt.toISOString() === waybill.voidedAt?.toISOString()
    && !waybill.physicalExit && !waybill.manualOutageExit && payload?.reason === waybill.voidReason
    && validAccountingDispatchAuthority(payload?.authority) && payload?.correlationId === command.correlationId
    && payload?.idempotencyKey === command.idempotencyKey && payload?.waybillIntegrityHash === waybill.integrityHash
    && payload?.before?.status === 'ISSUED' && payload?.after?.status === 'VOIDED');
};
export const isTerminalVoidWaybill = (waybill: { status: string; replacementWaybill?: { id: string } | null; replacesWaybillId?: string | null }) =>
  waybill.status === 'VOIDED' && !waybill.replacementWaybill;

export const createPrismaDispatchReplayTruthVerifier = (prisma: PrismaClient): DispatchReplayTruthVerifier => ({
  verifyPrimarySource: input => prisma.$transaction(async tx => {
    const revision = await tx.logisticsAllocationRevision.findUnique({ where: { id: input.allocationRevisionId }, include: {
      pricingReferences: { include: { pricingVersion: { include: { rows: { orderBy: { ordinal: 'asc' } } } } } }, pricedAllocationEvents: true,
      candidate: { include: { waybills: { include: { documentArtifacts: true } } } },
    } });
    if (!revision || revision.integrityHash !== input.allocationIntegrityHash) return false;
    const versionIds = revision.pricingReferences.map(item => item.pricingVersionId).sort(); const eventHashes = revision.pricedAllocationEvents.map(item => item.integrityHash).sort();
    if (JSON.stringify(versionIds) !== JSON.stringify([...input.pricingVersionIds].sort()) || JSON.stringify(eventHashes) !== JSON.stringify([...input.pricedEventIntegrityHashes].sort())) return false;
    for (const reference of revision.pricingReferences) {
      const version = reference.pricingVersion;
      if (reference.expectedPricingHash !== version.integrityHash
        || version.rows.some(row => !persistedApprovedPricingRowIntegrityMatches(version, row))
        || !persistedApprovedPricingVersionIntegrityMatches(version)) return false;
    }
    for (const event of revision.pricedAllocationEvents) if (pricedAllocationIntegrityHash({ allocationRevisionId: event.allocationRevisionId,
      allocationRevisionLineId: event.allocationRevisionLineId, pricingVersionId: event.pricingVersionId, pricingRowId: event.pricingRowId,
      quantity: event.quantity.toFixed(3), grossAmount: event.grossAmount.toFixed(12), discountAmount: event.discountAmount.toFixed(12), netAmount: event.netAmount.toFixed(12),
      consumesFinalRemainder: event.consumesFinalRemainder, evidence: event.evidence, recordedBy: event.recordedBy }) !== event.integrityHash) return false;
    let pricedAllocation;
    try { pricedAllocation = await readBoundPricedAllocation(tx, revision.id); } catch { return false; }
    const actualSourceHash = dispatchDocumentSourceIntegrityHash({ allocationRevisionId: revision.id,
      allocationIntegrityHash: revision.integrityHash, pricedAllocation });
    if (actualSourceHash !== input.expectedSourceIntegrityHash) return false;
    return Boolean(revision.candidate?.waybills.some(waybill => {
      const provenance = (waybill.snapshot as Record<string, any>)?.documentProvenance as Record<string, any> | undefined;
      const primary = waybill.documentArtifacts.filter(artifact => !artifact.statementAdjustmentId && (artifact.kind === 'WAYBILL' || artifact.kind === 'STATEMENT'));
      return provenance?.sourceIntegrityHash === input.expectedSourceIntegrityHash && provenance?.allocationRevisionId === revision.id
        && provenance?.allocationIntegrityHash === revision.integrityHash && primary.length === 2
        && primary.every(artifact => artifact.sourceIntegrityHash === input.expectedSourceIntegrityHash);
    }));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
});

export const replayPersistedDispatchDocumentChain = async (prisma: PrismaClient, waybillId: string, truthVerifier: DispatchReplayTruthVerifier) => {
  const waybill = await prisma.accountingDispatchWaybill.findUnique({ where: { id: waybillId }, include: {
    candidate: { include: { allocationRevision: { include: {
      lines: true,
      pricingReferences: { include: { pricingVersion: { include: { rows: { orderBy: { ordinal: 'asc' } } } } } },
      pricedAllocationEvents: true,
      predecessorRevision: { include: { lines: true, candidate: true } },
    } } } },
    documentArtifacts: true,
    replacesWaybill: { include: { replacementWaybill: { select: { id: true } }, documentArtifacts: true,
      physicalExit: true, manualOutageExit: true } },
    replacementWaybill: { select: { id: true } },
    printHandoffs: { include: { items: true } },
    physicalExit: true,
    manualOutageExit: true,
    dispatchCorrections: { include: { lines: true, statementAdjustment: { include: { artifact: true } } } },
  } });
  if (!waybill) throw new Error('Dispatch waybill does not exist.');
  const issues: Array<{ code: string; subjectId: string; detail: string }> = [];
  const revision = waybill.candidate.allocationRevision;
  if (waybill.physicalExit && waybill.manualOutageExit) issues.push({ code: 'BROKEN_EVIDENCE_LINK', subjectId: waybill.id,
    detail: 'Physical and manual-outage exit evidence are mutually exclusive.' });
  const exitSource = waybill.physicalExit ? { type: 'GUARD_PHYSICAL_EXIT', id: waybill.physicalExit.id, kind: 'PHYSICAL_EXIT',
    effectiveAt: waybill.physicalExit.occurredAt, recordedAt: waybill.physicalExit.recordedAt }
    : waybill.manualOutageExit ? { type: 'MANUAL_OUTAGE_EXIT', id: waybill.manualOutageExit.id, kind: 'MANUAL_OUTAGE_EXIT',
      effectiveAt: waybill.manualOutageExit.actualOccurredAt, recordedAt: waybill.manualOutageExit.recordedAt } : null;
  const exitQuantityRows = exitSource ? await prisma.shipmentQuantityEvidence.findMany({ where: {
    sourceType: exitSource.type, sourceId: { startsWith: `${exitSource.id}:` },
  }, orderBy: [{ contractId: 'asc' }, { contractItemId: 'asc' }, { productRowId: 'asc' }, { id: 'asc' }] }) : [];
  const exitQuantityWitnesses: Array<{ stage: 'EXIT'; contractId: string; contractItemId: string; productRowId: string; unit: string; value: string }> = [];
  if (exitSource) for (const line of revision.lines) {
    const matches = exitQuantityRows.filter(row => row.contractId === line.sourceContractId && row.contractItemId === line.sourceContractItemId
      && row.productRowId === line.productRowId && row.unit === line.unit);
    const row = matches[0]; const metadata = row?.metadata as Record<string, unknown> | undefined;
    const normalized = row ? { id: row.id, contractId: row.contractId, contractItemId: row.contractItemId,
      productRowId: row.productRowId, unit: row.unit, kind: row.kind, quantity: row.quantity.toFixed(3),
      effectiveAt: row.effectiveAt.toISOString(), recordedAt: row.recordedAt.toISOString(), sourceType: row.sourceType,
      sourceId: row.sourceId, sourceVersion: row.sourceVersion, integrityHash: row.integrityHash, metadata: metadata ?? {},
      guardReturnMovementId: row.guardReturnMovementId ?? undefined, returnEvidenceId: row.returnEvidenceId ?? undefined,
      dispatchEvidenceId: row.dispatchEvidenceId ?? undefined } : null;
    const valid = matches.length === 1 && normalized && validatesPersistedShipmentQuantityEvidence(normalized, {
      lineId: line.id, contractId: line.sourceContractId, contractItemId: line.sourceContractItemId,
      productRowId: line.productRowId, unit: line.unit, quantity: line.quantity.toFixed(3), sourceType: exitSource.type,
      sourceId: exitSource.id, kind: exitSource.kind, effectiveAt: exitSource.effectiveAt.toISOString(),
      recordedAt: exitSource.recordedAt?.toISOString() ?? '', waybillId: waybill.id, allocationRevisionId: revision.id,
    });
    if (!valid) issues.push({ code: 'QUANTITY_CONSERVATION_MISMATCH', subjectId: line.id,
      detail: 'Persisted exit quantity evidence is missing, duplicated, tampered, or does not bind the full stable row identity at scale three.' });
    else exitQuantityWitnesses.push({ stage: 'EXIT', contractId: row.contractId, contractItemId: row.contractItemId,
      productRowId: row.productRowId, unit: row.unit, value: row.quantity.toFixed(3) });
  }
  if (exitQuantityRows.length !== revision.lines.length) issues.push({ code: 'QUANTITY_CONSERVATION_MISMATCH', subjectId: waybill.id,
    detail: 'Exit quantity evidence cardinality differs from finalized allocation rows.' });
  if (waybill.candidate.status !== 'ACCEPTED' || !waybill.candidate.dispositionAt || !waybill.candidate.dispositionBy) issues.push({ code: 'BROKEN_EVIDENCE_LINK', subjectId: waybill.candidate.id, detail: 'Issued documents require an accepted candidate disposition with actor/time.' });
  if (!revision.finalizedAt || !revision.finalizedBy) issues.push({ code: 'INCOMPLETE_AUDIT_METADATA', subjectId: revision.id, detail: 'Allocation finalization actor/time is missing.' });
  if (dispatchRecoveryIntegrityHash(revision.snapshot) !== revision.integrityHash) issues.push({ code: 'INTEGRITY_HASH_MISMATCH', subjectId: revision.id, detail: 'Allocation snapshot hash changed.' });
  const expectedWaybillHash = waybill.replacesWaybillId
    ? dispatchRecoveryIntegrityHash({ ...(waybill.snapshot as Record<string, unknown>), replacementId: waybill.id })
    : dispatchRecoveryIntegrityHash(waybill.snapshot);
  if (expectedWaybillHash !== waybill.integrityHash) issues.push({ code: 'INTEGRITY_HASH_MISMATCH', subjectId: waybill.id, detail: 'Waybill snapshot hash changed.' });
  for (const reference of revision.pricingReferences) {
    const version = reference.pricingVersion;
    const recomputed = approvedPricingVersionIntegrityHash({
      id: version.id, contractId: version.contractId, versionNumber: version.versionNumber,
      sourceFinancialRecordId: version.sourceFinancialRecordId, approvedAt: version.approvedAt, approvedBy: version.approvedBy,
      schemaVersion: version.schemaVersion, currency: version.currency, grossAmount: version.grossAmount.toFixed(12),
      discountAmount: version.discountAmount.toFixed(12), netAmount: version.netAmount.toFixed(12),
      sourceEvidence: version.sourceEvidence as Record<string, unknown>, rowHashes: version.rows.map(row => row.integrityHash),
    });
    if (!version.approvedAt || !version.approvedBy) issues.push({ code: 'INCOMPLETE_AUDIT_METADATA', subjectId: version.id, detail: 'Approved-pricing approval actor/time is missing.' });
    if (version.rows.some(row => !persistedApprovedPricingRowIntegrityMatches(version, row))
      || recomputed !== version.integrityHash || reference.expectedPricingHash !== version.integrityHash) issues.push({ code: 'INTEGRITY_HASH_MISMATCH', subjectId: version.id, detail: 'Approved-pricing row/root binding or immutable hash changed.' });
  }
  const lineById = new Map(revision.lines.map(line => [line.id, line]));
  for (const event of revision.pricedAllocationEvents) {
    const payload = { allocationRevisionId: event.allocationRevisionId, allocationRevisionLineId: event.allocationRevisionLineId,
      pricingVersionId: event.pricingVersionId, pricingRowId: event.pricingRowId, quantity: event.quantity.toFixed(3),
      grossAmount: event.grossAmount.toFixed(12), discountAmount: event.discountAmount.toFixed(12), netAmount: event.netAmount.toFixed(12),
      consumesFinalRemainder: event.consumesFinalRemainder, evidence: event.evidence, recordedBy: event.recordedBy };
    const line = lineById.get(event.allocationRevisionLineId);
    if (!event.recordedAt || !event.recordedBy) issues.push({ code: 'INCOMPLETE_AUDIT_METADATA', subjectId: event.id, detail: 'Priced allocation actor/time is missing.' });
    const eventEvidence = event.evidence as Record<string, any>;
    const pricingVersion = revision.pricingReferences.find(reference => reference.pricingVersionId === event.pricingVersionId)?.pricingVersion;
    const pricingRow = pricingVersion?.rows.find(row => row.id === event.pricingRowId);
    if (!pricingVersion || !pricingRow || eventEvidence?.pricingIntegrityHash !== pricingVersion.integrityHash
      || eventEvidence?.pricingRowIntegrityHash !== pricingRow.integrityHash
      || eventEvidence?.readinessEvidenceHash !== revision.pricingReferences.find(reference => reference.pricingVersionId === event.pricingVersionId)?.readinessEvidenceHash) {
      issues.push({ code: 'AUDIT_SOURCE_MISMATCH', subjectId: event.id, detail: 'Priced-event decision evidence does not bind approved pricing, row, and readiness hashes.' });
    }
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
  const primaryArtifacts = orderedPrimaryArtifacts(waybill.documentArtifacts);
  const primarySourceHash = typeof provenance?.sourceIntegrityHash === 'string' ? provenance.sourceIntegrityHash : null;
  if (waybill.replacesWaybill) {
    const predecessorProvenance = ((waybill.replacesWaybill.snapshot as Record<string, any>)?.documentProvenance ?? {}) as Record<string, any>;
    const predecessorPrimary = waybill.replacesWaybill.documentArtifacts.filter(item => !item.statementAdjustmentId
      && (item.kind === 'WAYBILL' || item.kind === 'STATEMENT'));
    if (predecessorProvenance.sourceIntegrityHash !== primarySourceHash
      || predecessorProvenance.allocationIntegrityHash !== provenance?.allocationIntegrityHash
      || JSON.stringify(predecessorProvenance.sourceVersionIdentities) !== JSON.stringify(provenance?.sourceVersionIdentities)
      || !validatesRetainedPrimaryPair(predecessorPrimary, primarySourceHash)
      || waybill.replacesWaybill.replacementWaybill?.id !== waybill.id) issues.push({ code: 'BROKEN_EVIDENCE_LINK', subjectId: waybill.id,
        detail: 'Replacement and predecessor do not share one immutable source/snapshot identity or exactly-one successor.' });
  }
  const seenReplacementIds = new Set<string>([waybill.id]);
  const replacementChainAudits: any[] = [];
  let replacementSuccessor: any = waybill;
  let replacementPredecessor: any = waybill.replacesWaybill;
  while (replacementPredecessor) {
    if (seenReplacementIds.has(replacementPredecessor.id)) {
      issues.push({ code: 'BROKEN_EVIDENCE_LINK', subjectId: replacementPredecessor.id, detail: 'Replacement chain contains a cycle.' });
      break;
    }
    seenReplacementIds.add(replacementPredecessor.id);
    const successorProvenance = ((replacementSuccessor.snapshot as Record<string, any>)?.documentProvenance ?? {}) as Record<string, any>;
    const predecessorProvenance = ((replacementPredecessor.snapshot as Record<string, any>)?.documentProvenance ?? {}) as Record<string, any>;
    const predecessorPrimary = replacementPredecessor.documentArtifacts.filter((item: any) => !item.statementAdjustmentId
      && (item.kind === 'WAYBILL' || item.kind === 'STATEMENT'));
    const [replacementCommand, predecessorAudits] = await Promise.all([
      prisma.dispatchDocumentCommandResult.findFirst({ where: { scope: 'WAYBILL', scopeId: replacementPredecessor.id,
        command: 'REPLACE', status: 'SUCCEEDED', waybillId: replacementSuccessor.id }, orderBy: [{ completedAt: 'desc' }, { id: 'desc' }] }),
      prisma.dispatchLifecycleAudit.findMany({ where: { aggregateType: 'ACCOUNTING_DISPATCH_WAYBILL', aggregateId: replacementPredecessor.id },
        orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }] }),
    ]);
    const replacementAudit = [...predecessorAudits].reverse().find(item => item.eventType === 'DOCUMENT_BUNDLE_REPLACED');
    const transitionIssue = validatePersistedDocumentTransition({ waybill: { id: replacementSuccessor.id,
      candidateId: replacementSuccessor.candidateId, integrityHash: replacementSuccessor.integrityHash,
      replacesWaybillId: replacementSuccessor.replacesWaybillId, issuedAt: replacementSuccessor.issuedAt, issuedBy: replacementSuccessor.issuedBy },
      predecessor: { id: replacementPredecessor.id, status: replacementPredecessor.status, integrityHash: replacementPredecessor.integrityHash,
        voidedAt: replacementPredecessor.voidedAt, voidedBy: replacementPredecessor.voidedBy, voidReason: replacementPredecessor.voidReason,
        replacementWaybillId: replacementPredecessor.replacementWaybill?.id ?? null, physicalExit: replacementPredecessor.physicalExit,
        manualOutageExit: replacementPredecessor.manualOutageExit },
      primarySourceHash: successorProvenance.sourceIntegrityHash,
      primaryArtifactIds: orderedPrimaryArtifacts(replacementSuccessor.documentArtifacts).map((item: any) => item.id),
      command: replacementCommand ?? undefined, audit: replacementAudit ?? undefined });
    replacementChainAudits.push(...predecessorAudits);
    if (!validatesReplacementEvidenceGeneration({ successorId: replacementSuccessor.id,
      linkedSuccessorId: replacementPredecessor.replacementWaybill?.id ?? null, successorProvenance, predecessorProvenance,
      predecessorArtifacts: predecessorPrimary }) || transitionIssue) {
      issues.push({ code: transitionIssue ?? 'BROKEN_EVIDENCE_LINK', subjectId: replacementPredecessor.id,
        detail: 'A replacement generation lacks retained artifacts, immutable provenance, or its exact predecessor transition.' });
    }
    replacementSuccessor = replacementPredecessor;
    replacementPredecessor = replacementPredecessor.replacesWaybillId
      ? await prisma.accountingDispatchWaybill.findUnique({ where: { id: replacementPredecessor.replacesWaybillId },
        include: { documentArtifacts: true, replacementWaybill: { select: { id: true } }, physicalExit: true, manualOutageExit: true } }) : null;
  }
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
  if (!validatesAdjustmentLedgerContinuity({ baseEvents: revision.pricedAllocationEvents,
    adjustments: posted.flatMap(item => item.statementAdjustment ? [{ sequence: item.statementAdjustment.sequence,
      snapshot: item.statementAdjustment.snapshot }] : []) })) issues.push({ code: 'MONEY_CONSERVATION_MISMATCH', subjectId: waybill.id,
      detail: 'Statement-adjustment ledger sequence or before/after pricing evidence does not continue the immutable priced allocation ledger.' });
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
    lifecycle: { requiresPrintHandoff: waybill.printHandoffs.some(item => item.status === 'SUCCEEDED'), hasPrintHandoff: waybill.printHandoffs.some(item => item.status === 'SUCCEEDED'), requiresGuardExit: waybill.status === 'EXIT_RECORDED',
      hasGuardExit: Boolean(waybill.physicalExit || waybill.manualOutageExit), requiredAdjustmentIds: posted.map(item => item.statementAdjustment?.id ?? `missing:${item.id}`), actualAdjustmentIds: posted.flatMap(item => item.statementAdjustment ? [item.statementAdjustment.id] : []) },
    quantityWitnesses: [
      ...revision.lines.map(line => ({ stage: 'ALLOCATION' as const, contractId: line.sourceContractId, contractItemId: line.sourceContractItemId,
        productRowId: line.productRowId, unit: line.unit, value: line.quantity.toFixed(3) })),
      ...revision.pricedAllocationEvents.map(event => { const line = lineById.get(event.allocationRevisionLineId); return { stage: 'PRICED' as const,
        contractId: line?.sourceContractId ?? '', contractItemId: line?.sourceContractItemId ?? '', productRowId: line?.productRowId ?? '', unit: line?.unit ?? '', value: event.quantity.toFixed(3) }; }),
      ...(primarySourceHash ? revision.pricedAllocationEvents.map(event => { const line = lineById.get(event.allocationRevisionLineId); return { stage: 'DOCUMENTED' as const,
        contractId: line?.sourceContractId ?? '', contractItemId: line?.sourceContractItemId ?? '', productRowId: line?.productRowId ?? '', unit: line?.unit ?? '', value: event.quantity.toFixed(3) }; }) : []),
      ...exitQuantityWitnesses,
    ],
    moneyWitnesses: [
      ...[...pricedMoney].map(([currency, value]) => ({ stage: 'PRICED' as const, currency, gross: value.gross.toFixed(12), discount: value.discount.toFixed(12), net: value.net.toFixed(12) })),
      ...(primarySourceHash ? [...pricedMoney].map(([currency, value]) => ({ stage: 'DOCUMENTED' as const, currency, gross: value.gross.toFixed(12), discount: value.discount.toFixed(12), net: value.net.toFixed(12) })) : []),
    ],
    adjustmentWitnesses,
  }));
  const expectedAggregates: Array<{ aggregateType: string; aggregateId: string; sourceHash: string; role?: 'CURRENT' | 'PREDECESSOR_TRANSITION'; optional?: boolean }> = [
    { aggregateType: 'LOGISTICS_ALLOCATION_REVISION', aggregateId: revision.id, sourceHash: revision.integrityHash },
    { aggregateType: 'ACCOUNTING_DISPATCH_CANDIDATE', aggregateId: waybill.candidate.id, sourceHash: revision.integrityHash },
    ...(waybill.replacesWaybillId ? [{ aggregateType: 'ACCOUNTING_DISPATCH_WAYBILL', aggregateId: waybill.replacesWaybillId,
      sourceHash: waybill.integrityHash, role: 'PREDECESSOR_TRANSITION' as const }] : []),
    { aggregateType: 'ACCOUNTING_DISPATCH_WAYBILL', aggregateId: waybill.id, sourceHash: waybill.integrityHash,
      role: 'CURRENT', optional: !requiresCurrentWaybillAudit(waybill) },
    ...revision.pricingReferences.map(reference => ({ aggregateType: 'APPROVED_PRICING_VERSION', aggregateId: reference.pricingVersionId, sourceHash: reference.expectedPricingHash })),
    ...revision.pricedAllocationEvents.map(event => ({ aggregateType: 'PRICED_ALLOCATION_EVENT', aggregateId: event.id, sourceHash: event.integrityHash })),
    ...(waybill.physicalExit ? [{ aggregateType: 'GUARD_PHYSICAL_EXIT', aggregateId: waybill.physicalExit.id, sourceHash: waybill.physicalExit.integrityHash }] : []),
    ...(waybill.manualOutageExit ? [{ aggregateType: 'MANUAL_OUTAGE_EXIT', aggregateId: waybill.manualOutageExit.id,
      sourceHash: waybill.manualOutageExit.integrityHash ?? '' }] : []),
    ...waybill.dispatchCorrections.filter(item => item.status === 'POSTED').map(item => ({ aggregateType: 'DISPATCH_CORRECTION', aggregateId: item.id, sourceHash: item.integrityHash! })),
  ];
  const audits = await prisma.dispatchLifecycleAudit.findMany({ where: { OR: expectedAggregates.map(item => ({ aggregateType: item.aggregateType, aggregateId: item.aggregateId })) }, orderBy: [{ aggregateType: 'asc' }, { aggregateId: 'asc' }, { recordedAt: 'asc' }, { id: 'asc' }] });
  const commands = await prisma.dispatchDocumentCommandResult.findMany({ where: { OR: [
    { scope: 'CANDIDATE', scopeId: waybill.candidate.id }, { waybillId: waybill.id },
  ] }, orderBy: [{ startedAt: 'asc' }, { id: 'asc' }] });
  const issuanceCommand = waybill.replacesWaybillId
    ? commands.find(command => command.scope === 'WAYBILL' && command.scopeId === waybill.replacesWaybillId
      && command.command === 'REPLACE' && command.status === 'SUCCEEDED' && command.waybillId === waybill.id)
    : commands.find(command => command.scope === 'CANDIDATE' && command.scopeId === waybill.candidate.id
      && command.command === 'ACCEPT_AND_ISSUE' && command.status === 'SUCCEEDED' && command.waybillId === waybill.id);
  const terminalWaybillAudits = isTerminalVoidWaybill(waybill) && waybill.replacesWaybillId
    ? await prisma.dispatchLifecycleAudit.findMany({ where: { aggregateType: 'ACCOUNTING_DISPATCH_WAYBILL', aggregateId: waybill.id },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }] }) : [];
  if (isTerminalVoidWaybill(waybill)) {
    const voidCommand = commands.find(command => command.scope === 'WAYBILL' && command.scopeId === waybill.id
      && command.command === 'VOID' && command.status === 'SUCCEEDED' && command.waybillId === waybill.id);
    const currentRows = [...audits, ...terminalWaybillAudits].filter(row => row.aggregateType === 'ACCOUNTING_DISPATCH_WAYBILL'
      && row.aggregateId === waybill.id);
    const voidAudit = [...currentRows].reverse().find(row => row.eventType === 'DOCUMENT_BUNDLE_VOIDED');
    if (!validatesTerminalVoidTransition({ waybill, command: voidCommand, audit: voidAudit })) issues.push({ code: voidAudit ? 'INCOMPLETE_AUDIT_METADATA' : 'LEGACY_UNRECONCILED',
      subjectId: waybill.id, detail: 'Terminal void lacks exact command/audit/state metadata or conflicts with physical/manual exit.' });
  }
  for (const expected of expectedAggregates) {
    const rows = audits.filter(audit => audit.aggregateType === expected.aggregateType && audit.aggregateId === expected.aggregateId);
    if (!rows.length) { if (expected.optional) continue; const legacy = expected.aggregateType === 'APPROVED_PRICING_VERSION' || expected.aggregateType === 'PRICED_ALLOCATION_EVENT';
      issues.push({ code: legacy ? 'LEGACY_UNRECONCILED' : 'MISSING_EVIDENCE', subjectId: expected.aggregateId,
        detail: `No writer-owned ${expected.aggregateType} audit binds actor/time/reason/correlation/idempotency/source/before-after evidence.` }); continue; }
    const payloads = rows.map(row => row.payload as Record<string, any>);
    const contains = (value: unknown, expectedValue: string): boolean => value === expectedValue || (Array.isArray(value) ? value.some(item => contains(item, expectedValue))
      : Boolean(value && typeof value === 'object' && Object.values(value as Record<string, unknown>).some(item => contains(item, expectedValue))));
    const linked = payloads.some(payload => contains(payload, expected.sourceHash)
      || (expected.aggregateType === 'ACCOUNTING_DISPATCH_CANDIDATE' && payload.allocationRevisionId === revision.id)
      || (expected.aggregateType === 'ACCOUNTING_DISPATCH_WAYBILL' && expected.role === 'CURRENT')
      || (expected.aggregateType === 'ACCOUNTING_DISPATCH_WAYBILL' && expected.role === 'PREDECESSOR_TRANSITION' && payload.replacementWaybillId === waybill.id)
      || (expected.aggregateType === 'GUARD_PHYSICAL_EXIT' && payload.waybillId === waybill.id)
      || (expected.aggregateType === 'MANUAL_OUTAGE_EXIT' && payload.waybillId === waybill.id)
      || (expected.aggregateType === 'DISPATCH_CORRECTION' && payload.waybillId === waybill.id && payload.integrityHash === expected.sourceHash));
    if (!linked) issues.push({ code: 'AUDIT_SOURCE_MISMATCH', subjectId: expected.aggregateId, detail: 'Parent audit does not bind the expected immutable source identity/hash.' });
    if (expected.aggregateType === 'ACCOUNTING_DISPATCH_WAYBILL') {
      if (expected.role === 'PREDECESSOR_TRANSITION' || !waybill.replacesWaybillId) {
        const issued = rows.find(row => row.eventType === (waybill.replacesWaybillId ? 'DOCUMENT_BUNDLE_REPLACED' : 'PRIMARY_BUNDLE_ISSUED'));
        const transitionIssue = validatePersistedDocumentTransition({ waybill: { id: waybill.id, candidateId: waybill.candidate.id,
        integrityHash: waybill.integrityHash, replacesWaybillId: waybill.replacesWaybillId, issuedAt: waybill.issuedAt, issuedBy: waybill.issuedBy },
        predecessor: waybill.replacesWaybill ? { id: waybill.replacesWaybill.id, status: waybill.replacesWaybill.status,
          integrityHash: waybill.replacesWaybill.integrityHash, voidedAt: waybill.replacesWaybill.voidedAt,
          voidedBy: waybill.replacesWaybill.voidedBy, voidReason: waybill.replacesWaybill.voidReason,
          replacementWaybillId: waybill.replacesWaybill.replacementWaybill?.id ?? null, physicalExit: waybill.replacesWaybill.physicalExit,
          manualOutageExit: waybill.replacesWaybill.manualOutageExit } : undefined,
        primarySourceHash, primaryArtifactIds: primaryArtifacts.map(artifact => artifact.id), command: issuanceCommand, audit: issued });
        if (transitionIssue) issues.push({ code: transitionIssue, subjectId: waybill.id,
          detail: 'Document transition lacks exact source/replacement/actor/time/reason/correlation/idempotency binding.' });
      }
      if (expected.role === 'CURRENT') for (const handoff of waybill.printHandoffs) {
        const handoffAudit = rows.find(row => (row.payload as Record<string, any>)?.handoffId === handoff.id);
        if (!validatesPrintHandoffTransition({ handoff, audit: handoffAudit,
          artifactKinds: new Map(waybill.documentArtifacts.map(item => [item.id, item.kind])) })) {
          issues.push({ code: 'AUDIT_SOURCE_MISMATCH', subjectId: handoff.id,
            detail: 'Print handoff status, actor/time, failure reason, identity, or ordered artifacts differ from its parent audit.' });
        }
      }
    }
    if (expected.aggregateType === 'LOGISTICS_ALLOCATION_REVISION') {
      const finalized = rows.find(row => contains(row.payload, revision.integrityHash));
      if (!finalized || revision.pricingReferences.some(reference => !contains(finalized.payload, reference.pricingVersionId))
        || revision.pricedAllocationEvents.some(event => !contains(finalized.payload, event.integrityHash))) issues.push({ code: 'AUDIT_SOURCE_MISMATCH', subjectId: revision.id, detail: 'Allocation parent audit does not bind every pricing version and priced-event hash.' });
      if (revision.predecessorRevisionId) {
        const successorAudit = rows.find(row => row.eventType === 'SUCCESSOR_ALLOCATION_FINALIZED'); const successorPayload = successorAudit?.payload as Record<string, any> | undefined;
        const snapshot = revision.snapshot as Record<string, any>; const predecessor = revision.predecessorRevision;
        const stableLines = (lines: typeof revision.lines) => lines.map(line => [line.sourceContractId, line.sourceContractItemId,
          line.productRowId, line.unit, line.quantity.toFixed(3)]).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
        if (!predecessor || snapshot?.predecessorRevisionId !== predecessor.id || !successorAudit
          || successorPayload?.predecessorRevisionId !== predecessor.id || successorAudit.actorId !== revision.finalizedBy
          || successorAudit.recordedAt.toISOString() !== revision.finalizedAt.toISOString()
          || !validatesStaleSuccessorTransfer({ predecessorStatus: predecessor.candidate?.status ?? null,
            auditMarksStaleTransfer: successorPayload?.stalePricingTransfer === true,
            predecessorLines: stableLines(predecessor.lines), successorLines: stableLines(revision.lines) })) {
          issues.push({ code: 'BROKEN_EVIDENCE_LINK', subjectId: revision.id,
            detail: 'Successor snapshot/audit does not prove predecessor identity and exact stale reservation transfer.' });
        }
      }
    }
    if (expected.aggregateType === 'ACCOUNTING_DISPATCH_CANDIDATE') {
      const created = rows.find(row => row.eventType === 'CANDIDATE_CREATED'); const payload = created?.payload as Record<string, any> | undefined;
      if (!created || payload?.allocationRevisionId !== revision.id || created.actorId !== revision.finalizedBy
        || created.recordedAt.toISOString() !== revision.finalizedAt.toISOString()) issues.push({ code: 'INCOMPLETE_AUDIT_METADATA', subjectId: waybill.candidate.id,
          detail: 'Candidate creation audit does not bind allocation finalization actor/time.' });
      const accepted = rows.find(row => row.eventType === 'CANDIDATE_ACCEPTED_FOR_ISSUANCE'); const acceptance = accepted?.payload as Record<string, any> | undefined;
      const acceptanceAuthority = acceptance?.authority as Record<string, unknown> | undefined;
      if (!accepted || !issuanceCommand || accepted.actorId !== waybill.candidate.dispositionBy
        || accepted.recordedAt.toISOString() !== waybill.candidate.dispositionAt?.toISOString()
        || !acceptance?.reason || !validAccountingDispatchAuthority(acceptanceAuthority)
        || acceptance?.correlationId !== issuanceCommand.correlationId
        || acceptance?.idempotencyKey !== issuanceCommand.idempotencyKey || acceptance?.before?.status !== 'PENDING'
        || acceptance?.after?.status !== 'ACCEPTED' || acceptance?.after?.waybillId !== waybill.id
        || acceptance?.allocationRevisionId !== revision.id || acceptance?.allocationIntegrityHash !== revision.integrityHash
        || acceptance?.primarySourceHash !== primarySourceHash
        || JSON.stringify(acceptance?.primaryArtifactIds) !== JSON.stringify(primaryArtifacts.map(item => item.id))) {
        issues.push({ code: accepted ? 'INCOMPLETE_AUDIT_METADATA' : 'LEGACY_UNRECONCILED', subjectId: waybill.candidate.id,
          detail: 'Accounting acceptance lacks exact decision/command/authority/source/before-after evidence.' });
      }
    }
    if (expected.aggregateType === 'APPROVED_PRICING_VERSION') {
      const version = revision.pricingReferences.find(reference => reference.pricingVersionId === expected.aggregateId)?.pricingVersion;
      const created = rows.find(row => row.eventType === 'APPROVED_PRICING_VERSION_CREATED'); const payload = created?.payload as Record<string, any> | undefined;
      const pricingAuthority = payload?.effectiveAuthority as Record<string, unknown> | undefined;
      if (!version || !created || created.actorId !== version.approvedBy || created.recordedAt.toISOString() !== version.approvedAt.toISOString()
        || !payload?.reason || !payload?.correlationId || !payload?.idempotencyKey || pricingAuthority?.workspace !== 'accounting'
        || pricingAuthority?.feature !== 'accounting_actions_manage'
        || !['edit', 'admin'].includes(String(pricingAuthority?.workspacePermission || '').toLowerCase())
        || !['edit', 'admin'].includes(String(pricingAuthority?.featurePermission || '').toLowerCase())
        || payload?.sourceFinancialRecordId !== version.sourceFinancialRecordId || payload?.contractId !== version.contractId
        || payload?.versionIntegrityHash !== version.integrityHash
        || JSON.stringify(payload?.rowIntegrityHashes) !== JSON.stringify(version.rows.map(row => row.integrityHash))
        || payload?.after?.currentVersionId !== version.id || !payload?.before || !payload?.after) {
        issues.push({ code: 'INCOMPLETE_AUDIT_METADATA', subjectId: expected.aggregateId,
          detail: 'Approved-pricing audit lacks exact approval actor/time/reason/correlation/idempotency/authority/source/before-after binding.' });
      }
    }
    if (expected.aggregateType === 'PRICED_ALLOCATION_EVENT') {
      const event = revision.pricedAllocationEvents.find(item => item.id === expected.aggregateId);
      const recorded = rows.find(row => row.eventType === 'PRICED_ALLOCATION_RECORDED'); const payload = recorded?.payload as Record<string, any> | undefined;
      if (!event || !recorded || recorded.actorId !== event.recordedBy || recorded.recordedAt.toISOString() !== event.recordedAt.toISOString()
        || !payload?.reason || !payload?.correlationId || !payload?.idempotencyKey || !payload?.effectiveAuthority
        || payload?.allocationRevisionId !== revision.id || payload?.allocationIntegrityHash !== revision.integrityHash
        || payload?.pricingVersionId !== event.pricingVersionId || payload?.pricingRowId !== event.pricingRowId
        || payload?.pricedEventIntegrityHash !== event.integrityHash || payload?.before?.state !== 'UNPRICED' || payload?.after?.state !== 'PRICED') {
        issues.push({ code: 'INCOMPLETE_AUDIT_METADATA', subjectId: expected.aggregateId,
          detail: 'Priced-allocation audit lacks exact actor/time/reason/correlation/idempotency/authority/source/before-after binding.' });
      }
    }
    if (expected.aggregateType === 'DISPATCH_CORRECTION') {
      const postedAudit = rows.find(row => row.eventType === 'CORRECTION_POSTED'); const payload = postedAudit?.payload as Record<string, any> | undefined;
      const correction = waybill.dispatchCorrections.find(item => item.id === expected.aggregateId); const adjustment = correction?.statementAdjustment;
      const correctionCommand = commands.find(command => command.scope === 'CORRECTION' && command.scopeId === expected.aggregateId
        && command.command === 'ISSUE_ADJUSTMENT' && command.status === 'SUCCEEDED' && command.waybillId === waybill.id);
      if (!postedAudit || payload?.reason !== waybill.dispatchCorrections.find(item => item.id === expected.aggregateId)?.reason
        || !payload?.effectiveAuthority || !payload?.workspace || !payload?.beforeStatus || !payload?.afterStatus
        || !payload?.effectiveAt || !payload?.recordedAt || !correctionCommand || !correctionCommand.correlationId || !correctionCommand.idempotencyKey
        || correctionCommand.actorId !== correction?.postedBy || correctionCommand.completedAt?.toISOString() !== correction?.postedAt?.toISOString()
        || postedAudit.actorId !== correction?.postedBy || postedAudit.recordedAt.toISOString() !== correction?.postedAt?.toISOString()
        || (adjustment && (payload.statementAdjustmentId !== adjustment.id
          || payload.statementAdjustmentIntegrityHash !== adjustment.integrityHash || payload.statementAdjustmentArtifactId !== adjustment.artifact?.id))) issues.push({ code: 'INCOMPLETE_AUDIT_METADATA', subjectId: expected.aggregateId, detail: 'Correction audit lacks reason/authority or immutable adjustment/artifact binding.' });
      if (!validatesStatementAdjustmentEvidence({ waybillId: waybill.id, correction: correction!, adjustment,
        originalStatement: primaryArtifacts.find(item => item.kind === 'STATEMENT'), pricingReferences: revision.pricingReferences,
        command: correctionCommand, audit: postedAudit })) issues.push({ code: 'BROKEN_EVIDENCE_LINK', subjectId: adjustment?.id ?? expected.aggregateId,
        detail: 'Statement adjustment does not exactly bind correction rows, pricing versions, original statement, signed totals, artifact, actor/time, and command/audit identity.' });
    }
    if (expected.aggregateType === 'GUARD_PHYSICAL_EXIT') {
      const exitAudit = rows.find(row => row.eventType === 'PHYSICAL_EXIT_RECORDED'); const payload = exitAudit?.payload as Record<string, any> | undefined;
      const exitAuthority = payload?.effectiveAuthority as Record<string, unknown> | undefined;
      if (!exitAudit || payload?.waybillId !== waybill.id || payload?.allocationRevisionId !== revision.id
        || exitAuthority?.workspace !== 'security' || exitAuthority?.workspacePermission !== 'EDIT' || !exitAuthority?.actorRole
        || payload?.workspace !== 'security' || !payload?.sessionId || !payload?.correlationId
        || payload?.reasonCode !== 'GUARD_PHYSICAL_EXIT_CONFIRMED' || !payload?.idempotencyKey || !payload?.effectiveAt || !payload?.before || !payload?.after
        || payload?.waybillIntegrityHash !== waybill.integrityHash || payload?.allocationIntegrityHash !== revision.integrityHash
        || payload?.before?.authorization !== 'ACTIVE' || payload?.before?.waybill !== 'ISSUED'
        || payload?.after?.authorization !== 'CONSUMED' || payload?.after?.waybill !== 'EXIT_RECORDED'
        || exitAudit.actorId !== waybill.physicalExit?.recordedBy
        || exitAudit.recordedAt.toISOString() !== waybill.physicalExit?.recordedAt.toISOString()) {
        issues.push({ code: 'INCOMPLETE_AUDIT_METADATA', subjectId: expected.aggregateId,
          detail: 'Guard exit audit lacks exact actor/time/authority/session/correlation/source/before-after binding.' });
      }
    }
    if (expected.aggregateType === 'MANUAL_OUTAGE_EXIT') {
      const registered = rows.find(row => row.eventType === 'MANUAL_OUTAGE_EXIT_REGISTERED');
      if (!waybill.manualOutageExit || !validatesManualOutageExitEvidence({ waybill, revision,
        exit: waybill.manualOutageExit, audit: registered })) issues.push({ code: 'INCOMPLETE_AUDIT_METADATA', subjectId: expected.aggregateId,
        detail: 'Manual outage exit lacks exact immutable snapshot/hash, dual approvals, actor/time, Guard authority, or before/after audit binding.' });
    }
  }
  const replayAudits = [...audits,
    ...replacementChainAudits.filter(candidate => !audits.some(item => item.id === candidate.id)),
    ...terminalWaybillAudits.filter(candidate => !audits.some(item => item.id === candidate.id)
      && !replacementChainAudits.some(item => item.id === candidate.id))];
  issues.push(...verifyProductionDispatchAuditChains(replayAudits));
  return { status: issues.length ? 'UNRESOLVED_INCIDENT' as const : 'VERIFIED' as const, waybillId, issues, evidenceCount: expectedAggregates.length, auditCount: replayAudits.length,
    reportHash: dispatchRecoveryIntegrityHash({ waybillId, expectedAggregates, auditHashes: replayAudits.map(item => item.eventHash), issues }) };
};

export const createDispatchDocumentRecoveryOperations = (prisma: PrismaClient, filesystem: ReturnType<typeof createDispatchDocumentFilesystem>, truthVerifier: DispatchReplayTruthVerifier) => {
  const audit = createDurableDispatchRecoveryAuditPort(prisma);
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
      return prisma.$transaction(async tx => restoreDispatchDocumentArtifact({ ...command,
        metadata: await lockedMetadata(tx, command.artifactId), storage: filesystem, audit }),
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 120_000 });
    },
    restoreFromRecoveryPackage: async (command: { artifactId: string; recoveryPackagePath: string; passphrase: string; actorId: string; reason: string; correlationId: string; idempotencyKey: string; authority: DispatchRecoveryAuthority; now?: Date }) => {
      return prisma.$transaction(async tx => restoreDispatchDocumentArtifact({ ...command,
        metadata: await lockedMetadata(tx, command.artifactId),
        encryptedBackup: createEncryptedRecoveryPackageReader({ sourcePath: command.recoveryPackagePath, passphrase: command.passphrase }),
        storage: filesystem, audit }),
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 120_000 });
    },
    quarantine: (command: { storageKey: string; actorId: string; reason: string; correlationId: string; idempotencyKey: string; authority: DispatchRecoveryAuthority; now?: Date }) =>
      prisma.$transaction(async tx => {
        await acquireDispatchArtifactStorageKeyLocks(tx, [command.storageKey]);
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
      prisma.$transaction(async tx => {
        await acquireDispatchArtifactStorageKeyLocks(tx, [command.storageKey]);
        const aggregateId = dispatchRecoveryIntegrityHash({ storageKey: command.storageKey });
        const lockedRepository = {
          isReferenced: async (storageKey: string) => Boolean(await tx.dispatchDocumentArtifact.findUnique({ where: { storageKey }, select: { id: true } })),
          readQuarantineEvidence: async () => {
            const row = await tx.dispatchLifecycleAudit.findFirst({ where: { aggregateType: 'DISPATCH_DOCUMENT_RECOVERY', aggregateId,
              eventType: 'QUARANTINE_COMPLETED' }, orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }], select: { payload: true } });
            const detail = ((row?.payload as Record<string, any> | undefined)?.detail ?? {}) as Record<string, unknown>;
            return typeof detail.quarantinedAt === 'string' && typeof detail.reconciliationReportHash === 'string'
              ? { quarantinedAt: detail.quarantinedAt, reconciliationReportHash: detail.reconciliationReportHash } : null;
          },
        };
        return cleanupQuarantinedDispatchDocumentOrphan({ ...command, repository: lockedRepository, storage: filesystem, audit });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 120_000 }),
  };
};

export const dispatchDocumentRecoveryOperationInternals = { safePath, regularFiles };
