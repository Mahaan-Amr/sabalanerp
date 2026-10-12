import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { getEffectiveUserAccess } from '../effectiveAccessService';
import { resolveNarrowFeatureAccess } from '../narrowFeatureAccess';
import { FEATURE_WORKSPACE_MAP } from '../../middleware/feature';

test('persisted off decisions defeat direct/role administration across all workspaces, without changing role or levels', async () => {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (!['127.0.0.1', 'localhost', 'postgres'].includes(url.hostname) || url.pathname !== '/sabalanerp') throw new Error('Existing local database required');
  url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '10');
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const rollback = new Error('rollback isolated authorization QA');
  try {
    await assert.rejects(db.$transaction(async tx => {
      const workspaces = ['sales', 'crm', 'accounting', 'inventory', 'security', 'bi', 'logistics'];
      for (const role of ['USER', 'MANAGER', 'ADMIN'] as const) {
        const id = `checkbox-qa-${randomUUID()}`;
        await tx.user.create({ data: { id, username: id, email: `${id}@example.invalid`, password: 'no-login-test-fixture', firstName: 'Local', lastName: 'QA', role } });
        for (const workspace of workspaces) await tx.workspacePermission.create({ data: { userId: id, workspace, permissionLevel: 'admin' } });
        await tx.hrWorkspaceAccessGrant.create({ data: { stableKey: id, userId: id, workspaceCode: 'HUMAN_RESOURCES', level: 'ADMIN', reason: 'isolated QA', effectiveFrom: new Date('2020-01-01') } });
        await tx.hrFeatureAccessGrant.create({ data: { stableKey: `${id}:personnel`, userId: id, featureCode: 'PERSONNEL', level: 'ADMIN', reason: 'isolated QA', effectiveFrom: new Date('2020-01-01') } });
        const before = await getEffectiveUserAccess(tx, { userId: id, userRole: role });
        for (const workspace of [...workspaces, 'hr']) {
          const feature = workspace === 'hr' ? 'PERSONNEL' : Object.entries(FEATURE_WORKSPACE_MAP).find(([key, value]) => value === workspace && key.endsWith('_view'))![0];
          await tx.featurePermission.upsert({ where: { userId_workspace_feature: { userId: id, workspace, feature } }, create: { userId: id, workspace, feature, permissionLevel: 'none' }, update: { permissionLevel: 'none', isActive: true, expiresAt: null } });
          const denied = await getEffectiveUserAccess(tx, { userId: id, userRole: role });
          assert.equal(denied.features.some(row => row.feature === feature), false, `${role}:${workspace}`);
          assert.deepEqual(denied.workspaces, before.workspaces);
          assert.equal((await tx.user.findUniqueOrThrow({ where: { id } })).role, role);
          if (workspace !== 'hr') assert.equal((await resolveNarrowFeatureAccess(tx, { userId: id, role, workspace, feature, requiredPermission: 'view' })).allowed, false);
          // Tick on removes the durable off override. Existing manager defaults survive.
          await tx.featurePermission.deleteMany({ where: { userId: id, workspace, feature, permissionLevel: 'none' } });
          const restored = await getEffectiveUserAccess(tx, { userId: id, userRole: role });
          assert.equal(restored.features.some(row => row.feature === feature), true);
        }
      }
      // Role-only access stays inherited and follows later role-default edits.
      const inheritedId = `checkbox-inherited-${randomUUID()}`;
      const feature = 'sales_partner_inquiries_view';
      await tx.user.create({ data: { id: inheritedId, username: inheritedId, email: `${inheritedId}@example.invalid`, password: 'no-login-test-fixture', firstName: 'Local', lastName: 'QA', role: 'USER' } });
      const roleKey = { role: 'USER', workspace: 'sales', feature };
      await tx.roleFeaturePermission.upsert({ where: { role_workspace_feature: roleKey }, create: { ...roleKey, permissionLevel: 'view' }, update: { isActive: true, permissionLevel: 'view' } });
      assert.equal((await getEffectiveUserAccess(tx, { userId: inheritedId, userRole: 'USER' })).provenance.features.find(row => row.feature === feature)?.source, 'ROLE_FEATURE');
      await tx.featurePermission.create({ data: { userId: inheritedId, workspace: 'sales', feature, permissionLevel: 'none' } });
      assert.equal((await getEffectiveUserAccess(tx, { userId: inheritedId, userRole: 'USER' })).features.some(row => row.feature === feature), false);
      await tx.featurePermission.deleteMany({ where: { userId: inheritedId, feature, permissionLevel: 'none' } });
      assert.equal((await getEffectiveUserAccess(tx, { userId: inheritedId, userRole: 'USER' })).provenance.features.find(row => row.feature === feature)?.source, 'ROLE_FEATURE');
      await tx.roleFeaturePermission.update({ where: { role_workspace_feature: roleKey }, data: { isActive: false } });
      assert.equal((await getEffectiveUserAccess(tx, { userId: inheritedId, userRole: 'USER' })).features.some(row => row.feature === feature), false);
      assert.equal(await tx.featurePermission.count({ where: { userId: inheritedId } }), 0);
      throw rollback;
    }, { timeout: 60000 }), error => error === rollback);
  } finally { await db.$disconnect(); }
});
