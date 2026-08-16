import assert from 'node:assert/strict';
import type { RequestHandler } from 'express';
import { prisma } from '../../lib/prisma';
import router from '../hr-authorization';

const registeredRoutes = (router as unknown as {
  stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: RequestHandler }> } }>;
}).stack.flatMap((layer) => layer.route
  ? Object.entries(layer.route.methods)
    .filter(([, enabled]) => enabled)
    .map(([method]) => `${method.toUpperCase()} ${layer.route!.path}`)
  : []);

for (const route of [
  'GET /me',
  'GET /context',
  'POST /workspace-grants',
  'POST /workspace-grants/:id/revoke',
  'POST /feature-grants',
  'POST /feature-grants/:id/revoke',
  'POST /user-access/:userId',
  'POST /business-authorities',
  'POST /business-authorities/:id/revoke',
  'POST /responsibilities',
  'POST /responsibilities/:id/end',
  'POST /destinations',
]) assert.ok(registeredRoutes.includes(route), `missing HR authorization route: ${route}`);

for (const guardedRoute of ['/context', '/user-access/:userId', '/workspace-grants', '/feature-grants']) {
  const layer = (router as unknown as { stack: Array<{ route?: { path: string; stack: unknown[] } }> }).stack
    .find((candidate) => candidate.route?.path === guardedRoute);
  assert.ok(layer && layer.route!.stack.length >= 2, `${guardedRoute} must retain server-side authorization middleware`);
}

for (const historicalMutation of ['/business-authorities', '/business-authorities/:id/revoke', '/responsibilities', '/responsibilities/:id/end', '/destinations']) {
  const layer = (router as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: RequestHandler }> } }> }).stack
    .find((candidate) => candidate.route?.path === historicalMutation);
  assert.equal(layer?.route?.stack[0]?.handle.name, 'legacyAuthorizationReadOnly', `${historicalMutation} must be a read-only historical endpoint`);
}

const verifyContractPermissionsRemainSavableDuringCatalogDrift = async () => {
const userAccessLayer = (router as unknown as {
  stack: Array<{ route?: { path: string; stack: Array<{ handle: RequestHandler }> } }>;
}).stack.find((candidate) => candidate.route?.path === '/user-access/:userId');
assert.ok(userAccessLayer, 'missing user access mutation handler');
const userAccessHandler = userAccessLayer.route!.stack.at(-1)!.handle;
const originalTransaction = prisma.$transaction;
const catalogUpserts: string[] = [];

try {
  (prisma as any).$transaction = async (operation: (tx: any) => Promise<unknown>) => operation({
    user: { findUniqueOrThrow: async () => ({ id: 'qa-user', role: 'USER', isActive: true }) },
    // Reproduces a production catalog that has not yet been fully backfilled.
    hrFeatureCatalog: {
      findMany: async () => [],
      upsert: async ({ where }: any) => { catalogUpserts.push(where.code); return {}; },
    },
    workspacePermission: {
      findMany: async () => [], deleteMany: async () => ({ count: 0 }), upsert: async () => ({}),
    },
    featurePermission: {
      findMany: async () => [], deleteMany: async () => ({ count: 0 }), upsert: async () => ({}),
    },
    hrWorkspaceAccessGrant: {
      findMany: async () => [], update: async () => ({}), create: async () => ({}),
    },
    hrFeatureAccessGrant: {
      findMany: async () => [], update: async () => ({}), create: async () => ({}),
    },
    hrAuthorizationAuditEvent: { create: async () => ({}) },
  });

  await new Promise<void>((resolve, reject) => {
    const req = {
      params: { userId: 'qa-user' },
      body: {
        role: 'USER',
        workspaceLevels: { hr: 'edit' },
        features: [{ key: 'RECORD_PRELIMINARY_DECISION', level: 'edit' }],
        reason: 'تست ذخیره دسترسی',
      },
      user: { id: 'admin-user', role: 'ADMIN' },
    } as any;
    const res = {
      json: (body: any) => {
        try {
          assert.equal(body.success, true);
          resolve();
        } catch (error) { reject(error); }
      },
    } as any;
    userAccessHandler(req, res, (error?: unknown) => error ? reject(error) : resolve());
  });
  assert.deepEqual(new Set(catalogUpserts), new Set([
    'RECRUITMENT_CASES', 'VIEW_INITIAL_INTERVIEW_REPORT', 'RECORD_PRELIMINARY_DECISION',
  ]), 'missing contract features must be repaired before their grants are written');
} finally {
  (prisma as any).$transaction = originalTransaction;
}
};

const verifyActiveWorkspaceGrantsCannotFallOutOfTheContextWindow = async () => {
  const contextLayer = (router as unknown as {
    stack: Array<{ route?: { path: string; stack: Array<{ handle: RequestHandler }> } }>;
  }).stack.find((candidate) => candidate.route?.path === '/context');
  assert.ok(contextLayer, 'missing authorization context handler');
  const contextHandler = contextLayer.route!.stack.at(-1)!.handle;
  const emptyModels = [
    'hrWorkspaceCatalog', 'hrFeatureCatalog', 'hrAuthorityCatalog', 'hrResponsibilityTypeCatalog',
    'hrFeatureAccessGrant', 'hrBusinessAuthorityGrant', 'hrNamedResponsibility',
    'hrResponsibilityDestination', 'hrSeparationOfDutyConstraint', 'hrAuthorizationAuditEvent',
  ] as const;
  const originals = new Map<string, unknown>();
  for (const model of emptyModels) {
    originals.set(model, (prisma as any)[model].findMany);
    (prisma as any)[model].findMany = async () => [];
  }
  originals.set('user', (prisma as any).user.findMany);
  originals.set('hrWorkspaceAccessGrant', (prisma as any).hrWorkspaceAccessGrant.findMany);
  (prisma as any).user.findMany = async () => [{ id: 'qa-user', username: 'qa_hr_manager', firstName: 'نگار', lastName: 'احمدی', role: 'USER' }];
  (prisma as any).hrWorkspaceAccessGrant.findMany = async (args: any) => args?.where?.status === 'ACTIVE'
    ? [{ id: 'active-old-grant', userId: 'qa-user', workspaceCode: 'HUMAN_RESOURCES', level: 'EDIT', status: 'ACTIVE', effectiveFrom: new Date('2025-01-01') }]
    : Array.from({ length: 500 }, (_, index) => ({ id: `recent-revoked-${index}`, userId: 'other-user', status: 'REVOKED' }));

  try {
    await new Promise<void>((resolve, reject) => {
      const req = { user: { id: 'admin-user', role: 'ADMIN' } } as any;
      const res = { json: (body: any) => {
        try {
          assert.ok(body.data.workspaceGrants.some(({ id }: { id: string }) => id === 'active-old-grant'));
          resolve();
        } catch (error) { reject(error); }
      } } as any;
      contextHandler(req, res, (error?: unknown) => error ? reject(error) : resolve());
    });
  } finally {
    for (const model of emptyModels) (prisma as any)[model].findMany = originals.get(model);
    (prisma as any).user.findMany = originals.get('user');
    (prisma as any).hrWorkspaceAccessGrant.findMany = originals.get('hrWorkspaceAccessGrant');
  }
};

void verifyContractPermissionsRemainSavableDuringCatalogDrift()
  .then(verifyActiveWorkspaceGrantsCannotFallOutOfTheContextWindow)
  .then(() => console.log('HR authorization administration route tests passed.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
