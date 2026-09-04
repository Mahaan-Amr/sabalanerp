import type { AccountingTaxRecord } from '@prisma/client';
import { canonicalJson, RevisionRefSchema } from '@sabalanerp/partner-sales-contracts';
import type { PartnerFinancialPreparation } from './source';
import { assertPartnerAccountingWitnesses } from './receivableEvidence';
import { PartnerAccountingCommandError } from './errors';

export function assertSinglePartnerTaxRecord(rows: readonly AccountingTaxRecord[]): void {
  if (rows.length > 1) throw new PartnerAccountingCommandError('INTEGRITY_CONFLICT',
    'برای این صورتحساب همکار چند سابقه مالیاتی وجود دارد؛ پیش از تغییر، حسابداری باید تعارض را بررسی کند.');
}

export function assertPartnerTaxEvidence(tax: AccountingTaxRecord, invoiceId: string, preparation: PartnerFinancialPreparation): void {
  const metadata = tax.metadata as Record<string, unknown> | null;
  if (tax.invoiceRecordId !== invoiceId || tax.contractId || !metadata ||
      metadata.partnerCaseId !== preparation.owner.caseId ||
      !RevisionRefSchema.safeParse(metadata.owner).success ||
      canonicalJson(metadata.owner) !== canonicalJson(preparation.owner) ||
      metadata.financialEvidenceHash !== preparation.evidenceHash) {
    throw new PartnerAccountingCommandError('INTEGRITY_CONFLICT', 'منبع سابقه مالیاتی همکار سازگار نیست؛ بررسی حسابداری لازم است.');
  }
  assertPartnerAccountingWitnesses(metadata, preparation);
}
