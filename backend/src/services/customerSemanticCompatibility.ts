import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import { AccountingCustomerTreasuryError } from './accountingCustomerTreasury';

export type CustomerSourceShareOperation = 'grouped-allocation' | 'other';

const embeddedCommit = (() => {
  try { return readFileSync(path.resolve(__dirname, '../../.allocation-build-commit'), 'utf8').trim(); }
  catch { return ''; }
})();

export async function requireCustomerSourceSharesWithin(tx: Prisma.TransactionClient, operation: CustomerSourceShareOperation = 'other'): Promise<void> {
  if ('$transaction' in tx) throw new Error('CUSTOMER_SEMANTIC_TRANSACTION_REQUIRED');
  const releaseId = process.env.DEPLOYMENT_RELEASE_ID;
  if (operation === 'grouped-allocation' && /^[0-9a-f]{40}$/.test(embeddedCommit) && releaseId) {
    try {
      const [result] = await tx.$queryRaw<Array<{ admitted: boolean }>>`
        SELECT public.customer_allocation_runtime_admitted(${embeddedCommit}, ${releaseId}) AS admitted
      `;
      if (result?.admitted === true) return;
    } catch {
      // A missing migration or unavailable control is also closed.
    }
  }
  throw new AccountingCustomerTreasuryError('CUSTOMER_SOURCE_SHARES_CLOSED',
    'این عملیات مالی پس از تکمیل به‌روزرسانی در دسترس قرار می‌گیرد. درخواست ثبت نشد.', 409);
}
