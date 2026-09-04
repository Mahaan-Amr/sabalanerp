import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createPartnerLifecycleDatabase } from './partnerCaseLifecycleDatabase';
import { resolveScopedActions } from '../effectiveAuthorization/scopedActions';

const signal = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

test('Accounting permission replacement and user deletion preserve User-before-authority lock order', async () => {
  const sourceDatabaseUrl = process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL;
  if (!sourceDatabaseUrl) throw new Error('Explicit existing local database URL required');
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: path.resolve(process.cwd()), sourceDatabaseUrl });
  const database = temporary.client();
  try {
    await database.effectiveAuthorizationState.create({ data: { id: 1, revision: 1 } });
    for (const operation of ['REPLACE', 'DELETE_USER'] as const) {
      const actorId = `authority-${temporary.runId}-${operation}`;
      await database.user.create({ data: { id: actorId, username: actorId, email: `${actorId}@example.invalid`,
        password: 'not-a-login', firstName: 'Fence', lastName: 'Fixture' } });
      await database.workspacePermission.create({ data: { userId: actorId, workspace: 'accounting', permissionLevel: 'admin' } });
      const deleted = signal(), userLocked = signal();
      const writer = database.$transaction(async tx => {
        await tx.workspacePermission.deleteMany({ where: { userId: actorId } });
        deleted.resolve();
        await userLocked.promise;
        if (operation === 'REPLACE') {
          await tx.workspacePermission.createMany({ data: [{ userId: actorId, workspace: 'accounting', permissionLevel: 'view' }] });
        } else await tx.user.delete({ where: { id: actorId } });
      }, { timeout: 10_000 });
      // Attach error handlers immediately so a failed barrier cannot become an
      // unhandled rejection. Always release the peer barrier on a failed side.
      const guardedWriter = writer.finally(deleted.resolve);
      await deleted.promise;
      const command = database.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId} FOR UPDATE`;
        userLocked.resolve();
        const decision = await resolveScopedActions(tx, actorId, 'PARTNER');
        assert.ok(decision.authorizationRevision > 0);
      }, { timeout: 10_000 }).finally(userLocked.resolve);
      const results = await Promise.allSettled([guardedWriter, command]);
      for (const result of results) if (result.status === 'rejected') throw result.reason;
      const permission = await database.workspacePermission.findFirst({ where: { userId: actorId } });
      assert.equal(permission?.permissionLevel ?? null, operation === 'REPLACE' ? 'view' : null);
    }
  } finally { await database.$disconnect(); await temporary.cleanup(); }
});
