import { PartnerTechnicalDraftSchema, PartnerTechnicalCheckpointReceiptSchema,
  type PartnerTechnicalDraft, type PartnerTechnicalCheckpointReceipt } from '@sabalanerp/partner-sales-contracts';
import { PARTNER_TECHNICAL_RECOVERY_KIND } from '../../contractRecoveryProtection';

export type TechnicalRecoveryRecord = Record<string, unknown> & {
  kind: typeof PARTNER_TECHNICAL_RECOVERY_KIND; version: 1; recoveryRevision: number;
  updatedAt: number; draft: PartnerTechnicalDraft;
};
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Private metadata is decoded locally; public values always use their owning
 * package decoder. Unknown private fields are retained, never projected. */
export function decodeTechnicalRecovery(value: unknown): TechnicalRecoveryRecord | undefined {
  const record = object(value);
  if (!record || record.kind !== PARTNER_TECHNICAL_RECOVERY_KIND || record.version !== 1 ||
      typeof record.recoveryRevision !== 'number' || !Number.isSafeInteger(record.recoveryRevision) || record.recoveryRevision < 1 ||
      typeof record.updatedAt !== 'number' || !Number.isSafeInteger(record.updatedAt) || record.updatedAt <= 0 ||
      !Number.isFinite(new Date(record.updatedAt).getTime())) return undefined;
  const draft = PartnerTechnicalDraftSchema.safeParse(record.draft);
  if (!draft.success) return undefined;
  return { ...record, kind: PARTNER_TECHNICAL_RECOVERY_KIND, version: 1,
    recoveryRevision: record.recoveryRevision, updatedAt: record.updatedAt, draft: draft.data };
}

export function decodeTechnicalReceipt(value: unknown): { sessionId: string; receipt: PartnerTechnicalCheckpointReceipt } | undefined {
  const record = object(value);
  if (!record || typeof record.sessionId !== 'string' || !record.sessionId ||
      Object.keys(record).some(key => key !== 'sessionId' && key !== 'receipt')) return undefined;
  const receipt = PartnerTechnicalCheckpointReceiptSchema.safeParse(record.receipt);
  return receipt.success ? { sessionId: record.sessionId, receipt: receipt.data } : undefined;
}
