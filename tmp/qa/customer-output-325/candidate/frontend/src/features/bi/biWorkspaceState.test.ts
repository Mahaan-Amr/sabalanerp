import assert from 'node:assert/strict';
import {
  applyBiFilters,
  beginBiRefresh,
  failBiRefresh,
  resolveBiDestination,
} from './biWorkspaceState';

const run = () => {
  const current = { period: 'month', departmentId: '', sellerId: '' };
  const draft = { period: 'quarter', departmentId: 'sales', sellerId: '' };

  assert.deepEqual(applyBiFilters(current, draft), draft, 'draft filters commit only through Apply');
  assert.deepEqual(
    resolveBiDestination({ pathname: '/dashboard/bi', legacyTab: 'finance' }),
    '/dashboard/bi/collections',
  );
  assert.deepEqual(
    resolveBiDestination({ pathname: '/dashboard/bi/pipeline', legacyTab: null }),
    '/dashboard/bi/pipeline',
  );

  const refreshing = beginBiRefresh({ data: { snapshotVersion: 1 }, error: null, refreshing: false });
  assert.deepEqual(refreshing, { data: { snapshotVersion: 1 }, error: null, refreshing: true });
  assert.deepEqual(
    failBiRefresh(refreshing, 'به‌روزرسانی انجام نشد'),
    { data: { snapshotVersion: 1 }, error: 'به‌روزرسانی انجام نشد', refreshing: false },
    'a refresh failure keeps the last successful snapshot',
  );

  console.log('biWorkspaceState tests passed');
};

run();
