import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createAuthoritativeSession, SESSION_COOKIE } from '../../services/identitySessionService';
import { FEATURES } from '../../middleware/feature';

const url = process.env.LOCAL_QA_DATABASE_URL;
assert.ok(url, 'Use the existing sabalanerp-local database via LOCAL_QA_DATABASE_URL');
const target = new URL(url);
assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(target.hostname) && target.pathname === '/sabalanerp');
const origin = process.env.LOCAL_QA_API_ORIGIN || 'http://127.0.0.1:5000';
assert.ok(['localhost', '127.0.0.1', 'backend'].includes(new URL(origin).hostname));

test('draft save requires an authenticated accountant with the invoice management feature', async () => {
  const db = new PrismaClient({ datasources: { db: { url } } });
  let userId: string | undefined;
  try {
    const key = randomUUID();
    const user = await db.user.create({ data: { username: `draft-auth-${key}`, email: `${key}@draft-auth.invalid`,
      password: 'non-login-fixture', firstName: 'آزمون', lastName: 'مجوز', role: 'USER', isActive: true, mustChangePassword: false } });
    userId = user.id;
    await db.workspacePermission.create({ data: { userId, workspace: 'accounting', permissionLevel: 'edit' } });
    await db.featurePermission.create({ data: { userId, workspace: 'accounting', feature: FEATURES.ACCOUNTING_INVOICE_CANDIDATES_MANAGE, permissionLevel: 'none' } });
    const session = await createAuthoritativeSession(db, userId, { userAgent: 'draft-auth-test', ipAddress: '127.0.0.1' });
    const send = async (cookie?: string) => fetch(`${origin}/api/accounting/actions`, { method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ kind: 'SAVE_INVOICE_DRAFT', invoiceId: `missing-${key}`, systemInvoiceNumber: 'partial', sepidarAmount: '' }) });
    assert.equal((await send()).status, 401);
    const cookie = `${SESSION_COOKIE}=${session.token}`;
    assert.equal((await send(cookie)).status, 403);
    await db.featurePermission.update({ where: { userId_workspace_feature: { userId, workspace: 'accounting', feature: FEATURES.ACCOUNTING_INVOICE_CANDIDATES_MANAGE } }, data: { permissionLevel: 'edit' } });
    const allowed = await send(cookie);
    assert.notEqual(allowed.status, 401);
    assert.notEqual(allowed.status, 403, 'granted user reaches the action validation for the missing invoice');
    assert.ok(allowed.status >= 400 && allowed.status < 500, `missing invoice must be rejected: ${allowed.status}`);
  } finally {
    if (userId) {
      await db.authSession.deleteMany({ where: { userId } });
      await db.recognizedBrowserProfile.deleteMany({ where: { userId } });
      await db.featurePermission.deleteMany({ where: { userId } });
      await db.workspacePermission.deleteMany({ where: { userId } });
      await db.user.deleteMany({ where: { id: userId } });
    }
    await db.$disconnect();
  }
});
