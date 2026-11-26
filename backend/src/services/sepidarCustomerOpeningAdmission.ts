import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import { AccountingCustomerTreasuryError } from './accountingCustomerTreasury';

type SepidarOpeningIdentity = {
  bookId: string;
  profileId: string;
  actorId: string;
  occurredAt: Date;
  counterAccountId: string;
  commandHash: string;
  sourcePackageHash: string;
  sourceCustomerId: string;
  sourceVoucherItemId: string;
  idempotencyKey: string;
};

const embeddedCommit = (() => {
  try {
    return readFileSync(path.resolve(__dirname, '../../.allocation-build-commit'), 'utf8').trim();
  } catch {
    return '';
  }
})();

export async function requireSepidarCustomerOpeningWithin(
  tx: Prisma.TransactionClient,
  input: SepidarOpeningIdentity,
): Promise<void> {
  if ('$transaction' in tx) throw new Error('SEPIDAR_OPENING_TRANSACTION_REQUIRED');

  const releaseId = process.env.DEPLOYMENT_RELEASE_ID;
  if (/^[0-9a-f]{40}$/.test(embeddedCommit) && releaseId) {
    try {
      const [result] = await tx.$queryRaw<Array<{ admitted: boolean }>>`
        SELECT public.sepidar_customer_opening_runtime_admitted(
          ${embeddedCommit}, ${releaseId}, ${input.bookId}, ${input.profileId}, ${input.actorId}, ${input.occurredAt}::timestamptz,
          ${input.counterAccountId}, ${input.commandHash}, ${input.sourcePackageHash},
          ${input.sourceCustomerId}, ${input.sourceVoucherItemId}, ${input.idempotencyKey}
        ) AS admitted
      `;
      if (result?.admitted === true) return;
    } catch {
      // A missing function or unavailable release evidence also denies posting.
    }
  }

  throw new AccountingCustomerTreasuryError('SEPIDAR_CUSTOMER_OPENING_CLOSED',
    'ثبت افتتاحیه سپیدار برای این مشتری و بستهٔ تأییدشده فعال نیست. درخواست ثبت نشد.', 409);
}
