import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createPrismaPartnerAuthorization } from '../partnerSales/authorization/prisma';

test('real transaction reads current user activation and current grant rather than a prior UI decision', async () => {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (!['localhost', '127.0.0.1', 'postgres'].includes(url.hostname) || url.pathname !== '/sabalanerp') throw new Error('Existing local DB required');
  url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '10');
  const database = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const rollback = new Error('rollback namespaced fixture');
  try {
    await database.$transaction(async tx => {
      const partner = `authorization-${randomUUID()}`;
      const actor = `authorization-${randomUUID()}`;
      for (const id of [partner, actor]) await tx.user.create({ data: {
        id, username: id, email: `${id}@example.invalid`, password: 'not-a-login', firstName: 'Fixture', lastName: 'Authorization',
      } });
      await tx.partnerProfile.create({ data: { id: partner, userId: partner } });
      await tx.featurePermission.create({ data: { userId: actor, workspace: 'hr', feature: 'fixture-partner-identity', permissionLevel: 'edit' } });
      // Test-only #296 adapter: persisted explicit grant. Never a production
      // workspace fallback, default provider, or installed authorization registry.
      const port = createPrismaPartnerAuthorization(tx, { actorId: actor, purpose: 'ONBOARDING', channel: 'API' }, async (_tx, input) => {
        const grant = await _tx.featurePermission.findUniqueOrThrow({ where: {
          userId_workspace_feature: { userId: input.actorId, workspace: 'hr', feature: 'fixture-partner-identity' },
        } });
        return { authorizationRevision: 1, grants: grant.isActive ? [{
          action: 'IDENTITY_VERIFY', rootKind: 'PROFILE', purpose: 'ONBOARDING', scope: 'COMPANY',
          ...(grant.expiresAt ? { expiresAt: grant.expiresAt.toISOString() } : {}),
        }] : [] };
      });
      const root = { kind: 'PROFILE' as const, id: partner };
      assert.equal((await port.authorize('IDENTITY_VERIFY', root)).ok, true);
      await tx.featurePermission.updateMany({ where: { userId: actor }, data: { isActive: false } });
      assert.equal((await port.authorize('IDENTITY_VERIFY', root)).ok, false);
      await tx.featurePermission.updateMany({ where: { userId: actor }, data: { isActive: true, expiresAt: new Date('2000-01-01') } });
      assert.equal((await port.authorize('IDENTITY_VERIFY', root)).ok, false);
      await tx.featurePermission.updateMany({ where: { userId: actor }, data: { expiresAt: null } });
      await tx.user.update({ where: { id: actor }, data: { isActive: false } });
      assert.equal((await port.authorize('IDENTITY_VERIFY', root)).ok, false);
      throw rollback;
    }, { timeout: 20_000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await database.$disconnect(); }
});

test('persisted Customer and Project share the Customer root but retain independent Project responsibility', async () => {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (!['localhost', '127.0.0.1', 'postgres'].includes(url.hostname) || url.pathname !== '/sabalanerp') throw new Error('Existing local DB required');
  url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '10');
  const database = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const rollback = new Error('rollback namespaced fixture');
  try {
    await database.$transaction(async tx => {
      const partner = `authorization-${randomUUID()}`;
      const other = `authorization-${randomUUID()}`;
      for (const id of [partner, other]) await tx.user.create({ data: {
        id, username: id, email: `${id}@example.invalid`, password: 'not-a-login', firstName: 'Fixture', lastName: 'Authorization',
      } });
      await tx.partnerProfile.create({ data: { id: partner, userId: partner, state: 'ACTIVE' } });
      const customer = await tx.crmCustomer.create({ data: { ownerUserId: partner, firstName: 'Fixture', lastName: 'Customer' } });
      const project = await tx.crmPotentialProject.create({ data: { customerId: customer.id, responsibleSellerId: partner,
        title: 'Fixture project', workType: 'Fixture' } });
      const port = createPrismaPartnerAuthorization(tx, { actorId: partner, purpose: 'CRM', channel: 'DETAIL' },
        async () => ({ authorizationRevision: 1, grants: [] }));
      assert.equal((await port.authorize('CUSTOMER_READ', { kind: 'CUSTOMER', id: customer.id })).ok, true);
      assert.equal((await port.authorizeProject('CUSTOMER_WRITE', project.id, customer.id)).ok, true);
      const forged = await port.authorizeProject('CUSTOMER_READ', project.id, 'foreign-customer');
      assert.equal(forged.ok ? null : forged.error.status, 404);
      await tx.crmPotentialProject.update({ where: { id: project.id }, data: { responsibleSellerId: other } });
      assert.equal((await port.authorizeProject('CUSTOMER_READ', project.id, customer.id)).ok, false);
      assert.equal((await port.authorize('CUSTOMER_READ', { kind: 'CUSTOMER', id: customer.id })).ok, true);
      throw rollback;
    }, { timeout: 20_000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await database.$disconnect(); }
});
