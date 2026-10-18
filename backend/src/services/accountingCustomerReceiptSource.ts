import type { Prisma } from '@prisma/client';
import { AccountingCustomerTreasuryError } from './accountingCustomerTreasury';

export async function requireCustomerReceiptSourceDate(tx: Prisma.TransactionClient, receipt: { id: string; sourceParentId: string | null }, at: Date) {
  const parent = await tx.accountingCustomerReceiptResolution.findUnique({ where: { receiptId: receipt.sourceParentId ?? receipt.id } });
  if (parent && (!receipt.sourceParentId || parent.occurredAt > at)) throw new AccountingCustomerTreasuryError('RECEIPT_SOURCE_RESOLVED', 'دریافت تطبیق‌شده فقط از ابزارهای تأییدشده و از تاریخ تطبیق قابل مصرف است.', 409);
}
