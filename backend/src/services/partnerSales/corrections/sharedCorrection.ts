import {
  PartnerCommandSchema,
  HashSchema,
  IdSchema,
  RevisionRefSchema,
  canonicalHash,
  checkExpectedRevision,
  partnerError,
  type CaseState,
  type PartnerAction,
  type PartnerCommand,
  type PartnerErrorCode,
  type Result,
  type RevisionRef,
} from '@sabalanerp/partner-sales-contracts';
import {
  validatePartnerCorrectionDependencies,
  type PartnerCorrectionDependencyInput,
} from './dependencyChecks';

export const CORRECTION_GATES = [
  'SALES_SCOPE',
  'ACCOUNTING_PROCESS',
  'ACCOUNTING_MANAGER',
  'ACCOUNTING_VERIFY',
  'CUSTOMER_CONFIRM',
] as const;

export type CorrectionGateKind = typeof CORRECTION_GATES[number];
export type CorrectionGateEvidence = {
  gate: CorrectionGateKind;
  outcome: 'APPROVE' | 'REJECT';
  actorId: string;
  evidenceId: string;
};

export type CorrectionPricingEvidence = {
  productRowId: string;
  configurationChanged: boolean;
  source: 'FROZEN' | 'FRESH_EXACT';
  approvalId: string;
  configurationHash: string;
  evidenceHash: string;
  approvalExpiresAt: string;
};

type SharedSave = Extract<PartnerCommand, { type: 'SHARED_CORRECTION_SAVE' }>;
type GateCommand = Extract<PartnerCommand, { type: 'CORRECTION_GATE' }>;
type SharedCommand = SharedSave | GateCommand;

export type PartnerCorrectionCandidate<Payload = unknown> = {
  owner: RevisionRef;
  pricing: CorrectionPricingEvidence[];
  dependencies: PartnerCorrectionDependencyInput;
  payload: Payload;
};

export type PartnerCorrectionSnapshot<Payload = unknown> = {
  caseId: string;
  state: CaseState;
  owner: RevisionRef;
  partnerSellerId: string;
  profileStatus: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'TERMINATED';
  opportunity: {
    correctionId: string;
    scope: 'SHARED' | 'SABALAN_TERMS' | 'VOID';
    requesterId: string;
    predecessor: RevisionRef;
    approvedBy: string;
    expiresAt: string;
  };
  candidate?: PartnerCorrectionCandidate<Payload>;
  gates: CorrectionGateEvidence[];
};

export type PartnerCorrectionOutcome = {
  version: 1;
  commandId: string;
  replayed: boolean;
  caseId: string;
  correctionId: string;
  owner: RevisionRef;
  eventIds: string[];
  payloadHash: string;
};

export type PartnerSharedCorrectionDependencies<Transaction, Payload = unknown> = {
  actorId: string;
  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
  now(tx: Transaction): Promise<string>;
  readOutcome(tx: Transaction, key: string): Promise<unknown | null>;
  saveOutcome(tx: Transaction, key: string, outcome: PartnerCorrectionOutcome): Promise<void>;
  lockSnapshot(tx: Transaction, input: { caseId: string; correctionId: string }): Promise<PartnerCorrectionSnapshot<Payload> | null>;
  authorize(tx: Transaction, input: { actorId: string; action: PartnerAction; caseId: string;
    correctionId: string }): Promise<Result<{ evidenceId: string }>>;
  prepareSuccessor(tx: Transaction, input: { command: SharedSave; snapshot: PartnerCorrectionSnapshot<Payload> }):
    Promise<Result<PartnerCorrectionCandidate<Payload>>>;
  stageSuccessor(tx: Transaction, candidate: PartnerCorrectionCandidate<Payload>, input: {
    command: SharedSave; snapshot: PartnerCorrectionSnapshot<Payload>; authorizationEvidenceId: string;
    dependencyEvidenceIds: string[];
  }): Promise<void>;
  appendGate(tx: Transaction, gate: CorrectionGateEvidence & { command: GateCommand;
    authorizationEvidenceId: string }): Promise<void>;
  revalidateForEffect(tx: Transaction, input: { snapshot: PartnerCorrectionSnapshot<Payload>;
    candidate: PartnerCorrectionCandidate<Payload>; command: GateCommand }):
    Promise<Result<PartnerCorrectionDependencyInput>>;
  activateSuccessor(tx: Transaction, input: { snapshot: PartnerCorrectionSnapshot<Payload>;
    candidate: PartnerCorrectionCandidate<Payload>; command: GateCommand; dependencyEvidenceIds: string[];
    gateActors: Record<CorrectionGateKind, string> }): Promise<Result<{ eventIds: string[] }>>;
};

export type PartnerSharedCorrectionService = {
  execute(command: SharedCommand): Promise<Result<PartnerCorrectionOutcome>>;
};

const failure = <T = never>(code: PartnerErrorCode): Result<T> => ({ ok: false, error: partnerError(code) });

export function validateCorrectionPricingEvidence(
  evidence: CorrectionPricingEvidence[],
  now: string,
): Result<{ productRowIds: string[] }> {
  if (!Number.isFinite(Date.parse(now)) || !evidence.length ||
      new Set(evidence.map(row => row.productRowId)).size !== evidence.length) return failure('INVALID_PAYLOAD');
  for (const row of evidence) {
    const expiresAt = Date.parse(row.approvalExpiresAt);
    if (!Number.isFinite(expiresAt)) return failure('INTEGRITY_CONFLICT');
    if (!row.approvalId || !row.configurationHash || !row.evidenceHash) return failure('INTEGRITY_CONFLICT');
    if (!row.configurationChanged && row.source !== 'FROZEN') return failure('CONFIG_MISMATCH');
    if (row.configurationChanged && (row.source !== 'FRESH_EXACT' || expiresAt <= Date.parse(now))) {
      return failure(row.source === 'FRESH_EXACT' ? 'APPROVAL_EXPIRED' : 'CONFIG_MISMATCH');
    }
  }
  return { ok: true, value: { productRowIds: evidence.map(row => row.productRowId).sort() } };
}

export function approvedCorrectionGates(
  gates: CorrectionGateEvidence[],
  requesterId: string,
): Result<{ actors: Record<CorrectionGateKind, string>; evidenceIds: Record<CorrectionGateKind, string> }> {
  const approved = new Map<CorrectionGateKind, CorrectionGateEvidence>();
  for (const gate of gates) {
    if (gate.outcome !== 'APPROVE' || !gate.evidenceId || approved.has(gate.gate)) return failure('STATE_CONFLICT');
    approved.set(gate.gate, gate);
  }
  if (CORRECTION_GATES.some(gate => !approved.has(gate))) return failure('DEPENDENCY_BLOCKED');
  const processor = approved.get('ACCOUNTING_PROCESS')!.actorId;
  const manager = approved.get('ACCOUNTING_MANAGER')!.actorId;
  if (requesterId === processor || requesterId === manager || processor === manager) return failure('FORBIDDEN');
  return { ok: true, value: {
    actors: Object.fromEntries([...approved].map(([kind, gate]) => [kind, gate.actorId])) as Record<CorrectionGateKind, string>,
    evidenceIds: Object.fromEntries([...approved].map(([kind, gate]) => [kind, gate.evidenceId])) as
      Record<CorrectionGateKind, string>,
  } };
}

class RollbackCorrection extends Error {
  constructor(readonly result: Result<PartnerCorrectionOutcome>) {
    super('rollback Partner correction transaction');
  }
}

const outcomeKey = (command: SharedCommand) => [command.idempotency.actorId, command.type,
  command.idempotency.targetId, command.idempotency.key].join(':');

export function parsePartnerCorrectionOutcome(value: unknown, expectedCaseId: string): PartnerCorrectionOutcome | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Partial<PartnerCorrectionOutcome>;
  const owner = RevisionRefSchema.safeParse(row.owner);
  return row.version === 1 && IdSchema.safeParse(row.commandId).success && row.caseId === expectedCaseId &&
    IdSchema.safeParse(row.correctionId).success && owner.success && owner.data.caseId === expectedCaseId &&
    Array.isArray(row.eventIds) && row.eventIds.every(id => IdSchema.safeParse(id).success) &&
    HashSchema.safeParse(row.payloadHash).success
    ? row as PartnerCorrectionOutcome : null;
}

const commandPayload = (command: SharedCommand) => command.type === 'SHARED_CORRECTION_SAVE'
  ? { schemaVersion: 1, type: command.type, opportunityId: command.opportunityId, intent: command.intent,
    dependencyEvidenceIds: command.dependencyEvidenceIds }
  : { schemaVersion: 1, type: command.type, correctionId: command.correctionId, gate: command.gate,
    outcome: command.outcome, evidenceId: command.evidenceId, reason: command.reason };

const gateAction: Record<CorrectionGateKind, PartnerAction> = {
  SALES_SCOPE: 'CORRECTION_SCOPE_APPROVE',
  ACCOUNTING_PROCESS: 'FINANCIAL_PROCESS',
  ACCOUNTING_MANAGER: 'FINANCIAL_APPROVE',
  ACCOUNTING_VERIFY: 'FINANCIAL_VERIFY',
  CUSTOMER_CONFIRM: 'CUSTOMER_OUTPUT',
};

/**
 * Coordinates shared/Sabalan-side correction without owning pricing,
 * fulfillment, Accounting, customer-confirmation, or central authorization.
 * Those domains return immutable evidence through the injected ports; the
 * repository adapter commits the candidate/gates/effect as one transaction.
 */
export function createPartnerSharedCorrectionService<Transaction, Payload = unknown>(
  dependencies: PartnerSharedCorrectionDependencies<Transaction, Payload>,
): PartnerSharedCorrectionService {
  const execute = async (raw: SharedCommand): Promise<Result<PartnerCorrectionOutcome>> => {
    const parsed = PartnerCommandSchema.safeParse(raw);
    if (!parsed.success || !['SHARED_CORRECTION_SAVE', 'CORRECTION_GATE'].includes(parsed.data.type)) {
      return failure('INVALID_PAYLOAD');
    }
    const command = parsed.data as SharedCommand;
    const expectedHash = await canonicalHash(commandPayload(command));
    if (command.idempotency.actorId !== dependencies.actorId || command.idempotency.operation !== command.type ||
        command.idempotency.targetId !== command.expected.caseId || command.idempotency.payloadHash !== expectedHash) {
      return failure('INVALID_PAYLOAD');
    }
    try {
      return await dependencies.transaction(async tx => {
        const key = outcomeKey(command);
        const prior = await dependencies.readOutcome(tx, key);
        if (prior) {
          const saved = parsePartnerCorrectionOutcome(prior, command.expected.caseId);
          if (!saved || saved.commandId !== command.commandId || saved.payloadHash !== expectedHash) {
            return failure('IDEMPOTENCY_CONFLICT');
          }
          return { ok: true, value: { ...saved, replayed: true } };
        }
        const correctionId = command.type === 'SHARED_CORRECTION_SAVE' ? command.opportunityId : command.correctionId;
        const snapshot = await dependencies.lockSnapshot(tx, { caseId: command.expected.caseId, correctionId });
        if (!snapshot) return failure('NOT_FOUND');
        if (snapshot.opportunity.scope === 'VOID') return failure('STATE_CONFLICT');
        if (snapshot.state !== 'COMMITTED' || command.expectedState !== 'COMMITTED') return failure('STATE_CONFLICT');
        const expected = checkExpectedRevision(command.expected, snapshot.owner);
        if (expected) return { ok: false, error: expected };
        const predecessor = checkExpectedRevision(snapshot.opportunity.predecessor, snapshot.owner);
        if (predecessor) return { ok: false, error: predecessor };

        if (command.type === 'SHARED_CORRECTION_SAVE') {
          if (snapshot.candidate) return failure('STATE_CONFLICT');
          const now = await dependencies.now(tx);
          if (Date.parse(snapshot.opportunity.expiresAt) <= Date.parse(now)) return failure('APPROVAL_EXPIRED');
          if (dependencies.actorId !== snapshot.partnerSellerId || dependencies.actorId !== snapshot.opportunity.requesterId ||
              snapshot.profileStatus !== 'ACTIVE') return failure('PARTNER_NOT_ACTIVE');
          const authorization = await dependencies.authorize(tx, { actorId: dependencies.actorId,
            action: 'CORRECTION_REQUEST', caseId: snapshot.caseId, correctionId });
          if (!authorization.ok) return authorization;
          const prepared = await dependencies.prepareSuccessor(tx, { command, snapshot });
          if (!prepared.ok) return prepared;
          if (prepared.value.owner.caseId !== snapshot.caseId || prepared.value.owner.revision !== snapshot.owner.revision + 1) {
            return failure('INTEGRITY_CONFLICT');
          }
          const pricing = validateCorrectionPricingEvidence(prepared.value.pricing, now);
          if (!pricing.ok) return pricing;
          const successorProductRowIds = [...new Set(prepared.value.dependencies.successorProducts
            .map(row => row.productRowId))].sort();
          if (pricing.value.productRowIds.length !== successorProductRowIds.length ||
              pricing.value.productRowIds.some((id, index) => id !== successorProductRowIds[index])) {
            return failure('INTEGRITY_CONFLICT');
          }
          const dependencyEvidence = validatePartnerCorrectionDependencies(prepared.value.dependencies);
          if (!dependencyEvidence.ok) return dependencyEvidence;
          await dependencies.stageSuccessor(tx, prepared.value, { command, snapshot,
            authorizationEvidenceId: authorization.value.evidenceId,
            dependencyEvidenceIds: dependencyEvidence.value.evidenceIds });
          const outcome: PartnerCorrectionOutcome = { version: 1, commandId: command.commandId, replayed: false,
            caseId: snapshot.caseId, correctionId, owner: prepared.value.owner, eventIds: [], payloadHash: expectedHash };
          await dependencies.saveOutcome(tx, key, outcome);
          return { ok: true, value: outcome };
        }

        if (!snapshot.candidate || snapshot.gates.some(gate => gate.gate === command.gate || gate.outcome === 'REJECT')) {
          return failure('STATE_CONFLICT');
        }
        if (['ACCOUNTING_PROCESS', 'ACCOUNTING_MANAGER'].includes(command.gate) &&
            dependencies.actorId === snapshot.opportunity.requesterId) return failure('FORBIDDEN');
        if (command.gate === 'ACCOUNTING_MANAGER' && snapshot.gates.some(gate =>
          gate.gate === 'ACCOUNTING_PROCESS' && gate.actorId === dependencies.actorId)) return failure('FORBIDDEN');
        if (command.gate === 'SALES_SCOPE' && dependencies.actorId !== snapshot.opportunity.approvedBy) return failure('FORBIDDEN');
        const authorization = await dependencies.authorize(tx, { actorId: dependencies.actorId,
          action: gateAction[command.gate], caseId: snapshot.caseId, correctionId });
        if (!authorization.ok) return authorization;
        const gate = { gate: command.gate, outcome: command.outcome, actorId: dependencies.actorId,
          evidenceId: command.evidenceId } as const;
        await dependencies.appendGate(tx, { ...gate, command, authorizationEvidenceId: authorization.value.evidenceId });
        let eventIds: string[] = [];
        if (command.outcome === 'APPROVE') {
          const ready = approvedCorrectionGates([...snapshot.gates, gate], snapshot.opportunity.requesterId);
          if (ready.ok) {
            const current = await dependencies.revalidateForEffect(tx, { snapshot, candidate: snapshot.candidate, command });
            if (!current.ok) throw new RollbackCorrection(current);
            const validatedCurrent = validatePartnerCorrectionDependencies(current.value);
            if (!validatedCurrent.ok || await canonicalHash(current.value) !== await canonicalHash(snapshot.candidate.dependencies)) {
              throw new RollbackCorrection(failure('ROW_STALE'));
            }
            const activated = await dependencies.activateSuccessor(tx, { snapshot, candidate: snapshot.candidate,
              command, dependencyEvidenceIds: validatedCurrent.value.evidenceIds, gateActors: ready.value.actors });
            if (!activated.ok) throw new RollbackCorrection(activated);
            eventIds = activated.value.eventIds;
          } else if (ready.error.code !== 'DEPENDENCY_BLOCKED') {
            throw new RollbackCorrection(ready);
          }
        }
        const outcome: PartnerCorrectionOutcome = { version: 1, commandId: command.commandId, replayed: false,
          caseId: snapshot.caseId, correctionId, owner: snapshot.candidate.owner, eventIds, payloadHash: expectedHash };
        await dependencies.saveOutcome(tx, key, outcome);
        return { ok: true, value: outcome };
      });
    } catch (error) {
      if (error instanceof RollbackCorrection) return error.result;
      throw error;
    }
  };
  return { execute };
}
