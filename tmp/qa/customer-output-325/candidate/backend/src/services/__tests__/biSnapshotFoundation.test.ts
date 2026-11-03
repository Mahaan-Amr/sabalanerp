import assert from 'node:assert/strict';
import { resolveBiReportAccess, resolveBiSourceState } from '../biSnapshotService';

const manager = {
  id: 'manager-1',
  role: 'MANAGER',
  departmentId: 'sales-department',
};

assert.deepEqual(
  resolveBiReportAccess({ user: manager, workspacePermission: 'admin' }),
  {
    userId: 'manager-1',
    role: 'MANAGER',
    departmentId: 'sales-department',
    canManage: true,
    canCompany: true,
  },
  'BI workspace admins receive company reporting scope',
);

assert.deepEqual(
  resolveBiReportAccess({ user: manager, workspacePermission: 'view' }),
  {
    userId: 'manager-1',
    role: 'MANAGER',
    departmentId: 'sales-department',
    canManage: true,
    canCompany: false,
  },
  'BI workspace viewers remain department scoped',
);

assert.equal(
  resolveBiReportAccess({
    user: { ...manager, role: 'ADMIN' },
    workspacePermission: 'admin',
  }).canCompany,
  true,
  'global admins retain company reporting scope',
);

assert.deepEqual(
  resolveBiSourceState({ available: true, covered: 18, total: 24 }),
  { state: 'partial', coverage: { covered: 18, total: 24 } },
  'partial sources expose the known coverage instead of claiming a complete total',
);

assert.deepEqual(
  resolveBiSourceState({ available: true, covered: 24, total: 24 }),
  { state: 'complete', coverage: { covered: 24, total: 24 } },
  'fully covered sources are explicitly complete',
);

assert.deepEqual(
  resolveBiSourceState({ available: false, covered: 0, total: 24 }),
  { state: 'unavailable', coverage: null },
  'unavailable sources do not expose a synthetic zero coverage value',
);

assert.deepEqual(
  resolveBiSourceState({ available: true, authorized: false, covered: 18, total: 24 }),
  { state: 'unauthorized', coverage: null },
  'unauthorized sources do not reveal their coverage',
);

console.log('BI snapshot foundation tests passed');
