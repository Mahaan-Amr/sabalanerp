import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  InquiryIdentitySchema, PartnerCommandSchema, PartnerConfigurationRefSchema,
  InquiryBatchResultSchema, PartnerInquiryViewV2Schema, PartnerQueryV2Schema, PersianReasonSchema, TextSchema,
  ResponderInquiryViewV2Schema,
  canonicalHash, partnerError,
  type InquiryIdentity, type PartnerCommand, type PartnerCommandPort, type PartnerQueryV2Port, type Result,
} from '@sabalanerp/partner-sales-contracts';
import { authorizePartnerTechnicalRollout } from '../authorization/technicalRollout';

type ConfigurationRef = { recoveryId: string; recoveryRevision: number; productRowId: string };
type Definition = { version: 1; configurationRef: ConfigurationRef; identity: InquiryIdentity;
  description: string; configuration: Array<{ label: string; value: string }>; predecessorReason?: string };

function parseDefinition(value: unknown): Definition | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !['version', 'configurationRef', 'identity', 'description', 'configuration', 'predecessorReason'].includes(key)) ||
      row.version !== 1 || !Array.isArray(row.configuration)) return undefined;
  const reference = PartnerConfigurationRefSchema.safeParse(row.configurationRef);
  const identity = InquiryIdentitySchema.safeParse(row.identity);
  const description = TextSchema.safeParse(row.description);
  const configuration: Array<{ label: string; value: string }> = [];
  for (const item of row.configuration) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['label', 'value'].includes(key))) return undefined;
    const label = TextSchema.safeParse((item as Record<string, unknown>).label);
    const fieldValue = TextSchema.safeParse((item as Record<string, unknown>).value);
    if (!label.success || !fieldValue.success) return undefined;
    configuration.push({ label: label.data, value: fieldValue.data });
  }
  const reason = row.predecessorReason === undefined ? undefined : PersianReasonSchema.safeParse(row.predecessorReason);
  if (!reference.success || !identity.success || !description.success || (reason && !reason.success)) return undefined;
  return { version: 1, configurationRef: reference.data, identity: identity.data,
    description: description.data, configuration, ...(reason?.success ? { predecessorReason: reason.data } : {}) };
}
type Transaction = Prisma.TransactionClient;
type AuthorizationRequest = { actorId: string; action: 'INQUIRY_READ' | 'INQUIRY_WRITE' | 'INQUIRY_RESPOND' | 'RESPONDER_REASSIGN';
  purpose: 'PARTNER' | 'RESPONDER' | 'MANAGEMENT'; reason?: string;
  root: { kind: 'PROFILE' | 'INQUIRY'; id: string } };

export interface PartnerInquiryDependencies {
  actorId: string;
  transaction<T>(run: (tx: Transaction) => Promise<T>): Promise<T>;
  authorize(tx: Transaction, request: AuthorizationRequest): Promise<Result<{ evidenceId: string }>>;
  resolveInitialResponder(tx: Transaction, input: { profileId: string }): Promise<Result<{
    responderId: string; eligibilityEvidence: Prisma.JsonObject;
    profileAssignmentId?: string; profileAssignmentRevision?: number; assignedByActorId?: string;
  }>>;
  resolveResponder?(tx: Transaction, input: { responderId: string }): Promise<Result<{
    responderId: string; eligibilityEvidence: Prisma.JsonObject;
  }>>;
  ensureMissingResponderSupport?(tx: Transaction, input: { profileId: string; reporterId: string }): Promise<Result<{
    id: string; referenceCode: string;
  }>>;
  /** Post-commit source event handoff. Delivery failure never rolls back the
   * committed inquiry and the durable event id remains retryable by #334. */
  publishCommittedEvents?(eventIds: readonly string[]): Promise<void>;
  resolveConfiguration(tx: Transaction, input: { actorId: string; reference: ConfigurationRef }): Promise<Result<{
    identity: InquiryIdentity; description: string; configuration: Array<{ label: string; value: string }>;
  }>>;
}

async function publishCommitted<T extends Result<{ replayed: boolean; eventIds: readonly string[] }>>(
  dependencies: PartnerInquiryDependencies, work: Promise<T>): Promise<T> {
  const result = await work;
  if (result.ok && !result.value.replayed && result.value.eventIds.length && dependencies.publishCommittedEvents) {
    try { await dependencies.publishCommittedEvents(result.value.eventIds); } catch { /* committed source remains retryable */ }
  }
  return result;
}

export function createPrismaPartnerInquiryService(input: Omit<PartnerInquiryDependencies, 'transaction'> & { database: PrismaClient }) {
  return createPartnerInquiryService({ ...input, transaction: run => input.database.$transaction(run) });
}

function decodeReceipt(value: unknown): { commandId: string; eventIds: string[] } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !['version', 'commandId', 'eventIds'].includes(key)) || row.version !== 1 ||
      typeof row.commandId !== 'string' || !Array.isArray(row.eventIds) || row.eventIds.some(id => typeof id !== 'string')) return undefined;
  return { commandId: row.commandId, eventIds: row.eventIds as string[] };
}

function commandIntent(command: PartnerCommand): Record<string, unknown> {
  const { commandId: _commandId, correlationId: _correlationId, idempotency: _idempotency, ...intent } = command;
  return intent;
}

function decodeDecisionReceipt(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !['version', 'commandId', 'eventIds', 'batch'].includes(key)) || row.version !== 1) return undefined;
  const receipt = decodeReceipt({ version: row.version, commandId: row.commandId, eventIds: row.eventIds });
  const batch = InquiryBatchResultSchema.safeParse(row.batch);
  return receipt && batch.success ? { ...receipt, batch: batch.data } : undefined;
}

async function decideInquiry(dependencies: PartnerInquiryDependencies,
  command: Extract<PartnerCommand, { type: 'INQUIRY_DECIDE' }>) {
  const expectedHash = await canonicalHash(commandIntent(command));
  if (command.idempotency.actorId !== dependencies.actorId || command.idempotency.targetId !== command.inquiryId ||
      command.idempotency.payloadHash !== expectedHash) return { ok: false, error: partnerError('INVALID_PAYLOAD') } as const;
  return dependencies.transaction(async tx => {
    const identity = { actorId: dependencies.actorId, operation: command.type,
      targetScope: command.inquiryId, key: command.idempotency.key };
    const prior = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: identity } });
    if (prior) {
      if (prior.payloadHash !== expectedHash) return { ok: false, error: partnerError('IDEMPOTENCY_CONFLICT') } as const;
      const receipt = decodeDecisionReceipt(prior.outcome);
      return receipt?.commandId === command.commandId
        ? { ok: true, value: { commandId: receipt.commandId, replayed: true, batch: receipt.batch, eventIds: receipt.eventIds } } as const
        : { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as const;
    }
    await tx.$queryRaw`SELECT id FROM partner_inquiries WHERE id = ${command.inquiryId} FOR UPDATE`;
    const inquiry = await tx.partnerInquiry.findUnique({ where: { id: command.inquiryId },
      select: { id: true, profileId: true, revision: true } });
    if (!inquiry) return { ok: false, error: partnerError('NOT_FOUND') } as const;
    const authorization = await dependencies.authorize(tx, { actorId: dependencies.actorId,
      action: 'INQUIRY_RESPOND', purpose: 'RESPONDER', reason: command.decisions.map(decision =>
        decision.outcome === 'REJECTED' ? decision.reason : decision.note ?? 'پاسخ قیمت مصوب').join('؛ '),
      root: { kind: 'INQUIRY', id: inquiry.id } });
    if (!authorization.ok) return authorization;
    const rollout = await authorizePartnerTechnicalRollout(tx, inquiry.profileId, 'MUTATE');
    if (!rollout.ok) return rollout;
    const assignment = await tx.partnerInquiryAssignment.findFirst({ where: { inquiryId: inquiry.id },
      orderBy: { revision: 'desc' }, select: { id: true, revision: true, responderId: true } });
    if (!assignment || assignment.revision !== command.expectedAssignmentRevision || assignment.responderId !== dependencies.actorId) {
      return { ok: false, error: partnerError(assignment ? 'ROW_STALE' : 'NOT_ASSIGNED') } as const;
    }
    const rows = await tx.partnerInquiryRow.findMany({ where: { inquiryId: inquiry.id,
      id: { in: command.decisions.map(decision => decision.rowId) } }, select: {
      id: true, revision: true, outcome: true, definition: true, predecessorId: true,
      predecessor: { select: { approval: { select: { id: true } } } },
    } });
    const outcomes: Array<{ ok: true; rowId: string; outcomeId: string; revision: number; outcome: 'APPROVED' | 'REJECTED' } |
      { ok: false; rowId: string; error: ReturnType<typeof partnerError> }> = [];
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    for (const decision of command.decisions) {
      const row = rows.find(item => item.id === decision.rowId);
      if (!row) { outcomes.push({ ok: false, rowId: decision.rowId, error: partnerError('NOT_FOUND') }); continue; }
      if (row.revision !== decision.expectedRevision) { outcomes.push({ ok: false, rowId: row.id, error: partnerError('ROW_STALE') }); continue; }
      if (row.outcome !== 'PENDING') { outcomes.push({ ok: false, rowId: row.id, error: partnerError('STATE_CONFLICT') }); continue; }
      const definition = parseDefinition(row.definition);
      if (!definition) { outcomes.push({ ok: false, rowId: row.id, error: partnerError('INTEGRITY_CONFLICT') }); continue; }
      const outcomeId = randomUUID(), revision = row.revision + 1;
      if (decision.outcome === 'APPROVED') {
        if (decision.wholesaleUnitPrice.currency !== definition.identity.currency) {
          outcomes.push({ ok: false, rowId: row.id, error: partnerError('INVALID_PAYLOAD') }); continue;
        }
        const evidenceHash = await canonicalHash({ schemaVersion: 1, identity: definition.identity,
          wholesaleUnitPrice: decision.wholesaleUnitPrice, assignmentId: assignment.id,
          assignmentRevision: assignment.revision, authorizationEvidenceId: authorization.value.evidenceId,
          ...(row.predecessorId ? { predecessorApprovalId: row.predecessor?.approval?.id,
            supersessionReason: definition.predecessorReason } : {}) });
        if (row.predecessorId && (!row.predecessor?.approval?.id || !definition.predecessorReason)) {
          outcomes.push({ ok: false, rowId: row.id, error: partnerError('INTEGRITY_CONFLICT') }); continue;
        }
        await tx.partnerInquiryApproval.create({ data: { id: outcomeId, rowId: row.id, assignmentId: assignment.id,
          actorId: dependencies.actorId, commandId: `${command.commandId}:${row.id}`,
          authorizationEvidenceId: authorization.value.evidenceId,
          wholesaleUnitPrice: decision.wholesaleUnitPrice.amount, currency: decision.wholesaleUnitPrice.currency,
          evidenceHash, ...(decision.note ? { note: decision.note } : {}),
          ...(definition.predecessorReason ? { supersessionReason: definition.predecessorReason } : {}), approvedAt: clock.now,
          expiresAt: new Date(clock.now.getTime() + 48 * 60 * 60 * 1000) } });
      }
      await tx.partnerInquiryRow.update({ where: { id: row.id }, data: { outcome: decision.outcome, revision } });
      outcomes.push({ ok: true, rowId: row.id, outcomeId, revision, outcome: decision.outcome });
    }
    const batch = InquiryBatchResultSchema.parse({ schemaVersion: 1, commandId: command.commandId, outcomes });
    const eventIds: string[] = [];
    if (outcomes.some(outcome => outcome.ok)) {
      const next = await tx.partnerInquiry.update({ where: { id: inquiry.id }, data: { revision: { increment: 1 } }, select: { revision: true } });
      const eventId = randomUUID(); eventIds.push(eventId);
      await tx.partnerInquiryEvent.create({ data: { id: eventId, inquiryId: inquiry.id, revision: next.revision,
        actorId: dependencies.actorId, commandId: command.commandId, correlationId: command.correlationId,
        type: outcomes.every(outcome => outcome.ok) ? 'INQUIRY_DECIDED' : 'INQUIRY_PARTIALLY_DECIDED',
        evidence: { version: 1, assignmentId: assignment.id, assignmentRevision: assignment.revision,
          batch, decisions: command.decisions } } });
    }
    const receipt = { version: 1, commandId: command.commandId, eventIds, batch };
    await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), ...identity, payloadHash: expectedHash, outcome: receipt } });
    return { ok: true, value: { commandId: command.commandId, replayed: false, batch, eventIds } } as const;
  });
}

async function mutateInquiryLifecycle(dependencies: PartnerInquiryDependencies,
  command: Extract<PartnerCommand, { type: 'INQUIRY_CANCEL' | 'INQUIRY_REASSIGN' }>) {
  const expectedHash = await canonicalHash(commandIntent(command));
  if (command.idempotency.actorId !== dependencies.actorId || command.idempotency.targetId !== command.inquiryId ||
      command.idempotency.payloadHash !== expectedHash) return { ok: false, error: partnerError('INVALID_PAYLOAD') } as const;
  return dependencies.transaction(async tx => {
    const identity = { actorId: dependencies.actorId, operation: command.type,
      targetScope: command.inquiryId, key: command.idempotency.key };
    const prior = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: identity } });
    if (prior) {
      if (prior.payloadHash !== expectedHash) return { ok: false, error: partnerError('IDEMPOTENCY_CONFLICT') } as const;
      const receipt = decodeReceipt(prior.outcome);
      return receipt?.commandId === command.commandId
        ? { ok: true, value: { commandId: receipt.commandId, replayed: true, eventIds: receipt.eventIds } } as const
        : { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as const;
    }
    await tx.$queryRaw`SELECT id FROM partner_inquiries WHERE id = ${command.inquiryId} FOR UPDATE`;
    const inquiry = await tx.partnerInquiry.findUnique({ where: { id: command.inquiryId },
      select: { id: true, profileId: true, revision: true } });
    if (!inquiry) return { ok: false, error: partnerError('NOT_FOUND') } as const;
    const action = command.type === 'INQUIRY_CANCEL' ? 'INQUIRY_WRITE' : 'RESPONDER_REASSIGN';
    const authorization = await dependencies.authorize(tx, { actorId: dependencies.actorId, action,
      purpose: command.type === 'INQUIRY_CANCEL' ? 'PARTNER' : 'MANAGEMENT', reason: command.reason,
      root: { kind: 'INQUIRY', id: inquiry.id } });
    if (!authorization.ok) return authorization;
    const rollout = await authorizePartnerTechnicalRollout(tx, inquiry.profileId, 'CONTROL');
    if (!rollout.ok) return rollout;
    const pending = await tx.partnerInquiryRow.findMany({ where: { inquiryId: inquiry.id, outcome: 'PENDING' },
      select: { id: true, revision: true } });
    if (!pending.length) return { ok: false, error: partnerError('STATE_CONFLICT') } as const;
    if (command.type === 'INQUIRY_CANCEL') {
      if (command.expectedRevision !== inquiry.revision) return { ok: false, error: partnerError('ROW_STALE') } as const;
      for (const row of pending) await tx.partnerInquiryRow.update({ where: { id: row.id },
        data: { outcome: 'CANCELLED', revision: row.revision + 1 } });
    } else {
      const current = await tx.partnerInquiryAssignment.findFirst({ where: { inquiryId: inquiry.id },
        orderBy: { revision: 'desc' }, select: { revision: true } });
      if (!current || current.revision !== command.expectedAssignmentRevision) {
        return { ok: false, error: partnerError(current ? 'ROW_STALE' : 'INTEGRITY_CONFLICT') } as const;
      }
      if (!dependencies.resolveResponder) return { ok: false, error: partnerError('NOT_ASSIGNED') } as const;
      const responder = await dependencies.resolveResponder(tx, { responderId: command.responderId });
      if (!responder.ok) return responder;
      const eligible = await tx.user.findUnique({ where: { id: responder.value.responderId },
        select: { isActive: true, partnerProfile: { select: { id: true } } } });
      if (!eligible?.isActive || eligible.partnerProfile) return { ok: false, error: partnerError('NOT_ASSIGNED') } as const;
      await tx.partnerInquiryAssignment.create({ data: { id: randomUUID(), inquiryId: inquiry.id,
        revision: current.revision + 1, responderId: responder.value.responderId, actorId: dependencies.actorId,
        reason: command.reason, eligibilityEvidence: responder.value.eligibilityEvidence } });
    }
    const next = await tx.partnerInquiry.update({ where: { id: inquiry.id }, data: { revision: { increment: 1 } }, select: { revision: true } });
    const eventId = randomUUID();
    await tx.partnerInquiryEvent.create({ data: { id: eventId, inquiryId: inquiry.id, revision: next.revision,
      actorId: dependencies.actorId, commandId: command.commandId, correlationId: command.correlationId,
      type: command.type === 'INQUIRY_CANCEL' ? 'INQUIRY_CANCELLED' : 'INQUIRY_REASSIGNED', reason: command.reason,
      evidence: command.type === 'INQUIRY_CANCEL' ? { version: 1, rowIds: pending.map(row => row.id) }
        : { version: 1, responderId: command.responderId, assignmentRevision: command.expectedAssignmentRevision + 1,
          authorizationEvidenceId: authorization.value.evidenceId } } });
    const receipt = { version: 1, commandId: command.commandId, eventIds: [eventId] };
    await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), ...identity, payloadHash: expectedHash, outcome: receipt } });
    return { ok: true, value: { commandId: command.commandId, replayed: false, eventIds: [eventId] } } as const;
  });
}

/** Transactional inquiry aggregate. It consumes only owner-issued technical
 * references and stores private pricing identity in the inquiry definition;
 * public query projections are rebuilt through strict allowlists. */
export function createPartnerInquiryService(dependencies: PartnerInquiryDependencies): PartnerCommandPort & PartnerQueryV2Port {
  return {
    async execute(input) {
      const parsed = PartnerCommandSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
      if (parsed.data.type === 'INQUIRY_DECIDE') return publishCommitted(dependencies, decideInquiry(dependencies, parsed.data));
      if (parsed.data.type === 'INQUIRY_CANCEL' || parsed.data.type === 'INQUIRY_REASSIGN') {
        return publishCommitted(dependencies, mutateInquiryLifecycle(dependencies, parsed.data));
      }
      if (parsed.data.type !== 'INQUIRY_SUBMIT') return { ok: false, error: partnerError('INVALID_PAYLOAD') };
      const command = parsed.data;
      const scope = command.idempotency.targetId;
      const expectedHash = await canonicalHash({ schemaVersion: 1, type: command.type,
        partnerSellerId: command.partnerSellerId, rows: command.rows });
      if (command.partnerSellerId !== dependencies.actorId || command.idempotency.actorId !== dependencies.actorId ||
          command.idempotency.operation !== command.type || command.idempotency.payloadHash !== expectedHash) {
        return { ok: false, error: partnerError('INVALID_PAYLOAD') };
      }
      return publishCommitted(dependencies, dependencies.transaction(async tx => {
        const replay = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: {
          actorId: dependencies.actorId, operation: command.type, targetScope: scope, key: command.idempotency.key,
        } } });
        if (replay) {
          if (replay.payloadHash !== expectedHash) return { ok: false, error: partnerError('IDEMPOTENCY_CONFLICT') };
          const receipt = decodeReceipt(replay.outcome);
          return receipt?.commandId === command.commandId
            ? { ok: true, value: { commandId: receipt.commandId, replayed: true, eventIds: receipt.eventIds } }
            : { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
        }
        const profile = await tx.partnerProfile.findUnique({ where: { userId: dependencies.actorId }, select: { id: true } });
        if (!profile) return { ok: false, error: partnerError('NOT_FOUND') };
        let inquiry = await tx.partnerInquiry.findUnique({ where: { id: scope }, select: { id: true, profileId: true, revision: true } });
        const root = inquiry ? { kind: 'INQUIRY' as const, id: inquiry.id } : { kind: 'PROFILE' as const, id: profile.id };
        const allowed = await dependencies.authorize(tx, { actorId: dependencies.actorId, action: 'INQUIRY_WRITE', purpose: 'PARTNER', root });
        if (!allowed.ok) return allowed;
        const rollout = await authorizePartnerTechnicalRollout(tx, profile.id, 'MUTATE');
        if (!rollout.ok) return rollout;
        if (inquiry) {
          await tx.$queryRaw`SELECT id FROM partner_inquiries WHERE id = ${inquiry.id} FOR UPDATE`;
          inquiry = await tx.partnerInquiry.findUnique({ where: { id: inquiry.id }, select: { id: true, profileId: true, revision: true } });
          if (!inquiry || inquiry.profileId !== profile.id) return { ok: false, error: partnerError('NOT_FOUND') };
        }
        const definitions: Array<{ rowId: string; version: number; predecessorId?: string; definition: Definition; configurationHash: string }> = [];
        for (const row of command.rows) {
          if (row.configuration.recoveryId !== command.rows[0].configuration.recoveryId) {
            return { ok: false, error: partnerError('INVALID_PAYLOAD') };
          }
          const resolved = await dependencies.resolveConfiguration(tx, { actorId: dependencies.actorId, reference: row.configuration });
          if (!resolved.ok) return resolved;
          if (resolved.value.identity.partnerSellerId !== dependencies.actorId ||
              resolved.value.identity.catalogProductId.length === 0) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
          let version = 1, predecessorId: string | undefined;
          if (row.predecessor) {
            const predecessor = await tx.partnerInquiryRow.findUnique({ where: { id: row.predecessor.rowId },
              select: { id: true, revision: true, version: true, outcome: true,
                successor: { select: { id: true } }, inquiry: { select: { id: true, profileId: true } } } });
            if (!predecessor || predecessor.inquiry.id !== scope || predecessor.inquiry.profileId !== profile.id) {
              return { ok: false, error: partnerError('NOT_FOUND') };
            }
            if (predecessor.revision !== row.predecessor.revision) return { ok: false, error: partnerError('ROW_STALE') };
            if (!['APPROVED', 'REJECTED'].includes(predecessor.outcome)) return { ok: false, error: partnerError('STATE_CONFLICT') };
            if (predecessor.successor) return { ok: false, error: partnerError('STATE_CONFLICT') };
            predecessorId = predecessor.id; version = predecessor.version + 1;
          }
          const definition = parseDefinition({ version: 1, configurationRef: row.configuration,
            identity: resolved.value.identity, description: resolved.value.description,
            configuration: resolved.value.configuration, ...(row.predecessor ? { predecessorReason: row.predecessor.reason } : {}) });
          if (!definition) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
          definitions.push({ rowId: row.rowId, version, ...(predecessorId ? { predecessorId } : {}), definition,
            configurationHash: await canonicalHash(resolved.value.identity) });
        }
        if (new Set(definitions.map(row => row.rowId)).size !== definitions.length ||
            await tx.partnerInquiryRow.count({ where: { id: { in: definitions.map(row => row.rowId) } } })) {
          return { ok: false, error: partnerError('STATE_CONFLICT') };
        }
        let assignment: { id: string; revision: number } | null = null;
        const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
        if (!inquiry) {
          const responder = await dependencies.resolveInitialResponder(tx, { profileId: profile.id });
          if (!responder.ok) {
            if (responder.error.code !== 'NOT_ASSIGNED' || !dependencies.ensureMissingResponderSupport) return responder;
            const support = await dependencies.ensureMissingResponderSupport(tx, { profileId: profile.id, reporterId: dependencies.actorId });
            return support.ok ? { ok: false, error: partnerError('RESPONDER_UNAVAILABLE') } : support;
          }
          const eligible = await tx.user.findUnique({ where: { id: responder.value.responderId },
            select: { isActive: true, partnerProfile: { select: { id: true } } } });
          if (!eligible?.isActive || eligible.partnerProfile) return { ok: false, error: partnerError('NOT_ASSIGNED') };
          inquiry = await tx.partnerInquiry.create({ data: { id: scope, profileId: profile.id, revision: 1, submittedAt: clock.now },
            select: { id: true, profileId: true, revision: true } });
          assignment = await tx.partnerInquiryAssignment.create({ data: { id: randomUUID(), inquiryId: inquiry.id, revision: 1,
            responderId: responder.value.responderId, actorId: responder.value.assignedByActorId ?? dependencies.actorId,
            reason: 'تخصیص پاسخ‌دهنده مصوب', eligibilityEvidence: { ...responder.value.eligibilityEvidence,
              ...(responder.value.profileAssignmentId ? { profileAssignmentId: responder.value.profileAssignmentId,
                profileAssignmentRevision: responder.value.profileAssignmentRevision } : {}) } }, select: { id: true, revision: true } });
        } else {
          assignment = await tx.partnerInquiryAssignment.findFirst({ where: { inquiryId: inquiry.id }, orderBy: { revision: 'desc' },
            select: { id: true, revision: true } });
          if (!assignment) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
          inquiry = await tx.partnerInquiry.update({ where: { id: inquiry.id }, data: { revision: { increment: 1 }, submittedAt: clock.now },
            select: { id: true, profileId: true, revision: true } });
        }
        await tx.partnerInquiryRow.createMany({ data: definitions.map(row => ({ id: row.rowId, inquiryId: inquiry!.id,
          version: row.version, revision: 1, ...(row.predecessorId ? { predecessorId: row.predecessorId } : {}),
          configurationHash: row.configurationHash, definition: row.definition as Prisma.InputJsonValue })) });
        const eventId = randomUUID();
        await tx.partnerInquiryEvent.create({ data: { id: eventId, inquiryId: inquiry.id, revision: inquiry.revision,
          actorId: dependencies.actorId, commandId: command.commandId, correlationId: command.correlationId,
          type: 'INQUIRY_SUBMITTED', evidence: { version: 1, assignmentId: assignment.id,
            assignmentRevision: assignment.revision, rowIds: definitions.map(row => row.rowId) } } });
        const receipt = { version: 1, commandId: command.commandId, eventIds: [eventId] };
        await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), actorId: dependencies.actorId,
          operation: command.type, targetScope: scope, key: command.idempotency.key, payloadHash: expectedHash,
          outcome: receipt } });
        return { ok: true, value: { commandId: command.commandId, replayed: false, eventIds: [eventId] } };
      }));
    },
    async query(input) {
      const parsed = PartnerQueryV2Schema.safeParse(input);
      if (!parsed.success || (parsed.data.purpose !== 'PARTNER_INQUIRY' && parsed.data.purpose !== 'RESPONDER_INQUIRY')) {
        return { ok: false, error: partnerError('INVALID_PAYLOAD') } as never;
      }
      const inquiryId = parsed.data.inquiryId;
      return dependencies.transaction(async tx => {
        const inquiry = await tx.partnerInquiry.findUnique({ where: { id: inquiryId }, select: {
          id: true, profileId: true, profile: { select: { user: { select: { firstName: true, lastName: true } } } },
          assignments: { orderBy: { revision: 'desc' }, take: 1, select: { id: true, revision: true, responderId: true } },
          events: { orderBy: { revision: 'asc' }, select: { type: true, reason: true, evidence: true } },
          rows: { orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }], include: {
            predecessor: { select: { id: true, revision: true } },
            successor: { select: { id: true, revision: true, outcome: true, approval: { select: { expiresAt: true } } } },
            approval: { include: { usages: { include: { binding: { include: {
              caseRevision: { include: { case: { select: { caseNumber: true } } },
              } } } } } } },
          } },
        } });
        if (!inquiry) return { ok: false, error: partnerError('NOT_FOUND') } as never;
        const responderPurpose = parsed.data.purpose === 'RESPONDER_INQUIRY';
        const allowed = await dependencies.authorize(tx, { actorId: dependencies.actorId, action: 'INQUIRY_READ',
          purpose: responderPurpose ? 'RESPONDER' : 'PARTNER',
          root: { kind: 'INQUIRY', id: inquiry.id } });
        if (!allowed.ok) return allowed as never;
        const rollout = await authorizePartnerTechnicalRollout(tx, inquiry.profileId, 'READ');
        if (!rollout.ok) return rollout as never;
        const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
        const state = (outcome: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED', expiresAt?: Date,
          superseded = false): 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'SUPERSEDED' | 'CANCELLED' =>
          outcome !== 'APPROVED' ? outcome : superseded ? 'SUPERSEDED'
            : expiresAt && clock.now.getTime() >= expiresAt.getTime() ? 'EXPIRED' : 'APPROVED';
        const reasons = new Map<string, string>();
        for (const event of inquiry.events) {
          if (event.type === 'INQUIRY_CANCELLED' && event.reason) {
            const evidence = event.evidence as { rowIds?: unknown };
            if (Array.isArray(evidence.rowIds)) for (const rowId of evidence.rowIds) if (typeof rowId === 'string') reasons.set(rowId, event.reason);
          }
          if (event.type === 'INQUIRY_DECIDED' || event.type === 'INQUIRY_PARTIALLY_DECIDED') {
            const evidence = event.evidence as { decisions?: unknown };
            if (Array.isArray(evidence.decisions)) for (const decision of evidence.decisions) {
              if (decision && typeof decision === 'object' && (decision as { outcome?: unknown }).outcome === 'REJECTED' &&
                  typeof (decision as { rowId?: unknown }).rowId === 'string' && typeof (decision as { reason?: unknown }).reason === 'string') {
                reasons.set((decision as { rowId: string }).rowId, (decision as { reason: string }).reason);
              }
            }
          }
        }
        if (responderPurpose) {
          const assignment = inquiry.assignments[0];
          if (!assignment || assignment.responderId !== dependencies.actorId) return { ok: false, error: partnerError('NOT_ASSIGNED') } as never;
          const responseRows = inquiry.rows.map(row => {
            const definition = parseDefinition(row.definition);
            if (!definition) return null;
            const currentState = state(row.outcome, row.approval?.expiresAt,
              row.successor?.outcome === 'APPROVED');
            return { rowId: row.id, revision: row.revision, identity: definition.identity,
              ...(row.approval ? { approvedPrice: { amount: row.approval.wholesaleUnitPrice.toString(), currency: row.approval.currency },
                approvedAt: row.approval.approvedAt.toISOString(), expiresAt: row.approval.expiresAt.toISOString(),
                ...(row.approval.note ? { noteOrReason: row.approval.note } : {}) } :
                reasons.get(row.id) ? { noteOrReason: reasons.get(row.id) } : {}),
              used: Boolean(row.approval?.usages.length), state: currentState,
              actions: currentState === 'PENDING' ? [{ action: 'INQUIRY_RESPOND' as const, enabled: true }] : [],
            };
          });
          if (responseRows.some(row => row === null)) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as never;
          const view = ResponderInquiryViewV2Schema.safeParse({ schemaVersion: 2, purpose: 'RESPONDER_INQUIRY', inquiryId: inquiry.id,
            partnerDisplayName: `${inquiry.profile.user.firstName} ${inquiry.profile.user.lastName}`.trim(),
            assignmentId: assignment.id, assignmentRevision: assignment.revision,
            actions: responseRows.some(row => row?.state === 'PENDING') ? [{ action: 'INQUIRY_RESPOND', enabled: true }] : [], rows: responseRows });
          return view.success ? { ok: true, value: view.data } as never : { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as never;
        }
        const rows = inquiry.rows.map(row => {
          const definition = parseDefinition(row.definition);
          if (!definition) return null;
          const currentState = state(row.outcome, row.approval?.expiresAt,
            row.successor?.outcome === 'APPROVED');
          const successor = row.successor;
          return { rowId: row.id, revision: row.revision, description: definition.description,
            state: currentState, configuration: definition.configuration,
            configurationRef: definition.configurationRef,
            ...(row.approval ? { approvedPrice: { amount: row.approval.wholesaleUnitPrice.toString(), currency: row.approval.currency },
              approvedAt: row.approval.approvedAt.toISOString(), expiresAt: row.approval.expiresAt.toISOString(),
              ...(row.approval.note ? { noteOrReason: row.approval.note } : {}),
              approvedRowBinding: { inquiryId: inquiry.id, rowId: row.id, revision: row.revision } } : {}),
            ...(!row.approval && definition.predecessorReason ? { noteOrReason: definition.predecessorReason } : {}),
            usedCaseNumbers: row.approval?.usages.map(usage => usage.binding.caseRevision.case.caseNumber) ?? [],
            ...(row.predecessor ? { predecessor: { inquiryId: inquiry.id, rowId: row.predecessor.id,
              revision: row.predecessor.revision, reason: definition.predecessorReason! } } : {}),
            ...(successor ? { successor: { inquiryId: inquiry.id, rowId: successor.id, revision: successor.revision,
              state: state(successor.outcome, successor.approval?.expiresAt) } } : {}),
          };
        });
        if (rows.some(row => row === null)) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as never;
        const view = PartnerInquiryViewV2Schema.safeParse({ schemaVersion: 2, purpose: 'PARTNER_INQUIRY', inquiryId: inquiry.id, rows });
        return view.success ? { ok: true, value: view.data } as never : { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as never;
      });
    },
  };
}
