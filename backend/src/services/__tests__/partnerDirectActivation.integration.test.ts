import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { canonicalHash, type PartnerDirectActivationCommandV4,
  type PartnerDirectActivationRevertCommandV4 } from '@sabalanerp/partner-sales-contracts';
import { grantScopedAction } from '../effectiveAuthorization/scopedActions';
import { createPartnerLifecycleDatabase } from './partnerCaseLifecycleDatabase';
import { createPrismaPartnerDirectActivation } from '../partnerSales/activationPackage/directPrisma';

function databaseUrl() {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/sabalanerp') {
    throw new Error('Existing sabalanerp-local database required');
  }
  return url.toString();
}

test('direct activation converts an eligible user atomically without identity, terms, cohort or release inputs', async () => {
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: path.resolve(process.cwd()),
    sourceDatabaseUrl: databaseUrl() });
  const database = temporary.client();
  const suffix = randomUUID(), actorId = `direct-admin-${suffix}`, userId = `direct-user-${suffix}`;
  const responderId = `direct-responder-${suffix}`;
  try {
    await database.effectiveAuthorizationState.create({ data: { id: 1, revision: 1 } });
    await database.user.createMany({ data: [
      { id: actorId, username: actorId, email: `${actorId}@example.invalid`, password: 'not-a-login',
        firstName: 'مدیر', lastName: 'آزمون', role: 'ADMIN' },
      { id: userId, username: userId, email: `${userId}@example.invalid`, password: 'not-a-login',
        firstName: 'فریبا', lastName: 'پورشهید', role: 'SALES' },
      { id: responderId, username: responderId, email: `${responderId}@example.invalid`, password: 'not-a-login',
        firstName: 'پاسخ‌دهنده', lastName: 'قیمت', role: 'SALES' },
    ] });
    await database.profile.create({ data: { userId, phone: '09170000000', address: 'شیراز' } });
    await grantScopedAction(database, { actorId, reason: 'مجوز پاسخ استعلام برای آزمون تبدیل مستقیم',
      correlationId: `${suffix}-responder` }, { principal: { kind: 'USER', id: responderId }, domain: 'PARTNER',
      action: 'INQUIRY_RESPOND', rootKind: 'INQUIRY', purpose: 'RESPONDER', scope: 'ASSIGNED', effect: 'ALLOW' });
    await database.workspacePermission.create({ data: { userId: responderId, workspace: 'sales',
      permissionLevel: 'EDIT', grantedBy: actorId } });
    await database.featurePermission.create({ data: { userId: responderId, workspace: 'sales',
      feature: 'sales_partner_inquiries_respond', permissionLevel: 'EDIT', grantedBy: actorId } });
    await database.workspacePermission.create({ data: { userId, workspace: 'sales', permissionLevel: 'EDIT', grantedBy: actorId } });
    const service = createPrismaPartnerDirectActivation({ database, actorId,
      authorize: async (_tx, request) => ({ ok: true, value: { evidenceId: `auth-${request.action}` } }) });
    const before = await service.query({ schemaVersion: 4, purpose: 'PARTNER_DIRECT_ACTIVATION', userId });
    assert.equal(before.ok && before.value.subject.canActivate, true);
    assert.deepEqual(before.ok && before.value.responders.map(row => row.id), [responderId]);
    const user = await database.user.findUniqueOrThrow({ where: { id: userId } });
    const intent = { schemaVersion: 4 as const, type: 'PROFILE_DIRECT_ACTIVATE' as const, userId, responderId,
      expectedUserUpdatedAt: user.updatedAt.toISOString(), consequenceConfirmed: true as const };
    const commandId = `activate-${suffix}`;
    const command: PartnerDirectActivationCommandV4 = { ...intent, commandId, correlationId: commandId,
      idempotency: { actorId, operation: intent.type, targetId: userId, key: commandId,
        payloadHash: await canonicalHash(intent) } };
    const activated = await service.execute(command);
    assert.equal(activated.ok, true, JSON.stringify(activated)); if (!activated.ok) return;
    assert.equal(activated.value.removedAccessCount, 2, 'role and active workspace access are both snapshotted');
    const converted = await database.user.findUniqueOrThrow({ where: { id: userId }, include: {
      workspacePermissions: true,
      partnerProfile: { include: { commercialAccount: { include: { identities: true, terms: true } },
        responderAssignments: true, conversionDispositions: true, events: true } },
    } });
    assert.equal(converted.role, 'USER');
    assert.equal(converted.workspacePermissions[0]?.isActive, false);
    assert.equal(converted.partnerProfile?.state, 'ACTIVE');
    assert.equal(converted.partnerProfile?.responderAssignments.at(-1)?.responderId, responderId);
    assert.equal(converted.partnerProfile?.commercialAccount?.identities[0]?.legalName, 'فریبا پورشهید');
    assert.equal(converted.partnerProfile?.commercialAccount?.terms.length, 0,
      'direct activation does not manufacture commercial or credit terms');
    assert.equal(converted.partnerProfile?.conversionDispositions.length, 3);
    assert.ok(converted.partnerProfile?.conversionDispositions.some(item =>
      item.sourceType === 'PARTNER_ACTIVATION' && item.disposition === 'DIRECT_V4'));
    assert.equal(converted.partnerProfile?.events.at(-1)?.reason, 'تبدیل به فروشنده همکار');
    const replay = await service.execute(command);
    assert.equal(replay.ok && replay.value.replayed, true);
    const activeView = await service.query({ schemaVersion: 4, purpose: 'PARTNER_DIRECT_ACTIVATION', userId });
    assert.equal(activeView.ok && activeView.value.subject.canRevert, true);
    const revertIntent = { schemaVersion: 4 as const, type: 'PROFILE_DIRECT_ACTIVATION_REVERT' as const,
      userId, profileId: activated.value.profileId, expectedProfileRevision: activated.value.profileRevision,
      consequenceConfirmed: true as const };
    const revertCommandId = `revert-${suffix}`;
    const revertCommand: PartnerDirectActivationRevertCommandV4 = { ...revertIntent,
      commandId: revertCommandId, correlationId: revertCommandId, idempotency: { actorId,
        operation: revertIntent.type, targetId: revertIntent.profileId, key: revertCommandId,
        payloadHash: await canonicalHash(revertIntent) } };
    const reverted = await service.revert(revertCommand);
    assert.equal(reverted.ok, true, JSON.stringify(reverted)); if (!reverted.ok) return;
    assert.equal(reverted.value.restoredAccessCount, 2);
    const restored = await database.user.findUniqueOrThrow({ where: { id: userId }, include: {
      workspacePermissions: true, partnerProfile: { include: { conversionDispositions: true, events: true } },
    } });
    assert.equal(restored.role, 'SALES');
    assert.equal(restored.workspacePermissions[0]?.isActive, true);
    assert.equal(restored.partnerProfile?.state, 'PENDING');
    assert.ok(restored.partnerProfile?.conversionDispositions.some(item => item.disposition === 'REVERTED'));
    assert.equal(restored.partnerProfile?.events.at(-1)?.toState, 'PENDING');
    const revertReplay = await service.revert(revertCommand);
    assert.equal(revertReplay.ok && revertReplay.value.replayed, true);
  } finally {
    await database.$disconnect();
    await temporary.cleanup();
  }
});
