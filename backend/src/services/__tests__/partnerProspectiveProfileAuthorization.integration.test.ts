import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createAuditedPartnerAuthorization } from '../partnerSales/authorization/audited';

function localDatabase() {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/sabalanerp') {
    throw new Error('Existing sabalanerp-local DB required');
  }
  url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '10');
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}

test('prospective profile authorization binds an active owner before Profile creation without a role fallback', async () => {
  const database = localDatabase(), rollback = new Error('rollback prospective profile authorization fixture');
  try {
    await database.$transaction(async tx => {
      const suffix = randomUUID(), adminId = `prospective-admin-${suffix}`, candidateId = `prospective-user-${suffix}`;
      const ordinaryId = `prospective-ordinary-${suffix}`, profileId = `prospective-profile-${suffix}`;
      await tx.user.createMany({ data: [adminId, candidateId, ordinaryId].map(id => ({ id, username: id,
        email: `${id}@example.invalid`, password: 'not-a-login', firstName: 'Prospective', lastName: 'Fixture',
        ...(id === adminId ? { role: 'ADMIN' as const } : {}) })) });
      const root = { kind: 'PROFILE' as const, id: profileId };
      const admin = createAuditedPartnerAuthorization(tx, { actorId: adminId, purpose: 'ONBOARDING', channel: 'API' },
        { correlationId: `prospective-admin-${suffix}`, reason: 'ایجاد پروفایل همکار با هویت معتبر' },
        { prospectiveProfileOwnerId: candidateId });
      const allowed = await admin.authorize('PROFILE_CREATE', root);
      assert.equal(allowed.ok, true);
      if (allowed.ok) {
        assert.equal(allowed.value.partnerSellerId, candidateId);
        assert.equal(allowed.value.partnerStatus, 'PENDING');
        assert.equal(allowed.value.lifecycleRevision, 1);
      }
      const ordinary = createAuditedPartnerAuthorization(tx,
        { actorId: ordinaryId, purpose: 'ONBOARDING', channel: 'API' },
        { correlationId: `prospective-ordinary-${suffix}`, reason: 'تلاش بدون مجوز ایجاد پروفایل' },
        { prospectiveProfileOwnerId: candidateId });
      const denied = await ordinary.authorize('PROFILE_CREATE', root);
      assert.equal(denied.ok ? null : denied.error.code, 'NOT_FOUND');
      const decisions = await tx.effectiveAuthorizationAudit.findMany({ where: { rootId: profileId },
        orderBy: { recordedAt: 'asc' }, select: { actorId: true, allowed: true, action: true } });
      assert.deepEqual(decisions, [
        { actorId: adminId, allowed: true, action: 'PROFILE_CREATE' },
        { actorId: ordinaryId, allowed: false, action: 'PROFILE_CREATE' },
      ]);
      throw rollback;
    }, { timeout: 20_000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await database.$disconnect(); }
});
