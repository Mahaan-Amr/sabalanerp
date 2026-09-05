import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createPrismaPartnerProfileStore } from '../partnerSales/profiles/prismaStore';

function localDatabase() {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/sabalanerp') {
    throw new Error('Existing sabalanerp-local DB required');
  }
  url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '10');
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}

test('activation and a concurrent open correction claim serialize on the Partner Profile lock', async () => {
  const activator = localDatabase(), claimant = localDatabase(), suffix = randomUUID();
  const userId = `partner-correction-race-${suffix}`, profileId = `partner-correction-profile-${suffix}`;
  const correctionId = `partner-correction-request-${suffix}`;
  let releaseActivation!: () => void, announceProfileLock!: () => void;
  const activationMayFinish = new Promise<void>(resolve => { releaseActivation = resolve; });
  const profileLocked = new Promise<void>(resolve => { announceProfileLock = resolve; });
  try {
    await activator.user.create({ data: { id: userId, username: userId, email: `${userId}@example.invalid`,
      password: 'not-a-login', firstName: 'Partner', lastName: 'Correction Race' } });
    await activator.partnerProfile.create({ data: { id: profileId, userId } });
    const store = createPrismaPartnerProfileStore(activator);
    const activation = activator.$transaction(async tx => {
      const profile = await store.lockProfile(tx, profileId); assert.ok(profile);
      announceProfileLock();
      await activationMayFinish;
      const gates = await store.readActivationGates(tx, profile);
      assert.equal(gates.conversionCleared, true, 'the activation snapshot starts without internal correction work');
      await store.updateProfile(tx, { profileId, expectedRevision: 1, revision: 2, state: 'ACTIVE',
        firstActivatedAt: new Date(), irreversibleAt: new Date() });
    }, { timeout: 10_000 });
    await profileLocked;
    let claimSettled = false;
    const claim = claimant.accountingCorrectionRequest.create({ data: { id: correctionId, category: 'OTHER',
      accountantNote: 'درخواست اصلاح هم‌زمان با فعال‌سازی', createdBy: userId, assignedToUserId: userId } })
      .finally(() => { claimSettled = true; });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(claimSettled, false, 'the correction writer waits behind the Profile activation lock');
    releaseActivation();
    await activation;
    await assert.rejects(claim, /incompatible authority or responsibility for irreversible Partner persona/);
    assert.equal(await activator.accountingCorrectionRequest.count({ where: { id: correctionId } }), 0);
  } finally {
    releaseActivation?.();
    await activator.$transaction(async tx => {
      // Partner evidence is intentionally retained in normal operation. This
      // local-only harness removes only its exact namespaced fixture rows.
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.accountingCorrectionRequest.deleteMany({ where: { id: correctionId } });
      await tx.partnerProfile.deleteMany({ where: { id: profileId } });
      await tx.user.deleteMany({ where: { id: userId } });
    });
    await Promise.all([activator.$disconnect(), claimant.$disconnect()]);
  }
});
