import { Prisma } from '@prisma/client';
import { lockPartnerCommercialContract, isPartnerCommercialFlow, assertPartnerFinancialFinality } from '../cases/commercialLifecycle';
import { readCurrentPartnerCaseViews } from '../cases/lifecycle';
import { readPartnerCollections } from '../accounting/collections';
import { readPartnerInvoiceSource } from '../accounting/invoiceSource';

/** Current, applied Sabalan receipts only. Private retail collections never enter this gate. */
export async function partnerCommercialDispatchEligible(tx: Prisma.TransactionClient, caseId: string) {
  const { root, contract } = await lockPartnerCommercialContract(tx, caseId);
  if (!isPartnerCommercialFlow(contract)) return true;
  if (contract.isInactive || contract.status !== 'SIGNED') return false;
  await assertPartnerFinancialFinality(tx, caseId);
  const views = await readCurrentPartnerCaseViews(tx, caseId);
  if (!views?.accounting || !root.internalRecordId) return false;
  const required = new Prisma.Decimal(views.accounting.totals.payable);
  if (required.lte(0)) return false;
  const obligations = await tx.accountingReceivable.findMany({ where: { status: { not: 'VOIDED' },
    invoiceRecord: { sourceKind: 'PARTNER_INTERNAL_RECORD', sourceId: root.internalRecordId,
      status: { in: ['ISSUED', 'POSTED'] }, financiallyApprovedAt: { not: null } } }, include: { invoiceRecord: true } });
  let total = new Prisma.Decimal(0);
  for (const obligation of obligations) {
    if (!obligation.invoiceRecord) return false;
    const source = await readPartnerInvoiceSource(tx, obligation.invoiceRecord, caseId);
    if (!source || obligation.currency !== views.accounting.totals.currency || obligation.originalAmount.lte(0)) return false;
    const collected = await readPartnerCollections(tx, { receivableId: obligation.id, currency: obligation.currency,
      preparation: source.preparation, cutoff: new Date(), asOf: new Date() });
    if (collected === null || new Prisma.Decimal(collected).lt(obligation.originalAmount)) return false;
    total = total.plus(obligation.originalAmount);
  }
  return total.gte(required);
}

export async function assertPartnerCommercialDispatchEligible(tx: Prisma.TransactionClient,
  caseIds: Array<string | null | undefined>, Conflict: new (message: string) => Error = Error) {
  for (const id of [...new Set(caseIds.filter((id): id is string => !!id))].sort()) {
    if (!await partnerCommercialDispatchEligible(tx, id)) throw new Conflict('قرارداد همکار باید قطعی و با دریافت‌های وصول‌شده سبلان کاملاً تسویه شده باشد.');
  }
}
