import {
  PartnerCommandSchema,
  canonicalHash,
  checkExpectedRevision,
  partnerError,
  type CaseState,
  type PartnerAction,
  type PartnerCommand,
  type Result,
  type RevisionRef,
} from '@sabalanerp/partner-sales-contracts';
import {
  approvedCorrectionGates,
  parsePartnerCorrectionOutcome,
  type CorrectionGateEvidence,
  type CorrectionGateKind,
  type PartnerCorrectionOutcome,
} from './sharedCorrection';

type RemediationRequest = Extract<PartnerCommand, { type: 'VOID_REMEDIATION_REQUEST' }>;
type ActivePartnerRequest = Extract<PartnerCommand, { type: 'CORRECTION_REQUEST' }> & { scope: 'VOID' };
type VoidRequest = RemediationRequest | ActivePartnerRequest;
type GateCommand = Extract<PartnerCommand, { type: 'CORRECTION_GATE' }>;
type VoidingCommand = VoidRequest | GateCommand;

export type PartnerVoidingOpportunity = {
  correctionId: string;
  scope: 'VOID';
  requesterId: string;
  predecessor: RevisionRef;
  requestedAt: string;
  reason: string;
  requestKind: 'PARTNER_REQUEST' | 'INTERNAL_REMEDIATION';
};

export type PartnerVoidingSnapshot = {
  caseId: string;
  state: CaseState;
  owner: RevisionRef;
  profileStatus: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'TERMINATED';
  partnerSellerId: string;
  commitmentEventId: string;
  caseNumber: string;
  customerContractNumber: string;
  internalRecordNumber: string;
  opportunity?: PartnerVoidingOpportunity;
  gates: CorrectionGateEvidence[];
};

export type PartnerVoidingInspection = {
  dependencyEvidenceIds: string[];
  adjustmentEventIds: string[];
  owner: RevisionRef;
  commitmentEventId: string;
  evidenceHash: string;
};

export const partnerVoidingInspectionHash = (input: Omit<PartnerVoidingInspection, 'evidenceHash'>) => canonicalHash({
  purpose: 'PARTNER_VOIDING_INSPECTION', schemaVersion: 1, ...input,
});

export type PartnerVoidingDependencies<Transaction> = {
  actorId: string;
  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
  now(tx: Transaction): Promise<string>;
  readOutcome(tx: Transaction, key: string): Promise<unknown | null>;
  saveOutcome(tx: Transaction, key: string, outcome: PartnerCorrectionOutcome): Promise<void>;
  lockSnapshot(tx: Transaction, input: { caseId: string; correctionId?: string }): Promise<PartnerVoidingSnapshot | null>;
  authorize(tx: Transaction, input: { actorId: string; action: PartnerAction; caseId: string;
    correctionId?: string }): Promise<Result<{ evidenceId: string }>>;
  createOpportunity(tx: Transaction, opportunity: PartnerVoidingOpportunity, input: {
    command: VoidRequest; authorizationEvidenceId: string;
  }): Promise<void>;
  appendGate(tx: Transaction, gate: CorrectionGateEvidence & { command: GateCommand;
    authorizationEvidenceId: string }): Promise<void>;
  inspectForVoiding(tx: Transaction, input: { snapshot: PartnerVoidingSnapshot; command: GateCommand }):
    Promise<Result<PartnerVoidingInspection>>;
  finalizeVoiding(tx: Transaction, input: { snapshot: PartnerVoidingSnapshot; command: GateCommand;
    dependencyEvidenceIds: string[]; adjustmentEventIds: string[];
    gateActors: Record<CorrectionGateKind, string>; customerNoticeEvidenceId: string }):
    Promise<Result<{ eventIds: string[]; noticeOutboxId?: string }>>;
};

const failure = <T = never>(code: Parameters<typeof partnerError>[0]): Result<T> => ({ ok: false, error: partnerError(code) });
const keyFor = (command: VoidingCommand) => [command.idempotency.actorId, command.type,
  command.idempotency.targetId, command.idempotency.key].join(':');

const payloadFor = (command: VoidingCommand) => command.type === 'VOID_REMEDIATION_REQUEST'
  ? { schemaVersion: 1, type: command.type, reason: command.reason }
  : command.type === 'CORRECTION_REQUEST'
    ? { schemaVersion: 1, type: command.type, scope: command.scope, reason: command.reason }
  : { schemaVersion: 1, type: command.type, correctionId: command.correctionId, gate: command.gate,
    outcome: command.outcome, evidenceId: command.evidenceId, reason: command.reason };

const gateAction: Record<CorrectionGateKind, PartnerAction> = {
  SALES_SCOPE: 'CORRECTION_SCOPE_APPROVE',
  ACCOUNTING_PROCESS: 'FINANCIAL_PROCESS',
  ACCOUNTING_MANAGER: 'FINANCIAL_APPROVE',
  ACCOUNTING_VERIFY: 'FINANCIAL_VERIFY',
  // This gate records purpose-owned customer-contract cancellation evidence;
  // it is not a customer veto or a fresh commercial confirmation.
  CUSTOMER_CONFIRM: 'CUSTOMER_OUTPUT',
};

class RollbackVoiding extends Error {
  constructor(readonly result: Result<PartnerCorrectionOutcome>) {
    super('rollback Partner voiding transaction');
  }
}

/** Reviewed COMMITTED -> VOIDED orchestration. Customer cancellation, internal
 * void, dated adjustments, audit, and the safe notice outbox are delegated to
 * one adapter finalizer so none can become visible independently. */
export function createPartnerVoidingService<Transaction>(dependencies: PartnerVoidingDependencies<Transaction>) {
  const execute = async (raw: VoidingCommand): Promise<Result<PartnerCorrectionOutcome>> => {
    const parsed = PartnerCommandSchema.safeParse(raw);
    if (!parsed.success || !['VOID_REMEDIATION_REQUEST', 'CORRECTION_REQUEST', 'CORRECTION_GATE'].includes(parsed.data.type) ||
        (parsed.data.type === 'CORRECTION_REQUEST' && parsed.data.scope !== 'VOID')) {
      return failure('INVALID_PAYLOAD');
    }
    const command = parsed.data as VoidingCommand;
    if (command.idempotency.actorId !== dependencies.actorId || command.idempotency.operation !== command.type ||
        command.idempotency.targetId !== command.expected.caseId ||
        command.idempotency.payloadHash !== await canonicalHash(payloadFor(command))) return failure('INVALID_PAYLOAD');
    try {
      return await dependencies.transaction(async tx => {
        const key = keyFor(command);
        const prior = await dependencies.readOutcome(tx, key);
        if (prior) {
          const saved = parsePartnerCorrectionOutcome(prior, command.expected.caseId);
          if (!saved || saved.commandId !== command.commandId || saved.payloadHash !== command.idempotency.payloadHash) {
            return failure('IDEMPOTENCY_CONFLICT');
          }
          const authorization = await dependencies.authorize(tx, { actorId: dependencies.actorId,
            action: command.type === 'CORRECTION_GATE' ? gateAction[command.gate]
              : command.type === 'VOID_REMEDIATION_REQUEST' ? 'VOID_REMEDIATION_REQUEST' : 'VOID_REQUEST',
            caseId: command.expected.caseId, correctionId: saved.correctionId });
          if (!authorization.ok) return authorization;
          return { ok: true, value: { ...saved, replayed: true } };
        }
        const snapshot = await dependencies.lockSnapshot(tx, { caseId: command.expected.caseId,
          ...(command.type === 'CORRECTION_GATE' ? { correctionId: command.correctionId } : {}) });
        if (!snapshot) return failure('NOT_FOUND');
        if (snapshot.state !== 'COMMITTED' || command.expectedState !== 'COMMITTED' || !snapshot.commitmentEventId) {
          return failure('STATE_CONFLICT');
        }
        const expected = checkExpectedRevision(command.expected, snapshot.owner);
        if (expected) return { ok: false, error: expected };

        if (command.type === 'VOID_REMEDIATION_REQUEST' || command.type === 'CORRECTION_REQUEST') {
          if (snapshot.opportunity) return failure('STATE_CONFLICT');
          const remediation = command.type === 'VOID_REMEDIATION_REQUEST';
          if (remediation ? (!['SUSPENDED', 'TERMINATED'].includes(snapshot.profileStatus) ||
              dependencies.actorId === snapshot.partnerSellerId) :
            (snapshot.profileStatus !== 'ACTIVE' || dependencies.actorId !== snapshot.partnerSellerId)) return failure('FORBIDDEN');
          const authorization = await dependencies.authorize(tx, { actorId: dependencies.actorId,
            action: remediation ? 'VOID_REMEDIATION_REQUEST' : 'VOID_REQUEST', caseId: snapshot.caseId });
          if (!authorization.ok) return authorization;
          const now = await dependencies.now(tx);
          const opportunity: PartnerVoidingOpportunity = { correctionId: command.commandId, scope: 'VOID',
            requesterId: dependencies.actorId, predecessor: snapshot.owner, requestedAt: now,
            reason: command.reason, requestKind: remediation ? 'INTERNAL_REMEDIATION' : 'PARTNER_REQUEST' };
          await dependencies.createOpportunity(tx, opportunity, { command,
            authorizationEvidenceId: authorization.value.evidenceId });
          const outcome: PartnerCorrectionOutcome = { version: 1, commandId: command.commandId, replayed: false,
            caseId: snapshot.caseId, correctionId: opportunity.correctionId, owner: snapshot.owner, eventIds: [],
            payloadHash: command.idempotency.payloadHash };
          await dependencies.saveOutcome(tx, key, outcome);
          return { ok: true, value: outcome };
        }

        const opportunity = snapshot.opportunity;
        if (!opportunity || opportunity.scope !== 'VOID' || opportunity.correctionId !== command.correctionId ||
            checkExpectedRevision(opportunity.predecessor, snapshot.owner) ||
            snapshot.gates.some(gate => gate.gate === command.gate || gate.outcome === 'REJECT')) {
          return failure('STATE_CONFLICT');
        }
        if (['ACCOUNTING_PROCESS', 'ACCOUNTING_MANAGER'].includes(command.gate) &&
            dependencies.actorId === opportunity.requesterId) return failure('FORBIDDEN');
        if (command.gate === 'ACCOUNTING_MANAGER' && snapshot.gates.some(gate =>
          gate.gate === 'ACCOUNTING_PROCESS' && gate.actorId === dependencies.actorId)) return failure('FORBIDDEN');
        const authorization = await dependencies.authorize(tx, { actorId: dependencies.actorId,
          action: gateAction[command.gate], caseId: snapshot.caseId, correctionId: opportunity.correctionId });
        if (!authorization.ok) return authorization;
        const gate = { gate: command.gate, outcome: command.outcome, actorId: dependencies.actorId,
          evidenceId: command.evidenceId } as const;
        await dependencies.appendGate(tx, { ...gate, command, authorizationEvidenceId: authorization.value.evidenceId });
        let eventIds: string[] = [];
        if (command.outcome === 'APPROVE') {
          const ready = approvedCorrectionGates([...snapshot.gates, gate], opportunity.requesterId);
          if (ready.ok) {
            const inspected = await dependencies.inspectForVoiding(tx, { snapshot, command });
            if (!inspected.ok) throw new RollbackVoiding(inspected);
            const inspection = inspected.value;
            const uniqueDependencies = new Set(inspection.dependencyEvidenceIds);
            const uniqueAdjustments = new Set(inspection.adjustmentEventIds);
            const expectedInspectionHash = await partnerVoidingInspectionHash({
              dependencyEvidenceIds: inspection.dependencyEvidenceIds,
              adjustmentEventIds: inspection.adjustmentEventIds,
              owner: inspection.owner,
              commitmentEventId: inspection.commitmentEventId,
            });
            if (!inspection.dependencyEvidenceIds.length || uniqueDependencies.size !== inspection.dependencyEvidenceIds.length ||
                uniqueAdjustments.size !== inspection.adjustmentEventIds.length ||
                checkExpectedRevision(inspection.owner, snapshot.owner) ||
                inspection.commitmentEventId !== snapshot.commitmentEventId || inspection.evidenceHash !== expectedInspectionHash) {
              throw new RollbackVoiding(failure('ROW_STALE'));
            }
            const finalized = await dependencies.finalizeVoiding(tx, { snapshot, command,
              dependencyEvidenceIds: inspection.dependencyEvidenceIds,
              adjustmentEventIds: inspection.adjustmentEventIds, gateActors: ready.value.actors,
              customerNoticeEvidenceId: ready.value.evidenceIds.CUSTOMER_CONFIRM });
            if (!finalized.ok) throw new RollbackVoiding(finalized);
            eventIds = finalized.value.eventIds;
          } else if (ready.error.code !== 'DEPENDENCY_BLOCKED') throw new RollbackVoiding(ready);
        }
        const outcome: PartnerCorrectionOutcome = { version: 1, commandId: command.commandId, replayed: false,
          caseId: snapshot.caseId, correctionId: opportunity.correctionId, owner: snapshot.owner, eventIds,
          payloadHash: command.idempotency.payloadHash };
        await dependencies.saveOutcome(tx, key, outcome);
        return { ok: true, value: outcome };
      });
    } catch (error) {
      if (error instanceof RollbackVoiding) return error.result;
      throw error;
    }
  };
  return { execute };
}
