import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalHash, type PartnerCommand } from '@sabalanerp/partner-sales-contracts';
import { createPartnerProfileService, type PartnerProfileStore } from '../partnerSales/profiles/service';

type Profile = { id: string; userId: string; state: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'TERMINATED';
  revision: number; firstActivatedAt: Date | null; irreversibleAt: Date | null };

function harness(input: { state?: Profile['state']; gates?: Partial<Awaited<ReturnType<PartnerProfileStore['readActivationGates']>>> } = {}) {
  const profile: Profile = { id: 'profile-316', userId: 'partner-316', state: input.state ?? 'PENDING', revision: 1,
    firstActivatedAt: null, irreversibleAt: null };
  const outcomes = new Map<string, { payloadHash: string; receipt: unknown }>();
  const events: unknown[] = [];
  const remediationStates: Profile['state'][] = [];
  const gates = { identityVerified: true, commercialTermsReady: true, creditTermsReady: true,
    responderReady: true, conversionCleared: true, cohortReady: true, userActive: true,
    conflictingInternalAuthority: false, evidenceIds: ['gate-316'], ...input.gates };
  const store: PartnerProfileStore = {
    transaction: async work => work({} as never),
    findOutcome: async (_tx, key) => outcomes.get(JSON.stringify(key)) ?? null,
    saveOutcome: async (_tx, key, value) => { outcomes.set(JSON.stringify(key), value); },
    lockProfile: async () => ({ ...profile }),
    readActivationGates: async () => gates,
    updateProfile: async (_tx, update) => { Object.assign(profile, update); return { ...profile }; },
    appendProfileEvent: async (_tx, event) => { events.push(event); return `event-${events.length}`; },
    beginRemediation: async () => undefined,
    terminatePendingWork: async () => { remediationStates.push(profile.state); return []; },
  };
  const service = createPartnerProfileService({ actorId: 'hr-316', store,
    authorize: async () => ({ ok: true, value: { evidenceId: 'authorization-316' } }) });
  return { profile, events, outcomes, remediationStates, service };
}

async function transition(to: 'ACTIVE' | 'SUSPENDED' | 'TERMINATED', reason = 'تصمیم ممیزی‌شده مدیریت') {
  const intent = { schemaVersion: 1 as const, type: 'PROFILE_TRANSITION' as const, profileId: 'profile-316',
    expectedRevision: 1, to, reason, gateEvidenceIds: ['gate-316'] };
  return { ...intent, commandId: `command-${to}`, correlationId: `correlation-${to}`,
    idempotency: { actorId: 'hr-316', operation: 'PROFILE_TRANSITION', targetId: 'profile-316',
      key: `key-${to}`, payloadHash: await canonicalHash(intent) } } satisfies PartnerCommand;
}

test('profile activation commits once only after every independent gate is current', async () => {
  const ready = harness();
  const command = await transition('ACTIVE');
  const first = await ready.service.execute(command);
  assert.equal(first.ok, true);
  assert.equal(ready.profile.state, 'ACTIVE');
  assert.equal(ready.profile.revision, 2);
  assert.ok(ready.profile.firstActivatedAt);
  assert.ok(ready.profile.irreversibleAt);
  assert.equal(ready.events.length, 1);
  const replay = await ready.service.execute(command);
  assert.equal(replay.ok && replay.value.replayed, true);
  assert.equal(ready.events.length, 1);
  const key = JSON.stringify({ actorId: 'hr-316', operation: 'PROFILE_TRANSITION',
    targetScope: 'profile-316', key: 'key-ACTIVE' });
  const persisted = ready.outcomes.get(key)!;
  ready.outcomes.set(key, { ...persisted, receipt: { ...(persisted.receipt as object), profileId: 'other-profile' } });
  const misbound = await ready.service.execute(command);
  assert.equal(misbound.ok, false, 'a stored receipt cannot replay across Profile scope');
  if (!misbound.ok) assert.equal(misbound.error.code, 'INTEGRITY_CONFLICT');

  for (const gate of ['identityVerified', 'commercialTermsReady', 'creditTermsReady', 'responderReady',
    'conversionCleared', 'cohortReady', 'userActive'] as const) {
    const blocked = harness({ gates: { [gate]: false } });
    const result = await blocked.service.execute(await transition('ACTIVE'));
    assert.equal(result.ok, false, gate);
    assert.equal(blocked.profile.state, 'PENDING');
  }
  const conflict = harness({ gates: { conflictingInternalAuthority: true } });
  assert.equal((await conflict.service.execute(await transition('ACTIVE'))).ok, false);
});

test('suspension preserves approval evidence while termination runs owner remediation', async () => {
  const suspended = harness({ state: 'ACTIVE' });
  const result = await suspended.service.execute(await transition('SUSPENDED'));
  assert.equal(result.ok, true);
  assert.equal(suspended.profile.state, 'SUSPENDED');
  assert.equal(suspended.events.length, 1);
  const reactivated = harness({ state: 'SUSPENDED' });
  assert.equal((await reactivated.service.execute(await transition('ACTIVE'))).ok, true,
    'a suspended profile can reactivate after current gates pass');
  const inactive = harness({ state: 'SUSPENDED', gates: { userActive: false } });
  const terminated = await inactive.service.execute(await transition('TERMINATED'));
  assert.equal(terminated.ok, true, 'inactive login never prevents HR termination remediation');
  assert.equal(inactive.profile.state, 'TERMINATED');
  assert.deepEqual(inactive.remediationStates, ['SUSPENDED'],
    'owner remediation completes under the lifecycle lock before terminal state blocks inquiry writers');
});
