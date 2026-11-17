import type { Prisma } from '@prisma/client';
import { AccountingCustomerTreasuryError } from './accountingCustomerTreasury';

export type CustomerSourceShareOperation = 'grouped-allocation' | 'other';

export async function requireCustomerSourceSharesWithin(tx: Prisma.TransactionClient, _operation: CustomerSourceShareOperation = 'other'): Promise<void> {
  if ('$transaction' in tx) throw new Error('CUSTOMER_SEMANTIC_TRANSACTION_REQUIRED');
  // This recovery release only reads and corrects acknowledged allocations.
  throw new AccountingCustomerTreasuryError('CUSTOMER_SOURCE_SHARES_CLOSED',
    'این عملیات مالی پس از تکمیل به‌روزرسانی در دسترس قرار می‌گیرد. درخواست ثبت نشد.', 409);
}
