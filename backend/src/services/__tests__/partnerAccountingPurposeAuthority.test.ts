import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import { resolvePartnerWorkspaceAuthority } from '../partnerSales/authorization/workspaceAuthority';
import { createFencedPartnerPermissionReader } from '../partnerSales/authorization/fencedPermissionReads';
import { readPartnerCommercialAccountingCapabilities } from '../partnerSales/accounting/capabilities';
import { FEATURES } from '../../middleware/feature';

for (const scenario of [
  { role: 'ADMIN', active: true, partner: false, level: 'admin' },
  { role: 'USER', active: true, partner: false, level: 'view' },
  { role: 'USER', active: true, partner: false, level: 'edit' },
  { role: 'USER', active: true, partner: false, level: 'admin' },
  { role: 'USER', active: false, partner: false, level: 'admin' },
  { role: 'USER', active: true, partner: true, level: 'admin' },
  { role: 'USER', active: true, partner: false, level: 'none' },
  { role: 'USER', active: true, partner: false, level: 'admin', expired: true },
]) test(`Accounting purpose preserves full bridge grants ${JSON.stringify(scenario)}`, async () => {
  let effectiveFeatureReads = 0;
  const workspace = { id: 'workspace', workspace: 'accounting', permissionLevel: scenario.level,
    isActive: true, expiresAt: scenario.expired ? new Date('2020-01-01') : null };
  const features = [FEATURES.ACCOUNTING_CONTRACTS_VIEW, FEATURES.ACCOUNTING_INVOICE_CANDIDATES_MANAGE,
    FEATURES.ACCOUNTING_CORRECTIONS_MANAGE, FEATURES.ACCOUNTING_CORRECTIONS_APPROVE,
    FEATURES.ACCOUNTING_CORRECTIONS_VERIFY, FEATURES.ACCOUNTING_PARTNER_TERMS_MANAGE].map(feature => ({
    id: feature, workspace: 'accounting', feature, permissionLevel: scenario.level,
    isActive: true, expiresAt: workspace.expiresAt,
  }));
  const tx = {
    user: { findUnique: async () => ({ id: 'actor', role: scenario.role, isActive: scenario.active,
      partnerProfile: scenario.partner ? { id: 'profile' } : null }) },
    partnerProfile: { findUnique: async () => null },
    workspacePermission: { findMany: async () => [workspace], findUnique: async () => workspace },
    roleWorkspacePermission: { findMany: async () => [], findUnique: async () => null },
    featurePermission: { findMany: async (args: any) => {
      if (args?.where?.isActive === true) effectiveFeatureReads++;
      return features.filter(row => !args?.where?.permissionLevel || row.permissionLevel === args.where.permissionLevel);
    },
      findUnique: async (args: any) => features.find(row => row.feature === args?.where?.userId_workspace_feature?.feature) ?? null },
    roleFeaturePermission: { findMany: async () => [], findUnique: async () => null },
    hrWorkspaceAccessGrant: { findMany: async () => [] }, hrFeatureAccessGrant: { findMany: async () => [] },
    crossWorkspaceDuty: { findMany: async () => [] },
    $queryRaw: async (query: TemplateStringsArray) => query.join('').includes('effective_authorization_state') ? [{ revision: 1 }] : [],
  } as unknown as Prisma.TransactionClient;
  const full = await resolvePartnerWorkspaceAuthority(tx, 'actor');
  effectiveFeatureReads = 0;
  const accounting = await resolvePartnerWorkspaceAuthority(tx, 'actor', 'ACCOUNTING', { fencedPermissionReads: true });
  assert.deepEqual(accounting.grants, full.grants.filter(grant => grant.purpose === 'ACCOUNTING'));
  assert.deepEqual(accounting.disabledFeatures, full.disabledFeatures);
  assert.equal(effectiveFeatureReads, scenario.active && !scenario.partner ? 1 : 0,
    'Accounting resolves permission rows once per decision');
  if (scenario.role === 'ADMIN') assert(accounting.grants.some(grant => grant.action === 'CREDIT_TERMS_MANAGE' && grant.rootKind === 'PROFILE'));
  if (scenario.role === 'USER' && scenario.active && !scenario.partner && scenario.level === 'admin' && !scenario.expired) {
    assert(accounting.grants.some(grant => grant.action === 'ACCOUNTING_READ'));
    workspace.expiresAt = new Date('2020-01-01');
    for (const feature of features) feature.expiresAt = workspace.expiresAt;
    const expired = await resolvePartnerWorkspaceAuthority(tx, 'actor', 'ACCOUNTING', { fencedPermissionReads: true });
    assert.equal(expired.grants.some(grant => grant.action === 'ACCOUNTING_READ'), false,
      'the next decision must not reuse rows from a previous decision');
  }
});

test('a permission expiring during one fenced Accounting resolution is re-evaluated', async t => {
  const start = Date.UTC(2026, 0, 1);
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const workspace = { id: 'workspace', workspace: 'accounting', permissionLevel: 'admin',
    isActive: true, expiresAt: new Date(start + 10) };
  let actorReads = 0;
  const tx = {
    user: { findUnique: async () => {
      if (++actorReads === 2) t.mock.timers.tick(20);
      return { id: 'actor', role: 'USER', isActive: true, partnerProfile: null };
    } },
    workspacePermission: { findMany: async () => [workspace], findUnique: async () => workspace },
    roleWorkspacePermission: { findMany: async () => [], findUnique: async () => null },
    featurePermission: { findMany: async () => [], findUnique: async () => null },
    roleFeaturePermission: { findMany: async () => [], findUnique: async () => null },
    hrWorkspaceAccessGrant: { findMany: async () => [] }, hrFeatureAccessGrant: { findMany: async () => [] },
  } as unknown as Prisma.TransactionClient;
  const authority = await resolvePartnerWorkspaceAuthority(tx, 'actor', 'ACCOUNTING', { fencedPermissionReads: true });
  assert.equal(authority.grants.some(grant => grant.action === 'ACCOUNTING_READ'), false);
});

test('fenced Accounting decisions re-evaluate a narrow denial after expiry while reusing its permission rows', async t => {
  const start = Date.UTC(2026, 0, 1);
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const workspace = { id: 'workspace', workspace: 'accounting', permissionLevel: 'admin',
    isActive: true, expiresAt: null };
  const denial = { id: 'denial', workspace: 'accounting', feature: FEATURES.ACCOUNTING_ACTIONS_MANAGE,
    permissionLevel: 'none', isActive: true, expiresAt: new Date(start + 10) };
  let effectiveFeatureReads = 0;
  const tx = {
    user: { findUnique: async () => ({ role: 'USER', isActive: true, partnerProfile: null }) },
    workspacePermission: { findMany: async () => [workspace], findUnique: async () => workspace },
    roleWorkspacePermission: { findMany: async () => [], findUnique: async () => null },
    featurePermission: {
      findMany: async ({ where }: { where: { isActive?: boolean } }) => {
        if (where.isActive) effectiveFeatureReads++;
        return [denial];
      },
      findUnique: async ({ where }: { where: { userId_workspace_feature: { feature: string } } }) =>
        where.userId_workspace_feature.feature === denial.feature ? denial : null,
    },
    roleFeaturePermission: { findMany: async () => [], findUnique: async () => null },
    hrWorkspaceAccessGrant: { findMany: async () => [] }, hrFeatureAccessGrant: { findMany: async () => [] },
  } as unknown as Prisma.TransactionClient;

  const options = { fencedPermissionReads: true, permissionClient: createFencedPartnerPermissionReader(tx) };
  const before = await resolvePartnerWorkspaceAuthority(tx, 'actor', 'ACCOUNTING', options);
  assert.deepEqual(before.disabledFeatures, [FEATURES.ACCOUNTING_ACTIONS_MANAGE]);
  assert.equal((await readPartnerCommercialAccountingCapabilities(options.permissionClient, 'actor')).paper, false);

  t.mock.timers.tick(20);
  const after = await resolvePartnerWorkspaceAuthority(tx, 'actor', 'ACCOUNTING', options);
  assert.deepEqual(after.disabledFeatures, []);
  assert.equal((await readPartnerCommercialAccountingCapabilities(options.permissionClient, 'actor')).paper, true);
  assert.equal(effectiveFeatureReads, 1);
});
