import { Prisma, PrismaClient } from '@prisma/client';
import { isCommerciallyFinal, isOrdinaryCommercialFlow } from './ordinaryContractLifecycle';
import { activeCreditForContract, activeManagerApproval, hasFinancialDispatchApproval, ordinaryContract, rials } from './contractDispatchCredit';

type Db = PrismaClient | Prisma.TransactionClient;
type Obligation = { original: Prisma.Decimal.Value; applied: Prisma.Decimal.Value };

export const obligationsFullySettled = (required: Prisma.Decimal.Value, obligations: Obligation[]) => {
  const amount = new Prisma.Decimal(required);
  if (amount.lte(0) || obligations.length === 0) return false;
  const total = obligations.reduce((sum, item) => sum.plus(item.original), new Prisma.Decimal(0));
  return total.gte(amount) && obligations.every(item => new Prisma.Decimal(item.original).gt(0)
    && new Prisma.Decimal(item.applied).gte(item.original));
};

export const actualContractReceiptsRials = async (db: Db, contract: any): Promise<Prisma.Decimal> => {
  const authoritative = await db.accountingReplacementCutoverRun.findMany({ where: {
    authorityTransferredAt: { not: null }, sabalanAuthoritative: true,
  }, select: { bookId: true } });
  if (authoritative.length) {
    const items = await db.accountingCustomerOpenItem.findMany({ where: { contractId: contract.id, kind: 'RECEIVABLE',
      invoice: { status: 'POSTED' } }, include: { allocationLines: { where: {
        allocation: { reversesId: null, reversedById: null, ledgerVoucherId: { not: null },
          transaction: { kind: 'CUSTOMER_RECEIPT', postedVoucherId: { not: null } } },
      }, include: { allocation: { include: { transaction: true } } } }, invoice: true } });
    const voucherIds = items.flatMap(item => [item.invoice.ledgerVoucherId,
      ...item.allocationLines.flatMap(line => [line.allocation.ledgerVoucherId, line.allocation.transaction.postedVoucherId])])
      .filter((id): id is string => Boolean(id));
    const vouchers = await db.accountingLedgerVoucher.findMany({ where: { id: { in: voucherIds }, status: 'POSTED',
      bookId: { in: authoritative.map(run => run.bookId) } }, select: { id: true } });
    const posted = new Set(vouchers.map(voucher => voucher.id));
    const checks = items.flatMap(item => item.allocationLines).filter(line =>
      line.allocation.transaction.sourceType === 'CHECK_INSTRUMENT').map(line => line.allocation.transaction.sourceId);
    const cleared = new Set((await db.accountingCheckInstrument.findMany({ where: { id: { in: checks }, status: 'CLEARED' },
      select: { id: true } })).map(check => check.id));
    const obligations = items.filter(item => posted.has(item.invoice.ledgerVoucherId)).map(item => ({
      original: item.originalRials, applied: item.allocationLines.filter(line => {
        const allocation = line.allocation; const receipt = allocation.transaction;
        return posted.has(allocation.ledgerVoucherId!) && posted.has(receipt.postedVoucherId!)
          && (receipt.sourceType !== 'CHECK_INSTRUMENT' || cleared.has(receipt.sourceId));
      }).reduce((sum, line) => sum.plus(line.amountRials), new Prisma.Decimal(0))
    }));
    return obligations.reduce((sum, item) => sum.plus(Prisma.Decimal.min(item.original, item.applied)), new Prisma.Decimal(0));
  }
  const receivables = await db.accountingReceivable.findMany({ where: { contractId: contract.id, status: { not: 'VOIDED' } },
    include: { paymentStatuses: true } });
  const obligations = receivables.map(item => ({ original: item.originalAmount,
    applied: item.paymentStatuses.filter(payment => ['RECEIVED', 'RECONCILED'].includes(payment.status)
      && (payment.method !== 'CHECK' || payment.checkStatus === 'CLEARED'))
      .reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0)) }));
  return obligations.reduce((sum, item) => sum.plus(Prisma.Decimal.min(item.original, item.applied)), new Prisma.Decimal(0));
};

export const ordinaryContractDispatchEligible = async (db: Db, contract: any): Promise<boolean> => {
  if (!ordinaryContract(contract)) return true;
  if (contract.isInactive || !isCommerciallyFinal(contract)) return false;
  if (await hasFinancialDispatchApproval(db, contract.id) || await activeManagerApproval(db, contract)) return true;
  const amount = rials(contract.totalAmount ?? 0, contract.currency);
  if (amount.lte(0)) return false;
  return (await actualContractReceiptsRials(db, contract)).plus(await activeCreditForContract(db, contract)).gte(amount);
};

/** Lock the same contract rows as receipt writers before the final dispatch decision. */
export const assertOrdinaryContractsDispatchEligible = async (db: Db, contractIds: Array<string | null | undefined>,
  Conflict: new (message: string) => Error = Error) => {
  const ids = [...new Set(contractIds.filter((id): id is string => Boolean(id)))].sort();
  if (!ids.length) return;
  await db.$queryRaw(Prisma.sql`SELECT "id" FROM "sales_contracts" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`);
  const contracts = await db.salesContract.findMany({ where: { id: { in: ids } } });
  for (const contract of contracts) {
    if (!await ordinaryContractDispatchEligible(db, contract)) {
      throw new Conflict('ارسال به قرارداد قطعی و تأیید مالی، مجوز مدیر یا پوشش کامل دریافت و اعتبار فروشنده نیاز دارد.');
    }
  }
  if (contracts.length !== ids.length) throw new Conflict('Contract not found');
};

export const ordinaryDispatchSourcesEligible = async (db: Db, contractIds: Array<string | null | undefined>) => {
  const ids = [...new Set(contractIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return true;
  const contracts = await db.salesContract.findMany({ where: { id: { in: ids } } });
  if (contracts.length !== ids.length) return false;
  for (const contract of contracts) if (!await ordinaryContractDispatchEligible(db, contract)) return false;
  return true;
};
