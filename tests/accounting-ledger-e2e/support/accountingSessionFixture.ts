import type { Page } from '@playwright/test';

/** Public HTTP session boundary for UI contract tests. No real login or ledger write occurs. */
export async function installAccountingSessionFixture(page: Page) {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const user = { id: 'accounting-ui-fixture', firstName: 'حسابدار', lastName: 'آزمون', role: 'ADMIN', isActive: true };
    const data = path.endsWith('/auth/me') ? user
      : path.endsWith('/auth/login') ? { user, mustChangePassword: false }
      : path.endsWith('/workspace-permissions/user-workspaces') ? [{ workspace: 'accounting', permission: 'admin' }]
      : { items: [], total: 0, notifications: [], unreadCount: 0 };
    return route.fulfill({ json: { success: true, data, ...(path.endsWith('/auth/me') || path.endsWith('/auth/login') ? { session: { id: 'accounting_fixture_session' } } : {}) } });
  });
}
