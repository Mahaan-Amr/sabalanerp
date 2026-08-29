import { canonicalHash, PartnerManagementCommandV2Schema, partnerError,
  type PartnerManagementCommandV2Port, type Result } from '@sabalanerp/partner-sales-contracts';

type Command = ReturnType<typeof PartnerManagementCommandV2Schema.parse>;
type Supported = Extract<Command, { type: 'PROFILE_CREATE' | 'IDENTITY_VERIFY' |
  'COMMERCIAL_TERMS_SET' | 'CREDIT_TERMS_SET' | 'PROFILE_CONVERSION' }>;
type Profile = { id: string; userId: string; state: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'TERMINATED'; revision: number };
type OutcomeKey = { actorId: string; operation: string; targetScope: string; key: string };
type Receipt = { commandId: string; profileId: string; revision: number; eventIds: string[] };

export type PartnerIdentityEvidence = { id: string; userId: string; legalName: string; tradeName?: string;
  personType: string; identifiers: Record<string, unknown>; phone: string; address: string; integrityHash: string };
export type PartnerTermsPolicy = { id: string; purpose: 'PARTNER_TECHNICAL_PRICING' | 'PARTNER_CREDIT_TERMS';
  effectiveDate: Date; terms: Record<string, unknown>; integrityHash: string };

export interface PartnerProfileManagementStore<Transaction = unknown> {
  transaction<T>(run: (tx: Transaction) => Promise<T>): Promise<T>;
  findOutcome(tx: Transaction, key: OutcomeKey): Promise<{ payloadHash: string; receipt: unknown } | null>;
  saveOutcome(tx: Transaction, key: OutcomeKey, value: { payloadHash: string; receipt: Receipt }): Promise<void>;
  verifyCreationReceipt(tx: Transaction, input: { profileId: string; identityEvidenceId: string;
    commandId: string; revision: number }): Promise<boolean>;
  resolveIdentityEvidence(tx: Transaction, evidenceId: string): Promise<PartnerIdentityEvidence | null>;
  resolveTermsPolicy(tx: Transaction, policyId: string, purpose: PartnerTermsPolicy['purpose']): Promise<PartnerTermsPolicy | null>;
  lockProfile(tx: Transaction, profileId: string): Promise<Profile | null>;
  findProfileByUser(tx: Transaction, userId: string): Promise<Profile | null>;
  createProfile(tx: Transaction, input: { profileId: string; evidence: PartnerIdentityEvidence; actorId: string;
    commandId: string; reason: string; authorizationEvidenceId: string }): Promise<{ profile: Profile; eventId: string }>;
  appendIdentity(tx: Transaction, input: { profile: Profile; evidence: PartnerIdentityEvidence; actorId: string;
    commandId: string; reason: string; authorizationEvidenceId: string }): Promise<{ revision: number; eventId: string }>;
  appendTerms(tx: Transaction, input: { profile: Profile; policy: PartnerTermsPolicy; actorId: string;
    commandId: string; reason: string; authorizationEvidenceId: string }): Promise<{ revision: number; eventId: string }>;
  readConversion(tx: Transaction, profile: Profile): Promise<{ started: boolean; irreversible: boolean;
    blockerIds: string[]; requiredBlockerIds: string[]; evidenceIds: string[] }>;
  appendConversion(tx: Transaction, input: { profile: Profile; transition: 'START' | 'ABANDON' | 'RESOLVE';
    blockerIds: string[]; dispositionEvidenceIds: string[]; actorId: string; commandId: string; reason: string;
    authorizationEvidenceId: string }): Promise<{ revision: number; eventId: string }>;
}

export interface PartnerProfileManagementDependencies<Transaction = unknown> {
  actorId: string;
  newId(): string;
  store: PartnerProfileManagementStore<Transaction>;
  authorize(tx: Transaction, input: { actorId: string; action: 'PROFILE_CREATE' | 'IDENTITY_VERIFY' |
    'COMMERCIAL_TERMS_MANAGE' | 'CREDIT_TERMS_MANAGE' | 'PROFILE_CONVERSION_MANAGE';
    purpose: 'ONBOARDING' | 'MANAGEMENT' | 'ACCOUNTING';
    reason: string; root: { kind: 'PROFILE'; id: string }; prospectiveOwnerId?: string }): Promise<Result<{ evidenceId: string }>>;
}

function intent(command: Supported) {
  const { commandId: _commandId, correlationId: _correlationId, idempotency: _idempotency, ...value } = command;
  return value;
}

function decodeReceipt(value: unknown): Receipt | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !['commandId', 'profileId', 'revision', 'eventIds'].includes(key)) ||
      typeof row.commandId !== 'string' || typeof row.profileId !== 'string' || !Number.isSafeInteger(row.revision) ||
      !Array.isArray(row.eventIds) || row.eventIds.some(id => typeof id !== 'string')) return undefined;
  return row as Receipt;
}

function authorization(command: Supported) {
  if (command.type === 'PROFILE_CREATE') return { action: 'PROFILE_CREATE' as const, purpose: 'ONBOARDING' as const };
  if (command.type === 'IDENTITY_VERIFY') return { action: 'IDENTITY_VERIFY' as const, purpose: 'ONBOARDING' as const };
  if (command.type === 'COMMERCIAL_TERMS_SET') return { action: 'COMMERCIAL_TERMS_MANAGE' as const, purpose: 'MANAGEMENT' as const };
  if (command.type === 'CREDIT_TERMS_SET') return { action: 'CREDIT_TERMS_MANAGE' as const, purpose: 'ACCOUNTING' as const };
  return { action: 'PROFILE_CONVERSION_MANAGE' as const, purpose: 'MANAGEMENT' as const };
}

/** Owns the identity and effective-terms evidence required by Profile activation.
 * Browser option lists are references only: evidence/policy provenance, current
 * authority, CAS and idempotency are revalidated inside the write transaction. */
export function createPartnerProfileManagementService<Transaction = unknown>(
  dependencies: PartnerProfileManagementDependencies<Transaction>): PartnerManagementCommandV2Port {
  return { async execute(input) {
    const parsed = PartnerManagementCommandV2Schema.safeParse(input);
    if (!parsed.success || !['PROFILE_CREATE', 'IDENTITY_VERIFY', 'COMMERCIAL_TERMS_SET', 'CREDIT_TERMS_SET', 'PROFILE_CONVERSION']
      .includes(parsed.data.type)) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    const command = parsed.data as Supported;
    const payloadHash = await canonicalHash(intent(command));
    const expectedTarget = command.type === 'PROFILE_CREATE' ? command.identityEvidenceId : command.profileId;
    if (command.idempotency.actorId !== dependencies.actorId || command.idempotency.operation !== command.type ||
        command.idempotency.targetId !== expectedTarget || command.idempotency.payloadHash !== payloadHash) {
      return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    }
    return dependencies.store.transaction(async tx => {
      const targetScope = command.type === 'PROFILE_CREATE' ? command.identityEvidenceId : command.profileId;
      const key = { actorId: dependencies.actorId, operation: command.type, targetScope, key: command.idempotency.key };
      const replay = async (prior: { payloadHash: string; receipt: unknown }) => {
        if (prior.payloadHash !== payloadHash) return { ok: false as const, error: partnerError('IDEMPOTENCY_CONFLICT') };
        const saved = decodeReceipt(prior.receipt);
        if (!saved || saved.commandId !== command.commandId || saved.revision < 1 ||
            (command.type !== 'PROFILE_CREATE' && saved.profileId !== command.profileId)) {
          return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
        }
        if (command.type === 'PROFILE_CREATE' && !await dependencies.store.verifyCreationReceipt(tx, {
          profileId: saved.profileId, identityEvidenceId: command.identityEvidenceId,
          commandId: command.commandId, revision: saved.revision })) {
          return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
        }
        return { ok: true as const, value: { ...saved, replayed: true } };
      };
      const prior = await dependencies.store.findOutcome(tx, key);
      if (prior) return replay(prior);
      if (command.type === 'PROFILE_CREATE') {
        const evidence = await dependencies.store.resolveIdentityEvidence(tx, command.identityEvidenceId);
        if (!evidence) return { ok: false, error: partnerError('NOT_FOUND') };
        const concurrent = await dependencies.store.findOutcome(tx, key);
        if (concurrent) return replay(concurrent);
        const profileId = dependencies.newId();
        const access = authorization(command);
        const authorized = await dependencies.authorize(tx, { actorId: dependencies.actorId, ...access,
          reason: command.reason, root: { kind: 'PROFILE', id: profileId }, prospectiveOwnerId: evidence.userId });
        if (!authorized.ok) return authorized;
        if (await dependencies.store.findProfileByUser(tx, evidence.userId)) {
          return { ok: false, error: partnerError('STATE_CONFLICT') };
        }
        const created = await dependencies.store.createProfile(tx, { profileId, evidence, actorId: dependencies.actorId,
          commandId: command.commandId, reason: command.reason, authorizationEvidenceId: authorized.value.evidenceId });
        const saved = { commandId: command.commandId, profileId: created.profile.id,
          revision: created.profile.revision, eventIds: [created.eventId] };
        await dependencies.store.saveOutcome(tx, key, { payloadHash, receipt: saved });
        return { ok: true, value: { ...saved, replayed: false } };
      }
      const profile = await dependencies.store.lockProfile(tx, command.profileId);
      if (!profile) return { ok: false, error: partnerError('NOT_FOUND') };
      const concurrent = await dependencies.store.findOutcome(tx, key);
      if (concurrent) return replay(concurrent);
      if (profile.revision !== command.expectedRevision) return { ok: false, error: partnerError('ROW_STALE') };
      if (profile.state === 'TERMINATED') return { ok: false, error: partnerError('STATE_CONFLICT') };
      const access = authorization(command);
      const authorized = await dependencies.authorize(tx, { actorId: dependencies.actorId, ...access,
        reason: command.reason, root: { kind: 'PROFILE', id: profile.id } });
      if (!authorized.ok) return authorized;
      let written: { revision: number; eventId: string };
      if (command.type === 'PROFILE_CONVERSION') {
        const conversion = await dependencies.store.readConversion(tx, profile);
        if (command.transition === 'START' && (conversion.started || conversion.irreversible)) {
          return { ok: false, error: partnerError('STATE_CONFLICT') };
        }
        if (command.transition === 'START' && conversion.blockerIds.length === 0) {
          return { ok: false, error: partnerError('STATE_CONFLICT') };
        }
        if (command.transition !== 'START' && !conversion.started) {
          return { ok: false, error: partnerError('STATE_CONFLICT') };
        }
        if (command.transition === 'ABANDON' && conversion.irreversible) {
          return { ok: false, error: partnerError('STATE_CONFLICT') };
        }
        if (command.transition === 'RESOLVE') {
          const supplied = new Set(command.dispositionEvidenceIds);
          if (conversion.blockerIds.length || supplied.size !== command.dispositionEvidenceIds.length ||
              conversion.requiredBlockerIds.length === 0 || supplied.size !== conversion.requiredBlockerIds.length ||
              supplied.size !== conversion.evidenceIds.length || conversion.evidenceIds.some(id => !supplied.has(id))) {
            return { ok: false, error: partnerError('DEPENDENCY_BLOCKED') };
          }
        }
        written = await dependencies.store.appendConversion(tx, { profile, transition: command.transition,
          blockerIds: command.transition === 'START' ? conversion.blockerIds : conversion.requiredBlockerIds,
          dispositionEvidenceIds: command.dispositionEvidenceIds, actorId: dependencies.actorId,
          commandId: command.commandId, reason: command.reason,
          authorizationEvidenceId: authorized.value.evidenceId });
      } else if (command.type === 'IDENTITY_VERIFY') {
        const evidence = await dependencies.store.resolveIdentityEvidence(tx, command.evidenceId);
        if (!evidence) return { ok: false, error: partnerError('NOT_FOUND') };
        if (evidence.userId !== profile.userId) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
        written = await dependencies.store.appendIdentity(tx, { profile, evidence, actorId: dependencies.actorId,
          commandId: command.commandId, reason: command.reason, authorizationEvidenceId: authorized.value.evidenceId });
      } else {
        const purpose = command.type === 'COMMERCIAL_TERMS_SET' ? 'PARTNER_TECHNICAL_PRICING' : 'PARTNER_CREDIT_TERMS';
        const policy = await dependencies.store.resolveTermsPolicy(tx, command.termsVersionId, purpose);
        if (!policy) return { ok: false, error: partnerError('NOT_FOUND') };
        written = await dependencies.store.appendTerms(tx, { profile, policy, actorId: dependencies.actorId,
          commandId: command.commandId, reason: command.reason, authorizationEvidenceId: authorized.value.evidenceId });
      }
      const saved = { commandId: command.commandId, profileId: profile.id,
        revision: written.revision, eventIds: [written.eventId] };
      await dependencies.store.saveOutcome(tx, key, { payloadHash, receipt: saved });
      return { ok: true, value: { ...saved, replayed: false } };
    });
  } };
}
