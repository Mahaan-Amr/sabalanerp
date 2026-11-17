import type { Prisma } from '@prisma/client';
import { AccountingCustomerTreasuryError } from './accountingCustomerTreasury';

/** New customer source-share writes stay closed until protected runtime admission is wired. */
export type CustomerSourceShareOperation = 'grouped-allocation' | 'other';

export async function requireCustomerSourceSharesWithin(tx: Prisma.TransactionClient, operation: CustomerSourceShareOperation = 'other'): Promise<void> {
  if ('$transaction' in tx) throw new Error('CUSTOMER_SEMANTIC_TRANSACTION_REQUIRED');
  if (operation === 'grouped-allocation') {
    // Use the same row lock that coordinates posting and protected closure.
    try {
      await tx.$queryRaw`SELECT state FROM customer_allocation_release_control
        WHERE id = 'grouped-allocation' FOR SHARE`;
    } catch {
      // A missing migration or unavailable control is also closed.
    }
  }
  throw new AccountingCustomerTreasuryError('CUSTOMER_SOURCE_SHARES_CLOSED',
    'این عملیات مالی پس از تکمیل به‌روزرسانی در دسترس قرار می‌گیرد. درخواست ثبت نشد.', 409);
}
