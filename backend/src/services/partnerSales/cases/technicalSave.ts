import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { canonicalHash, InquiryIdentitySchema, PartnerTechnicalSaveSchema, PartnerTechnicalSavedReadSchema,
  PartnerTechnicalSavedViewSchema, PartnerTechnicalSaveReceiptSchema, partnerError,
  type PartnerTechnicalSavePort, type PartnerTechnicalDraft, type InquiryIdentity, type Result } from '@sabalanerp/partner-sales-contracts';
import { PARTNER_TECHNICAL_RECOVERY_KIND } from '../../contractRecoveryProtection';
import { CONTRACT_EDIT_LEASE_TTL_MS, CONTRACT_CREATION_DRAFT_TTL_MS } from '../../contractEditSessionService';
import { compilePartnerTechnicalGraph, type PartnerTechnicalGraphContext } from './technicalGraph';
import { technicalRecoveryLease, technicalRecoveryJson as json, technicalDraftContent,
  type PartnerTechnicalRecoveryDependencies } from './technicalRecovery';
import { encodeTechnicalSavedSnapshot, decodeTechnicalSavedSnapshot, type TechnicalSavedSnapshot } from './technicalSavedRecords';

export interface PartnerTechnicalSaveDependencies extends PartnerTechnicalRecoveryDependencies {
  /** Owner adapter must preserve frozen evidence for unchanged configuration;
   * it resolves current authorized catalog facts and exact private inquiry
   * identities. It is never supplied by transport or a Partner browser. */
  resolveEvidence(transaction: Prisma.TransactionClient, input: {
    actorId: string; recoveryId: string; draft: PartnerTechnicalDraft; previous: TechnicalSavedSnapshot | null;
  }): Promise<Result<{ context: PartnerTechnicalGraphContext; identities: { productRowId: string; identity: InquiryIdentity }[] }>>;
}

export function createPrismaPartnerTechnicalSaveService(input: {
  database: PrismaClient; actorId: string; authorize: PartnerTechnicalSaveDependencies['authorize'];
  resolveEvidence: PartnerTechnicalSaveDependencies['resolveEvidence'];
}): PartnerTechnicalSavePort {
  return createPartnerTechnicalSaveService({ ...input, transaction: work => input.database.$transaction(work) });
}

export function createPartnerTechnicalSaveService(dependencies: PartnerTechnicalSaveDependencies): PartnerTechnicalSavePort {
  const underLease = technicalRecoveryLease(dependencies);
  return {
    async readSaved(input) {
      const parsed = PartnerTechnicalSavedReadSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
      return underLease(parsed.data, 'READ', async (_tx, session, recovery) => {
        const history = recovery?.validatedSnapshots;
        if (!Array.isArray(history)) return { ok: false, error: partnerError(history === undefined ? 'NOT_FOUND' : 'INTEGRITY_CONFLICT') };
        for (const record of history) {
          const snapshot = await decodeTechnicalSavedSnapshot(record);
          if (!snapshot || snapshot.sessionId !== session.id || snapshot.view.recoveryId !== session.draftId ||
              snapshot.view.recoveryRevision > recovery!.recoveryRevision) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
          if (snapshot.view.recoveryRevision === parsed.data.recoveryRevision) return { ok: true, value: snapshot.view };
        }
        return { ok: false, error: partnerError('NOT_FOUND') };
      });
    },
    async save(input) {
      const parsed = PartnerTechnicalSaveSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
      const command = parsed.data;
      const payloadHash = await canonicalHash(json({ schemaVersion: 1, recoveryId: command.recoveryId,
        baseRevision: command.baseRevision, expectedRecoveryRevision: command.expectedRecoveryRevision, draft: command.draft }));
      return underLease(command, 'SAVE', async (tx, session, recovery, now) => {
        const history = recovery?.validatedSnapshots ?? [];
        if (!Array.isArray(history)) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
        const snapshots: TechnicalSavedSnapshot[] = [];
        for (const record of history) {
          const snapshot = await decodeTechnicalSavedSnapshot(record);
          if (!snapshot || snapshot.sessionId !== session.id || snapshot.view.recoveryId !== session.draftId ||
              snapshot.view.recoveryRevision > (recovery?.recoveryRevision ?? 0) ||
              snapshot.view.recoveryRevision <= (snapshots.at(-1)?.view.recoveryRevision ?? 0)) {
            return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
          }
          snapshots.push(snapshot);
        }
        const identity = { actorId: dependencies.actorId, operation: 'PARTNER_TECHNICAL_SAVE_V1',
          targetScope: session.draftId, key: command.idempotencyKey };
        const priorOutcome = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: identity } });
        if (priorOutcome) {
          if (priorOutcome.payloadHash !== payloadHash) return { ok: false, error: partnerError('IDEMPOTENCY_CONFLICT') };
          const outcome = priorOutcome.outcome as { sessionId?: string; receipt?: unknown };
          const receipt = PartnerTechnicalSaveReceiptSchema.safeParse(outcome?.receipt);
          if (outcome?.sessionId !== session.id || !receipt.success || !snapshots.some(snapshot =>
            JSON.stringify({ ...snapshot.view, replayed: false }) === JSON.stringify(receipt.data))) {
            return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
          }
          return { ok: true, value: { ...receipt.data, replayed: true } };
        }
        const revision = recovery?.recoveryRevision ?? 0;
        if (revision !== command.expectedRecoveryRevision || revision === Number.MAX_SAFE_INTEGER) return { ok: false, error: partnerError('ROW_STALE') };
        const previous = snapshots.at(-1) ?? null;
        const evidence = await dependencies.resolveEvidence(tx, { actorId: dependencies.actorId, recoveryId: session.draftId,
          draft: command.draft, previous });
        if (!evidence.ok) return { ok: false, error: partnerError(evidence.error.code) };
        const compiled = compilePartnerTechnicalGraph(command.draft, evidence.value.context);
        if (!compiled.ok) return compiled;
        const graph = compiled.value.graph;
        const identities = evidence.value.identities;
        if (identities.length !== graph.rows.length || new Set(identities.map(item => item.productRowId)).size !== identities.length) {
          return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
        }
        const rows = [];
        for (const row of graph.rows) {
          for (const saved of snapshots) {
            const original = saved.graph.rows.find(item => item.productRowId === row.productRowId);
            if (original && (!previous?.graph.rows.some(item => item.productRowId === row.productRowId) ||
                original.productType !== row.productType || original.catalogProductId !== row.catalogProductId ||
                original.parentProductRowId !== row.parentProductRowId || original.sourceProductRowId !== row.sourceProductRowId ||
                original.stairPart?.part !== row.stairPart?.part || original.stairPart?.stairSystemId !== row.stairPart?.stairSystemId)) {
              return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
            }
          }
          const inquiry = InquiryIdentitySchema.safeParse(identities.find(item => item.productRowId === row.productRowId)?.identity);
          if (!inquiry.success || inquiry.data.partnerSellerId !== dependencies.actorId || inquiry.data.catalogProductId !== row.catalogProductId ||
              inquiry.data.family !== row.productType || inquiry.data.calculationPolicyVersion !== graph.calculationPolicy.calculation ||
              inquiry.data.roundingPolicyVersion !== graph.calculationPolicy.rounding) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
          // Canonical compiler owns the quantity; the evidence producer cannot
          // replace it with a quantity inferred from a price or catalog match.
          const measure = compiled.value.measures.find(item => item.productRowId === row.productRowId);
          if (!measure || measure.unit !== inquiry.data.unit) {
            return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
          }
          const old = previous?.identities.find(item => item.productRowId === row.productRowId);
          const configurationChange = !old ? 'NEW' : await canonicalHash(json(old.identity)) === await canonicalHash(json(inquiry.data)) ? 'UNCHANGED' : 'CHANGED';
          rows.push({ configurationRef: { recoveryId: session.draftId, recoveryRevision: revision + 1, productRowId: row.productRowId },
            quantity: measure.quantity, unit: measure.unit, configurationChange });
        }
        const updatedAt = recovery && technicalDraftContent(recovery.draft) === technicalDraftContent(command.draft) ? recovery.updatedAt : now.getTime();
        const view = PartnerTechnicalSavedViewSchema.safeParse({ schemaVersion: 1, recoveryId: session.draftId,
          recoveryRevision: revision + 1, inputRevision: command.draft.inputRevision, updatedAt: new Date(updatedAt).toISOString(), rows });
        if (!view.success) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
        const snapshot = await encodeTechnicalSavedSnapshot({ version: 1, sessionId: session.id, view: view.data, draft: command.draft,
          graph, context: evidence.value.context, identities });
        const stillAuthorized = await dependencies.authorize(tx, { actorId: dependencies.actorId, recoveryId: session.draftId, operation: 'SAVE' });
        if (!stillAuthorized.ok) return { ok: false, error: partnerError(stillAuthorized.error.code) };
        const current = await tx.salesContractEditSession.findUnique({ where: { draftId: session.draftId } });
        const [commitClock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
        if (!current || current.id !== session.id || current.ownerUserId !== dependencies.actorId ||
            current.browserSessionId !== command.browserSessionId || current.leaseToken !== command.leaseToken ||
            commitClock.now.getTime() - current.updatedAt.getTime() > CONTRACT_EDIT_LEASE_TTL_MS) {
          return { ok: false, error: partnerError('FORBIDDEN') };
        }
        if (recovery && commitClock.now.getTime() - recovery.updatedAt > CONTRACT_CREATION_DRAFT_TTL_MS) {
          return { ok: false, error: partnerError('STATE_CONFLICT') };
        }
        const next = { ...recovery, kind: PARTNER_TECHNICAL_RECOVERY_KIND, version: 1, recoveryRevision: revision + 1,
          updatedAt, draft: command.draft, validatedSnapshots: [...history, snapshot] };
        const written = await tx.salesContractEditSession.updateMany({ where: { draftId: session.draftId,
          leaseToken: session.leaseToken, baseRevision: session.baseRevision,
          recovery: { equals: session.recovery === null ? Prisma.AnyNull : json(session.recovery) },
          id: session.id, contractId: null,
        }, data: { recovery: json(next), updatedAt: commitClock.now } });
        if (written.count !== 1) return { ok: false, error: partnerError('ROW_STALE') };
        const receipt = { ...view.data, replayed: false };
        await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), ...identity, payloadHash,
          outcome: json({ sessionId: session.id, receipt }), recordedAt: commitClock.now } });
        return { ok: true, value: receipt };
      });
    },
  };
}
