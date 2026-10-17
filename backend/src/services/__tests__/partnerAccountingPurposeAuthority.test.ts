import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import { resolvePartnerWorkspaceAuthority } from '../partnerSales/authorization/workspaceAuthority';
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
    featurePermission: { findMany: async (args: any) => features.filter(row =>
      !args?.where?.permissionLevel || row.permissionLevel === args.where.permissionLevel),
      findUnique: async (args: any) => features.find(row => row.feature === args?.where?.userId_workspace_feature?.feature) ?? null },
    roleFeaturePermission: { findMany: async () => [], findUnique: async () => null },
    hrWorkspaceAccessGrant: { findMany: async () => [] }, hrFeatureAccessGrant: { findMany: async () => [] },
    crossWorkspaceDuty: { findMany: async () => [] },
    $queryRaw: async (query: TemplateStringsArray) => query.join('').includes('effective_authorization_state') ? [{ revision: 1 }] : [],
  } as unknown as Prisma.TransactionClient;
  const full = await resolvePartnerWorkspaceAuthority(tx, 'actor');
  const accounting = await resolvePartnerWorkspaceAuthority(tx, 'actor', 'ACCOUNTING');
  assert.deepEqual(accounting.grants, full.grants.filter(grant => grant.purpose === 'ACCOUNTING'));
  assert.deepEqual(accounting.disabledFeatures, full.disabledFeatures);
  if (scenario.role === 'ADMIN') assert(accounting.grants.some(grant => grant.action === 'CREDIT_TERMS_MANAGE' && grant.rootKind === 'PROFILE'));
});
