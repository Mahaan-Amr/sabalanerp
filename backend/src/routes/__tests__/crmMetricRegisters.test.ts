import assert from 'node:assert/strict';
import test from 'node:test';
import router, { ordinaryCrmRelatedVisibility } from '../crm';
import { prisma } from '../../lib/prisma';

type RouteLayer = { route?: { path: string; stack: Array<{ handle: Function }> } };
const handler = (path: string) => {
  const route = (router.stack as RouteLayer[]).find(layer => layer.route?.path === path)?.route;
  assert.ok(route);
  return route.stack.at(-1)!.handle;
};

test('overdue register filters before pagination, retains actor/privacy scope, and counts the same population', async () => {
  const originals: Array<() => void> = [];
  const stub = (delegate: any, name: string, implementation: Function) => {
    const original = delegate[name];
    delegate[name] = implementation;
    originals.push(() => { delegate[name] = original; });
  };
  try {
    for (const delegate of [prisma.featurePermission, prisma.roleFeaturePermission, prisma.workspacePermission, prisma.roleWorkspacePermission]) {
      stub(delegate, 'findUnique', async () => null);
    }
    let read: any;
    let count: any;
    let body: any;
    stub(prisma.crmNextAction, 'findMany', async (query: any) => { read = query; return []; });
    stub(prisma.crmNextAction, 'count', async (query: any) => { count = query; return 21; });
    const response = { json(value: any) { body = value; }, status() { return this; } };
    await handler('/next-actions')({ user: { id: 'seller', role: 'USER' }, query: { due: 'overdue', page: '2', limit: '20', status: 'انجام شده' } }, response);
    assert.equal(read.where.status, 'باز');
    assert.equal(read.where.assignedToId, 'seller');
    assert.deepEqual(read.where.OR, ordinaryCrmRelatedVisibility.OR);
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    assert.equal(read.where.dueAt.lt.getTime(), startOfToday.getTime());
    assert.equal(read.skip, 20);
    assert.equal(read.take, 20);
    assert.deepEqual(read.where, count.where);
    assert.deepEqual(body.pagination, { page: 2, limit: 20, total: 21, pages: 2 });
    await handler('/next-actions')({ user: { id: 'admin', role: 'ADMIN' }, query: {} }, response);
    assert.equal(read.where.assignedToId, undefined);
    assert.equal(read.where.dueAt, undefined);
    assert.equal(read.take, 100, 'existing consumers keep their default limit');
  } finally { originals.reverse().forEach(restore => restore()); }
});

test('estimated value drill-down excludes won/lost projects while preserving seller and ordinary-project scope', async () => {
  const originals: Array<() => void> = [];
  const stub = (delegate: any, name: string, implementation: Function) => {
    const original = delegate[name]; delegate[name] = implementation;
    originals.push(() => { delegate[name] = original; });
  };
  try {
    for (const delegate of [prisma.featurePermission, prisma.roleFeaturePermission, prisma.workspacePermission, prisma.roleWorkspacePermission]) stub(delegate, 'findUnique', async () => null);
    let read: any; let count: any;
    stub(prisma.crmPotentialProject, 'findMany', async (query: any) => { read = query; return []; });
    stub(prisma.crmPotentialProject, 'count', async (query: any) => { count = query; return 0; });
    await handler('/potential-projects')({ user: { id: 'seller', role: 'USER' }, query: { scope: 'pipeline' } }, { json() {}, status() { return this; } });
    assert.deepEqual(read.where, { isActive: true, partnerRevision: null, status: { notIn: ['برنده شده', 'از دست رفته'] }, responsibleSellerId: 'seller' });
    assert.deepEqual(read.where, count.where);
  } finally { originals.reverse().forEach(restore => restore()); }
});


test('customer restriction summaries count the authorized filtered population before pagination', async () => {
  const originals: Array<() => void> = [];
  const stub = (delegate: any, name: string, implementation: Function) => {
    const original = delegate[name]; delegate[name] = implementation;
    originals.push(() => { delegate[name] = original; });
  };
  try {
    for (const delegate of [prisma.featurePermission, prisma.roleFeaturePermission, prisma.workspacePermission, prisma.roleWorkspacePermission]) {
      stub(delegate, 'findUnique', async () => null);
    }
    stub(prisma.user, 'findUnique', async () => null);
    let read: any; const counts: any[] = []; let body: any;
    stub(prisma.crmCustomer, 'findMany', async (query: any) => { read = query; return []; });
    stub(prisma.crmCustomer, 'count', async (query: any) => { counts.push(query); return query.where.isBlacklisted ? 23 : query.where.isLocked ? 12 : 203; });
    const response = { json(value: any) { body = value; }, status() { return this; } };
    await handler('/customers')({ user: { id: 'seller', role: 'USER' }, query: { page: '2', limit: '10', search: 'مینا', status: 'Active', isLocked: 'false' } }, response);
    assert.equal(read.skip, 10); assert.equal(read.take, 10);
    assert.deepEqual(counts[0].where, read.where);
    assert.deepEqual(counts[1].where, { ...read.where, isBlacklisted: true });
    assert.deepEqual(counts[2].where, { ...read.where, isLocked: true });
    assert.equal(read.where.partnerOwnerProfileId, null);
    assert.deepEqual(read.where.OR, [{ ownerUserId: 'seller' }, { ownerUserId: null, createdBy: 'seller' }]);
    assert.equal(read.where.status, 'Active'); assert.ok(read.where.AND.length);
    assert.deepEqual(body.summary, { blacklisted: 23, locked: 12 });
    assert.equal(body.pagination.total, 203);
  } finally { originals.reverse().forEach(restore => restore()); }
});
