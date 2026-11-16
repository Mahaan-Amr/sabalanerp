import type { Prisma } from '@prisma/client';
import { AccountingCustomerTreasuryError } from './accountingCustomerTreasury';

/** The customer source-share workflow is deferred from the protected candidate.
 * Every affected command checks this inside its transaction before mutation. */
export type CustomerSourceShareOperation = 'grouped-allocation' | 'grouped-credit-reversal' | 'other';

export async function requireCustomerSourceSharesWithin(tx: Prisma.TransactionClient, operation: CustomerSourceShareOperation = 'other'): Promise<void> {
  if ('$transaction' in tx) throw new Error('CUSTOMER_SEMANTIC_TRANSACTION_REQUIRED');
  if (operation === 'grouped-allocation') {
    // Lock in the posting transaction. The dormant control row may be ACTIVE,
    // but this runtime guard remains unconditionally closed.
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
