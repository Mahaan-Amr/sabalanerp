import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { createPrismaPartnerAuthorization, createPrismaPartnerAuthorizationV2 } from '../partnerSales/authorization/prisma';
import { seedAuthorizationCase } from './partnerAuthorizationFixture';

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

test('persisted Inquiry authority follows its immutable Partner owner, not a supplied Customer or actor id', async () => {
  await fixture(async (tx, partner, other) => {
    await tx.partnerProfile.create({ data: { id: partner, userId: partner, state: 'ACTIVE' } });
    await tx.partnerProfile.create({ data: { id: other, userId: other, state: 'ACTIVE' } });
    const inquiry = await tx.partnerInquiry.create({ data: { profileId: partner } });
    const authority = async () => ({ authorizationRevision: 1, grants: [] });
    const own = createPrismaPartnerAuthorization(tx, { actorId: partner, purpose: 'PARTNER', channel: 'DETAIL' }, authority);
    const foreign = createPrismaPartnerAuthorization(tx, { actorId: other, purpose: 'PARTNER', channel: 'DETAIL' }, authority);
    assert.equal((await own.authorize('INQUIRY_READ', { kind: 'INQUIRY', id: inquiry.id })).ok, true);
    const denied = await foreign.authorize('INQUIRY_READ', { kind: 'INQUIRY', id: inquiry.id });
    assert.deepEqual(denied, await foreign.authorize('INQUIRY_READ', { kind: 'INQUIRY', id: 'missing-inquiry' }));
  });
});

test('only the latest persisted Inquiry assignment and current responder authority permit a response, including ADMIN', async () => {
  await fixture(async (tx, partner, actor) => {
    await tx.partnerProfile.create({ data: { id: partner, userId: partner, state: 'ACTIVE' } });
    const inquiry = await tx.partnerInquiry.create({ data: { profileId: partner } });
    const assignment = await tx.partnerInquiryAssignment.create({ data: { inquiryId: inquiry.id, revision: 1,
      responderId: actor, actorId: actor, reason: 'انتساب آزمون', eligibilityEvidence: { historical: true } } });
    let granted = true;
    const port = createPrismaPartnerAuthorization(tx, { actorId: actor, purpose: 'RESPONDER', channel: 'API' }, async () => ({
      authorizationRevision: 1, grants: granted ? [{ action: 'INQUIRY_RESPOND', rootKind: 'INQUIRY', purpose: 'RESPONDER', scope: 'ASSIGNED' }] : [],
    }));
    const root = { kind: 'INQUIRY' as const, id: inquiry.id };
    const permitted = await port.authorize('INQUIRY_RESPOND', root);
    assert.equal(permitted.ok, true);
    if (permitted.ok) assert.deepEqual(permitted.value.assignment, { actorId: actor, assignmentId: assignment.id, revision: 1, eligible: true });
    granted = false;
    assert.equal((await port.authorize('INQUIRY_RESPOND', root)).ok, false, 'historical eligibility cannot replace a current grant');
    await tx.user.update({ where: { id: actor }, data: { role: 'ADMIN' } });
    assert.equal((await port.authorize('INQUIRY_RESPOND', root)).ok, true, 'named ADMIN action still requires the real assignment');
    await tx.partnerInquiryAssignment.create({ data: { inquiryId: inquiry.id, revision: 2,
      responderId: partner, actorId: actor, reason: 'انتساب مجدد آزمون', eligibilityEvidence: { historical: true } } });
    const obsolete = await port.authorize('INQUIRY_RESPOND', root);
    assert.equal(obsolete.ok ? null : obsolete.error.code, 'NOT_ASSIGNED');
  });
});

test('direct Inquiry row ids inherit the exact root and current Partner lifecycle', async () => {
  await fixture(async (tx, partner, actor) => {
    await tx.partnerProfile.create({ data: { id: partner, userId: partner, state: 'ACTIVE' } });
    const inquiry = await tx.partnerInquiry.create({ data: { profileId: partner } });
    const unrelated = await tx.partnerInquiry.create({ data: { profileId: partner } });
    const row = await tx.partnerInquiryRow.create({ data: { inquiryId: inquiry.id, version: 1,
      configurationHash: `sha256-v1:${'a'.repeat(64)}`, definition: {} } });
    await tx.partnerInquiryAssignment.create({ data: { inquiryId: inquiry.id, revision: 1,
      responderId: actor, actorId: actor, reason: 'انتساب آزمون', eligibilityEvidence: {} } });
    await tx.user.update({ where: { id: actor }, data: { role: 'ADMIN' } });
    const port = createPrismaPartnerAuthorization(tx, { actorId: actor, purpose: 'RESPONDER', channel: 'API' },
      async () => ({ authorizationRevision: 1, grants: [] }));
    assert.equal((await port.authorizeInquiryRow('INQUIRY_RESPOND', row.id, inquiry.id)).ok, true);
    const mismatch = await port.authorizeInquiryRow('INQUIRY_RESPOND', row.id, unrelated.id);
    assert.equal(mismatch.ok ? null : mismatch.error.status, 404);
    await tx.partnerProfile.update({ where: { id: partner }, data: { state: 'SUSPENDED', revision: 2 } });
    const suspended = await port.authorizeInquiryRow('INQUIRY_RESPOND', row.id, inquiry.id);
    assert.equal(suspended.ok ? null : suspended.error.code, 'PARTNER_NOT_ACTIVE');
    assert.equal((await port.authorizeInquiryRow('INQUIRY_READ', row.id, inquiry.id)).ok, true);
  });
});

test('persisted Case authority follows the immutable Partner even after Customer ownership differs', async () => {
  await fixture(async (tx, partner, other) => {
    await tx.partnerProfile.create({ data: { id: partner, userId: partner, state: 'ACTIVE' } });
    await tx.partnerProfile.create({ data: { id: other, userId: other, state: 'ACTIVE' } });
    const sale = await seedAuthorizationCase(tx, partner, other);
    const authority = async () => ({ authorizationRevision: 1, grants: [] });
    const own = createPrismaPartnerAuthorization(tx, { actorId: partner, purpose: 'PARTNER', channel: 'DETAIL' }, authority);
    const customerOwner = createPrismaPartnerAuthorization(tx, { actorId: other, purpose: 'PARTNER', channel: 'DETAIL' }, authority);
    assert.equal((await own.authorize('CASE_READ', { kind: 'CASE', id: sale.id })).ok, true);
    const denied = await customerOwner.authorize('CASE_READ', { kind: 'CASE', id: sale.id });
    assert.deepEqual(denied, await customerOwner.authorize('CASE_READ', { kind: 'CASE', id: 'missing-case' }));
    const crm = createPrismaPartnerAuthorization(tx, { actorId: other, purpose: 'CRM', channel: 'DETAIL' }, authority);
    assert.equal((await crm.authorize('CUSTOMER_READ', { kind: 'CUSTOMER', id: sale.customerId })).ok, true);
  });
});

test('Case record and product ids cannot authorize a different aggregate or widen its purpose', async () => {
  await fixture(async (tx, partner, other) => {
    await tx.partnerProfile.create({ data: { id: partner, userId: partner, state: 'ACTIVE' } });
    await tx.partnerProfile.create({ data: { id: other, userId: other, state: 'ACTIVE' } });
    const sale = await seedAuthorizationCase(tx, partner);
    const foreign = await seedAuthorizationCase(tx, other);
    const authority = async () => ({ authorizationRevision: 1, grants: [] });
    const own = createPrismaPartnerAuthorization(tx, { actorId: partner, purpose: 'PARTNER', channel: 'LINK' }, authority);
    const crm = createPrismaPartnerAuthorization(tx, { actorId: partner, purpose: 'CRM', channel: 'LINK' }, authority);
    for (const [kind, id] of [['PRODUCT_ROW', sale.rowId], ['INTERNAL_RECORD', sale.internalId], ['CUSTOMER_CONTRACT', sale.contractId]] as const) {
      assert.equal((await own.authorizeCaseRecord('CASE_READ', { kind, id }, sale.id)).ok, true, kind);
      const mismatch = await own.authorizeCaseRecord('CASE_READ', { kind, id }, foreign.id);
      assert.equal(mismatch.ok ? null : mismatch.error.status, 404, kind);
      assert.equal((await crm.authorizeCaseRecord('CASE_READ', { kind, id }, sale.id)).ok, false, 'CRM purpose cannot expose Case economics');
    }
    const denied = await own.authorizeCaseRecord('CASE_READ', { kind: 'CUSTOMER_CONTRACT', id: foreign.contractId }, foreign.id);
    const missing = await own.authorizeCaseRecord('CASE_READ', { kind: 'CUSTOMER_CONTRACT', id: 'missing' }, foreign.id);
    assert.deepEqual(denied, missing);
  });
});

test('financial authority uses the explicitly bound persisted correction requester, never another chain on the Case', async () => {
  await fixture(async (tx, partner, actor) => {
    await tx.partnerProfile.create({ data: { id: partner, userId: partner, state: 'ACTIVE' } });
    await tx.user.update({ where: { id: actor }, data: { role: 'ADMIN' } });
    const sale = await seedAuthorizationCase(tx, partner);
    const opportunities: string[] = [];
    for (const requesterId of [actor, partner]) opportunities.push((await tx.partnerCorrectionOpportunity.create({ data: {
      id: `authorization-correction-${randomUUID()}`, caseId: sale.id, predecessorRevision: 1, scope: 'SABALAN_TERMS',
      scopeHash: `sha256-v1:${'a'.repeat(64)}`, requesterId, approvedBy: actor, approvedAt: new Date('2026-08-28T08:00:00Z'),
      expiresAt: new Date('2026-09-01T08:00:00Z'), calendarVersion: 'fixture-calendar', evidence: {},
    } })).id);
    const binding = { actorId: actor, purpose: 'ACCOUNTING' as const, channel: 'API' as const };
    const authority = async () => ({ authorizationRevision: 1, grants: [] });
    const unbound = createPrismaPartnerAuthorization(tx, binding, authority);
    const requested = createPrismaPartnerAuthorization(tx, binding, authority, { correctionOpportunityId: opportunities[0] });
    const independent = createPrismaPartnerAuthorization(tx, binding, authority, { correctionOpportunityId: opportunities[1] });
    const root = { kind: 'CASE' as const, id: sale.id };
    for (const action of ['FINANCIAL_PROCESS', 'FINANCIAL_APPROVE'] as const) {
      assert.equal((await unbound.authorize(action, root)).ok, false, 'Case alone cannot identify the financial chain');
      const self = await requested.authorize(action, root);
      assert.equal(self.ok ? null : self.error.code, 'FORBIDDEN', 'even ADMIN cannot process their own request');
      const allowed = await independent.authorize(action, root);
      assert.equal(allowed.ok, true);
      if (allowed.ok) assert.equal(allowed.value.requesterId, partner);
    }
    const foreignOwner = `authorization-${randomUUID()}`;
    await tx.user.create({ data: { id: foreignOwner, username: foreignOwner, email: `${foreignOwner}@example.invalid`,
      password: 'not-a-login', firstName: 'Fixture', lastName: 'Authorization' } });
    await tx.partnerProfile.create({ data: { id: foreignOwner, userId: foreignOwner, state: 'ACTIVE' } });
    const foreignCase = await seedAuthorizationCase(tx, foreignOwner);
    const forged = await independent.authorize('FINANCIAL_PROCESS', { kind: 'CASE', id: foreignCase.id });
    assert.equal(forged.ok ? null : forged.error.status, 404);
  });
});

test('a responder deactivated by a competing transaction cannot pass authorization after the User lock wait', async () => {
  const database = localDatabase(3);
  const partner = `authorization-${randomUUID()}`; const actor = `authorization-${randomUUID()}`;
  const rollback = new Error('rollback retained inquiry');
  function signal() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
  }
  const locked = signal(); const release = signal(); const ready = signal();
  let blocker: Promise<unknown> | undefined; let request: Promise<unknown> | undefined;
  let requestPid = 0;
  let result: Awaited<ReturnType<ReturnType<typeof createPrismaPartnerAuthorization>['authorize']>> | undefined;
  try {
    for (const id of [partner, actor]) await database.user.create({ data: {
      id, username: id, email: `${id}@example.invalid`, password: 'not-a-login', firstName: 'Fixture', lastName: 'Authorization',
    } });
    blocker = database.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${actor} FOR UPDATE`;
      locked.resolve(); await release.promise;
      await tx.user.update({ where: { id: actor }, data: { isActive: false } });
    }, { timeout: 15_000 });
    await Promise.race([locked.promise, blocker.then(() => { throw new Error('Lock fixture ended early'); })]);
    request = database.$transaction(async tx => {
      await tx.partnerProfile.create({ data: { id: partner, userId: partner, state: 'ACTIVE' } });
      const inquiry = await tx.partnerInquiry.create({ data: { profileId: partner } });
      await tx.partnerInquiryAssignment.create({ data: { inquiryId: inquiry.id, revision: 1, responderId: actor,
        actorId: partner, reason: 'انتساب آزمون', eligibilityEvidence: { activeAtAssignment: true } } });
      const [connection] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      requestPid = connection.pid; ready.resolve();
      const port = createPrismaPartnerAuthorization(tx, { actorId: actor, purpose: 'RESPONDER', channel: 'API' }, async () => ({
        authorizationRevision: 1, grants: [{ action: 'INQUIRY_RESPOND', rootKind: 'INQUIRY', purpose: 'RESPONDER', scope: 'ASSIGNED' }],
      }));
      result = await port.authorize('INQUIRY_RESPOND', { kind: 'INQUIRY', id: inquiry.id });
      throw rollback;
    }, { timeout: 15_000 }).catch(error => { if (error !== rollback) throw error; });
    await Promise.race([ready.promise, request.then(() => { throw new Error('Request ended before authorization'); })]);
    for (let attempt = 0; ; attempt++) {
      const [wait] = await database.$queryRaw<Array<{ waiting: boolean }>>`SELECT cardinality(pg_blocking_pids(${requestPid}::integer)) > 0 AS waiting`;
      if (wait.waiting) break;
      if (attempt >= 200) throw new Error('Request never waited for the competing User lock');
      await new Promise(done => setTimeout(done, 10));
    }
    release.resolve(); await Promise.all([blocker, request]);
    assert.equal(result?.ok, false, 'current User activation must defeat historical assignment eligibility');
  } finally {
    release.resolve();
    await Promise.allSettled([blocker, request].filter((item): item is Promise<unknown> => Boolean(item)));
    try { await database.user.deleteMany({ where: { id: { in: [partner, actor] },
      email: { in: [`${partner}@example.invalid`, `${actor}@example.invalid`] } } }); }
    finally { await database.$disconnect(); }
  }
});

test('persisted v2 management uses the same current Profile and grant source without HR or workspace fallback', async () => {
  await fixture(async (tx, partner, actor) => {
    await tx.partnerProfile.create({ data: { id: partner, userId: partner, state: 'PENDING' } });
    const grant = await tx.featurePermission.create({ data: { userId: actor, workspace: 'sales',
      feature: 'fixture-partner-v2-commercial', permissionLevel: 'edit' } });
    const port = createPrismaPartnerAuthorizationV2(tx, { actorId: actor, purpose: 'MANAGEMENT', channel: 'API' }, async () => {
      // Test-only persisted boundary adapter; no production permission mapping.
      const current = await tx.featurePermission.findUniqueOrThrow({ where: { id: grant.id } });
      return { authorizationRevision: 1, grants: current.isActive ? [{ action: 'COMMERCIAL_TERMS_MANAGE',
        rootKind: 'PROFILE', purpose: 'MANAGEMENT', scope: 'COMPANY' }] : [] };
    });
    const root = { kind: 'PROFILE' as const, id: partner };
    assert.equal((await port.authorize('COMMERCIAL_TERMS_MANAGE', root)).ok, true);
    assert.equal((await port.authorize('IDENTITY_VERIFY', root)).ok, false, 'commercial authority never verifies HR identity');
    await tx.featurePermission.update({ where: { id: grant.id }, data: { isActive: false } });
    assert.equal((await port.authorize('COMMERCIAL_TERMS_MANAGE', root)).ok, false);
  });
});
