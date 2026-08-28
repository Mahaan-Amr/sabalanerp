import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { createPrismaPartnerAuthorization } from '../partnerSales/authorization/prisma';

function localDatabase(connectionLimit = 2) {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (!['localhost', '127.0.0.1', 'postgres'].includes(url.hostname) || url.pathname !== '/sabalanerp') throw new Error('Existing local DB required');
  url.searchParams.set('connection_limit', String(connectionLimit)); url.searchParams.set('pool_timeout', '10');
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}

async function fixture(run: (tx: Prisma.TransactionClient, partner: string, actor: string) => Promise<void>) {
  const database = localDatabase();
  const rollback = new Error('rollback namespaced fixture');
  try {
    await database.$transaction(async tx => {
      const partner = `authorization-${randomUUID()}`;
      const actor = `authorization-${randomUUID()}`;
      for (const id of [partner, actor]) await tx.user.create({ data: {
        id, username: id, email: `${id}@example.invalid`, password: 'not-a-login', firstName: 'Fixture', lastName: 'Authorization',
      } });
      await run(tx, partner, actor);
      throw rollback;
    }, { timeout: 20_000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await database.$disconnect(); }
}

test('real transaction reads current user activation and current grant rather than a prior UI decision', async () => {
  await fixture(async (tx, partner, actor) => {
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
  });
});

test('a real Project lock wait cannot carry an expired grant back to the caller', async () => {
  const database = localDatabase(3);
  const partner = `authorization-${randomUUID()}`;
  const actor = `authorization-${randomUUID()}`;
  const customerId = `authorization-${randomUUID()}`;
  const projectId = `authorization-${randomUUID()}`;
  const rollback = new Error('rollback retained profile');
  function signal() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
  }
  const locked = signal(); const release = signal(); const grantRead = signal();
  let blocker: Promise<unknown> | undefined;
  let request: Promise<unknown> | undefined;
  let expiresAt = '';
  let result: Awaited<ReturnType<ReturnType<typeof createPrismaPartnerAuthorization>['authorizeProject']>> | undefined;
  try {
    await database.$transaction(async tx => {
      for (const id of [partner, actor]) await tx.user.create({ data: {
        id, username: id, email: `${id}@example.invalid`, password: 'not-a-login', firstName: 'Fixture', lastName: 'Authorization',
      } });
      await tx.crmCustomer.create({ data: { id: customerId, ownerUserId: partner, firstName: 'Fixture', lastName: 'Customer' } });
      await tx.crmPotentialProject.create({ data: { id: projectId, customerId, responsibleSellerId: partner,
        title: 'Fixture project', workType: 'Fixture' } });
    });
    blocker = database.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM crm_potential_projects WHERE id = ${projectId} FOR UPDATE`;
      locked.resolve(); await release.promise;
    }, { timeout: 15_000 });
    await Promise.race([locked.promise, blocker.then(() => { throw new Error('Lock fixture ended early'); })]);
    request = database.$transaction(async tx => {
      // Only mutable CRM/User fixtures are committed. Retained Partner evidence
      // is visible to this command transaction and always rolled back.
      await tx.partnerProfile.create({ data: { id: partner, userId: partner, state: 'ACTIVE' } });
      const port = createPrismaPartnerAuthorization(tx, { actorId: actor, purpose: 'CRM', channel: 'API' }, async () => {
        if (!expiresAt) {
          const [clock] = await tx.$queryRaw<Array<{ expiry: Date }>>`SELECT clock_timestamp() + interval '1 second' AS expiry`;
          expiresAt = clock.expiry.toISOString(); grantRead.resolve();
        }
        return { authorizationRevision: 1, grants: [{ action: 'CUSTOMER_READ', rootKind: 'CUSTOMER', purpose: 'CRM', scope: 'COMPANY', expiresAt }] };
      });
      result = await port.authorizeProject('CUSTOMER_READ', projectId, customerId);
      throw rollback;
    }, { timeout: 15_000 }).catch(error => { if (error !== rollback) throw error; });
    await Promise.race([grantRead.promise, request.then(() => { throw new Error('Request ended before grant'); })]);
    for (let attempt = 0; ; attempt++) {
      const [clock] = await database.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      if (clock.now.getTime() >= Date.parse(expiresAt)) break;
      if (attempt >= 200) throw new Error('Database clock did not reach expiry');
      await new Promise(done => setTimeout(done, 10));
    }
    assert.equal({ current: result }.current, undefined, 'the request must actually wait on the locked Project');
    release.resolve();
    await Promise.all([blocker, request]);
    assert.equal(result?.ok, false, 'permission must be refreshed after the locked child is read');
  } finally {
    release.resolve();
    await Promise.allSettled([blocker, request].filter((item): item is Promise<unknown> => Boolean(item)));
    try {
      await database.$transaction(async tx => {
        await tx.crmPotentialProject.deleteMany({ where: { id: projectId, customerId } });
        await tx.crmCustomer.deleteMany({ where: { id: customerId, ownerUserId: partner } });
        await tx.user.deleteMany({ where: { id: { in: [partner, actor] }, email: { in: [`${partner}@example.invalid`, `${actor}@example.invalid`] } } });
      });
    } finally { await database.$disconnect(); }
  }
});

test('persisted Customer and Project share the Customer root but retain independent Project responsibility', async () => {
  await fixture(async (tx, partner, other) => {
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
  });
});
