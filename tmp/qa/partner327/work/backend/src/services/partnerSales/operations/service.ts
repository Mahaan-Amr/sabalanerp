import { ContractRuntime, OperationsError, OperationsState, PermissionContext, Result } from './contracts';
import { assessReadiness, ReadinessCheck } from './readiness';
import { checkOperationsGate } from './policy';

export interface ControlAudit {
  action: 'PAUSE_CHANGED' | 'COHORT_DEFINED' | 'COHORT_ENROLLED' | 'INCIDENT_RESOLVED';
  actorId: string;
  authorizationRevision: number;
  lifecycleRevision: number;
  revision: number;
  recordedAt: string;
  reason: string;
  evidenceId?: string;
}
export interface RecordedCommand { key: string; intentHash: string; result: OperationsState }
export interface Incident {
  key: string;
  category: string;
  evidenceReference: string;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: number;
  resolution?: { actorId: string; evidenceId: string; recordedAt: string };
}
export interface RemediationEvidence {
  source: 'DATABASE_VERIFIED' | 'FIXTURE';
  evidenceId: string;
  incidentKey: string;
  causeCorrected: boolean;
  reconciliationPassed: boolean;
  failedTestPassed: boolean;
  checkedAt: string;
}
export interface OperationsTransaction {
  now(): string;
  /** Bound to the authenticated principal; resolves fresh OPERATIONS_MANAGE in
   * the central #319 policy, never from body actorId/role/permission claims. */
  authorize(): Promise<Result<PermissionContext>>;
  readState(): Promise<OperationsState>;
  writeState(state: OperationsState): Promise<void>;
  findCommand(key: string): Promise<RecordedCommand | null>;
  appendCommand(command: RecordedCommand): Promise<void>;
  appendAudit(audit: ControlAudit): Promise<void>;
  readiness(): Promise<ReadinessCheck>;
  enrollmentCandidate(sellerId: string): Promise<{ sellerId: string; profileId: string; eligible: boolean } | null>;
  listOpenIncidents(): Promise<Incident[]>;
  findIncident(key: string): Promise<Incident | null>;
  saveIncident(incident: Incident): Promise<void>;
  enqueueTelemetry(record: Record<string, string | number>): Promise<void>;
  remediationEvidence(incidentKey: string): Promise<RemediationEvidence | null>;
}
export interface OperationsStore {
  /** #315/#334 implementation: shared Prisma client; one durable global control
   * row lock also acquired by ALL Partner writers immediately before mutation.
   * All callback writes, audit, dedup ledger and outbox commit or roll back as one.
   * Missing/unavailable state FAILS CLOSED, never falls back to process memory.
   * There is deliberately no production adapter in this module-only delivery. */
  transaction<T>(work: (tx: OperationsTransaction) => Promise<T>): Promise<T>;
}

export function createOperationsService(contract: ContractRuntime, store: OperationsStore) {
  async function transact<T>(work: (tx: OperationsTransaction) => Promise<T>): Promise<Result<T>> {
    try { return { ok: true, value: await store.transaction(work) }; }
    catch (error) { return { ok: false, error: contract.partnerError(error instanceof OperationsError ? error.code : 'INTEGRITY_CONFLICT') }; }
  }
  async function authorize(tx: OperationsTransaction) {
    const result = await tx.authorize();
    if (!result.ok) throw new OperationsError(result.error.code);
    const permission = contract.PermissionContextSchema.parse(result.value);
    // The action-time clock comes from the transaction, not cached UI/context.
    permission.evaluatedAt = contract.InstantSchema.parse(tx.now());
    const denial = checkOperationsGate(contract, await tx.readState(), { operation: 'OPERATIONS_MANAGE', permission });
    if (denial) throw new OperationsError(denial.code);
    if (permission.scope !== 'COMPANY') throw new OperationsError('FORBIDDEN');
    return permission;
  }
  function audit(tx: OperationsTransaction, actor: PermissionContext, state: OperationsState, action: ControlAudit['action'], reason: string, evidenceId?: string) {
    return tx.appendAudit({ action, actorId: actor.actorId, authorizationRevision: actor.authorizationRevision,
      lifecycleRevision: actor.lifecycleRevision, revision: state.revision, recordedAt: tx.now(), reason, ...(evidenceId ? { evidenceId } : {}) });
  }
  async function requireReadiness(tx: OperationsTransaction, state: OperationsState) {
    const check = await tx.readiness();
    check.current.now = tx.now();
    if (!assessReadiness(contract, check.evidence, check.current) ||
      (state.lastOperationalPauseAt && check.evidence!.checkedAt < state.lastOperationalPauseAt)) throw new OperationsError('COHORT_NOT_READY');
    return check.evidence!;
  }
  return {
    status: () => transact(async tx => { await authorize(tx); return tx.readState(); }),
    incidents: () => transact(async tx => { await authorize(tx); return tx.listOpenIncidents(); }),
    resolveIncident: (key: string, reason: string) => transact(async tx => {
      const actor = await authorize(tx);
      if (!contract.IdSchema.safeParse(key).success || !contract.PersianReasonSchema.safeParse(reason).success) throw new OperationsError('INVALID_PAYLOAD');
      const incident = await tx.findIncident(key);
      if (!incident) throw new OperationsError('NOT_FOUND');
      if (incident.resolution) return incident;
      const evidence = await tx.remediationEvidence(key);
      if (!evidence || evidence.source !== 'DATABASE_VERIFIED' || evidence.incidentKey !== key ||
        !contract.IdSchema.safeParse(evidence.evidenceId).success || !contract.InstantSchema.safeParse(evidence.checkedAt).success ||
        evidence.checkedAt < incident.lastSeenAt || evidence.checkedAt > tx.now() ||
        !evidence.causeCorrected || !evidence.reconciliationPassed || !evidence.failedTestPassed) throw new OperationsError('INTEGRITY_CONFLICT');
      const resolved = { ...incident, resolution: { actorId: actor.actorId, evidenceId: evidence.evidenceId, recordedAt: tx.now() } };
      await tx.saveIncident(resolved);
      await audit(tx, actor, await tx.readState(), 'INCIDENT_RESOLVED', reason, evidence.evidenceId);
      return resolved;
    }),
    defineCohort: (input: { id: string; name: string; expectedRevision: number; reason: string }) => transact(async tx => {
      const actor = await authorize(tx);
      if (!contract.IdSchema.safeParse(input.id).success || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 160 ||
        !contract.PersianReasonSchema.safeParse(input.reason).success || !contract.RevisionSchema.safeParse(input.expectedRevision).success) throw new OperationsError('INVALID_PAYLOAD');
      const state = await tx.readState();
      if (state.revision !== input.expectedRevision) throw new OperationsError('ROW_STALE');
      if (!state.enrollmentPaused || state.cohort) throw new OperationsError('STATE_CONFLICT');
      const next = { ...state, revision: state.revision + 1, cohort: { id: input.id, name: input.name.trim(), sellerIds: [] } };
      await tx.writeState(next);
      await audit(tx, actor, next, 'COHORT_DEFINED', input.reason);
      return next;
    }),
    enroll: (input: { sellerId: string; expectedRevision: number; reason: string }) => transact(async tx => {
      const actor = await authorize(tx);
      if (!contract.IdSchema.safeParse(input.sellerId).success || !contract.RevisionSchema.safeParse(input.expectedRevision).success ||
        !contract.PersianReasonSchema.safeParse(input.reason).success) throw new OperationsError('INVALID_PAYLOAD');
      const state = await tx.readState();
      if (state.revision !== input.expectedRevision) throw new OperationsError('ROW_STALE');
      const readiness = await tx.readiness();
      readiness.current.now = tx.now();
      const denial = checkOperationsGate(contract, state, { operation: 'COHORT_ENROLL', permission: actor, readiness });
      if (denial) throw new OperationsError(denial.code);
      const candidate = await tx.enrollmentCandidate(input.sellerId);
      if (!candidate?.eligible || candidate.sellerId !== input.sellerId || !contract.IdSchema.safeParse(candidate.profileId).success) throw new OperationsError('COHORT_NOT_READY');
      if (state.cohort!.sellerIds.includes(input.sellerId)) return state;
      const next = { ...state, revision: state.revision + 1, cohort: { ...state.cohort!, sellerIds: [...state.cohort!.sellerIds, input.sellerId] } };
      await tx.writeState(next);
      await audit(tx, actor, next, 'COHORT_ENROLLED', input.reason, readiness.evidence!.evidenceId);
      return next;
    }),
    pause: (input: unknown) => transact(async tx => {
      const actor = await authorize(tx);
      const parsed = contract.PartnerCommandSchema.safeParse(input);
      if (!parsed.success || parsed.data.type !== 'OPERATIONS_PAUSE') throw new OperationsError('INVALID_PAYLOAD');
      const command = parsed.data;
      if (command.idempotency.actorId !== actor.actorId || command.idempotency.targetId !== 'partner-operations') throw new OperationsError('FORBIDDEN');
      const intentHash = await contract.canonicalHash({ kind: command.kind, paused: command.paused, expectedRevision: command.expectedRevision, reason: command.reason });
      if (intentHash !== command.idempotency.payloadHash) throw new OperationsError('INVALID_PAYLOAD');
      const key = await contract.canonicalHash([actor.actorId, command.type, command.idempotency.targetId, command.idempotency.key]);
      const previous = await tx.findCommand(key);
      if (previous) {
        if (previous.intentHash !== intentHash) throw new OperationsError('IDEMPOTENCY_CONFLICT');
        return previous.result;
      }
      const state = await tx.readState();
      if (state.revision !== command.expectedRevision) throw new OperationsError('ROW_STALE');
      let evidenceId: string | undefined;
      if (!command.paused) {
        evidenceId = (await requireReadiness(tx, state)).evidenceId;
        if (command.kind === 'OPERATIONAL' && (await tx.listOpenIncidents()).length) throw new OperationsError('INTEGRITY_CONFLICT');
      }
      const next = { ...state, revision: state.revision + 1,
        ...(command.kind === 'ENROLLMENT' ? { enrollmentPaused: command.paused } : { operationalPaused: command.paused }),
        ...(command.kind === 'OPERATIONAL' && command.paused ? { lastOperationalPauseAt: tx.now() } : {}) };
      await tx.writeState(next);
      await audit(tx, actor, next, 'PAUSE_CHANGED', command.reason, evidenceId);
      await tx.appendCommand({ key, intentHash, result: next });
      return next;
    }),
  };
}
export type OperationsService = ReturnType<typeof createOperationsService>;
