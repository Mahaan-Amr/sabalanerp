import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createPartnerLifecycleDatabase } from './partnerCaseLifecycleDatabase';
import { resolvePartnerScopedAuthority } from '../partnerSales/authorization/centralAuthority';
import { grantScopedAction, revokeScopedAction } from '../effectiveAuthorization/scopedActions';
import { hasSharedOperationAuthority } from '../partnerSales/authorization/sharedOperationAuthority';
import { readPartnerRouteAuthority } from '../partnerSales/authorization/centralAuthority';

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

test('shared Accounting, Logistics and Guard permissions bridge without duplicate grants and respect narrowing, denial and revocation', async () => {
  const sourceDatabaseUrl = process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL;
  if (!sourceDatabaseUrl) throw new Error('Existing local database URL required');
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: path.resolve(process.cwd()), sourceDatabaseUrl });
  const database = temporary.client();
  try {
    await database.effectiveAuthorizationState.create({ data: { id: 1, revision: 1 } });
    const actorId = `shared-${temporary.runId}`, adminId = `admin-${temporary.runId}`;
    for (const [id, role] of [[actorId, 'USER'], [adminId, 'ADMIN']] as const) await database.user.create({ data: {
      id, username: id, email: `${id}@example.invalid`, password: 'not-a-login', firstName: 'Shared', lastName: 'Fixture', role } });
    const authority = { actorId: adminId, reason: 'isolated permission parity test', correlationId: temporary.runId };
    const read = () => database.$transaction(tx => resolvePartnerScopedAuthority(tx, { actorId, root: { kind: 'CASE', id: 'case-A' } }));
    const feature = async (workspace: string, name: string, permissionLevel = 'edit') => {
      await database.workspacePermission.upsert({ where: { userId_workspace: { userId: actorId, workspace } },
        create: { userId: actorId, workspace, permissionLevel: 'edit' }, update: {} });
      return database.featurePermission.create({ data: { userId: actorId, workspace, feature: name, permissionLevel, grantedBy: adminId } });
    };
    const invoice = await feature('accounting', 'accounting_invoice_candidates_manage');
    assert.ok((await read()).grants.some(row => row.action === 'ACCOUNTING_READ'), 'financial feature reads its internal sources without a duplicate contracts-view grant');
    assert.ok((await read()).grants.some(row => row.action === 'ACCOUNTING_WRITE'));
    assert.equal((await read()).grants.some(row => row.action.startsWith('FINANCIAL_')), false);
    assert.equal(await database.$transaction(tx => hasSharedOperationAuthority(tx, actorId, 'accounting', 'accounting_payments_manage')), false);
    const narrowRead = await database.$transaction(tx => grantScopedAction(tx, authority, { principal: { kind: 'USER', id: actorId },
      domain: 'PARTNER', action: 'ACCOUNTING_READ', rootKind: 'CASE', purpose: 'ACCOUNTING', scope: 'PURPOSE_BOUND', boundRootId: 'case-A', effect: 'ALLOW' }));
    assert.deepEqual((await read()).grants.filter(row => row.action === 'ACCOUNTING_WRITE').map(row => [row.scope, row.boundRootId]), [['PURPOSE_BOUND', 'case-A']]);
    await database.$transaction(tx => revokeScopedAction(tx, authority, narrowRead.id));
    const denyRead = await database.$transaction(tx => grantScopedAction(tx, authority, { principal: { kind: 'USER', id: actorId },
      domain: 'PARTNER', action: 'ACCOUNTING_READ', rootKind: 'CASE', purpose: 'ACCOUNTING', scope: 'COMPANY', effect: 'DENY' }));
    assert.equal((await read()).grants.some(row => row.action === 'ACCOUNTING_WRITE'), false);
    await database.$transaction(tx => revokeScopedAction(tx, authority, denyRead.id));
    await feature('accounting', 'accounting_corrections_manage');
    assert.ok((await read()).grants.some(row => row.action === 'FINANCIAL_PROCESS'));
    assert.equal((await read()).grants.some(row => row.action === 'FINANCIAL_APPROVE'), false);
    await feature('accounting', 'accounting_corrections_approve');
    await feature('accounting', 'accounting_corrections_verify');
    assert.equal((await read()).grants.some(row => row.action === 'FINANCIAL_APPROVE'), false,
      'ordinary manager review remains limited to Accounting workspace administration');
    await database.workspacePermission.update({ where: { userId_workspace: { userId: actorId, workspace: 'accounting' } },
      data: { permissionLevel: 'admin' } });
    for (const action of ['FINANCIAL_PROCESS', 'FINANCIAL_APPROVE', 'FINANCIAL_VERIFY']) {
      assert.ok((await read()).grants.some(row => row.action === action));
    }
    await feature('logistics', 'logistics_loadings_view', 'view');
    const loading = await feature('logistics', 'logistics_loadings_create');
    assert.ok((await read()).grants.some(row => row.action === 'FULFILLMENT_READ'));
    assert.ok((await read()).grants.some(row => row.action === 'FULFILLMENT_WRITE'));
    assert.equal(await database.$transaction(tx => hasSharedOperationAuthority(tx, actorId, 'logistics', 'logistics_loadings_finalize')), false);
    for (const [action, purpose] of [['ACCOUNTING_WRITE', 'ACCOUNTING'], ['FINANCIAL_APPROVE', 'ACCOUNTING'], ['FULFILLMENT_WRITE', 'FULFILLMENT']] as const) {
      const denied = await database.$transaction(tx => grantScopedAction(tx, authority, { principal: { kind: 'USER', id: actorId },
        domain: 'PARTNER', action, rootKind: 'CASE', purpose, scope: 'COMPANY', effect: 'DENY' }));
      assert.equal((await read()).grants.some(row => row.action === action), false);
      await database.$transaction(tx => revokeScopedAction(tx, authority, denied.id));
      const narrowed = await database.$transaction(tx => grantScopedAction(tx, authority, { principal: { kind: 'USER', id: actorId },
        domain: 'PARTNER', action, rootKind: 'CASE', purpose, scope: 'PURPOSE_BOUND', boundRootId: 'case-A', effect: 'ALLOW' }));
      assert.deepEqual((await read()).grants.filter(row => row.action === action).map(row => row.scope), ['PURPOSE_BOUND']);
      await database.$transaction(tx => revokeScopedAction(tx, authority, narrowed.id));
    }
    await database.workspacePermission.update({ where: { userId_workspace: { userId: actorId, workspace: 'accounting' } },
      data: { permissionLevel: 'edit' } });
    await database.featurePermission.update({ where: { id: invoice.id }, data: { permissionLevel: 'view' } });
    assert.equal(await database.$transaction(tx => hasSharedOperationAuthority(tx, actorId, 'accounting', 'accounting_invoice_candidates_manage')), false);
    await database.featurePermission.update({ where: { id: loading.id }, data: { isActive: false } });
    assert.equal((await read()).grants.some(row => row.action === 'FULFILLMENT_WRITE'), false);
    await database.workspacePermission.create({ data: { userId: actorId, workspace: 'security', permissionLevel: 'edit' } });
    assert.ok((await read()).grants.some(row => row.action === 'FULFILLMENT_WRITE'));
    assert.equal(await database.$transaction(tx => hasSharedOperationAuthority(tx, actorId, 'logistics', 'logistics_loadings_create')), false,
      'Guard release authority must not permit Logistics materialization');
    await feature('sales', 'sales_partner_inquiries_view', 'view');
    const denyInquiry = await database.$transaction(tx => grantScopedAction(tx, authority, { principal: { kind: 'USER', id: actorId },
      domain: 'PARTNER', action: 'INQUIRY_READ', rootKind: 'INQUIRY', purpose: 'RESPONDER', scope: 'COMPANY', effect: 'DENY' }));
    assert.equal((await database.$transaction(tx => readPartnerRouteAuthority(tx, actorId, 'PARTNER'))).grants.some(row => row.action === 'INQUIRY_READ'), false);
    await database.$transaction(tx => revokeScopedAction(tx, authority, denyInquiry.id));
    await database.user.update({ where: { id: actorId }, data: { isActive: false } });
    assert.equal((await read()).grants.length, 0);
    const inheritedId = `inherited-${temporary.runId}`;
    await database.user.create({ data: { id: inheritedId, username: inheritedId, email: `${inheritedId}@example.invalid`,
      password: 'not-a-login', firstName: 'Inherited', lastName: 'Fixture', role: 'USER' } });
    await database.roleWorkspacePermission.create({ data: { role: 'USER', workspace: 'accounting', permissionLevel: 'edit' } });
    const inheritedFeature = await database.roleFeaturePermission.create({ data: { role: 'USER', workspace: 'accounting',
      feature: 'accounting_invoice_candidates_manage', permissionLevel: 'edit' } });
    const inherited = () => database.$transaction(tx => resolvePartnerScopedAuthority(tx, { actorId: inheritedId, root: { kind: 'CASE', id: 'case-A' } }));
    assert.ok((await inherited()).grants.some(row => row.action === 'ACCOUNTING_WRITE'), 'role defaults work for any user without an individual Partner grant');
    await database.featurePermission.create({ data: { userId: inheritedId, workspace: 'accounting',
      feature: 'accounting_invoice_candidates_manage', permissionLevel: 'view', grantedBy: adminId } });
    assert.equal((await inherited()).grants.some(row => row.action === 'ACCOUNTING_WRITE'), false, 'a direct lower feature overrides inherited edit');
    await database.roleFeaturePermission.update({ where: { id: inheritedFeature.id }, data: { isActive: false } });
    assert.equal((await inherited()).grants.some(row => row.action === 'ACCOUNTING_WRITE'), false);
  } finally { await database.$disconnect(); await temporary.cleanup(); }
});
