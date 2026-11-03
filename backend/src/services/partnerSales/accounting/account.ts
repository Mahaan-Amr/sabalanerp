import { contracts, type PartnerAccountView, type Result } from './contracts';
import type { PartnerAccountSnapshot } from './repository';
import { equalAmounts, failure, matchesFinancialPreparation, preparePartnerFinancialSource, sumAmounts } from './source';

export async function projectPartnerAccount(snapshot: PartnerAccountSnapshot, requestedPartnerSellerId: string): Promise<Result<PartnerAccountView>> {
  if (snapshot.partnerSellerId !== requestedPartnerSellerId) return failure('NOT_FOUND');
  const purchases: PartnerAccountView['purchases'] = [];
  const seen = new Set<string>();
  for (const row of snapshot.purchases) {
    if (row.source.partnerSellerId !== snapshot.partnerSellerId) return failure('NOT_FOUND');
    const prepared = await preparePartnerFinancialSource(row.source, row.source.view.owner);
    if (!prepared.ok) return prepared;
    const source = prepared.value;
    if (seen.has(source.owner.caseId)) return failure('INTEGRITY_CONFLICT');
    seen.add(source.owner.caseId);
    let amount = source.amount;
    let received = { amount: '0', currency: source.amount.currency };
    let balance = source.amount;
    let status: PartnerAccountView['purchases'][number]['status'] = 'AWAITING_REVIEW';
    if (row.official) {
      const { invoice, receivable } = row.official;
      // A retail-only successor can rebind the Case revision without changing the
      // official financial snapshot or recreating its receivable.
      if (!invoice.approval || !['ISSUED', 'POSTED', 'VOIDED'].includes(invoice.status) ||
          !matchesFinancialPreparation(source, invoice.preparation) ||
          !contracts.MoneySchema.safeParse(invoice.amount).success || invoice.amount.currency !== source.amount.currency ||
          !equalAmounts(invoice.amount.amount, source.amount.amount) ||
          receivable.invoiceRecordId !== invoice.invoiceRecordId || receivable.internalRecordId !== source.internalRecordId ||
          receivable.partnerSellerId !== snapshot.partnerSellerId || receivable.commercialAccountId !== source.debtor.commercialAccountId ||
          contracts.canonicalJson(receivable.owner) !== contracts.canonicalJson(invoice.preparation.owner) ||
          contracts.canonicalJson(receivable.paymentPlan) !== contracts.canonicalJson(invoice.preparation.paymentPlan) ||
          !contracts.MoneySchema.safeParse(receivable.originalAmount).success ||
          receivable.originalAmount.currency !== source.amount.currency || !equalAmounts(receivable.originalAmount.amount, source.amount.amount)) return failure('INTEGRITY_CONFLICT');
      amount = receivable.originalAmount;
      received = row.official.received;
      balance = row.official.balance;
      if (![amount, received, balance].every(money => contracts.MoneySchema.safeParse(money).success && money.currency === source.amount.currency)) return failure('INTEGRITY_CONFLICT');
      if (row.official.status === 'VOIDED') {
        status = 'VOIDED';
      } else {
        const outstanding = sumAmounts([amount.amount, `-${received.amount}`]);
        if (!equalAmounts(balance.amount, outstanding.startsWith('-') ? '0' : outstanding) || invoice.status === 'VOIDED') return failure('INTEGRITY_CONFLICT');
        status = equalAmounts(balance.amount, '0') ? 'SETTLED' : equalAmounts(received.amount, '0') ? 'PAYABLE' : 'PARTIALLY_PAID';
      }
    } else if (row.source.view.state === 'VOIDED') {
      status = 'VOIDED';
      balance = { amount: '0', currency: source.amount.currency };
    }
    const plan = source.paymentPlan;
    purchases.push({ owner: source.owner, caseNumber: row.source.view.caseNumber, amount, received, balance, status,
      sabalanPaymentPlan: {
        planId: plan.planId, version: plan.version, effectiveDate: plan.effectiveDate,
        ...(plan.predecessorPlanId ? { predecessorPlanId: plan.predecessorPlanId } : {}),
        installments: plan.installments.map(item => ({ installmentId: item.installmentId, dueDate: item.dueDate,
          amount: item.amount, method: item.method,
          ...(item.subtype ? { subtype: item.subtype } : {}),
          ...(item.check ? { check: { number: item.check.number, bank: item.check.bank, dueDate: item.check.dueDate } } : {}),
        })),
      },
    });
  }
  const parsed = contracts.PartnerAccountViewSchema.safeParse({ schemaVersion: 1, purpose: 'PARTNER_ACCOUNT', partnerSellerId: snapshot.partnerSellerId, purchases });
  return parsed.success ? { ok: true, value: parsed.data } : failure('INTEGRITY_CONFLICT');
}
