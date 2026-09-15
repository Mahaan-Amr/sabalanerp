import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { PartnerManagementCommandV2Schema, canonicalHash, partnerError,
  type PartnerManagementCommandV2Port, type Result } from '@sabalanerp/partner-sales-contracts';
import { authorizePartnerTechnicalRollout, lockPartnerOperationsControl } from '../authorization/technicalRollout';

type Transaction = Prisma.TransactionClient;
export interface PartnerResponderAssignmentDependencies {
  actorId: string;
  transaction<T>(run: (tx: Transaction) => Promise<T>): Promise<T>;
  authorize(tx: Transaction, request: { actorId: string; action: 'RESPONDER_ASSIGN'; purpose: 'MANAGEMENT';
    reason: string; root: { kind: 'PROFILE'; id: string } }): Promise<Result<{ evidenceId: string }>>;
  resolveResponder(tx: Transaction, input: { responderId: string }): Promise<Result<{
    responderId: string; eligibilityEvidence: Prisma.JsonObject;
  }>>;
  publishCommittedEvents?(eventIds: readonly string[]): Promise<void>;
}

export function createPrismaPartnerResponderAssignmentService(input:
  Omit<PartnerResponderAssignmentDependencies, 'transaction'> & { database: PrismaClient }) {
  return createPartnerResponderAssignmentService({ ...input, transaction: run => input.database.$transaction(async tx => {
    await lockPartnerOperationsControl(tx);
    return run(tx);
  }) });
}

function commandIntent(command: Extract<ReturnType<typeof PartnerManagementCommandV2Schema.parse>, { type: 'RESPONDER_ASSIGN' }>) {
  const { commandId: _commandId, correlationId: _correlationId, idempotency: _idempotency, ...intent } = command;
  return intent;
}

function decodeReceipt(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !['version', 'commandId', 'profileId', 'revision', 'eventIds'].includes(key)) ||
      row.version !== 1 || typeof row.commandId !== 'string' || typeof row.profileId !== 'string' ||
      !Number.isSafeInteger(row.revision) || !Array.isArray(row.eventIds) || row.eventIds.some(id => typeof id !== 'string')) return undefined;
  return { commandId: row.commandId, profileId: row.profileId, revision: row.revision as number, eventIds: row.eventIds as string[] };
}

/** Versioned default-responder aggregate. Historical assignments stay
 * append-only; every currently pending inquiry receives a new assignment in
 * the same transaction so no row remains stranded with the former responder. */
export function createPartnerResponderAssignmentService(
  dependencies: PartnerResponderAssignmentDependencies): PartnerManagementCommandV2Port {
  return { async execute(input) {
    const parsed = PartnerManagementCommandV2Schema.safeParse(input);
    if (!parsed.success || parsed.data.type !== 'RESPONDER_ASSIGN') return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    const command = parsed.data;
    const expectedHash = await canonicalHash(commandIntent(command));
    if (command.idempotency.actorId !== dependencies.actorId || command.idempotency.payloadHash !== expectedHash) {
      return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    }
    const result = await dependencies.transaction<Result<{
      commandId: string; replayed: boolean; profileId: string; revision: number; eventIds: readonly string[];
    }>>(async tx => {
      const identity = { actorId: dependencies.actorId, operation: command.type,
        targetScope: command.profileId, key: command.idempotency.key };
      const prior = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: identity } });
      if (prior) {
        if (prior.payloadHash !== expectedHash) return { ok: false, error: partnerError('IDEMPOTENCY_CONFLICT') };
        const receipt = decodeReceipt(prior.outcome);
        return receipt?.commandId === command.commandId
          ? { ok: true, value: { ...receipt, replayed: true } }
          : { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      }
      await tx.$queryRaw`SELECT id FROM partner_profiles WHERE id = ${command.profileId} FOR UPDATE`;
      const profile = await tx.partnerProfile.findUnique({ where: { id: command.profileId },
        select: { id: true, revision: true } });
      if (!profile) return { ok: false, error: partnerError('NOT_FOUND') };
      if (profile.revision !== command.expectedRevision) return { ok: false, error: partnerError('ROW_STALE') };
      const authorized = await dependencies.authorize(tx, { actorId: dependencies.actorId, action: 'RESPONDER_ASSIGN',
        purpose: 'MANAGEMENT', reason: command.reason, root: { kind: 'PROFILE', id: profile.id } });
      if (!authorized.ok) return authorized;
      const rollout = await authorizePartnerTechnicalRollout(tx, profile.id, 'CONTROL');
      if (!rollout.ok) return rollout;
      const responder = await dependencies.resolveResponder(tx, { responderId: command.responderId });
      if (!responder.ok) return responder;
      const eligible = await tx.user.findUnique({ where: { id: responder.value.responderId },
        select: { isActive: true, partnerProfile: { select: { id: true } } } });
      if (!eligible?.isActive || eligible.partnerProfile) return { ok: false, error: partnerError('NOT_ASSIGNED') };
      const current = await tx.partnerProfileResponderAssignment.findFirst({ where: { profileId: profile.id },
        orderBy: { revision: 'desc' }, select: { revision: true, responderId: true } });
      if (current?.responderId === responder.value.responderId) {
        return { ok: false, error: partnerError('STATE_CONFLICT') };
      }
      const assignment = await tx.partnerProfileResponderAssignment.create({ data: { id: randomUUID(), profileId: profile.id,
        revision: (current?.revision ?? 0) + 1, responderId: responder.value.responderId, actorId: dependencies.actorId,
        reason: command.reason, eligibilityEvidence: { ...responder.value.eligibilityEvidence,
          authorizationEvidenceId: authorized.value.evidenceId } } });
      const pendingInquiries = await tx.partnerInquiry.findMany({ where: { profileId: profile.id,
        rows: { some: { outcome: 'PENDING' } } }, select: { id: true }, orderBy: { id: 'asc' } });
      const inquiryEventIds: string[] = [];
      for (const pendingInquiry of pendingInquiries) {
        await tx.$queryRaw`SELECT id FROM partner_inquiries WHERE id = ${pendingInquiry.id} FOR UPDATE`;
        const currentInquiryAssignment = await tx.partnerInquiryAssignment.findFirst({ where: { inquiryId: pendingInquiry.id },
          orderBy: { revision: 'desc' }, select: { revision: true, responderId: true } });
        if (!currentInquiryAssignment) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
        if (currentInquiryAssignment.responderId === responder.value.responderId) continue;
        const nextAssignment = await tx.partnerInquiryAssignment.create({ data: { id: randomUUID(), inquiryId: pendingInquiry.id,
          revision: currentInquiryAssignment.revision + 1, responderId: responder.value.responderId,
          actorId: dependencies.actorId, reason: command.reason,
          eligibilityEvidence: { ...responder.value.eligibilityEvidence,
            authorizationEvidenceId: authorized.value.evidenceId, profileAssignmentId: assignment.id } } });
        const inquiry = await tx.partnerInquiry.update({ where: { id: pendingInquiry.id },
          data: { revision: { increment: 1 } }, select: { revision: true } });
        const eventId = randomUUID();
        await tx.partnerInquiryEvent.create({ data: { id: eventId, inquiryId: pendingInquiry.id,
          revision: inquiry.revision, actorId: dependencies.actorId, commandId: command.commandId,
          correlationId: command.correlationId, type: 'INQUIRY_REASSIGNED', reason: command.reason,
          evidence: { version: 1, responderId: responder.value.responderId, assignmentId: nextAssignment.id,
            assignmentRevision: nextAssignment.revision, authorizationEvidenceId: authorized.value.evidenceId,
            profileAssignmentId: assignment.id } } });
        inquiryEventIds.push(eventId);
      }
      const updated = await tx.partnerProfile.update({ where: { id: profile.id }, data: { revision: { increment: 1 } },
        select: { revision: true } });
      const receipt = { version: 1, commandId: command.commandId, profileId: profile.id,
        revision: updated.revision, eventIds: [assignment.id, ...inquiryEventIds] };
      await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), ...identity,
        payloadHash: expectedHash, outcome: receipt } });
      return { ok: true, value: { commandId: command.commandId, replayed: false, profileId: profile.id,
        revision: updated.revision, eventIds: [assignment.id, ...inquiryEventIds] } };
    });
    if (result.ok && !result.value.replayed && dependencies.publishCommittedEvents) {
      await dependencies.publishCommittedEvents(result.value.eventIds.slice(1));
    }
    return result;
  } };
}
