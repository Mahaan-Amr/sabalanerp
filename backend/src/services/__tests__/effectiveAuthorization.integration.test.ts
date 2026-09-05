import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { grantScopedAction, revokeScopedAction, resolveScopedActions } from '../effectiveAccessService';

async function fixture(run: (tx: Prisma.TransactionClient, admin: string, actor: string) => Promise<void>) {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '55432' || url.pathname !== '/sabalanerp') {
    throw new Error('Existing sabalanerp-local database required');
  }
  url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '10');
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const rollback = new Error('rollback scoped authority fixture');
  try {
    await db.$transaction(async tx => {
      const admin = `scoped-auth-${randomUUID()}`, actor = `scoped-auth-${randomUUID()}`;
      for (const id of [admin, actor]) await tx.user.create({ data: {
        id, username: id, email: `${id}@example.invalid`, password: 'not-a-login', firstName: 'Fixture', lastName: 'Scoped authority',
        role: id === admin ? 'ADMIN' : 'MANAGER',
      } });
      await run(tx, admin, actor);
      throw rollback;
    }, { timeout: 20_000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await db.$disconnect(); }
}

test('explicit stored action carries its scope and provenance; workspace and MANAGER do not manufacture a grant', async () => {
  await fixture(async (tx, admin, actor) => {
    await tx.workspacePermission.create({ data: { userId: actor, workspace: 'sales', permissionLevel: 'admin' } });
    assert.deepEqual((await resolveScopedActions(tx, actor, 'PARTNER')).grants, []);
    const receipt = await grantScopedAction(tx, { actorId: admin, reason: 'تأیید دامنهٔ دسترسی', correlationId: randomUUID() }, {
      principal: { kind: 'USER', id: actor }, domain: 'PARTNER', action: 'COMMERCIAL_TERMS_MANAGE', rootKind: 'PROFILE',
      purpose: 'MANAGEMENT', scope: 'DEPARTMENT', effect: 'ALLOW',
    });
    const result = await resolveScopedActions(tx, actor, 'PARTNER');
    assert.equal(result.grants.length, 1);
    assert.equal(result.grants[0].scope, 'DEPARTMENT');
    assert.deepEqual(result.grants[0].provenance, { source: 'DIRECT_ACTION', grantId: receipt.id, version: 1 });
    assert.equal(result.grants[0].action, 'COMMERCIAL_TERMS_MANAGE');
    assert.ok(result.authorizationRevision > 1);
  });
});

test('direct narrowing replaces inherited scope, revocation restores only the remaining current role grant', async () => {
  await fixture(async (tx, admin, actor) => {
    const authority = { actorId: admin, reason: 'تغییر دامنه', correlationId: randomUUID() };
    const action = { domain: 'PARTNER', action: 'CASE_READ', rootKind: 'CASE', purpose: 'MANAGEMENT', effect: 'ALLOW' as const };
    await grantScopedAction(tx, authority, { ...action, principal: { kind: 'ROLE', id: 'MANAGER' }, scope: 'COMPANY' });
    const direct = await grantScopedAction(tx, authority, { ...action, principal: { kind: 'USER', id: actor }, scope: 'DEPARTMENT' });
    assert.deepEqual((await resolveScopedActions(tx, actor, 'PARTNER')).grants.map(row => row.scope), ['DEPARTMENT']);
    await revokeScopedAction(tx, authority, direct.id);
    assert.deepEqual((await resolveScopedActions(tx, actor, 'PARTNER')).grants.map(row => row.scope), ['COMPANY']);
    await grantScopedAction(tx, authority, { ...action, effect: 'DENY', principal: { kind: 'USER', id: actor }, scope: 'COMPANY' });
    assert.deepEqual((await resolveScopedActions(tx, actor, 'PARTNER')).grants, []);
  });
});

test('expired and future grants confer no current authority, and provisioning cannot be impersonated by MANAGER', async () => {
  await fixture(async (tx, admin, actor) => {
    const grant = { principal: { kind: 'USER' as const, id: actor }, domain: 'PARTNER', action: 'CASE_READ',
      rootKind: 'CASE', purpose: 'MANAGEMENT', scope: 'COMPANY' as const, effect: 'ALLOW' as const };
    const context = { actorId: admin, reason: 'محدودیت زمانی', correlationId: randomUUID() };
    await assert.rejects(grantScopedAction(tx, { ...context, actorId: actor }, grant), /forbidden/);
    await assert.rejects(grantScopedAction(tx, { ...context, reason: ' ' }, grant), /Reason/);
    await grantScopedAction(tx, context, { ...grant, effectiveFrom: new Date('2000-01-01'), expiresAt: new Date('2000-01-02') });
    await grantScopedAction(tx, context, { ...grant, effectiveFrom: new Date('2999-01-01') });
    assert.deepEqual((await resolveScopedActions(tx, actor, 'PARTNER')).grants, []);
    await tx.partnerProfile.create({ data: { userId: admin, state: 'ACTIVE' } });
    await assert.rejects(grantScopedAction(tx, context, grant), /forbidden/);
  });
});

test('stored grant identity cannot be rewritten or deleted and revocation is repeat-safe', async () => {
  await fixture(async (tx, admin, actor) => {
    const authority = { actorId: admin, reason: 'ثبت اولیه', correlationId: randomUUID() };
    const grant = await grantScopedAction(tx, authority, { principal: { kind: 'USER', id: actor }, domain: 'PARTNER',
      action: 'CASE_READ', rootKind: 'CASE', purpose: 'MANAGEMENT', scope: 'COMPANY', effect: 'ALLOW' });
    await tx.$executeRawUnsafe('SAVEPOINT immutable_grant');
    await assert.rejects(tx.$executeRaw`UPDATE effective_action_grants SET scope = 'DEPARTMENT' WHERE id = ${grant.id}`, /immutable/);
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT immutable_grant');
    await assert.rejects(tx.$executeRaw`DELETE FROM effective_action_grants WHERE id = ${grant.id}`, /retained/);
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT immutable_grant');
    assert.equal((await resolveScopedActions(tx, actor, 'PARTNER')).grants.length, 1);
    assert.equal((await revokeScopedAction(tx, authority, grant.id)).changed, true);
    assert.equal((await revokeScopedAction(tx, authority, grant.id)).changed, false);
    assert.deepEqual((await resolveScopedActions(tx, actor, 'PARTNER')).grants, []);
  });
});

test('an absent direct grant remains stable until command completion, including a competing role-grant insert', async () => {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/sabalanerp') throw new Error('Existing local DB required');
  url.searchParams.set('connection_limit', '3'); url.searchParams.set('pool_timeout', '10');
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const admin = `scoped-auth-${randomUUID()}`, actor = `scoped-auth-${randomUUID()}`;
  const rollback = new Error('rollback retained role grant');
  const signal = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { resolve, promise }; };
  const locked = signal(), release = signal(), writerStarted = signal();
  let reader: Promise<unknown> | undefined, writer: Promise<unknown> | undefined;
  let writerPid = 0, writerFinished = false;
  try {
    for (const id of [admin, actor]) await db.user.create({ data: { id, username: id, email: `${id}@example.invalid`, password: 'not-a-login',
      firstName: 'Fixture', lastName: 'Scoped race', role: id === admin ? 'ADMIN' : 'MANAGER' } });
    reader = db.$transaction(async tx => {
      assert.deepEqual((await resolveScopedActions(tx, actor, 'PARTNER')).grants, []);
      locked.resolve(); await release.promise;
      assert.deepEqual((await resolveScopedActions(tx, actor, 'PARTNER')).grants, []);
    }, { timeout: 15_000 });
    await Promise.race([locked.promise, reader.then(() => { throw new Error('Reader ended early'); })]);
    writer = db.$transaction(async tx => {
      const [pid] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      writerPid = pid.pid; writerStarted.resolve();
      await grantScopedAction(tx, { actorId: admin, reason: 'آزمون هم‌زمانی', correlationId: randomUUID() }, {
        principal: { kind: 'ROLE', id: 'MANAGER' }, domain: 'PARTNER', action: 'CASE_READ', rootKind: 'CASE',
        purpose: 'MANAGEMENT', scope: 'COMPANY', effect: 'ALLOW',
      });
      writerFinished = true;
      throw rollback;
    }, { timeout: 15_000 }).catch(error => { if (error !== rollback) throw error; });
    await Promise.race([writerStarted.promise, writer.then(() => { throw new Error('Writer ended early'); })]);
    let blocked = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      const [state] = await db.$queryRaw<Array<{ waiting: boolean }>>`SELECT cardinality(pg_blocking_pids(${writerPid}::int)) > 0 AS waiting`;
      if (state.waiting) { blocked = true; break; }
      await new Promise(done => setTimeout(done, 10));
    }
    assert.equal(blocked, true, 'competing role grant must wait, despite no existing grant row or common User');
    assert.equal(writerFinished, false);
    release.resolve(); await Promise.all([reader, writer]);
    assert.equal(writerFinished, true);
  } finally {
    release.resolve(); await Promise.allSettled([reader, writer].filter((item): item is Promise<unknown> => Boolean(item)));
    try { await db.user.deleteMany({ where: { id: { in: [admin, actor] }, email: { in: [`${admin}@example.invalid`, `${actor}@example.invalid`] } } }); }
    finally { await db.$disconnect(); }
  }
});
