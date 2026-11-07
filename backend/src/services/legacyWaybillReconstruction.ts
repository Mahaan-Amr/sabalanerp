import { Prisma, type PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { renderDispatchDocumentPdf } from '../documents/dispatch/dispatchDocumentPdf';
import { PrismaDispatchDocumentSourceReader, allocationPricingIntegrityVerifier } from './dispatchDocuments/prismaSourceReader';
import { loadShipmentStatementRuntimeStateUnderLock } from './dispatchDocuments/runtimeState';
import { isPostCutoverFinalization } from './dispatchDocuments/featureGate';
import { dispatchDocumentLifecycleAuditEventHash } from './dispatchDocuments/prismaRepository';
import { isRetryableDispatchTransactionError } from './dispatchAllocation';
import { dispatchRecoveryIntegrityHash } from './dispatchDocumentAuditRecovery';

export class LegacyWaybillReconstructionError extends Error {}
const hashBytes = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const validLegacySnapshot = (waybill: { snapshot: Prisma.JsonValue; integrityHash: string; number: bigint;
  candidate: { allocationRevisionId: string; allocationRevision: { integrityHash: string } } }) => {
  const snapshot = waybill.snapshot && typeof waybill.snapshot === 'object' && !Array.isArray(waybill.snapshot) ? waybill.snapshot : {};
  return dispatchRecoveryIntegrityHash(snapshot) === waybill.integrityHash && snapshot.allocationRevisionId === waybill.candidate.allocationRevisionId &&
    snapshot.allocationIntegrityHash === waybill.candidate.allocationRevision.integrityHash && snapshot.number === waybill.number.toString();
};
const appendLegacyAudit = async (tx: Prisma.TransactionClient, input: { waybillId: string; actorId: string; eventType: string; payload: Prisma.InputJsonValue }) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`LEGACY_WAYBILL_RECONSTRUCTION:${input.waybillId}`}))`;
  const aggregateType = 'LEGACY_WAYBILL_RECONSTRUCTION', aggregateId = input.waybillId, at = new Date();
  const previous = await tx.dispatchLifecycleAudit.findFirst({ where: { aggregateType, aggregateId },
    orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }] });
  const previousHash = previous?.eventHash ?? null;
  await tx.dispatchLifecycleAudit.create({ data: { aggregateType, aggregateId, eventType: input.eventType, actorId: input.actorId,
    recordedAt: at, payload: input.payload, previousHash, eventHash: dispatchDocumentLifecycleAuditEventHash({ aggregateType,
      aggregateId, eventType: input.eventType, actorId: input.actorId, at, payload: input.payload, previousHash }) } });
};

/** Reconstruction is separate from original artifacts and never creates a
 * customer shipment statement or rewrites the original waybill. */
export async function reconstructLegacyWaybill(db: PrismaClient, input: {
  waybillId: string; actorId: string; reason: string;
}, render = renderDispatchDocumentPdf) {
  const reason = input.reason?.trim();
  if (!reason || reason.length < 3 || reason.length > 2000) throw new LegacyWaybillReconstructionError('دلیل بازسازی بارنامه را وارد کنید.');
  const waybill = await db.accountingDispatchWaybill.findUnique({ where: { id: input.waybillId }, include: {
    candidate: { include: { allocationRevision: true } }, documentArtifacts: { where: { kind: 'WAYBILL' } }, legacyReconstruction: true,
  } });
  if (!waybill || waybill.candidate.status !== 'ACCEPTED' || !waybill.candidate.allocationRevision.sealedAt || !['ISSUED', 'EXIT_RECORDED'].includes(waybill.status) ||
      waybill.candidate.allocationRevision.sourceKind !== 'SALES_CONTRACT' || !validLegacySnapshot(waybill)) {
    throw new LegacyWaybillReconstructionError('بارنامه قدیمی معتبر برای بازسازی پیدا نشد.');
  }
  if (waybill.documentArtifacts.length) throw new LegacyWaybillReconstructionError('فایل اصلی بارنامه موجود است؛ نیازی به بازسازی نیست.');
  const reader = new PrismaDispatchDocumentSourceReader(db, 'dispatch-documents-v1', 'chromium-pdf-v1');
  const source = await reader.readPrimaryBundle({ candidateId: waybill.candidateId, waybill: {
    waybillId: waybill.id, waybillDocumentId: randomUUID(), statementDocumentId: randomUUID(),
    number: waybill.number.toString(), issuedAt: waybill.issuedAt.toISOString(),
  } });
  const rendered = await render({ ...source.waybill, reconstructionLabel: 'LEGACY_RECONSTRUCTED' });
  if (!rendered.bytes.length || rendered.bytes.length > 20 * 1024 * 1024) throw new LegacyWaybillReconstructionError('فایل بارنامه بازسازی‌شده معتبر نیست.');
  const commit = () => db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`LEGACY_WAYBILL_RECONSTRUCTION:${waybill.id}`}))`;
    const gate = await loadShipmentStatementRuntimeStateUnderLock(tx);
    if (!gate) throw new LegacyWaybillReconstructionError('وضعیت گذار اسناد قابل بررسی نیست.');
    const current = await tx.accountingDispatchWaybill.findUnique({ where: { id: waybill.id }, include: {
      candidate: { include: { allocationRevision: true } }, documentArtifacts: { where: { kind: 'WAYBILL' } }, legacyReconstruction: true,
    } });
    if (!current || current.candidate.status !== 'ACCEPTED' || !current.candidate.allocationRevision.sealedAt || !['ISSUED', 'EXIT_RECORDED'].includes(current.status) ||
        current.integrityHash !== waybill.integrityHash || !validLegacySnapshot(current) || current.candidate.allocationRevisionId !== source.allocationRevisionId ||
        current.candidate.allocationRevision.sourceKind !== 'SALES_CONTRACT' ||
        (gate?.cutoverAt && isPostCutoverFinalization(current.candidate.allocationRevision.finalizedAt, gate.cutoverAt))) {
      throw new LegacyWaybillReconstructionError('وضعیت بارنامه یا مرز اسناد تغییر کرده است؛ دوباره بررسی کنید.');
    }
    if (current.documentArtifacts.length) throw new LegacyWaybillReconstructionError('فایل اصلی بارنامه اکنون موجود است.');
    const latest = await tx.logisticsAllocationRevision.findFirst({ where: { loadingId: current.candidate.allocationRevision.loadingId,
      queueTurnId: current.candidate.allocationRevision.queueTurnId }, orderBy: { revisionNumber: 'desc' }, select: { id: true } });
    if (latest?.id !== source.allocationRevisionId) throw new LegacyWaybillReconstructionError('تخصیص جدیدتری برای راننده ثبت شده است.');
    const freshness = await allocationPricingIntegrityVerifier.assess({ transaction: tx, allocationRevisionId: source.allocationRevisionId,
      expectedSourceIntegrityHash: source.sourceIntegrityHash });
    if (freshness.status !== 'CURRENT') throw new LegacyWaybillReconstructionError('شواهد قیمت بارگیری به بررسی نیاز دارند.');
    if (current.legacyReconstruction) {
      const prior = current.legacyReconstruction;
      if (prior.waybillIntegrityHash !== current.integrityHash || prior.sourceIntegrityHash !== source.sourceIntegrityHash ||
          hashBytes(prior.pdf) !== prior.pdfSha256) throw new LegacyWaybillReconstructionError('نسخه بازسازی‌شده موجود نیاز به بررسی دارد.');
      return { id: prior.id, reused: true };
    }
    const at = new Date(), id = randomUUID(), pdfSha256 = hashBytes(rendered.bytes);
    await tx.legacyWaybillReconstruction.create({ data: { id, waybillId: waybill.id, allocationRevisionId: source.allocationRevisionId,
      sourceIntegrityHash: source.sourceIntegrityHash, waybillIntegrityHash: current.integrityHash, pdfSha256,
      pdf: rendered.bytes, createdAt: at, createdBy: input.actorId, reason } });
    const payload = { reconstructionId: id, allocationRevisionId: source.allocationRevisionId, sourceIntegrityHash: source.sourceIntegrityHash,
      waybillIntegrityHash: current.integrityHash, pdfSha256, reason };
    await appendLegacyAudit(tx, { waybillId: waybill.id, actorId: input.actorId, eventType: 'RECONSTRUCTED', payload });
    return { id, reused: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60000 });
  for (let attempt = 0; ; attempt++) {
    try { return await commit(); }
    catch (error) {
      const target = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.target : null;
      const duplicateWaybill = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' &&
        (Array.isArray(target) ? target.includes('waybillId') : typeof target === 'string' && target.includes('waybillId'));
      if (attempt >= 2 || (!duplicateWaybill && !isRetryableDispatchTransactionError(error))) throw error;
    }
  }
}

export async function readLegacyWaybillReconstruction(db: PrismaClient, waybillId: string) {
  return db.$transaction(async tx => {
    const gate = await loadShipmentStatementRuntimeStateUnderLock(tx);
    if (!gate) throw new LegacyWaybillReconstructionError('وضعیت گذار اسناد قابل بررسی نیست.');
    const row = await tx.legacyWaybillReconstruction.findUnique({ where: { waybillId }, include: { waybill: {
      include: { candidate: { include: { allocationRevision: true } }, documentArtifacts: { where: { kind: 'WAYBILL' } } },
    } } });
    const waybill = row?.waybill;
    if (!row || !waybill || waybill.candidate.status !== 'ACCEPTED' || !waybill.candidate.allocationRevision.sealedAt || !['ISSUED', 'EXIT_RECORDED'].includes(waybill.status) ||
      waybill.candidate.allocationRevision.sourceKind !== 'SALES_CONTRACT' || waybill.documentArtifacts.length ||
      row.allocationRevisionId !== waybill.candidate.allocationRevisionId || row.waybillIntegrityHash !== waybill.integrityHash || !validLegacySnapshot(waybill) ||
      hashBytes(row.pdf) !== row.pdfSha256 || (gate?.cutoverAt && isPostCutoverFinalization(waybill.candidate.allocationRevision.finalizedAt, gate.cutoverAt))) {
      throw new LegacyWaybillReconstructionError('نسخه بازسازی‌شده بارنامه معتبر یا در دسترس نیست.');
    }
    const latest = await tx.logisticsAllocationRevision.findFirst({ where: { loadingId: waybill.candidate.allocationRevision.loadingId,
      queueTurnId: waybill.candidate.allocationRevision.queueTurnId }, orderBy: { revisionNumber: 'desc' }, select: { id: true } });
    if (latest?.id !== row.allocationRevisionId) throw new LegacyWaybillReconstructionError('تخصیص جدیدتری برای راننده ثبت شده است.');
    const freshness = await allocationPricingIntegrityVerifier.assess({ transaction: tx, allocationRevisionId: row.allocationRevisionId,
      expectedSourceIntegrityHash: row.sourceIntegrityHash });
    if (freshness.status !== 'CURRENT') throw new LegacyWaybillReconstructionError('شواهد قیمت بارگیری به بررسی نیاز دارند.');
    return { id: row.id, bytes: row.pdf, pdfSha256: row.pdfSha256 };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60000 });
}

export async function recordLegacyReconstructionHandoff(db: PrismaClient, input: {
  waybillId: string; reconstructionId: string; actorId: string; status: 'SUCCEEDED' | 'FAILED';
}) {
  for (let attempt = 0; ; attempt++) {
    try {
      await db.$transaction(tx => appendLegacyAudit(tx, { waybillId: input.waybillId, actorId: input.actorId,
        eventType: input.status === 'SUCCEEDED' ? 'RECONSTRUCTION_HANDED_OFF' : 'RECONSTRUCTION_HANDOFF_FAILED',
        payload: { reconstructionId: input.reconstructionId } }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return;
    } catch (error) {
      if (attempt >= 2 || !isRetryableDispatchTransactionError(error)) throw error;
    }
  }
}
