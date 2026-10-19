import type { Prisma } from '@prisma/client';
import { AccountingCustomerTreasuryError } from './accountingCustomerTreasury';

/** Deny-only predecessor staging, evaluated inside the command's transaction.
 * No migration count, process setting or request can grant activation here.
 * Opening this capability requires a separately evidenced controller protocol.
 */
export async function requireCustomerSourceSharesWithin(tx: Prisma.TransactionClient): Promise<void> {
  if ('$transaction' in tx) throw new Error('CUSTOMER_SEMANTIC_TRANSACTION_REQUIRED');
  try {
    await tx.$queryRaw`SELECT public.sabalan_require_customer_source_shares()::text`;
  } catch (error) {
    const failure = error as { code?: string; meta?: { code?: string; message?: string } };
    if (failure.code === 'P2010' && failure.meta?.code === '55000'
      && ['CUSTOMER_SOURCE_SHARES_CLOSED', 'ERROR: CUSTOMER_SOURCE_SHARES_CLOSED'].includes(failure.meta.message ?? '')) {
      throw new AccountingCustomerTreasuryError('CUSTOMER_SOURCE_SHARES_CLOSED',
        'این عملیات مالی پس از تکمیل به‌روزرسانی در دسترس قرار می‌گیرد. درخواست ثبت نشد.', 409);
    }
    throw error;
  }
  // Even an unexpectedly returning SQL function cannot open this deny-only
  // application predecessor. It requires an independently reviewed successor.
  throw new Error('CUSTOMER_SEMANTIC_BARRIER_STATE_UNPROVEN');
}
