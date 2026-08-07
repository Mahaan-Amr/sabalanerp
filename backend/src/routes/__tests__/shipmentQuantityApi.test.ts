import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createShipmentQuantityRouter } from '../shipment-quantities';

const projection = {
  mode: 'AUDIT_KNOWN_AT' as const,
  cutoff: '2026-08-03T00:00:00.000Z',
  rows: [],
  totalsByUnit: [],
};

test('contract API preserves historical mode and normalized cutoff at the HTTP boundary', async () => {
  const calls: unknown[] = [];
  const app = express();
  app.use(express.json());
  app.use('/api/shipment-quantities', createShipmentQuantityRouter({
    prisma: {} as any,
    authenticate: (_req, _res, next) => next(),
    authorizeView: (_req, _res, next) => next(),
    readProjection: (async (_prisma, scope, options) => {
      calls.push({ scope, options });
      return projection;
    }) as any,
  }));
  const server = app.listen(0);
  try {
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/shipment-quantities/contracts/contract-7?mode=audit-known-at&cutoff=2026-08-03T00:00:00Z`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, data: projection });
    assert.deepEqual(calls, [{ scope: { contractId: 'contract-7' }, options: { mode: 'AUDIT_KNOWN_AT', cutoff: '2026-08-03T00:00:00.000Z' } }]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('API rejects an invalid cutoff without reading projection evidence', async () => {
  let read = false;
  const app = express();
  app.use('/api/shipment-quantities', createShipmentQuantityRouter({
    prisma: {} as any,
    authenticate: (_req, _res, next) => next(),
    authorizeView: (_req, _res, next) => next(),
    readProjection: (async () => { read = true; return projection; }) as any,
  }));
  const server = app.listen(0);
  try {
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/shipment-quantities/customers/customer-2?cutoff=not-a-date`);
    assert.equal(response.status, 400);
    assert.equal(read, false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

const authenticatedAs = (role: string) => (req: any, _res: any, next: any) => {
  req.user = { id: 'user-1', role, email: '', username: '', departmentId: null, isActive: true, mustChangePassword: false };
  next();
};

test('global MANAGER eligibility follows the canonical feature policy', async () => {
  const unavailable = { findUnique: async () => { throw new Error('global role must not query grants'); } };
  const prisma = { workspacePermission: unavailable, roleWorkspacePermission: unavailable, featurePermission: unavailable, roleFeaturePermission: unavailable } as any;
  const app = express();
  app.use('/api/shipment-quantities', createShipmentQuantityRouter({
    prisma, authenticate: authenticatedAs('MANAGER'), readProjection: (async () => projection) as any,
  }));
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/shipment-quantities/contracts/c1`);
    assert.equal(response.status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('canonical workspace fallback grants view and ignores expired direct overrides', async () => {
  const expiredAt = new Date('2026-01-01T00:00:00.000Z');
  const prisma = {
    workspacePermission: { findUnique: async ({ where }: any) => where.userId_workspace.workspace === 'accounting'
      ? { permissionLevel: 'view', isActive: true, expiresAt: null } : null },
    featurePermission: { findUnique: async ({ where }: any) => where.userId_workspace_feature.workspace === 'accounting'
      ? { permissionLevel: 'admin', isActive: true, expiresAt: expiredAt } : null },
    roleWorkspacePermission: { findUnique: async () => null },
    roleFeaturePermission: { findUnique: async () => null },
  } as any;
  const app = express();
  app.use('/api/shipment-quantities', createShipmentQuantityRouter({
    prisma, authenticate: authenticatedAs('ACCOUNTANT'), readProjection: (async () => projection) as any,
  }));
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/shipment-quantities/contracts/c1`);
    assert.equal(response.status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('expired canonical grants do not disclose shipment projection existence', async () => {
  const expired = { permissionLevel: 'view', isActive: true, expiresAt: new Date('2020-01-01T00:00:00.000Z') };
  const prisma = {
    workspacePermission: { findUnique: async () => expired }, featurePermission: { findUnique: async () => expired },
    roleWorkspacePermission: { findUnique: async () => null }, roleFeaturePermission: { findUnique: async () => null },
  } as any;
  const app = express();
  app.use('/api/shipment-quantities', createShipmentQuantityRouter({
    prisma, authenticate: authenticatedAs('ACCOUNTANT'), readProjection: (async () => projection) as any,
  }));
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/shipment-quantities/contracts/secret-contract`);
    assert.equal(response.status, 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
