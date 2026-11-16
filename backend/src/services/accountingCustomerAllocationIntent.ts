import { Prisma, type PrismaClient } from '@prisma/client';
import { AccountingCustomerTreasuryError } from './accountingCustomerTreasury';
import { hashAccountingEvidence } from './accountingLedgerFoundation';
import { resolveCustomerWorkspace, type recordCustomerWorkspaceTreasury } from './accountingCustomerWorkspace';
import { requireCustomerSourceSharesWithin } from './customerSemanticCompatibility';
import { serializeCustomerAllocationWithin } from './accountingCustomerAllocationFence';

type AllocationInput = Parameters<typeof recordCustomerWorkspaceTreasury>[2];
const fail = (code: string, message: string, status = 409): never => { throw new AccountingCustomerTreasuryError(code, message, status); };
const unknown = () => ({ status: 'UNKNOWN' as const });

/**
 * Persist denial/recovery evidence only. This is not an activation authority,
 * does not call a financial writer.
 * Do not expose this until all writers and cancellation share a proven fence.
 */
export function prepareAdmittedCustomerAllocationIntent(database: PrismaClient, accountId: string, input: AllocationInput) {
  return prepareCustomerAllocationIntent(database, accountId, input, requireCustomerSourceSharesWithin);
}

export async function prepareCustomerAllocationIntent(database: PrismaClient, accountId: string, input: AllocationInput,
  requireAdmission?: (tx: Prisma.TransactionClient) => Promise<void>) {
  if (input.actor.profile === 'VIEWER') return fail('ACCOUNTING_WRITE_FORBIDDEN', 'مجوز ثبت عملیات مالی ندارید.', 403);
  const plan = input.sourceAllocations;
  if (input.kind !== 'ALLOCATION' || !input.confirmed || input.amountRials !== 0n || input.allocations.length !== 0
    || input.receiptId || input.creditItemId || !plan?.length || plan.length > 100
    || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 128
    || !Number.isFinite(input.occurredAt.getTime()) || input.reason.trim().length < 8 || !input.reference.trim()
    || plan.some(row => Boolean(row.receiptId) === Boolean(row.creditItemId) || !row.allocations.length || row.allocations.length > 500
      || row.allocations.some(line => !line.openItemId || line.amountRials <= 0n))
    || new Set(plan.map(row => row.receiptId ?? row.creditItemId)).size !== plan.length) {
    return fail('INVALID_ALLOCATION_INTENT', 'اطلاعات درخواست تخصیص معتبر نیست.', 400);
  }
  const payload = { ...input, actor: undefined };
  const serialized = JSON.stringify(payload, (_key, value) => typeof value === 'bigint' ? value.toString() : value);
  if (Buffer.byteLength(serialized, 'utf8') > 1_000_000) return fail('INVALID_ALLOCATION_INTENT', 'حجم درخواست تخصیص بیش از حد مجاز است.', 400);
  const command = JSON.parse(serialized) as Prisma.InputJsonValue;
  const commandHash = hashAccountingEvidence(payload);
  return database.$transaction(async tx => {
    await requireAdmission?.(tx);
    const initial = await resolveCustomerWorkspace(tx, accountId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-account:${initial.customerId}`}))`;
    const resolved = await resolveCustomerWorkspace(tx, accountId);
    if (resolved.customerId !== initial.customerId || !resolved.profile) return fail('CUSTOMER_PROFILE_NOT_FOUND', 'پرونده مالی مشتری پیدا نشد.', 404);
    const prior = await tx.accountingCustomerAllocationIntent.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (prior) {
      if (prior.profileId !== resolved.profile.id || prior.ownerId !== input.actor.id || prior.accountId !== accountId || prior.commandHash !== commandHash)
        return fail('ALLOCATION_INTENT_MISMATCH', 'این درخواست متعلق به اطلاعات یا حساب دیگری است.');
      return { status: prior.state, idempotencyKey: prior.idempotencyKey };
    }
    if (await tx.accountingCustomerCommand.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } }))
      return fail('ALLOCATION_INTENT_RECONCILIATION_REQUIRED', 'نتیجه درخواست قبلی باید بررسی شود.');
    await serializeCustomerAllocationWithin(tx, resolved.profile.id);
    if (await tx.accountingCustomerAllocationIntent.findFirst({ where: { profileId: resolved.profile.id, state: 'PENDING' }, select: { id: true } }))
      return fail('ALLOCATION_INTENT_PENDING', 'درخواست قبلی این حساب هنوز تعیین تکلیف نشده است.');
    const created = await tx.accountingCustomerAllocationIntent.create({ data: {
      profileId: resolved.profile.id, accountId, ownerId: input.actor.id, idempotencyKey: input.idempotencyKey, commandHash, command,
    } });
    return { status: created.state, idempotencyKey: created.idempotencyKey };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

/** Cancel only a positively identified intent. The database transition also
 * fences the parent-command insert, including when it arrives concurrently. */
export async function cancelCustomerAllocationIntent(database: PrismaClient, accountId: string, input: AllocationInput) {
  if (input.actor.profile === 'VIEWER') return fail('ACCOUNTING_WRITE_FORBIDDEN', 'مجوز ثبت عملیات مالی ندارید.', 403);
  if (input.kind !== 'ALLOCATION' || !input.sourceAllocations || input.idempotencyKey.length < 8) return unknown();
  const commandHash = hashAccountingEvidence({ ...input, actor: undefined });
  return database.$transaction(async tx => {
    const initial = await resolveCustomerWorkspace(tx, accountId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-account:${initial.customerId}`}))`;
    const resolved = await resolveCustomerWorkspace(tx, accountId);
    if (resolved.customerId !== initial.customerId || !resolved.profile) return unknown();
    const identity = {
      idempotencyKey: input.idempotencyKey, profileId: resolved.profile.id, ownerId: input.actor.id, accountId, commandHash,
    };
    await serializeCustomerAllocationWithin(tx, resolved.profile.id);
    const canceled = await tx.accountingCustomerAllocationIntent.updateMany({
      where: { ...identity, state: 'PENDING' }, data: { state: 'CANCELED' },
    });
    if (canceled.count === 1) return { status: 'CANCELED' as const };
    const intent = await tx.accountingCustomerAllocationIntent.findFirst({ where: identity });
    if (intent?.state === 'CANCELED') return { status: 'CANCELED' as const };
    if (intent?.state === 'COMMITTED' && intent.result !== null) return { status: 'COMMITTED' as const, result: intent.result };
    return unknown();
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

/** The owner can rediscover a pending request on another device. Other actors
 * only learn that this account is blocked, never the command or owner. */
export async function readCustomerAllocationIntent(database: PrismaClient, accountId: string, actor: AllocationInput['actor']) {
  if (actor.profile === 'VIEWER') return fail('ACCOUNTING_WRITE_FORBIDDEN', 'مجوز ثبت عملیات مالی ندارید.', 403);
  const resolved = await resolveCustomerWorkspace(database, accountId);
  if (!resolved.profile) return unknown();
  const pending = await database.accountingCustomerAllocationIntent.findFirst({ where: { profileId: resolved.profile.id, state: 'PENDING' } });
  if (!pending) return unknown();
  if (pending.ownerId !== actor.id) return { status: 'BLOCKED' as const };
  return { status: 'PENDING' as const, accountId: pending.accountId, idempotencyKey: pending.idempotencyKey, command: pending.command };
}

/** Reconcile a known exact command, including terminal results. Missing or
 * mismatched evidence is never proof that a financial command did not run.
 * This is not an activation or cancellation authority and is not exposed. */
export async function readCustomerAllocationIntentByCommand(database: PrismaClient, accountId: string, input: AllocationInput) {
  if (input.actor.profile === 'VIEWER') return fail('ACCOUNTING_WRITE_FORBIDDEN', 'مجوز ثبت عملیات مالی ندارید.', 403);
  if (input.kind !== 'ALLOCATION' || !input.sourceAllocations || input.idempotencyKey.length < 8) return unknown();
  const resolved = await resolveCustomerWorkspace(database, accountId);
  if (!resolved.profile) return unknown();
  const intent = await database.accountingCustomerAllocationIntent.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (!intent || intent.profileId !== resolved.profile.id || intent.accountId !== accountId || intent.ownerId !== input.actor.id
    || intent.commandHash !== hashAccountingEvidence({ ...input, actor: undefined })) return unknown();
  if (intent.state === 'PENDING') return { status: 'PENDING' as const };
  if (intent.state === 'CANCELED') return { status: 'CANCELED' as const };
  if (intent.state === 'COMMITTED' && intent.result !== null) return { status: 'COMMITTED' as const, result: intent.result };
  return unknown();
}
