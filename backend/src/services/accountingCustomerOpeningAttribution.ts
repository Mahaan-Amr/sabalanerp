import { Prisma, type PrismaClient } from '@prisma/client';
import { requireCustomerSourceSharesWithin } from './customerSemanticCompatibility';
import { resolveCustomerWorkspace } from './accountingCustomerWorkspace';
import { customerOpeningSnapshot } from './accountingCustomerOpening';
import { AccountingCustomerTreasuryError, type CustomerTreasuryActor } from './accountingCustomerTreasury';
import { hashAccountingEvidence } from './accountingLedgerFoundation';
import { createAccountingLedgerPrismaRepository } from './accountingLedgerPrismaRepository';

export async function attributeCustomerOpening(database: PrismaClient, id: string, input: {
  lineKey: string; expectedSequence: number; expectedSnapshotHash: string; financialRecordId?: string; contractId?: string;
  reason: string; reference: string; confirmed: boolean; idempotencyKey: string; actor: CustomerTreasuryActor;
}) {
  const fail = (message: string): never => { throw new AccountingCustomerTreasuryError('OPENING_ATTRIBUTION_INVALID', message, 409); };
  if (input.actor.profile === 'VIEWER' || !input.confirmed || input.reason.trim().length < 8 || !input.reference.trim()
    || input.idempotencyKey.length < 8 || !Number.isSafeInteger(input.expectedSequence)) fail('مجوز، نسخه و مستندات انتساب لازم است.');
  return database.$transaction(async tx => {
    await requireCustomerSourceSharesWithin(tx);
    const resolved = await resolveCustomerWorkspace(tx, id);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-account:${resolved.customerId}`}))`;
    const review = resolved.profile ? await tx.accountingCustomerOpeningReview.findUnique({ where: { profileId: resolved.profile.id } }) : null;
    if (!review || !resolved.book) fail('افتتاحیه بررسی‌شده این مشتری پیدا نشد.');
    const hash = hashAccountingEvidence({ ...input, actor: undefined, openingReviewId: review!.id });
    const prior = await tx.accountingCustomerOpeningAttribution.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (prior) { if (prior.commandHash !== hash) fail('کلید انتساب برای اطلاعات دیگری استفاده شده است.'); return prior; }
    const evidence = review!.evidence as { review: { lines: Array<{ key: string }> } };
    if (!evidence.review.lines.some(line => line.key === input.lineKey)) fail('قلم افتتاحیه متعلق به بررسی مشتری نیست.');
    const latest = await tx.accountingCustomerOpeningAttribution.findFirst({ where: { openingReviewId: review!.id, lineKey: input.lineKey }, orderBy: { sequence: 'desc' } });
    if ((latest?.sequence ?? 0) !== input.expectedSequence) fail('انتساب این قلم تغییر کرده است؛ پرونده را به‌روز کنید.');
    const snapshot = await customerOpeningSnapshot(tx, { customerId: resolved.customerId, profileId: resolved.profile!.id,
      bookId: resolved.book!.id, basisAt: review!.basisAt });
    if (snapshot.snapshotHash !== input.expectedSnapshotHash
      || (input.contractId && !snapshot.contracts.some(row => row.id === input.contractId))
      || (input.financialRecordId && !snapshot.financialRecords.some(row => row.id === input.financialRecordId && (!input.contractId || row.contractId === input.contractId)))) fail('نسخه بررسی یا قرارداد و فاکتور با مشتری منطبق نیست.');
    const result = await tx.accountingCustomerOpeningAttribution.create({ data: { openingReviewId: review!.id, lineKey: input.lineKey,
      sequence: input.expectedSequence + 1, contractId: input.contractId, financialRecordId: input.financialRecordId,
      reason: input.reason.trim(), reference: input.reference.trim(), idempotencyKey: input.idempotencyKey, commandHash: hash, createdBy: input.actor.id } });
    await createAccountingLedgerPrismaRepository(tx, true).appendAudit({ action: 'CUSTOMER_OPENING_ATTRIBUTED', result: 'SUCCEEDED',
      actorId: input.actor.id, effectiveProfile: input.actor.profile, entityType: 'CUSTOMER_OPENING', entityId: review!.id,
      correlationId: input.idempotencyKey, reason: input.reason.trim(), payloadHash: hash });
    return result;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
}
