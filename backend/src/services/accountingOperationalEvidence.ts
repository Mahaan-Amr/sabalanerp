import { Prisma, type PrismaClient } from '@prisma/client';
import {
  SupplyChainAccountingError,
  hashSupplyChainEvidence,
  type ImmutableEvidence,
} from './accountingSupplyChain';

/**
 * Producer-side contract for an owning workspace to publish an immutable receipt.
 * Callers provide the source payload, never an accounting-authored hash.
 */
type EvidenceDatabase = PrismaClient | Prisma.TransactionClient;

const publishAccountingOperationalEvidence = async (
  prisma: EvidenceDatabase,
  input: {
    ownerWorkspace: 'accounting' | 'sales' | 'inventory' | 'security';
    sourceType: string;
    sourceId: string;
    sourceVersion: number;
    sourcePayload: unknown;
    occurredAt: Date;
  },
): Promise<ImmutableEvidence> => {
  if (!input.ownerWorkspace.trim() || !input.sourceType.trim() || !input.sourceId.trim()
      || !Number.isInteger(input.sourceVersion) || input.sourceVersion < 1 || input.sourcePayload == null) {
    throw new SupplyChainAccountingError('INVALID_OPERATIONAL_EVIDENCE', 'مشخصات شاهد عملیاتی کامل نیست.', 400);
  }
  const sourcePayload = JSON.parse(JSON.stringify(input.sourcePayload, (_key, value) => (
    typeof value === 'bigint' ? value.toString() : value
  ))) as Prisma.InputJsonValue;
  const sourceHash = hashSupplyChainEvidence(sourcePayload);
  const existing = await prisma.accountingOperationalEvidenceReceipt.findUnique({
    where: { sourceType_sourceId_sourceVersion: {
      sourceType: input.sourceType, sourceId: input.sourceId, sourceVersion: input.sourceVersion,
    } },
  });
  if (existing && (existing.ownerWorkspace !== input.ownerWorkspace || existing.sourceHash !== sourceHash)) {
    throw new SupplyChainAccountingError('OPERATIONAL_EVIDENCE_CONFLICT', 'نسخه شاهد عملیاتی قبلاً با محتوای دیگری ثبت شده است.');
  }
  const receipt = existing ?? await prisma.accountingOperationalEvidenceReceipt.create({ data: {
    ownerWorkspace: input.ownerWorkspace, sourceType: input.sourceType, sourceId: input.sourceId,
    sourceVersion: input.sourceVersion, sourceHash, sourcePayload,
    occurredAt: input.occurredAt,
  } });
  return { type: receipt.sourceType, id: receipt.sourceId, version: receipt.sourceVersion, hash: receipt.sourceHash, payload: receipt.sourcePayload };
};

export const publishCustomerPaymentOperationalEvidence = (
  prisma: EvidenceDatabase,
  input: { sourceId: string; sourceVersion: number; sourcePayload: unknown; occurredAt: Date },
) => publishAccountingOperationalEvidence(prisma, {
  ownerWorkspace: 'accounting', sourceType: 'CUSTOMER_PAYMENT_STATUS', ...input,
});

export const publishGuardInboundOperationalEvidence = (
  prisma: EvidenceDatabase,
  input: { sourceId: string; sourceVersion: number; sourcePayload: unknown; occurredAt: Date },
) => publishAccountingOperationalEvidence(prisma, {
  ownerWorkspace: 'security', sourceType: 'GUARD_INBOUND_MOVEMENT', ...input,
});

export const resolveAccountingOperationalEvidence = async (
  prisma: EvidenceDatabase,
  reference: Pick<ImmutableEvidence, 'type' | 'id' | 'version'>,
  allowedTypes: readonly string[],
): Promise<ImmutableEvidence> => {
  if (!allowedTypes.includes(reference.type)) {
    throw new SupplyChainAccountingError('EVIDENCE_NOT_APPLICABLE', 'نوع شاهد عملیاتی برای این عملیات حسابداری مجاز نیست.', 400);
  }
  const receipt = await prisma.accountingOperationalEvidenceReceipt.findUnique({
    where: { sourceType_sourceId_sourceVersion: { sourceType: reference.type, sourceId: reference.id, sourceVersion: reference.version } },
  });
  if (!receipt || hashSupplyChainEvidence(receipt.sourcePayload) !== receipt.sourceHash) {
    throw new SupplyChainAccountingError('EVIDENCE_NOT_AUTHORITATIVE', 'شاهد نسخه‌دار از فضای کاری مالک دریافت نشده یا یکپارچگی آن مخدوش است.', 400);
  }
  return { type: receipt.sourceType, id: receipt.sourceId, version: receipt.sourceVersion, hash: receipt.sourceHash, payload: receipt.sourcePayload };
};
