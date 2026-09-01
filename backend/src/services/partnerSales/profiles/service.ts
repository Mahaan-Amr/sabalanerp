import { canonicalHash, PartnerCommandSchema, partnerError,
  type PartnerCommandPort, type Result } from '@sabalanerp/partner-sales-contracts';

type Transition = Extract<ReturnType<typeof PartnerCommandSchema.parse>, { type: 'PROFILE_TRANSITION' }>;
type ProfileState = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'TERMINATED';
export type PartnerProfileRecord = { id: string; userId: string; state: ProfileState; revision: number;
  firstActivatedAt: Date | null; irreversibleAt: Date | null };
export type PartnerActivationGates = { identityVerified: boolean; commercialTermsReady: boolean;
  creditTermsReady: boolean; responderReady: boolean; conversionCleared: boolean; cohortReady: boolean;
  userActive: boolean; conflictingInternalAuthority: boolean; evidenceIds: string[] };
export type PartnerProfileReceipt = { commandId: string; profileId: string; revision: number; eventIds: string[] };
type OutcomeKey = { actorId: string; operation: string; targetScope: string; key: string };

export interface PartnerProfileStore<Transaction = unknown> {
  transaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T>;
  findOutcome(transaction: Transaction, key: OutcomeKey): Promise<{ payloadHash: string; receipt: unknown } | null>;
  saveOutcome(transaction: Transaction, key: OutcomeKey,
    value: { payloadHash: string; receipt: PartnerProfileReceipt }): Promise<void>;
  lockProfile(transaction: Transaction, profileId: string): Promise<PartnerProfileRecord | null>;
  readActivationGates(transaction: Transaction, profile: PartnerProfileRecord): Promise<PartnerActivationGates>;
  updateProfile(transaction: Transaction, update: { profileId: string; expectedRevision: number; state: ProfileState;
    revision: number; firstActivatedAt?: Date; irreversibleAt?: Date; disableUser?: boolean }): Promise<PartnerProfileRecord>;
  appendProfileEvent(transaction: Transaction, event: { profileId: string; revision: number; fromState: ProfileState;
    toState: ProfileState; actorId: string; reason: string; commandId: string; evidence: Record<string, unknown> }): Promise<string>;
  /** Opens a transaction-local path for already-authorized owner remediation.
   * It never grants domain authority and is scoped to exactly one Profile. */
  beginRemediation(transaction: Transaction, profileId: string): Promise<void>;
  /** Termination owner cancels only pending, unused work. Committed obligations
   * remain available to Accounting/Fulfillment and are never rewritten here. */
  terminatePendingWork(transaction: Transaction, input: { profileId: string; actorId: string;
    commandId: string; correlationId: string; reason: string }): Promise<string[]>;
}

export interface PartnerProfileDependencies<Transaction = unknown> {
  actorId: string;
  store: PartnerProfileStore<Transaction>;
  authorize(transaction: Transaction, input: { actorId: string;
    action: 'PROFILE_ACTIVATE' | 'PROFILE_SUSPEND' | 'PROFILE_TERMINATE'; purpose: 'ONBOARDING';
    reason: string; root: { kind: 'PROFILE'; id: string } }): Promise<Result<{ evidenceId: string }>>;
}

function commandIntent(command: Transition) {
  const { commandId: _commandId, correlationId: _correlationId, idempotency: _idempotency, ...intent } = command;
  return intent;
}

function receipt(value: unknown): PartnerProfileReceipt | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !['commandId', 'profileId', 'revision', 'eventIds'].includes(key)) ||
      typeof row.commandId !== 'string' || typeof row.profileId !== 'string' ||
      !Number.isSafeInteger(row.revision) || !Array.isArray(row.eventIds) ||
      row.eventIds.some(id => typeof id !== 'string')) return undefined;
  return row as PartnerProfileReceipt;
}

const activationReady = (gates: PartnerActivationGates) => gates.identityVerified && gates.commercialTermsReady &&
  gates.creditTermsReady && gates.responderReady && gates.conversionCleared && gates.cohortReady &&
  gates.userActive && !gates.conflictingInternalAuthority;

const sameEvidence = (provided: readonly string[], current: readonly string[]) => provided.length === current.length &&
  new Set(provided).size === provided.length && provided.every(id => current.includes(id));

function allowedTransition(from: ProfileState, to: Transition['to']): boolean {
  if (from === 'TERMINATED' || from === to) return false;
  if (to === 'ACTIVE') return from === 'PENDING' || from === 'SUSPENDED';
  if (to === 'SUSPENDED') return from === 'ACTIVE';
  return true;
}

/** Profile lifecycle aggregate. Its small public interface owns current
 * authorization, CAS, readiness, idempotency, remediation and append-only
 * evidence; UI availability is never accepted as permission. */
export function createPartnerProfileService<Transaction = unknown>(
  dependencies: PartnerProfileDependencies<Transaction>): PartnerCommandPort {
  return { async execute(input) {
    const parsed = PartnerCommandSchema.safeParse(input);
    if (!parsed.success || parsed.data.type !== 'PROFILE_TRANSITION') {
      return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    }
    const command = parsed.data;
    const payloadHash = await canonicalHash(commandIntent(command));
    if (command.idempotency.actorId !== dependencies.actorId ||
        command.idempotency.operation !== command.type ||
        command.idempotency.targetId !== command.profileId ||
        command.idempotency.payloadHash !== payloadHash) {
      return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    }
    return dependencies.store.transaction(async transaction => {
      const key = { actorId: dependencies.actorId, operation: command.type,
        targetScope: command.profileId, key: command.idempotency.key };
      const prior = await dependencies.store.findOutcome(transaction, key);
      if (prior) {
        if (prior.payloadHash !== payloadHash) return { ok: false, error: partnerError('IDEMPOTENCY_CONFLICT') };
        const saved = receipt(prior.receipt);
        return saved?.commandId === command.commandId && saved.profileId === command.profileId &&
          Number.isSafeInteger(saved.revision) && saved.revision > 0
          ? { ok: true, value: { commandId: saved.commandId, replayed: true, eventIds: saved.eventIds } }
          : { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      }
      const profile = await dependencies.store.lockProfile(transaction, command.profileId);
      if (!profile) return { ok: false, error: partnerError('NOT_FOUND') };
      if (profile.revision !== command.expectedRevision) return { ok: false, error: partnerError('ROW_STALE') };
      if (!allowedTransition(profile.state, command.to)) return { ok: false, error: partnerError('STATE_CONFLICT') };
      const action = command.to === 'ACTIVE' ? 'PROFILE_ACTIVATE'
        : command.to === 'SUSPENDED' ? 'PROFILE_SUSPEND' : 'PROFILE_TERMINATE';
      const authorized = await dependencies.authorize(transaction, { actorId: dependencies.actorId,
        action, purpose: 'ONBOARDING', reason: command.reason, root: { kind: 'PROFILE', id: profile.id } });
      if (!authorized.ok) return authorized;
      const gates = await dependencies.store.readActivationGates(transaction, profile);
      if (command.to === 'ACTIVE' && (!activationReady(gates) || !sameEvidence(command.gateEvidenceIds, gates.evidenceIds))) {
        return { ok: false, error: partnerError('DEPENDENCY_BLOCKED') };
      }
      const now = new Date();
      const revision = profile.revision + 1;
      // Termination owns the Profile lock, so remediate pending inquiry work
      // before the lifecycle state becomes terminal. The database guard rejects
      // every other inquiry writer that resumes after this transaction commits.
      const remediation = command.to === 'TERMINATED'
        ? (await dependencies.store.beginRemediation(transaction, profile.id),
          await dependencies.store.terminatePendingWork(transaction, { profileId: profile.id,
            actorId: dependencies.actorId, commandId: command.commandId,
            correlationId: command.correlationId, reason: command.reason })) : [];
      const updated = await dependencies.store.updateProfile(transaction, { profileId: profile.id,
        expectedRevision: profile.revision, state: command.to, revision,
        ...(command.to === 'ACTIVE' && !profile.firstActivatedAt ? { firstActivatedAt: now } : {}),
        ...(command.to === 'ACTIVE' && !profile.irreversibleAt ? { irreversibleAt: now } : {}),
        ...(command.to === 'TERMINATED' ? { disableUser: true } : {}) });
      if (updated.revision !== revision || updated.state !== command.to) {
        return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      }
      const eventId = await dependencies.store.appendProfileEvent(transaction, { profileId: profile.id,
        revision, fromState: profile.state, toState: command.to, actorId: dependencies.actorId,
        reason: command.reason, commandId: command.commandId, evidence: {
          schemaVersion: 1, authorizationEvidenceId: authorized.value.evidenceId,
          ...(command.to === 'ACTIVE' ? { gateEvidenceIds: gates.evidenceIds } : {}), gates,
        } });
      const saved: PartnerProfileReceipt = { commandId: command.commandId, profileId: profile.id,
        revision, eventIds: [eventId, ...remediation] };
      await dependencies.store.saveOutcome(transaction, key, { payloadHash, receipt: saved });
      return { ok: true, value: { commandId: saved.commandId, replayed: false, eventIds: saved.eventIds } };
    });
  } };
}
