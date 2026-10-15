import { Prisma, type PrismaClient } from '@prisma/client';
import { hashAccountingEvidence } from './accountingLedgerFoundation';
import { AccountingCustomerTreasuryError } from './accountingCustomerTreasury';

type Database = PrismaClient | Prisma.TransactionClient;
export type CustomerOpeningLine = {
  key: string; kind: 'RECEIVABLE' | 'CREDIT'; amountRials: bigint; reference: string;
  existingSourceIds: string[]; financialRecordId?: string; contractId?: string;
};
export type CustomerOpeningReview = {
  expectedSnapshotHash: string; identityConfirmed: boolean; totalConfirmed: boolean; lines: CustomerOpeningLine[];
};
const invalid = (message: string): never => { throw new AccountingCustomerTreasuryError('OPENING_REVIEW_INVALID', message, 409); };
const rials = (value: { toString(): string }) => BigInt(value.toString());

export async function customerOpeningSnapshot(database: Database, input: { customerId: string; profileId?: string; bookId: string; basisAt: Date }) {
  if (!Number.isFinite(input.basisAt.getTime()) || input.basisAt > new Date()) invalid('تاریخ مبنای افتتاحیه معتبر نیست.');
  const contracts = await database.salesContract.findMany({ where: { customerId: input.customerId, partnerKind: null, partnerCaseId: null },
    select: { id: true, totalAmount: true, currency: true, commercialRevision: true, status: true, updatedAt: true }, orderBy: { id: 'asc' } });
  const [records, items, receipts, refunds] = await Promise.all([
    database.accountingFinancialRecord.findMany({ where: { OR: [{ customerId: input.customerId }, { contractId: { in: contracts.map(contract => contract.id) } }] }, select: {
      id: true, contractId: true, amount: true, currency: true, systemInvoiceNumber: true, systemInvoiceDate: true, sepidarAmount: true,
      status: true, updatedAt: true, financiallyApprovedAt: true }, orderBy: { id: 'asc' } }),
    input.profileId ? database.accountingCustomerOpenItem.findMany({ where: { profileId: input.profileId }, include: {
      invoice: true, allocationLines: { include: { allocation: { include: { reversedBy: true } } } },
      sourceSettlements: { include: { lines: true, reversedBy: true } } }, orderBy: { id: 'asc' } }) : Promise.resolve([]),
    input.profileId ? database.accountingTreasuryTransaction.findMany({ where: { profileId: input.profileId, kind: 'CUSTOMER_RECEIPT' },
      include: { allocations: { include: { lines: true, reversedBy: true } }, adjustments: true, checkInstrument: { include: { events: true } } }, orderBy: { id: 'asc' } }) : Promise.resolve([]),
    input.profileId ? database.accountingTreasuryTransaction.findMany({ where: { profileId: input.profileId, kind: 'CUSTOMER_REFUND' }, orderBy: { id: 'asc' } }) : Promise.resolve([]),
  ]);
  const resolved = await database.accountingCustomerReceiptResolution.findMany({ where: { receipt: { profileId: input.profileId ?? '__no-profile__' }, occurredAt: { lte: input.basisAt } } });
  const resolvedIds = new Set(resolved.map(row => row.receiptId));
  const eligibleReceipts = receipts.filter(row => !resolvedIds.has(row.id) && (!row.sourceParentId || resolvedIds.has(row.sourceParentId)));
  const eligibleRefunds = refunds.filter(row => (!row.refundOfId || !resolvedIds.has(row.refundOfId)) && (!row.sourceParentId || resolvedIds.has(row.sourceParentId)));
  const ids = [...new Set([...items.map(item => item.invoice?.ledgerVoucherId ?? item.ledgerVoucherId), ...receipts.map(row => row.postedVoucherId),
    ...receipts.flatMap(row => row.adjustments.map(adjustment => adjustment.ledgerVoucherId)),
    ...refunds.map(row => row.postedVoucherId), ...items.flatMap(item => item.allocationLines.flatMap(line => [line.allocation.ledgerVoucherId, line.allocation.reversedBy?.ledgerVoucherId]))].filter((id): id is string => Boolean(id)))];
  const vouchers = await database.accountingLedgerVoucher.findMany({ where: { id: { in: ids } }, select: { id: true, bookId: true, status: true, documentDate: true, sourceHash: true }, orderBy: { id: 'asc' } });
  const inBasis = (id: string | null | undefined) => Boolean(id && vouchers.some(v => v.id === id && v.bookId === input.bookId && v.status === 'POSTED' && v.documentDate <= input.basisAt));
  const active = (allocation: { reversesId: string | null; ledgerVoucherId: string | null; reversedBy: { ledgerVoucherId: string | null } | null }) =>
    allocation.reversesId == null && inBasis(allocation.ledgerVoucherId) && !inBasis(allocation.reversedBy?.ledgerVoucherId);
  const sources = items.filter(item => inBasis(item.invoice?.ledgerVoucherId ?? item.ledgerVoucherId)).map(item => ({
    id: `item:${item.id}`, kind: item.kind as 'RECEIVABLE' | 'CREDIT', description: item.description,
    amountRials: rials(item.originalRials) - item.allocationLines.filter(line => active(line.allocation)).reduce((sum, line) => sum + rials(line.amountRials), 0n)
      - item.sourceSettlements.filter(active).flatMap(allocation => allocation.lines).reduce((sum, line) => sum + rials(line.amountRials), 0n),
    contractId: item.contractId, voucherId: item.invoice?.ledgerVoucherId ?? item.ledgerVoucherId,
  })).concat(eligibleReceipts.filter(row => inBasis(row.postedVoucherId)).map(row => ({
    id: `receipt:${row.id}`, kind: 'CREDIT' as const, description: 'دریافت تخصیص‌نیافته',
    amountRials: rials(row.amountRials) + row.adjustments.filter(adjustment => inBasis(adjustment.ledgerVoucherId)).reduce((sum, adjustment) => sum + rials(adjustment.deltaRials), 0n)
      - row.allocations.filter(active).flatMap(allocation => allocation.lines).reduce((sum, line) => sum + rials(line.amountRials), 0n)
      - eligibleRefunds.filter(refund => refund.refundOfId === row.id && inBasis(refund.postedVoucherId)).reduce((sum, refund) => sum + rials(refund.amountRials), 0n),
    contractId: row.contractId, voucherId: row.postedVoucherId,
  }))).filter(source => source.amountRials > 0n);
  const snapshotHash = hashAccountingEvidence({ customerId: input.customerId, bookId: input.bookId, basisAt: input.basisAt, contracts, records, items, receipts, refunds, vouchers, resolved });
  return { snapshotHash, sources, contracts, financialRecords: records, basisAt: input.basisAt };
}

export function reconcileCustomerOpening(snapshot: Awaited<ReturnType<typeof customerOpeningSnapshot>>, totalRials: bigint, review: CustomerOpeningReview) {
  if (!review.identityConfirmed || !review.totalConfirmed || review.expectedSnapshotHash !== snapshot.snapshotHash) invalid('هویت، مانده کل یا نسخه بررسی افتتاحیه معتبر نیست؛ اطلاعات را دوباره تطبیق دهید.');
  if (!review.lines.length || new Set(review.lines.map(line => line.key)).size !== review.lines.length) invalid('ریز افتتاحیه با شناسه‌های مستقل لازم است.');
  const used = new Set<string>();
  let total = 0n;
  const transfers = review.lines.map(line => {
    if (!line.key.trim() || !line.reference.trim() || line.amountRials < 0n || !['RECEIVABLE', 'CREDIT'].includes(line.kind)) invalid('مبلغ، جهت یا مدرک ریز افتتاحیه معتبر نیست.');
    if (line.contractId && !snapshot.contracts.some(contract => contract.id === line.contractId)) invalid('قرارداد ریز افتتاحیه متعلق به مشتری نیست.');
    if (line.financialRecordId && !snapshot.financialRecords.some(record => record.id === line.financialRecordId && (!line.contractId || record.contractId === line.contractId))) invalid('فاکتور ریز افتتاحیه با مشتری و قرارداد منطبق نیست.');
    const record = snapshot.financialRecords.find(record => record.id === line.financialRecordId);
    if (record?.systemInvoiceDate && record.systemInvoiceDate > snapshot.basisAt) invalid('فاکتور پس از تاریخ مبنا در افتتاحیه منظور نمی‌شود.');
    total += line.kind === 'CREDIT' ? -line.amountRials : line.amountRials;
    const existing = line.existingSourceIds.reduce((sum, id) => {
      const source = snapshot.sources.find(source => source.id === id);
      if (!source || source.kind !== line.kind || used.has(id)) invalid('منشأ قطعی موجود نامعتبر یا دوباره منظور شده است.');
      used.add(id);
      return sum + source!.amountRials;
    }, 0n);
    if (existing > line.amountRials) invalid('سهم قطعی موجود از مبلغ ریز افتتاحیه بیشتر است؛ اختلاف را تعیین تکلیف کنید.');
    return { ...line, transferRials: line.amountRials - existing };
  });
  if (total !== totalRials || used.size !== snapshot.sources.length) invalid('جمع ریز و مانده کل یا تطبیق تمام اقلام قطعی موجود کامل نیست.');
  return transfers;
}
