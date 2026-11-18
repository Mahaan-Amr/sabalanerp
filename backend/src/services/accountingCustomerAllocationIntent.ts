import { Prisma, type PrismaClient } from '@prisma/client';
import { AccountingCustomerTreasuryError } from './accountingCustomerTreasury';
import { hashAccountingEvidence } from './accountingLedgerFoundation';
import { resolveCustomerWorkspace, type recordCustomerWorkspaceTreasury } from './accountingCustomerWorkspace';
import { requireCustomerSourceSharesWithin } from './customerSemanticCompatibility';
import { serializeCustomerAllocationWithin } from './accountingCustomerAllocationFence';
import { createAccountingLedgerPrismaRepository } from './accountingLedgerPrismaRepository';

type AllocationInput = Parameters<typeof recordCustomerWorkspaceTreasury>[2];
const fail = (code: string, message: string, status = 409): never => { throw new AccountingCustomerTreasuryError(code, message, status); };
const unknown = () => ({ status: 'UNKNOWN' as const });
const allocationKey = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/**
 * Persist denial/recovery evidence only. This is not an activation authority,
 * does not call a financial writer.
 * Do not expose this until all writers and cancellation share a proven fence.
 */
export function prepareAdmittedCustomerAllocationIntent(database: PrismaClient, accountId: string, input: AllocationInput) {
  return prepareCustomerAllocationIntent(database, accountId, input, tx => requireCustomerSourceSharesWithin(tx, 'grouped-allocation'));
}

export async function prepareCustomerAllocationIntent(database: PrismaClient, accountId: string, input: AllocationInput,
  requireAdmission?: (tx: Prisma.TransactionClient) => Promise<void>) {
  if (input.actor.profile === 'VIEWER') return fail('ACCOUNTING_WRITE_FORBIDDEN', 'مجوز ثبت عملیات مالی ندارید.', 403);
  const plan = input.sourceAllocations;
  if (input.kind !== 'ALLOCATION' || !input.confirmed || input.amountRials !== 0n || input.allocations.length !== 0
    || input.receiptId || input.creditItemId || !plan?.length || plan.length > 100
    || !allocationKey.test(input.idempotencyKey)
    || !Number.isFinite(input.occurredAt.getTime()) || input.occurredAt > new Date()
    || !input.periodId || !input.postingRuleId || input.reason.trim().length < 8 || !input.reference.trim()
    || [input.periodId, input.postingRuleId, input.reason, input.reference].some(value => value.length > 4096)
    || [input.financialAccountId, input.bankLedgerId, input.receiptId, input.creditItemId, input.allocationId,
      input.supplierPartyId, input.parts, input.resolvedShares, input.expectedAmountRials, input.reversals,
      input.expectedSequence, input.collectionLedgerId, input.unpaidRials].some(value => value !== undefined)
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
      if (prior.profileId !== resolved.profile.id || prior.ownerId !== input.actor.id || prior.commandHash !== commandHash)
        return fail('ALLOCATION_INTENT_MISMATCH', 'این درخواست متعلق به اطلاعات یا حساب دیگری است.');
      return { status: prior.state, idempotencyKey: prior.idempotencyKey };
    }
    if (await tx.accountingCustomerCommand.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } }))
      return fail('ALLOCATION_INTENT_RECONCILIATION_REQUIRED', 'نتیجه درخواست قبلی باید بررسی شود.');
    await serializeCustomerAllocationWithin(tx, resolved.profile.id);
    if (await tx.accountingCustomerAllocationIntent.findFirst({ where: { profileId: resolved.profile.id, state: 'PENDING' }, select: { id: true } }))
      return fail('ALLOCATION_INTENT_PENDING', 'درخواست قبلی این حساب هنوز تعیین تکلیف نشده است.');
    const created = await tx.accountingCustomerAllocationIntent.create({ data: {
      profileId: resolved.profile.id, accountId: resolved.profile.id, ownerId: input.actor.id, idempotencyKey: input.idempotencyKey, commandHash, command,
    } });
    return { status: created.state, idempotencyKey: created.idempotencyKey };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

/** Cancel the exact command, reserving its key even if preparation never arrived. */
export async function cancelCustomerAllocationIntent(database: PrismaClient, accountId: string, input: AllocationInput) {
  if (input.actor.profile === 'VIEWER') return fail('ACCOUNTING_WRITE_FORBIDDEN', 'مجوز ثبت عملیات مالی ندارید.', 403);
  if (input.kind !== 'ALLOCATION' || !input.confirmed || !input.sourceAllocations || !allocationKey.test(input.idempotencyKey)) return unknown();
  const payload = { ...input, actor: undefined };
  const serialized = JSON.stringify(payload, (_key, value) => typeof value === 'bigint' ? value.toString() : value);
  if (Buffer.byteLength(serialized, 'utf8') > 1_000_000) return unknown();
  const commandHash = hashAccountingEvidence(payload);
  return database.$transaction(async tx => {
    const initial = await resolveCustomerWorkspace(tx, accountId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-account:${initial.customerId}`}))`;
    const resolved = await resolveCustomerWorkspace(tx, accountId);
    if (resolved.customerId !== initial.customerId || !resolved.profile) return unknown();
    const identity = {
      idempotencyKey: input.idempotencyKey, profileId: resolved.profile.id, ownerId: input.actor.id, commandHash,
    };
    await serializeCustomerAllocationWithin(tx, resolved.profile.id);
    await tx.$executeRaw`SELECT public.serialize_customer_command_key_within(${input.idempotencyKey})`;
    const recordCancellation = async (intentId: string) => {
      await createAccountingLedgerPrismaRepository(tx, true).appendAudit({
        action: 'CUSTOMER_ALLOCATION_INTENT_CANCELED', result: 'SUCCEEDED', actorId: identity.ownerId,
        effectiveProfile: input.actor.profile, entityType: 'CUSTOMER_ALLOCATION_INTENT', entityId: intentId,
        correlationId: identity.idempotencyKey, payloadHash: identity.commandHash,
      });
      return { status: 'CANCELED' as const };
    };
    const intent = await tx.accountingCustomerAllocationIntent.findFirst({ where: identity });
    if (intent?.state === 'PENDING') {
      const canceled = await tx.accountingCustomerAllocationIntent.updateMany({
        where: { id: intent.id, state: 'PENDING' }, data: { state: 'CANCELED' },
      });
      if (canceled.count !== 1) return fail('ALLOCATION_INTENT_CHANGED', 'وضعیت درخواست تغییر کرد؛ پرونده را به‌روز کنید.');
      return recordCancellation(intent.id);
    }
    if (intent?.state === 'CANCELED') return { status: 'CANCELED' as const };
    if (intent?.state === 'COMMITTED' && intent.result !== null) return { status: 'COMMITTED' as const, result: intent.result };
    const prior = await tx.accountingCustomerCommand.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (prior) {
      return prior.kind === 'ALLOCATION' && prior.profileId === identity.profileId &&
        prior.createdBy === identity.ownerId && prior.commandHash === commandHash
        ? { status: 'COMMITTED' as const, result: prior.result } : unknown();
    }
    const tombstone = await tx.accountingCustomerAllocationIntent.createMany({
      data: { ...identity, accountId: identity.profileId, command: JSON.parse(serialized), state: 'CANCELED' },
      skipDuplicates: true,
    });
    if (tombstone.count !== 1) return unknown();
    const created = await tx.accountingCustomerAllocationIntent.findUniqueOrThrow({
      where: { idempotencyKey: identity.idempotencyKey },
    });
    return recordCancellation(created.id);
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
  if (pending.ownerId !== actor.id) return actor.profile === 'ACCOUNTING_MANAGER'
    ? { status: 'BLOCKED' as const, reconciliationId: pending.id }
    : { status: 'BLOCKED' as const };
  return { status: 'PENDING' as const, accountId: pending.profileId, idempotencyKey: pending.idempotencyKey, command: pending.command };
}

export async function reconcileCustomerAllocationIntent(database: PrismaClient, accountId: string, input: {
  intentId: string; reason: string; actor: AllocationInput['actor'];
}) {
  if (input.actor.profile !== 'ACCOUNTING_MANAGER') return fail('ACCOUNTING_WRITE_FORBIDDEN', 'مجوز تعیین تکلیف درخواست را ندارید.', 403);
  const reason = input.reason.trim();
  if (!input.intentId || input.intentId.length > 128 || reason.length < 8 || reason.length > 4096) {
    return fail('ACCOUNTING_EVIDENCE_REQUIRED', 'شناسه درخواست و دلیل مستند لغو لازم است.', 400);
  }
  return database.$transaction(async tx => {
    const initial = await resolveCustomerWorkspace(tx, accountId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-account:${initial.customerId}`}))`;
    const resolved = await resolveCustomerWorkspace(tx, accountId);
    if (resolved.customerId !== initial.customerId || !resolved.profile) return unknown();
    const intent = await tx.accountingCustomerAllocationIntent.findFirst({
      where: { id: input.intentId, profileId: resolved.profile.id },
    });
    if (!intent) return unknown();
    if (intent.state === 'CANCELED') return { status: 'CANCELED' as const };
    if (intent.state === 'COMMITTED') return { status: 'COMMITTED' as const };
    await serializeCustomerAllocationWithin(tx, resolved.profile.id);
    const changed = await tx.accountingCustomerAllocationIntent.updateMany({
      where: { id: intent.id, state: 'PENDING' }, data: { state: 'CANCELED' },
    });
    if (changed.count !== 1) return fail('ALLOCATION_INTENT_CHANGED', 'وضعیت درخواست تغییر کرد؛ پرونده را به‌روز کنید.');
    await createAccountingLedgerPrismaRepository(tx, true).appendAudit({
      action: 'CUSTOMER_ALLOCATION_INTENT_RECONCILED', result: 'SUCCEEDED', actorId: input.actor.id,
      effectiveProfile: input.actor.profile, entityType: 'CUSTOMER_ALLOCATION_INTENT', entityId: intent.id,
      correlationId: intent.idempotencyKey, reason, payloadHash: intent.commandHash,
    });
    return { status: 'CANCELED' as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
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
  if (!intent || intent.profileId !== resolved.profile.id || intent.ownerId !== input.actor.id
    || intent.commandHash !== hashAccountingEvidence({ ...input, actor: undefined })) return unknown();
  if (intent.state === 'PENDING') return { status: 'PENDING' as const };
  if (intent.state === 'CANCELED') return { status: 'CANCELED' as const };
  if (intent.state === 'COMMITTED' && intent.result !== null) return { status: 'COMMITTED' as const, result: intent.result };
  return unknown();
}
