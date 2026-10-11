import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createPartnerLifecycleDatabase } from './partnerCaseLifecycleDatabase';
import { resolvePartnerScopedAuthority } from '../partnerSales/authorization/centralAuthority';
import { grantScopedAction, revokeScopedAction } from '../effectiveAuthorization/scopedActions';

test('Accounting view bridges Partner read only and preserves explicit denial and narrower scope', async () => {
  const sourceDatabaseUrl = process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL;
  if (!sourceDatabaseUrl) throw new Error('Existing local database URL required');
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: path.resolve(process.cwd()), sourceDatabaseUrl });
  const database = temporary.client();
  try {
    await database.effectiveAuthorizationState.create({ data: { id: 1, revision: 1 } });
    const actorId = `view-${temporary.runId}`, adminId = `admin-${temporary.runId}`;
    for (const [id, role] of [[actorId, 'USER'], [adminId, 'ADMIN']] as const) await database.user.create({ data: {
      id, username: id, email: `${id}@example.invalid`, password: 'not-a-login', firstName: 'View', lastName: 'Fixture', role } });
    const authority = { actorId: adminId, reason: 'isolated explicit scope test', correlationId: temporary.runId };
    await database.workspacePermission.create({ data: { userId: actorId, workspace: 'accounting', permissionLevel: 'view' } });
    await database.featurePermission.create({ data: { userId: actorId, workspace: 'accounting',
      feature: 'accounting_contracts_view', permissionLevel: 'view', grantedBy: adminId } });
    const read = () => database.$transaction(tx => resolvePartnerScopedAuthority(tx, { actorId, root: { kind: 'CASE', id: 'case-A' } }));
    const bridged = await read();
    assert.ok(bridged.grants.some(row => row.action === 'ACCOUNTING_READ' && row.scope === 'COMPANY'));
    assert.equal(bridged.grants.some(row => row.action === 'ACCOUNTING_WRITE'), false);
    const denied = await database.$transaction(tx => grantScopedAction(tx, authority, { principal: { kind: 'USER', id: actorId },
      domain: 'PARTNER', action: 'ACCOUNTING_READ', rootKind: 'CASE', purpose: 'ACCOUNTING', scope: 'COMPANY', effect: 'DENY' }));
    assert.equal((await read()).grants.some(row => row.action === 'ACCOUNTING_READ'), false);
    await database.$transaction(tx => revokeScopedAction(tx, authority, denied.id));
    await database.$transaction(tx => grantScopedAction(tx, authority, { principal: { kind: 'USER', id: actorId },
      domain: 'PARTNER', action: 'ACCOUNTING_READ', rootKind: 'CASE', purpose: 'ACCOUNTING', scope: 'PURPOSE_BOUND', boundRootId: 'case-A', effect: 'ALLOW' }));
    const narrowed = (await read()).grants.filter(row => row.action === 'ACCOUNTING_READ');
    assert.equal(narrowed.length, 1);
    assert.equal(narrowed[0].scope, 'PURPOSE_BOUND');
    assert.equal(narrowed[0].boundRootId, 'case-A');
  } finally { await database.$disconnect(); await temporary.cleanup(); }
});
