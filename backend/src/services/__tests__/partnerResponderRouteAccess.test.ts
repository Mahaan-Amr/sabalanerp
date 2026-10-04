import type { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { resolveWorkspaceRouteAvailability } from '../workspaceRouteAvailability';
import { resolvePartnerWorkspaceAuthority } from '../partnerSales/authorization/workspaceAuthority';

const emptyClient = {
  workspacePermission: { findMany: async () => [], findUnique: async () => null },
  roleWorkspacePermission: { findMany: async () => [], findUnique: async () => null },
  featurePermission: { findMany: async () => [], findUnique: async () => null },
  roleFeaturePermission: { findMany: async () => [], findUnique: async () => null },
  hrWorkspaceAccessGrant: { findMany: async () => [] },
  hrFeatureAccessGrant: { findMany: async () => [] },
  partnerProfile: { findUnique: async () => null },
};

const run = async () => {
  for (const featureSource of ['direct', 'role'] as const) {
    for (const granted of [true, false]) {
      const feature = { id: 'responder-grant', workspace: 'sales', feature: 'sales_partner_inquiries_respond',
        permissionLevel: 'edit', isActive: true, expiresAt: null };
      const stub = { ...emptyClient,
        workspacePermission: { findMany: async () => [{ id: 'sales-grant', workspace: 'sales', permissionLevel: 'edit', isActive: true, expiresAt: null }] },
        user: { findUnique: async () => ({ role: 'SALES', isActive: true, partnerProfile: null }) },
        $queryRaw: async (query: TemplateStringsArray) => query.join('').includes('effective_authorization_state') ? [{ revision: 1 }] : [],
        featurePermission: { findMany: async () => granted && featureSource === 'direct' ? [feature] : [] },
        roleFeaturePermission: { findMany: async () => granted && featureSource === 'role' ? [feature] : [] },
      };
      const client = { ...stub, $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(stub) } as unknown as PrismaClient;
      const route = await resolveWorkspaceRouteAvailability(client, { userId: 'any-responder', role: 'SALES', path: '/dashboard/sales/partner-inquiries' });
      assert.equal(route.allowed, granted, `${featureSource} feature grant must admit its responder without a second scoped grant`);
      const authority = await resolvePartnerWorkspaceAuthority(client, 'any-responder');
      assert.equal(authority.canRespondAssigned, granted);
      assert.ok(authority.grants.filter(grant => grant.purpose === 'RESPONDER').every(grant => grant.scope === 'ASSIGNED'));
      const unrelated = await resolveWorkspaceRouteAvailability(client, { userId: 'any-responder', role: 'SALES', path: '/dashboard/sales/partners' });
      assert.equal(unrelated.allowed, false, 'responder access must not grant Partner management access');
    }
  }
  for (const scenario of [
    { name: 'view only', feature: 'sales_partner_inquiries_view', level: 'view', active: true, expiresAt: null, workspace: true, allowed: true, respond: false },
    { name: 'insufficient response level', feature: 'sales_partner_inquiries_respond', level: 'view', active: true, expiresAt: null, workspace: true, allowed: false, respond: false },
    { name: 'revoked response', feature: 'sales_partner_inquiries_respond', level: 'edit', active: false, expiresAt: null, workspace: true, allowed: false, respond: false },
    { name: 'expired response', feature: 'sales_partner_inquiries_respond', level: 'edit', active: true, expiresAt: new Date('2020-01-01'), workspace: true, allowed: false, respond: false },
    { name: 'missing workspace', feature: 'sales_partner_inquiries_respond', level: 'edit', active: true, expiresAt: null, workspace: false, allowed: false, respond: true },
  ]) {
    const stub = { ...emptyClient,
      workspacePermission: { findMany: async () => scenario.workspace ? [{ id: 'sales-grant', workspace: 'sales', permissionLevel: 'edit', isActive: true, expiresAt: null }] : [] },
      user: { findUnique: async () => ({ role: 'SALES', isActive: true, partnerProfile: null }) },
      $queryRaw: async (query: TemplateStringsArray) => query.join('').includes('effective_authorization_state') ? [{ revision: 1 }] : [],
      featurePermission: { findMany: async () => [{ id: 'feature-grant', workspace: 'sales', feature: scenario.feature,
        permissionLevel: scenario.level, isActive: scenario.active, expiresAt: scenario.expiresAt }] },
    };
    const client = { ...stub, $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(stub) } as unknown as PrismaClient;
    const route = await resolveWorkspaceRouteAvailability(client, { userId: 'any-responder', role: 'SALES', path: '/dashboard/sales/partner-inquiries' });
    assert.equal(route.allowed, scenario.allowed, scenario.name);
    const authority = await resolvePartnerWorkspaceAuthority(client, 'any-responder');
    assert.equal(authority.canRespondAssigned, scenario.respond, scenario.name);
  }
  console.log('Partner responder route access tests passed.');
};
void run();
