import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalHash, type PartnerManagementCommandV2 } from '@sabalanerp/partner-sales-contracts';
import { createPartnerProfileManagementService, type PartnerProfileManagementStore } from '../partnerSales/profiles/management';

type Profile = { id: string; userId: string; state: 'PENDING'; revision: number };

function fixture() {
  const profiles = new Map<string, Profile>();
  const outcomes = new Map<string, { payloadHash: string; receipt: unknown }>();
  const events: Array<{ kind: string; profileId: string; referenceId: string }> = [];
  const conversion = new Map<string, { started: boolean; irreversible: boolean; blockerIds: string[];
    requiredBlockerIds: string[]; evidenceIds: string[] }>();
  const store: PartnerProfileManagementStore<object> = {
    transaction: run => run({}),
    findOutcome: async (_tx, key) => outcomes.get(`${key.actorId}:${key.operation}:${key.targetScope}:${key.key}`) ?? null,
    saveOutcome: async (_tx, key, value) => { outcomes.set(`${key.actorId}:${key.operation}:${key.targetScope}:${key.key}`, value); },
    verifyCreationReceipt: async (_tx, input) => profiles.has(input.profileId) &&
      events.some(event => event.kind === 'PROFILE_CREATE' && event.profileId === input.profileId &&
        event.referenceId === input.identityEvidenceId),
    resolveIdentityEvidence: async (_tx, evidenceId) => evidenceId === 'identity-1' ? {
      id: evidenceId, userId: 'partner-user', legalName: 'فروشنده همکار', personType: 'NATURAL',
      identifiers: { nationalId: 'masked' }, phone: '+989120000000', address: 'تهران، نشانی معتبر',
      integrityHash: `sha256-v1:${'1'.repeat(64)}`,
    } : null,
    resolveTermsPolicy: async (_tx, policyId, purpose) => policyId === `${purpose}-v1` ? {
      id: policyId, purpose, effectiveDate: new Date('2026-08-29'), terms: { purpose, policyId },
      integrityHash: `sha256-v1:${'2'.repeat(64)}`,
    } : null,
    lockProfile: async (_tx, profileId) => profiles.get(profileId) ?? null,
    findProfileByUser: async (_tx, userId) => [...profiles.values()].find(profile => profile.userId === userId) ?? null,
    createProfile: async (_tx, input) => {
      const profile = { id: input.profileId, userId: input.evidence.userId, state: 'PENDING' as const, revision: 1 };
      profiles.set(profile.id, profile); events.push({ kind: 'PROFILE_CREATE', profileId: profile.id, referenceId: input.evidence.id });
      return { profile, eventId: `event-${events.length}` };
    },
    appendIdentity: async (_tx, input) => {
      const profile = profiles.get(input.profile.id)!; profile.revision += 1;
      events.push({ kind: 'IDENTITY_VERIFY', profileId: profile.id, referenceId: input.evidence.id });
      return { revision: profile.revision, eventId: `event-${events.length}` };
    },
    appendTerms: async (_tx, input) => {
      const profile = profiles.get(input.profile.id)!; profile.revision += 1;
      events.push({ kind: input.policy.purpose, profileId: profile.id, referenceId: input.policy.id });
      return { revision: profile.revision, eventId: `event-${events.length}` };
    },
    readConversion: async (_tx, profile) => conversion.get(profile.id) ??
      { started: false, irreversible: false, blockerIds: [], requiredBlockerIds: [], evidenceIds: [] },
    appendConversion: async (_tx, input) => {
      const profile = profiles.get(input.profile.id)!; profile.revision += 1;
      const previous = conversion.get(profile.id) ?? { started: false, irreversible: false, blockerIds: [],
        requiredBlockerIds: [], evidenceIds: [] };
      conversion.set(profile.id, { ...previous, started: input.transition === 'START',
        requiredBlockerIds: input.blockerIds,
        evidenceIds: input.dispositionEvidenceIds });
      events.push({ kind: `PROFILE_CONVERSION_${input.transition}`, profileId: profile.id,
        referenceId: input.dispositionEvidenceIds.join(',') });
      return { revision: profile.revision, eventId: `event-${events.length}` };
    },
  };
  return { store, profiles, events, conversion, outcomes };
}

type CommandInput = { type: 'PROFILE_CREATE'; identityEvidenceId: string } |
  { type: 'IDENTITY_VERIFY'; profileId: string; expectedRevision: number; evidenceId: string } |
  { type: 'COMMERCIAL_TERMS_SET' | 'CREDIT_TERMS_SET'; profileId: string; expectedRevision: number; termsVersionId: string } |
  { type: 'PROFILE_CONVERSION'; profileId: string; expectedRevision: number; transition: 'START' | 'ABANDON' | 'RESOLVE';
    dispositionEvidenceIds: string[] };

async function command(actorId: string, input: CommandInput, commandId: string): Promise<PartnerManagementCommandV2> {
  const intent = { schemaVersion: 2 as const, ...input, reason: 'دلیل معتبر برای عملیات پروفایل همکار' } as const;
  const targetId = input.type === 'PROFILE_CREATE' ? input.identityEvidenceId : input.profileId;
  return { ...intent, commandId, correlationId: commandId, idempotency: { actorId, operation: input.type,
    targetId, key: commandId, payloadHash: await canonicalHash(intent) } } as PartnerManagementCommandV2;
}

test('profile management creates one pending profile from current owner-issued identity evidence and replays exactly', async () => {
  const { store, profiles, events } = fixture();
  const authorizations: string[] = [];
  const service = createPartnerProfileManagementService({ actorId: 'hr-manager', store, newId: () => 'profile-1',
    authorize: async (_tx, input) => { authorizations.push(`${input.action}:${input.prospectiveOwnerId}`);
      return { ok: true, value: { evidenceId: 'authorization-1' } }; } });
  const request = await command('hr-manager', { type: 'PROFILE_CREATE', identityEvidenceId: 'identity-1' }, 'create-1');
  const first = await service.execute(request);
  assert.deepEqual(first, { ok: true, value: { commandId: 'create-1', replayed: false, profileId: 'profile-1',
    revision: 1, eventIds: ['event-1'] } });
  assert.equal(profiles.get('profile-1')?.state, 'PENDING');
  assert.deepEqual(authorizations, ['PROFILE_CREATE:partner-user']);
  assert.deepEqual(await service.execute(request), { ok: true, value: { commandId: 'create-1', replayed: true,
    profileId: 'profile-1', revision: 1, eventIds: ['event-1'] } });
  assert.equal(events.length, 1);
});

test('identity and effective commercial/credit policies append evidence and advance profile CAS independently', async () => {
  const { store, profiles, events } = fixture(); profiles.set('profile-1', { id: 'profile-1', userId: 'partner-user', state: 'PENDING', revision: 1 });
  const actions: string[] = [];
  const service = createPartnerProfileManagementService({ actorId: 'manager', store, newId: () => 'unused',
    authorize: async (_tx, input) => { actions.push(input.action); return { ok: true, value: { evidenceId: `auth-${input.action}` } }; } });
  assert.equal((await service.execute(await command('manager', { type: 'IDENTITY_VERIFY', profileId: 'profile-1',
    expectedRevision: 1, evidenceId: 'identity-1' }, 'identity-command'))).ok, true);
  assert.equal((await service.execute(await command('manager', { type: 'COMMERCIAL_TERMS_SET', profileId: 'profile-1',
    expectedRevision: 2, termsVersionId: 'PARTNER_TECHNICAL_PRICING-v1' }, 'commercial-command'))).ok, true);
  const credit = await service.execute(await command('manager', { type: 'CREDIT_TERMS_SET', profileId: 'profile-1',
    expectedRevision: 3, termsVersionId: 'PARTNER_CREDIT_TERMS-v1' }, 'credit-command'));
  assert.equal(credit.ok, true); if (credit.ok) assert.equal(credit.value.revision, 4);
  assert.deepEqual(actions, ['IDENTITY_VERIFY', 'COMMERCIAL_TERMS_MANAGE', 'CREDIT_TERMS_MANAGE']);
  assert.deepEqual(events.map(event => event.kind), ['IDENTITY_VERIFY', 'PARTNER_TECHNICAL_PRICING', 'PARTNER_CREDIT_TERMS']);
});

test('profile management rejects stale revisions, unknown evidence, actor spoofing and second profile for one user', async () => {
  const { store, profiles, outcomes } = fixture(); profiles.set('existing', { id: 'existing', userId: 'partner-user', state: 'PENDING', revision: 4 });
  const service = createPartnerProfileManagementService({ actorId: 'manager', store, newId: () => 'profile-2',
    authorize: async () => ({ ok: true, value: { evidenceId: 'authorization' } }) });
  const duplicate = await service.execute(await command('manager', { type: 'PROFILE_CREATE', identityEvidenceId: 'identity-1' }, 'duplicate'));
  assert.equal(duplicate.ok ? null : duplicate.error.code, 'STATE_CONFLICT');
  const stale = await service.execute(await command('manager', { type: 'IDENTITY_VERIFY', profileId: 'existing',
    expectedRevision: 3, evidenceId: 'identity-1' }, 'stale'));
  assert.equal(stale.ok ? null : stale.error.code, 'ROW_STALE');
  const missing = await service.execute(await command('manager', { type: 'IDENTITY_VERIFY', profileId: 'existing',
    expectedRevision: 4, evidenceId: 'missing' }, 'missing'));
  assert.equal(missing.ok ? null : missing.error.code, 'NOT_FOUND');
  const spoofed = await command('other-actor', { type: 'IDENTITY_VERIFY', profileId: 'existing', expectedRevision: 4,
    evidenceId: 'identity-1' }, 'spoofed');
  assert.equal((await service.execute(spoofed)).ok, false);
  const forged = await command('manager', { type: 'IDENTITY_VERIFY', profileId: 'existing', expectedRevision: 4,
    evidenceId: 'identity-1' }, 'forged-replay');
  outcomes.set('manager:IDENTITY_VERIFY:existing:forged-replay', { payloadHash: forged.idempotency.payloadHash,
    receipt: { commandId: forged.commandId, profileId: 'different-profile', revision: 4, eventIds: [] } });
  const forgedReplay = await service.execute(forged);
  assert.equal(forgedReplay.ok ? null : forgedReplay.error.code, 'INTEGRITY_CONFLICT');
});

test('conversion requires an open process, current blocker disposition and owner-issued evidence before resolution', async () => {
  const { store, profiles, conversion, events } = fixture();
  profiles.set('profile-1', { id: 'profile-1', userId: 'partner-user', state: 'PENDING', revision: 1 });
  conversion.set('profile-1', { started: false, irreversible: false, blockerIds: ['DUTY:duty-1'],
    requiredBlockerIds: [], evidenceIds: [] });
  const service = createPartnerProfileManagementService({ actorId: 'sales-manager', store, newId: () => 'unused',
    authorize: async (_tx, input) => ({ ok: true, value: { evidenceId: `auth-${input.action}` } }) });
  const start = await service.execute(await command('sales-manager', { type: 'PROFILE_CONVERSION', profileId: 'profile-1',
    expectedRevision: 1, transition: 'START', dispositionEvidenceIds: [] }, 'conversion-start'));
  assert.equal(start.ok, true);
  const blocked = await service.execute(await command('sales-manager', { type: 'PROFILE_CONVERSION', profileId: 'profile-1',
    expectedRevision: 2, transition: 'RESOLVE', dispositionEvidenceIds: ['disposition-1'] }, 'conversion-blocked'));
  assert.equal(blocked.ok ? null : blocked.error.code, 'DEPENDENCY_BLOCKED');
  conversion.set('profile-1', { started: true, irreversible: false, blockerIds: [],
    requiredBlockerIds: ['DUTY:duty-1'], evidenceIds: ['disposition-1'] });
  const resolved = await service.execute(await command('sales-manager', { type: 'PROFILE_CONVERSION', profileId: 'profile-1',
    expectedRevision: 2, transition: 'RESOLVE', dispositionEvidenceIds: ['disposition-1'] }, 'conversion-resolve'));
  assert.equal(resolved.ok, true); if (resolved.ok) assert.equal(resolved.value.revision, 3);
  assert.equal(events.at(-1)?.kind, 'PROFILE_CONVERSION_RESOLVE');
});
