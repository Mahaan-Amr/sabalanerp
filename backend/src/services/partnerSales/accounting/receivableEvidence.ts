import type { AccountingReceivable } from '@prisma/client';
import { canonicalJson } from '@sabalanerp/partner-sales-contracts';
import type { PartnerFinancialPreparation } from './source';
import type { PartnerReceivable } from './repository';
import { PartnerAccountingCommandError } from './errors';
import { subtract } from '../reporting/money';

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const conflict = () => new PartnerAccountingCommandError('INTEGRITY_CONFLICT', 'شواهد دریافتنی با منبع صورتحساب همکار سازگار نیست؛ بررسی حسابداری لازم است.');

/** Every retained private witness agrees with the actual canonical owner. An
 * allowed parent cannot legitimize a nested snapshot copied from another Case. */
export function assertPartnerAccountingWitnesses(value: unknown, preparation: PartnerFinancialPreparation): void {
  if (Array.isArray(value)) { for (const child of value) assertPartnerAccountingWitnesses(child, preparation); return; }
  const row = object(value);
  if (!row) return;
  for (const [key, expected] of Object.entries({ partnerCaseId: preparation.owner.caseId,
    internalRecordId: preparation.internalRecordId, partnerSellerId: preparation.debtor.partnerSellerId,
    commercialAccountId: preparation.debtor.commercialAccountId })) {
    if (key in row && row[key] !== expected) throw conflict();
  }
  if ('owner' in row && canonicalJson(row.owner) !== canonicalJson(preparation.owner)) throw conflict();
  if ('partnerPreparation' in row && canonicalJson(row.partnerPreparation) !== canonicalJson(preparation)) throw conflict();
  for (const child of Object.values(row)) assertPartnerAccountingWitnesses(child, preparation);
}

/** Validate against independently rebuilt invoice evidence, not against another
 * mutable field on this same receivable. Shared by writes and all readers. */
export function readPartnerReceivableEvidence(receivable: AccountingReceivable, preparation: PartnerFinancialPreparation): PartnerReceivable {
  const evidence = object(object(receivable.metadata)?.partnerReceivable);
  if (!evidence || receivable.contractId || receivable.customerId || receivable.sourcePaymentId ||
      evidence.id !== receivable.id || evidence.invoiceRecordId !== receivable.invoiceRecordId ||
      evidence.internalRecordId !== preparation.internalRecordId || evidence.partnerSellerId !== preparation.debtor.partnerSellerId ||
      evidence.commercialAccountId !== preparation.debtor.commercialAccountId ||
      canonicalJson(evidence.owner) !== canonicalJson(preparation.owner) ||
      canonicalJson(evidence.paymentPlan) !== canonicalJson(preparation.paymentPlan) ||
      canonicalJson(evidence.originalAmount) !== canonicalJson(preparation.amount) ||
      receivable.currency !== preparation.amount.currency ||
      subtract(receivable.originalAmount.toString(), preparation.amount.amount) !== '0') throw conflict();
  assertPartnerAccountingWitnesses(receivable.metadata, preparation);
  return evidence as PartnerReceivable;
}
