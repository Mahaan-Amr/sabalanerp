import assert from 'node:assert/strict';
import { deniesDashboardWorkspaceRoute } from './dashboardRouteGuard';

const denied = deniesDashboardWorkspaceRoute({
  workspaceAccessLoading: false,
  currentWorkspace: 'sales',
  taskScopedDutyRoute: false,
  accessibleWorkspaceIds: [],
  routeAllowed: true,
});

assert.equal(denied, false,
  'مجوز صریح مسیر فروش همکار باید نبود دسترسی عمومی فضای فروش را برای همان صفحه پوشش دهد');

assert.equal(deniesDashboardWorkspaceRoute({
  workspaceAccessLoading: false,
  currentWorkspace: 'sales',
  taskScopedDutyRoute: false,
  accessibleWorkspaceIds: [],
  routeAllowed: false,
}), true, 'مسیر ردشده بدون دسترسی عمومی باید بسته بماند');

assert.equal(deniesDashboardWorkspaceRoute({
  workspaceAccessLoading: false,
  currentWorkspace: 'sales',
  taskScopedDutyRoute: false,
  accessibleWorkspaceIds: [],
  routeAllowed: null,
}), true, 'پیش از دریافت تصمیم سرور، مسیر فاقد دسترسی عمومی باید بسته بماند');
console.log('Dashboard route guard tests passed.');
