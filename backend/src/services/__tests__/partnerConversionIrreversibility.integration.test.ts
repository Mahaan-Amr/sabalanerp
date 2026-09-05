import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { canonicalHash, type PartnerManagementCommandV2 } from '@sabalanerp/partner-sales-contracts';
import { seedAuthorizationCase } from './partnerAuthorizationFixture';
import { createPartnerProfileManagementService } from '../partnerSales/profiles/management';
import { createPrismaPartnerProfileManagementStore } from '../partnerSales/profiles/managementPrismaStore';

function localDatabase() {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/sabalanerp') {
    throw new Error('Existing sabalanerp-local DB required');
  }
  url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '10');
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}

async function conversion(actorId: string, profileId: string, expectedRevision: number,
  transition: 'START' | 'ABANDON', id: string): Promise<PartnerManagementCommandV2> {
  const intent = { schemaVersion: 2 as const, type: 'PROFILE_CONVERSION' as const, profileId, expectedRevision,
    transition, dispositionEvidenceIds: [], reason: 'تست غیرقابل بازگشت شدن هویت همکار' };
  return { ...intent, commandId: id, correlationId: id, idempotency: { actorId, operation: intent.type,
    targetId: profileId, key: id, payloadHash: await canonicalHash(intent) } };
}

for (const root of ['CUSTOMER', 'INQUIRY', 'CASE'] as const) test(`first Partner-owned ${root} prevents conversion abandonment`, async () => {
  const database = localDatabase(), rollback = new Error(`rollback ${root} irreversibility fixture`);
  try {
    await database.$transaction(async tx => {
      const suffix = randomUUID(), actorId = `conversion-manager-${suffix}`, profileId = `conversion-profile-${suffix}`;
      await tx.user.createMany({ data: [actorId, profileId].map(id => ({ id, username: id,
        email: `${id}@example.invalid`, password: 'not-a-login', firstName: 'Conversion', lastName: 'Fixture',
        ...(id === actorId ? { role: 'ADMIN' as const } : {}) })) });
      await tx.partnerProfile.create({ data: { id: profileId, userId: profileId } });
      const permission = await tx.workspacePermission.create({ data: { userId: profileId,
        workspace: `conversion-${suffix}`, permissionLevel: 'EDIT', grantedBy: actorId } });
      const base = createPrismaPartnerProfileManagementStore(database);
      const service = createPartnerProfileManagementService({ actorId, newId: randomUUID,
        store: { ...base, transaction: <T>(run: (inner: Prisma.TransactionClient) => Promise<T>) => run(tx) },
        authorize: async () => ({ ok: true, value: { evidenceId: `authorization-${suffix}` } }) });
      assert.equal((await service.execute(await conversion(actorId, profileId, 1, 'START', `start-${suffix}`))).ok, true);
      await tx.workspacePermission.update({ where: { id: permission.id }, data: { isActive: false } });
      if (root === 'CUSTOMER') {
        await tx.crmCustomer.create({ data: { id: `customer-${suffix}`, firstName: 'Partner', lastName: 'Customer',
          ownerUserId: profileId, partnerOwnerProfileId: profileId } });
      } else if (root === 'INQUIRY') {
        await tx.partnerInquiry.create({ data: { id: `inquiry-${suffix}`, profileId } });
      } else {
        await seedAuthorizationCase(tx, profileId);
      }
      if (root !== 'CUSTOMER') {
        const otherId = `other-profile-${suffix}`;
        await tx.user.create({ data: { id: otherId, username: otherId, email: `${otherId}@example.invalid`,
          password: 'not-a-login', firstName: 'Other', lastName: 'Fixture' } });
        await tx.partnerProfile.create({ data: { id: otherId, userId: otherId } });
        await tx.$executeRawUnsafe('SAVEPOINT immutable_partner_root');
        const move = root === 'INQUIRY'
          ? tx.partnerInquiry.update({ where: { id: `inquiry-${suffix}` }, data: { profileId: otherId } })
          : tx.partnerSaleCase.update({ where: { id: (await tx.partnerSaleCase.findFirstOrThrow({
            where: { profileId }, select: { id: true } })).id }, data: { profileId: otherId } });
        await assert.rejects(move, /Profile root is immutable/);
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT immutable_partner_root');
      }
      assert.ok((await tx.partnerProfile.findUniqueOrThrow({ where: { id: profileId } })).irreversibleAt);
      const abandoned = await service.execute(await conversion(actorId, profileId, 2, 'ABANDON', `abandon-${suffix}`));
      assert.equal(abandoned.ok ? null : abandoned.error.code, 'STATE_CONFLICT');
      throw rollback;
    }, { timeout: 25_000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await database.$disconnect(); }
});
