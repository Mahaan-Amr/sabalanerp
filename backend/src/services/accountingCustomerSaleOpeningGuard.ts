import type { Prisma } from '@prisma/client';
import { AccountingCustomerTreasuryError } from './accountingCustomerTreasury';

/** Opening covers the historical economic balance, including amounts awaiting attribution. */
export async function requireNewCustomerSaleAfterOpening(tx: Prisma.TransactionClient, input: {
  profileId: string; customerId: string; contractId: string; recognizedAt: Date; invoiceNumber: string; financialRecordId?: string;
}) {
  const review = await tx.accountingCustomerOpeningReview.findUnique({ where: { profileId: input.profileId }, include: { attributions: { orderBy: { sequence: 'desc' } } } });
  if (!review) return;
  const fail = (message: string): never => { throw new AccountingCustomerTreasuryError('SALE_OPENING_RECONCILIATION_REQUIRED', message, 409); };
  if (input.recognizedAt <= review.basisAt) fail('فروش مربوط به تاریخ مبنای افتتاحیه یا قبل از آن دوباره ثبت نمی‌شود؛ ریز افتتاحیه را با حفظ سابقه تطبیق دهید.');
  const records = await tx.accountingFinancialRecord.findMany({ where: { contractId: input.contractId } });
  const evidence = review.evidence as { review?: { lines?: Array<{ financialRecordId?: string; contractId?: string }> } };
  const coveredIds = new Set((evidence.review?.lines ?? []).map(line => line.financialRecordId).filter(Boolean));
  for (const attribution of review.attributions) if (attribution.financialRecordId) coveredIds.add(attribution.financialRecordId);
  const historical = records.filter(record => coveredIds.has(record.id) || record.systemInvoiceDate == null || record.systemInvoiceDate <= review.basisAt);
  const linkedContract = (evidence.review?.lines ?? []).some(line => line.contractId === input.contractId)
    || review.attributions.some(row => row.contractId === input.contractId);
  if (historical.some(record => record.systemInvoiceNumber === input.invoiceNumber.trim())) fail('این شماره فاکتور به سابقه افتتاحیه مربوط است؛ ثبت دیرهنگام آن بدهی جدید نمی‌سازد.');
  if (!input.financialRecordId) {
    if (historical.length || linkedContract) fail('برای فروش جدید قرارداد دارای سابقه افتتاحیه، فاکتور جدید و مستقل پس از تاریخ مبنا را مشخص کنید.');
    return;
  }
  const record = records.find(row => row.id === input.financialRecordId);
  if (!record || (record.customerId != null && record.customerId !== input.customerId)
    || !record.systemInvoiceDate || record.systemInvoiceDate <= review.basisAt || record.systemInvoiceDate > input.recognizedAt
    || record.systemInvoiceNumber !== input.invoiceNumber.trim() || coveredIds.has(record.id)
    || record.voidedAt != null || !record.financiallyApprovedAt) fail('فاکتور جدید باید تأییدشده، متعلق به همین مشتری و قرارداد و مستقل از اقلام افتتاحیه باشد.');
}
