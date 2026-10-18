import { Prisma } from '@prisma/client';
import { hashAccountingEvidence } from './accountingLedgerFoundation';
import { AccountingCustomerTreasuryError } from './accountingCustomerTreasury';

/** Parent identity protects multi-component commands even when every child identity changes. */
export async function customerCompoundCommandWithin<T>(tx: Prisma.TransactionClient, input: {
  profileId: string; kind: string; idempotencyKey: string; actor: { id: string }; payload: unknown;
}, execute: () => Promise<T>): Promise<T> {
  const commandHash = hashAccountingEvidence(input.payload);
  const prior = await tx.accountingCustomerCommand.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (prior) {
    if (prior.profileId !== input.profileId || prior.kind !== input.kind || prior.commandHash !== commandHash)
      throw new AccountingCustomerTreasuryError('IDEMPOTENCY_KEY_REUSED', 'کلید فرمان برای اطلاعات دیگری استفاده شده است.', 409);
    return prior.result as T;
  }
  const result: Prisma.InputJsonValue = JSON.parse(JSON.stringify(await execute(), (_key, value) => typeof value === 'bigint' ? value.toString() : value));
  return (await tx.accountingCustomerCommand.create({ data: { profileId: input.profileId, kind: input.kind,
    idempotencyKey: input.idempotencyKey, commandHash, createdBy: input.actor.id, result } })).result as T;
}
