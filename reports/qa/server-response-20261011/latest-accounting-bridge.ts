import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { resolvePartnerScopedAuthority } from '../../../backend/src/services/partnerSales/authorization/centralAuthority';
import { grantScopedAction, revokeScopedAction } from '../../../backend/src/services/effectiveAuthorization/scopedActions';
const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.hostname, 'postgres');
assert.equal(url.pathname, '/sabalanerp');
const client = new PrismaClient();
const rollback = new Error('ROLLBACK_BRIDGE_RELEASE_QA');
async function main() {
  try {
    await assert.rejects(client.$transaction(async tx => {
      const runId = randomUUID();
      const actorId = `qa-view-${runId}`, adminId = `qa-admin-${runId}`;
      for (const [id, role] of [[actorId, 'USER'], [adminId, 'ADMIN']] as const)
        await tx.user.create({ data: { id, username: id, email: `${id}@example.invalid`, password: 'not-login', firstName: 'QA', lastName: 'Bridge', role } });
      await tx.workspacePermission.create({ data: { userId: actorId, workspace: 'accounting', permissionLevel: 'view' } });
      await tx.featurePermission.create({ data: { userId: actorId, workspace: 'accounting', feature: 'accounting_contracts_view', permissionLevel: 'view', grantedBy: adminId } });
      const authority = { actorId: adminId, reason: 'isolated bridge release QA', correlationId: runId };
      const read = () => resolvePartnerScopedAuthority(tx, { actorId, root: { kind: 'CASE' as const, id: 'case-A' } });
      const bridged = await read();
      assert.ok(bridged.grants.some(row => row.action === 'ACCOUNTING_READ' && row.scope === 'COMPANY'));
      assert.equal(bridged.grants.some(row => row.action === 'ACCOUNTING_WRITE'), false);
      const denied = await grantScopedAction(tx, authority, { principal: { kind: 'USER', id: actorId }, domain: 'PARTNER', action: 'ACCOUNTING_READ', rootKind: 'CASE', purpose: 'ACCOUNTING', scope: 'COMPANY', effect: 'DENY' });
      assert.equal((await read()).grants.some(row => row.action === 'ACCOUNTING_READ'), false);
      await revokeScopedAction(tx, authority, denied.id);
      await grantScopedAction(tx, authority, { principal: { kind: 'USER', id: actorId }, domain: 'PARTNER', action: 'ACCOUNTING_READ', rootKind: 'CASE', purpose: 'ACCOUNTING', scope: 'PURPOSE_BOUND', boundRootId: 'case-A', effect: 'ALLOW' });
      const narrowed = (await read()).grants.filter(row => row.action === 'ACCOUNTING_READ');
      assert.equal(narrowed.length, 1); assert.equal(narrowed[0].scope, 'PURPOSE_BOUND'); assert.equal(narrowed[0].boundRootId, 'case-A');
      throw rollback;
    }, { timeout: 30000 }), error => error === rollback);
    console.log('PASS: read-only bridge, no write grant, explicit denial and narrower scope; all fixture writes rolled back');
  } finally { await client.$disconnect(); }
}
main().catch(error => { console.error(error.name + ': ' + error.message); process.exitCode = 1; });
