import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { canonicalHash } from '@sabalanerp/partner-sales-contracts';
import { createPrismaManagementWorkspaceReader } from '../partnerSales/workspaces/management';
import { createPartnerCrmService } from '../partnerSales/crm/service';
import { createAuditedPartnerAuthorization } from '../partnerSales/authorization/audited';
import { canReadTransferNotice } from '../partnerSales/crm/transferAccess';
import { resolveWorkspaceRouteAvailability } from '../workspaceRouteAvailability';
import { seedAuthorizationCase } from './partnerAuthorizationFixture';
import { FEATURES, FEATURE_LABELS } from '../../middleware/feature';

test('transfer management resolves internal ownership, ADMIN reasons, explicit HR authority, and atomic direct transfer', async () => {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL || '');
  assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(url.hostname) && url.pathname === '/sabalanerp');
  url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '10');
  const database = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const rollback = new Error('rollback transfer management fixtures');
  try {
    await assert.rejects(database.$transaction(async tx => {
      const suffix = randomUUID();
      const admin = `transfer-admin-${suffix}`, owner = `transfer-owner-${suffix}`, partner = `transfer-partner-${suffix}`, delegate = `transfer-delegate-${suffix}`;
      for (const [id, role] of [[admin, 'ADMIN'], [owner, 'SALES'], [partner, 'SALES'], [delegate, 'MANAGER']] as const) {
        await tx.user.create({ data: { id, role, username: id, email: `${id}@example.invalid`, password: 'not-a-login', firstName: 'آزمون', lastName: id } });
      }
      await tx.partnerProfile.create({ data: { id: partner, userId: partner, state: 'ACTIVE' } });
      const customerId = `transfer-customer-${suffix}`, transferId = `transfer-request-${suffix}`, matchId = `transfer-match-${suffix}`;
      await tx.crmCustomer.create({ data: { id: customerId, ownerUserId: owner, firstName: 'مشتری', lastName: 'آزمون', phoneNumbers: { create: { number: '09120000000', type: 'mobile', isPrimary: true } } } });
      const snapshot = { schemaVersion: 1, purpose: 'DUPLICATE_MATCH', matchReference: matchId, displayName: 'مشتری آزمون', personType: 'NATURAL', city: 'تهران', maskedWitness: '********0000' };
      await tx.partnerDuplicateCustomerMatch.create({ data: { id: matchId, requesterProfileId: partner, customerId, snapshot, witnessHash: await canonicalHash(snapshot), expiresAt: new Date(Date.now() + 900000) } });
      await tx.partnerCustomerTransfer.create({ data: { id: transferId, customerId, matchId, fromOwnerUserId: owner, toProfileId: partner, requestedBy: partner, requestReason: 'درخواست انتقال آزمون', correlationId: suffix } });
      const read = async (actorId: string) => createPrismaManagementWorkspaceReader({ database, actorId, correlationId: suffix })(tx, { limit: 20, section: 'TRANSFERS', transferId });
      const adminView = await read(admin);
      assert.ok(adminView.ok); if (!adminView.ok) throw new Error('projection denied');
      assert.equal(adminView.value.transfers.length, 1);
      assert.equal(adminView.value.transfers[0].actions[0].enabled, true);
      assert.equal(adminView.value.transfers[0].requestReason, 'درخواست انتقال آزمون');
      const denied = await read(delegate); assert.ok(denied.ok); if (denied.ok) assert.equal(denied.value.transfers.length, 0);
      await tx.workspacePermission.create({ data: { userId: delegate, workspace: 'crm', permissionLevel: 'edit' } });
      const grant = await tx.featurePermission.create({ data: { userId: delegate, workspace: 'crm', feature: FEATURES.CRM_PARTNER_CUSTOMER_TRANSFERS_MANAGE, permissionLevel: 'edit' } });
      assert.equal(FEATURE_LABELS[FEATURES.CRM_PARTNER_CUSTOMER_TRANSFERS_MANAGE], 'بررسی و تصمیم انتقال مشتری به همکار');
      const allowed = await read(delegate); assert.ok(allowed.ok); if (allowed.ok) assert.equal(allowed.value.transfers[0].actions[0].enabled, true);
      assert.equal(await canReadTransferNotice(tx, owner, transferId), true);
      assert.equal(await canReadTransferNotice(tx, partner, transferId), true);
      assert.equal(await canReadTransferNotice(tx, delegate, transferId), true);
      const transactionDatabase = new Proxy(tx, { get(target, property) { return property === '$transaction' ? (work: (transaction: Prisma.TransactionClient) => unknown) => work(tx) : Reflect.get(target, property); } }) as unknown as PrismaClient;
      assert.equal((await resolveWorkspaceRouteAvailability(transactionDatabase, { userId: delegate, role: 'MANAGER', path: '/dashboard/sales/partners' })).allowed, true);
      assert.equal((await resolveWorkspaceRouteAvailability(transactionDatabase, { userId: partner, role: 'SALES', path: '/dashboard/sales/partner-customers/transfers' })).allowed, true);
      assert.equal((await resolveWorkspaceRouteAvailability(transactionDatabase, { userId: owner, role: 'SALES', path: '/dashboard/sales/partner-customers/transfers' })).allowed, false);
      await tx.featurePermission.update({ where: { id: grant.id }, data: { isActive: false } });
      assert.equal(await canReadTransferNotice(tx, delegate, transferId), false);
      const service = createPartnerCrmService({ database: { $transaction: async (work: (transaction: Prisma.TransactionClient) => unknown) => work(tx) } as unknown as PrismaClient,
        actorId: admin, authorize: (transaction, input) => createAuditedPartnerAuthorization(transaction, { actorId: admin, purpose: 'CRM', channel: 'API' },
          { correlationId: input.correlationId, reason: input.reason }, input.target).authorize(input.action, input.root), notifyTransfer: async () => undefined });
      const intent = { schemaVersion: 1, customerId, toProfileId: partner, expectedOwnerUserId: owner, reason: 'انتقال مستقیم با حفظ سابقه' };
      const command = { ...intent, commandId: `direct-${suffix}`, correlationId: suffix, idempotencyKey: `direct-${suffix}`, payloadHash: await canonicalHash(intent) };
      const direct = await service.directTransfer(command);
      assert.ok(direct.ok, JSON.stringify(direct));
      assert.deepEqual(await service.directTransfer(command), direct);
      assert.equal((await tx.crmCustomer.findUniqueOrThrow({ where: { id: customerId } })).ownerUserId, partner);
      const directCustomerId = `transfer-direct-customer-${suffix}`;
      await tx.crmCustomer.create({ data: { id: directCustomerId, ownerUserId: owner, firstName: 'مشتری', lastName: 'مستقیم' } });
      const directIntent = { ...intent, customerId: directCustomerId };
      const fresh = await service.directTransfer({ ...directIntent, commandId: `fresh-${suffix}`, correlationId: suffix, idempotencyKey: `fresh-${suffix}`, payloadHash: await canonicalHash(directIntent) });
      assert.ok(fresh.ok, JSON.stringify(fresh));
      assert.equal((await tx.crmCustomer.findUniqueOrThrow({ where: { id: directCustomerId } })).ownerUserId, partner);
      assert.equal(await tx.partnerCustomerTransferEvent.count({ where: { transfer: { customerId: directCustomerId } } }), 2);
      const phoneFreeMatch = await tx.partnerDuplicateCustomerMatch.findFirstOrThrow({ where: { customerId: directCustomerId } });
      assert.equal((phoneFreeMatch.snapshot as { maskedWitness: string }).maskedWitness, 'ثبت‌نشده');
      const openCase = await seedAuthorizationCase(tx, partner, owner);
      await tx.phoneNumber.create({ data: { customerId: openCase.id, number: '09120000001', type: 'mobile', isPrimary: true } });
      const blockedIntent = { ...intent, customerId: openCase.id };
      const before = await tx.partnerCustomerTransfer.count({ where: { customerId: openCase.id } });
      const blocked = await service.directTransfer({ ...blockedIntent, commandId: `blocked-${suffix}`, correlationId: suffix, idempotencyKey: `blocked-${suffix}`, payloadHash: await canonicalHash(blockedIntent) });
      assert.equal(blocked.ok, false); if (!blocked.ok) assert.equal(blocked.error.code, 'DEPENDENCY_BLOCKED');
      assert.equal(await tx.partnerCustomerTransfer.count({ where: { customerId: openCase.id } }), before);
      throw rollback;
    }, { timeout: 60000 }), error => error === rollback);
  } finally { await database.$disconnect(); }
});
