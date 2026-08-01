import assert from 'node:assert/strict';
import { resolveCoreDashboardSalesAccess } from '../coreDashboardAccess';

const user = { id: 'seller-1', role: 'USER', departmentId: 'sales-dept' };

assert.equal(resolveCoreDashboardSalesAccess({ user, workspacePermissions: [] }), null);
assert.deepEqual(resolveCoreDashboardSalesAccess({
  user,
  workspacePermissions: [{ workspace: 'sales', permission: 'view' }],
}), {
  userId: 'seller-1',
  role: 'USER',
  departmentId: 'sales-dept',
  canManage: false,
  canCompany: false,
});

console.log('core dashboard access tests passed');
