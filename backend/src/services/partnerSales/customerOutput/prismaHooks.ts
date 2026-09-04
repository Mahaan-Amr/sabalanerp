import crypto, { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import * as contracts from '@sabalanerp/partner-sales-contracts';
import { prisma as applicationPrisma } from '../../../lib/prisma';
import smsService from '../../smsService';
import type { PartnerConfirmationHooks, PublicCustomerConfirmation } from './existingFlow';
import type { RequestEvidenceMeta, SendConfirmationResult } from '../../contractConfirmationService';
import { createCustomerOutputSnapshots } from './snapshots';
import { createPartnerCaseLifecycleService, readCurrentPartnerCaseViews } from '../cases/lifecycle';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { readAuthorizationDecisionByCorrelation } from '../../effectiveAuthorization/audit';
import { authorizePartnerTechnicalRollout, lockPartnerOperationsControl } from '../authorization/technicalRollout';
import { createPrismaPartnerRetailCorrectionService } from '../corrections/prismaRetailCorrection';

export function createPrismaPartnerConfirmationHooks(input: { database?: PrismaClient;
  sms?: Pick<typeof smsService, 'sendContractConfirmationMessage'> } = {}): PartnerConfirmationHooks {
const prisma = input.database ?? applicationPrisma;
const sms = input.sms ?? smsService;

const snapshots = createCustomerOutputSnapshots(contracts);
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const normalize = (value: string) => {
  const digits = value.replace(/\D/g, '');
  return digits.startsWith('0098') ? `+98${digits.slice(4)}` : digits.startsWith('98') ? `+${digits}`
    : digits.startsWith('0') ? `+98${digits.slice(1)}` : digits.startsWith('9') ? `+98${digits}` : value;
};
const localPhone = (value: string) => value.startsWith('+98') ? `0${value.slice(3)}` : value;
const ttlDays = () => Number.parseInt(process.env.CONTRACT_CONFIRM_LINK_TTL_DAYS || '60', 10);
const otpMinutes = () => Number.parseInt(process.env.CONTRACT_CONFIRM_OTP_TTL_MINUTES || '10', 10);
const maxAttempts = () => Number.parseInt(process.env.CONTRACT_CONFIRM_MAX_ATTEMPTS || '5', 10);
const frontendUrl = () => process.env.FRONTEND_URL || 'http://localhost:3000';

class Rollback extends Error {
  constructor(readonly result: SendConfirmationResult | { success: false; error: string }) { super('rollback Partner customer output'); }
}

function safeError(code: contracts.PartnerErrorCode) {
  return contracts.partnerError(code).message;
}

async function authorization(tx: Prisma.TransactionClient, input: { actorId: string; caseId: string; correlationId: string }) {
  const decision = await createAuditedPartnerAuthorization(tx, { actorId: input.actorId,
    purpose: 'CUSTOMER_OUTPUT', channel: 'API' }, { correlationId: input.correlationId })
    .authorize('CUSTOMER_OUTPUT', { kind: 'CASE', id: input.caseId });
  if (!decision.ok) return decision;
  const evidence = await readAuthorizationDecisionByCorrelation(tx, { domain: 'PARTNER', actorId: input.actorId,
    action: 'CUSTOMER_OUTPUT', rootKind: 'CASE', rootId: input.caseId, purpose: 'CUSTOMER_OUTPUT', channel: 'API',
    correlationId: input.correlationId, allowed: true });
  return evidence ? { ok: true as const, value: { evidenceId: evidence.id } }
    : { ok: false as const, error: contracts.partnerError('INTEGRITY_CONFLICT') };
}

function lifecycle(tx: Prisma.TransactionClient, actorId: string, correlationId: string) {
  return createPartnerCaseLifecycleService({ actorId, cancellationPurpose: 'PARTNER', transaction: work => work(tx),
    authorize: async (_tx, request) => authorization(tx, { actorId: request.actorId, caseId: request.root.id, correlationId }),
    verifyOutputEvidence: async () => ({ ok: false, error: contracts.partnerError('STATE_CONFLICT') }),
    cancelConfirmationSessions: async (_tx, request) => {
      const rows = await tx.contractPublicConfirmation.findMany({ where: { contract: { partnerCaseId: request.caseId }, status: 'PENDING' },
        select: { id: true } });
      await tx.contractPublicConfirmation.updateMany({ where: { id: { in: rows.map(row => row.id) } },
        data: { status: 'CANCELLED', cancelledAt: new Date() } });
      return { ok: true, value: { invalidatedSessionIds: rows.map(row => row.id), preservedSnapshotIds: [] } };
    },
    recordEvidenceReview: async (_tx, review) => {
      const id = randomUUID();
      await tx.partnerCommandOutcome.create({ data: { id, actorId, operation: 'CUSTOMER_OUTPUT_INTEGRITY_REVIEW',
        targetScope: review.caseId, key: id, payloadHash: await contracts.canonicalHash(review.evidence),
        outcome: json({ schemaVersion: 1, correlationId: review.correlationId, evidence: review.evidence }) } });
    },
  });
}

async function caseOutput(tx: Prisma.TransactionClient, contractId: string) {
  await tx.$queryRaw`SELECT id FROM sales_contracts WHERE id = ${contractId} FOR UPDATE`;
  const row = await tx.salesContract.findUnique({ where: { id: contractId }, select: {
    id: true, partnerKind: true, partnerCaseId: true, contractNumber: true, customerId: true,
    partnerCase: { select: { id: true, state: true, headRevision: true, integrityHash: true,
      committedRevision: true,
      profile: { select: { id: true, userId: true } },
      head: { select: { customerProjection: true } },
      corrections: { where: { scope: 'RETAIL_ONLY' }, orderBy: { approvedAt: 'desc' }, take: 1,
        include: { save: { include: { successor: { select: { integrityHash: true,
          customerProjection: true } } } }, gates: { where: { kind: 'CUSTOMER_CONFIRM' } } } } } },
  } });
  if (!row || row.partnerKind !== 'PARTNER_CUSTOMER' || !row.partnerCaseId || !row.partnerCase) return row ? 'ORDINARY' as const : null;
  const correction = row.partnerCase.corrections[0];
  const pendingRetailCorrection = row.partnerCase.state === 'COMMITTED' &&
    Boolean(correction?.save) && correction!.save!.successorRevision !== row.partnerCase.headRevision && correction!.gates.length === 0;
  const selected = pendingRetailCorrection ? correction!.save!.successor : row.partnerCase.head;
  const owner = pendingRetailCorrection ? { caseId: row.partnerCase.id,
    revision: correction!.save!.successorRevision, integrityHash: correction!.save!.successor.integrityHash }
    : { caseId: row.partnerCase.id, revision: row.partnerCase.headRevision, integrityHash: row.partnerCase.integrityHash };
  const content = contracts.CustomerContractOutputSchema.safeParse(selected.customerProjection);
  if (!content.success || content.data.contractNumber !== row.contractNumber || content.data.revision !== owner.revision) return null;
  return { contract: row, case: row.partnerCase, owner, content: content.data, pendingRetailCorrection };
}

function snapshotId(createdBy: string | null) {
  return createdBy?.startsWith('partner-output:') ? createdBy.slice('partner-output:'.length) : undefined;
}

async function readSnapshot(tx: Prisma.TransactionClient, session: { createdBy: string | null; contractId: string }) {
  const id = snapshotId(session.createdBy);
  const record = id ? await tx.partnerCustomerOutputSnapshot.findUnique({ where: { id } }) : null;
  const parsed = record && await snapshots.read(record.content);
  return parsed && record.contractNumber === parsed.content.contractNumber ? parsed : undefined;
}

async function send(input: { contractId: string; requestedBy: string; resend?: boolean; explicitToken?: string; meta?: RequestEvidenceMeta }) {
  let delivery: { phone: string; otp: string; contractNumber: string; customerName: string } | undefined;
  let response: SendConfirmationResult;
  try {
    response = await prisma.$transaction(async tx => {
      await lockPartnerOperationsControl(tx);
      const source = await caseOutput(tx, input.contractId);
      if (source === 'ORDINARY') return undefined as unknown as SendConfirmationResult;
      if (!source) throw new Rollback({ success: false, error: safeError('NOT_FOUND') });
      const correlationId = randomUUID();
      const allowed = await authorization(tx, { actorId: input.requestedBy, caseId: source.case.id, correlationId });
      if (!allowed.ok) throw new Rollback({ success: false, error: allowed.error.message });
      const rollout = await authorizePartnerTechnicalRollout(tx, source.case.profile.id, 'MUTATE');
      if (!rollout.ok) throw new Rollback({ success: false, error: rollout.error.message });
      if (!['DRAFT', 'AWAITING_CUSTOMER_CONFIRMATION'].includes(source.case.state) && !source.pendingRetailCorrection) {
        throw new Rollback({ success: false, error: safeError('STATE_CONFLICT') });
      }
      const recipient = normalize(source.content.customer.phone);
      if (!/^\+98\d{10}$/.test(recipient)) throw new Rollback({ success: false, error: safeError('INVALID_PAYLOAD') });
      const now = new Date();
      const linkExpiresAt = new Date(now.getTime() + ttlDays() * 86_400_000);
      const otpExpiresAt = new Date(now.getTime() + otpMinutes() * 60_000);
      const previous = await tx.contractPublicConfirmation.findFirst({ where: { contractId: input.contractId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' } });
      let snapshot = previous && await readSnapshot(tx, previous);
      if (!snapshot || contracts.checkExpectedRevision(snapshot.owner, source.owner) || snapshot.normalizedRecipient !== recipient) {
        snapshot = undefined;
      }
      if (!snapshot) {
        const { seller, outputHash: _outputHash, ...retail } = source.content;
        snapshot = await snapshots.mint({ snapshotId: randomUUID(), owner: source.owner, normalizedRecipient: recipient,
          createdAt: now.toISOString(), expiresAt: linkExpiresAt.toISOString(), business: {
            legalName: seller.displayName, businessPhone: seller.phone, businessAddress: seller.address,
          }, retail: { ...retail, status: 'PENDING_APPROVAL', confirmation: 'PENDING' } });
        await tx.contractPublicConfirmation.updateMany({ where: { contractId: input.contractId, status: 'PENDING' },
          data: { status: 'CANCELLED', cancelledAt: now } });
        await tx.partnerCustomerOutputSnapshot.create({ data: { id: snapshot.snapshotId, caseId: source.case.id,
          caseRevision: source.owner.revision, integrityHash: source.owner.integrityHash,
          contentHash: snapshot.content.outputHash, contractNumber: source.contract.contractNumber,
          recipient, expiresAt: linkExpiresAt, content: json(snapshot), commandId: randomUUID() } });
      }
      const rawToken = input.explicitToken || crypto.randomBytes(32).toString('hex');
      const otp = String(crypto.randomInt(100000, 1_000_000));
      const active = previous && snapshotId(previous.createdBy) === snapshot.snapshotId && previous.status === 'PENDING';
      const session = active ? await tx.contractPublicConfirmation.update({ where: { id: previous.id }, data: {
        tokenHash: hash(rawToken), otpCodeHash: hash(otp), otpExpiresAt, attemptsUsed: 0,
        resendCount: { increment: 1 }, lastSentAt: now,
      } }) : await tx.contractPublicConfirmation.create({ data: { contractId: input.contractId, tokenHash: hash(rawToken),
        phoneNumber: localPhone(recipient), otpCodeHash: hash(otp), otpExpiresAt, linkExpiresAt: snapshot.expiresAt,
        maxAttempts: maxAttempts(), lastSentAt: now, resendCount: input.resend ? 1 : 0,
        createdBy: `partner-output:${snapshot.snapshotId}` } });
      if (source.case.state === 'DRAFT') {
        const transitioned = await lifecycle(tx, input.requestedBy, correlationId).markAwaitingCustomerConfirmation({
          expected: snapshot.owner, commandId: randomUUID(), correlationId, snapshotId: snapshot.snapshotId,
        });
        if (!transitioned.ok) throw new Rollback({ success: false, error: transitioned.error.message });
      }
      await tx.contractConfirmationAuditLog.create({ data: { contractId: input.contractId, sessionId: session.id,
        eventType: 'PARTNER_CONFIRMATION_QUEUED', eventPayloadJson: json({ snapshotId: snapshot.snapshotId,
          linkExpiresAt: snapshot.expiresAt, otpExpiresAt: otpExpiresAt.toISOString(), resend: Boolean(input.resend) }),
        ipAddress: input.meta?.ipAddress, userAgent: input.meta?.userAgent } });
      delivery = { phone: localPhone(recipient), otp, contractNumber: source.contract.contractNumber,
        customerName: source.content.customer.displayName };
      return { success: true, data: { contractId: input.contractId, status: 'PENDING_APPROVAL', phoneNumber: localPhone(recipient),
        publicLink: `${frontendUrl()}/contracts/confirm/${rawToken}`, expiresAt: snapshot.expiresAt,
        otpExpiresAt: otpExpiresAt.toISOString(),
        ...(process.env.SMS_IR_ENVIRONMENT === 'sandbox' && process.env.NODE_ENV !== 'production' ? { debugOtp: otp } : {}) } };
    });
  } catch (error) {
    if (error instanceof Rollback) return error.result;
    return { success: false, error: safeError('INTEGRITY_CONFLICT') };
  }
  if (!delivery) return response;
  try {
    const sent = await sms.sendContractConfirmationMessage({ phoneNumber: delivery.phone, code: delivery.otp,
      customerName: delivery.customerName, contractNumber: delivery.contractNumber });
    if (!sent.success) return { success: false, error: sent.error || 'ارسال پیامک تایید انجام نشد' };
    if (response.data && sent.messageId) response.data.messageId = String(sent.messageId);
  } catch { return { success: false, error: 'ارسال پیامک تایید انجام نشد' }; }
  return response;
}

async function publicSession(where: { tokenHash?: string; contract?: { contractNumber: string }; phoneNumber?: string }) {
  return prisma.contractPublicConfirmation.findFirst({ where: { ...where, contract: { ...where.contract,
    partnerKind: 'PARTNER_CUSTOMER' } }, orderBy: { createdAt: 'desc' } });
}

async function getPublic(session: Awaited<ReturnType<typeof publicSession>>, meta?: RequestEvidenceMeta) {
  if (!session) return { success: false, error: safeError('NOT_FOUND') };
  return prisma.$transaction(async tx => {
    const locked = await tx.contractPublicConfirmation.findUnique({ where: { id: session.id } });
    const snapshot = locked && await readSnapshot(tx, locked);
    const source = locked && await caseOutput(tx, locked.contractId);
    if (!locked || !snapshot || !source || source === 'ORDINARY' || locked.status === 'CANCELLED' || locked.linkExpiresAt <= new Date()) {
      return { success: false, error: safeError('NOT_FOUND') };
    }
    const disposition = snapshots.disposition(snapshot, { owner: source.owner, contractNumber: source.contract.contractNumber,
      normalizedRecipient: normalize(source.content.customer.phone), state: source.case.state },
    locked.verifiedAt?.toISOString() || null, new Date().toISOString());
    await tx.contractConfirmationAuditLog.create({ data: { contractId: locked.contractId, sessionId: locked.id,
      eventType: 'PARTNER_LINK_OPENED', eventPayloadJson: json({ snapshotId: snapshot.snapshotId }),
      ipAddress: meta?.ipAddress, userAgent: meta?.userAgent } });
    return { success: true, data: { contract: snapshot.content, verifiedAt: locked.verifiedAt?.toISOString() || null,
      linkExpiresAt: snapshot.expiresAt, ...disposition } satisfies PublicCustomerConfirmation };
  });
}

async function verify(session: Awaited<ReturnType<typeof publicSession>>, code: string) {
  if (!session || !/^\d{6}$/.test(code)) return { success: false, error: safeError('NOT_FOUND') };
  try {
    return await prisma.$transaction(async tx => {
      await lockPartnerOperationsControl(tx);
      await tx.$queryRaw`SELECT id FROM contract_public_confirmations WHERE id = ${session.id} FOR UPDATE`;
      const current = await tx.contractPublicConfirmation.findUnique({ where: { id: session.id } });
      const snapshot = current && await readSnapshot(tx, current);
      const source = current && await caseOutput(tx, current.contractId);
      if (!current || !snapshot || !source || source === 'ORDINARY' || current.status !== 'PENDING' ||
          current.otpExpiresAt <= new Date() || current.attemptsUsed >= current.maxAttempts) {
        throw new Rollback({ success: false, error: safeError('NOT_FOUND') });
      }
      const left = Buffer.from(hash(code)), right = Buffer.from(current.otpCodeHash);
      if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
        await tx.contractPublicConfirmation.update({ where: { id: current.id }, data: { attemptsUsed: { increment: 1 } } });
        return { success: false, error: 'کد تایید نامعتبر است' };
      }
      const verifiedAt = new Date();
      const correlationId = randomUUID();
      snapshots.disposition(snapshot, { owner: source.owner, contractNumber: source.contract.contractNumber,
        normalizedRecipient: normalize(source.content.customer.phone), state: source.case.state }, null, verifiedAt.toISOString());
      if (!source.pendingRetailCorrection) {
        const approved = await lifecycle(tx, source.case.profile.userId, correlationId).markCustomerApproved({
          expected: snapshot.owner, commandId: randomUUID(), correlationId,
            snapshotId: snapshot.snapshotId, verifiedAt: verifiedAt.toISOString() });
        if (!approved.ok) throw new Rollback({ success: false, error: approved.error.message });
      }
      await tx.contractPublicConfirmation.update({ where: { id: current.id }, data: { status: 'VERIFIED', verifiedAt } });
      if (source.pendingRetailCorrection) {
        const correction = source.case.corrections[0];
        const commandId = `customer-confirm:${current.id}`;
        const intent = { type: 'CORRECTION_GATE' as const, expected: snapshot.owner, expectedState: 'COMMITTED' as const,
          correctionId: correction.id, gate: 'CUSTOMER_CONFIRM' as const, outcome: 'APPROVE' as const,
          evidenceId: snapshot.snapshotId, reason: 'تأیید مشتری با کد یک‌بارمصرف' };
        const effective = await createPrismaPartnerRetailCorrectionService({ database: prisma, transaction: tx,
          actorId: source.case.profile.userId, correlationId, reason: intent.reason }).execute({ schemaVersion: 1,
          ...intent, commandId, correlationId, idempotency: { actorId: source.case.profile.userId,
            operation: intent.type, targetId: source.case.id, key: commandId, payloadHash: await contracts.canonicalHash(intent) } });
        if (!effective.ok) throw new Rollback({ success: false, error: effective.error.message });
        await tx.contractConfirmationAuditLog.create({ data: { contractId: current.contractId, sessionId: current.id,
          eventType: 'PARTNER_RETAIL_CORRECTION_CONFIRMED', eventPayloadJson: json({ snapshotId: snapshot.snapshotId,
            correctionId: correction.id, commandId, correlationId }) } });
      }
      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
      return { success: true, data: { status: 'APPROVED', verifiedAt: verifiedAt.toISOString() } };
    });
  } catch (error) {
    return error instanceof Rollback ? error.result : { success: false, error: safeError('INTEGRITY_CONFLICT') };
  }
}

  return {
    async sendForConfirmation(input) {
      const contract = await prisma.salesContract.findUnique({ where: { id: input.contractId }, select: { partnerKind: true } });
      return contract?.partnerKind === 'PARTNER_CUSTOMER' ? send(input) : undefined;
    },
    async getPublicContractByToken(token, meta) {
      const session = await publicSession({ tokenHash: hash(token) });
      return session ? getPublic(session, meta) : undefined;
    },
    async getPublicContractByManualLookup(input) {
      const session = await publicSession({ contract: { contractNumber: input.contractNumber },
        phoneNumber: localPhone(normalize(input.phoneNumber)) });
      return session ? getPublic(session, input.meta) : undefined;
    },
    async verifyPublicOtp(input) {
      const session = await publicSession({ tokenHash: hash(input.token) });
      return session ? verify(session, input.code) : undefined;
    },
    async verifyPublicOtpByManualLookup(input) {
      const session = await publicSession({ contract: { contractNumber: input.contractNumber },
        phoneNumber: localPhone(normalize(input.phoneNumber)) });
      return session ? verify(session, input.code) : undefined;
    },
    async resendFromPublicToken(input) {
      const session = await publicSession({ tokenHash: hash(input.token) });
      const owner = session && await prisma.salesContract.findUnique({ where: { id: session.contractId },
        select: { partnerCase: { select: { profile: { select: { userId: true } } } } } });
      return session && owner?.partnerCase ? send({ contractId: session.contractId, requestedBy: owner.partnerCase.profile.userId,
        resend: true, explicitToken: input.token, meta: input.meta }) : undefined;
    },
    async resendFromManualLookup(input) {
      const session = await publicSession({ contract: { contractNumber: input.contractNumber },
        phoneNumber: localPhone(normalize(input.phoneNumber)) });
      const owner = session && await prisma.salesContract.findUnique({ where: { id: session.contractId },
        select: { partnerCase: { select: { profile: { select: { userId: true } } } } } });
      return session && owner?.partnerCase ? send({ contractId: session.contractId, requestedBy: owner.partnerCase.profile.userId,
        resend: true, meta: input.meta }) : undefined;
    },
    async cancelContract(input) {
      const source = await prisma.salesContract.findUnique({ where: { id: input.contractId }, select: { partnerKind: true } });
      if (source?.partnerKind !== 'PARTNER_CUSTOMER') return undefined;
      return { success: false, error: safeError('FORBIDDEN') };
    },
  };
}
