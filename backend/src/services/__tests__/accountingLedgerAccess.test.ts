import assert from 'node:assert/strict';
import { requireWorkspaceAccessWithClient, WORKSPACES, WORKSPACE_PERMISSIONS } from '../../middleware/workspace';
import { accountingAccessProfileFromPermission } from '../accountingLedgerFoundation';

const run = async (role: string, permissionLevel?: 'view' | 'edit' | 'admin') => {
  const database = {
    workspacePermission: { findUnique: async () => permissionLevel ? { permissionLevel, isActive: true, expiresAt: null } : null },
    roleWorkspacePermission: { findUnique: async () => null },
  } as any;
  const middleware = requireWorkspaceAccessWithClient(database, WORKSPACES.ACCOUNTING, WORKSPACE_PERMISSIONS.EDIT);
  return new Promise<'next' | number>((resolve, reject) => {
    const response: any = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json() { resolve(this.statusCode); } };
    middleware({ user: { id: 'کاربر-آزمون', role } } as any, response, () => resolve('next')).catch(reject);
  });
};

const verify = async () => {
  assert.equal(await run('ADMIN'), 403, 'نقش فنی مدیر سامانه نباید دسترسی مالی ضمنی داشته باشد');
  assert.equal(await run('ADMIN', 'admin'), 'next');
  assert.equal(await run('USER', 'edit'), 'next');
  assert.equal(await run('USER', 'view'), 403);
  assert.equal(accountingAccessProfileFromPermission('view'), 'VIEWER');
  assert.equal(accountingAccessProfileFromPermission('edit'), 'ACCOUNTANT');
  assert.equal(accountingAccessProfileFromPermission('admin'), 'ACCOUNTING_MANAGER');
  assert.notEqual(accountingAccessProfileFromPermission('view'), 'ADMIN', 'مدیر فنی با سطح مشاهده نباید پروفایل اجرایی مدیر بگیرد');
  console.log('accounting access profile tests passed');
};

void verify().catch((error) => { console.error(error); process.exitCode = 1; });
