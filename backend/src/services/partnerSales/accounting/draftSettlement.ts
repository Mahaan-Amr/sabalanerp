import type { Prisma } from '@prisma/client';
import type { SabalanInternalRecordView } from '@sabalanerp/partner-sales-contracts';
import { PartnerEventIntegrityError, readPersistedPartnerEvents } from '../events/persisted';
import { subtract } from '../reporting/money';
import { PartnerCollectionIntegrityError } from './collections';
import { PartnerAccountingCommandError } from './errors';
import { latestPartnerFinancialApproval, PartnerOfficialAccountingIntegrityError, readPartnerOfficialPurchase } from './officialPurchase';
import { withCurrentSabalanPlan } from './sabalanPlan';
import { matchesFinancialPreparation, preparePartnerFinancialSource } from './source';

/** Full settlement requires actual collections against the live, canonical
 * Sabalan receivable. The end customer's collections belong to a different ledger. */
export async function hasPartnerDraftSettlement(tx: Prisma.TransactionClient, accounting: SabalanInternalRecordView, partnerSellerId: string) {
  const { owner, recordId: internalRecordId } = accounting;
  try {
    const events = await tx.partnerCaseEvent.findMany({ where: { caseId: owner.caseId, type: 'SABALAN_FINANCIAL_APPROVED' } });
    const approval = latestPartnerFinancialApproval(
      readPersistedPartnerEvents({ id: owner.caseId, internalRecordId }, events));
    if (!approval) return false;
    const receivable = await tx.accountingReceivable.findUnique({ where: { id: approval.accountingReceivableId },
      include: { invoiceRecord: true } });
    if (!receivable?.invoiceRecord || receivable.status === 'VOIDED' || receivable.invoiceRecord.voidedAt ||
        !['ISSUED', 'POSTED'].includes(receivable.invoiceRecord.status) || !receivable.originalAmount.gt(0)) return false;
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const { official } = await readPartnerOfficialPurchase(tx, { internalRecordId, approval,
      asOf: clock.now, cutoff: clock.now, voided: false });
    if (!official || subtract(official.received.amount, receivable.originalAmount.toString()) !== '0' ||
        !receivable.remainingAmount.isZero() || !receivable.paidAmount.equals(receivable.originalAmount)) return false;
    const currentView = await withCurrentSabalanPlan(tx, accounting);
    const prepared = await preparePartnerFinancialSource({ view: currentView, partnerSellerId }, owner);
    return prepared.ok && matchesFinancialPreparation(prepared.value, official.invoice.preparation);
  } catch (error) {
    if (error instanceof PartnerAccountingCommandError || error instanceof PartnerEventIntegrityError ||
        error instanceof PartnerCollectionIntegrityError || error instanceof PartnerOfficialAccountingIntegrityError) return false;
    throw error;
  }
}
