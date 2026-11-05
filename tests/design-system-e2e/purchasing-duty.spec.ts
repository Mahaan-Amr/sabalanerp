import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../backend/node_modules/@prisma/client';
import { createAuthoritativeSession, SESSION_COOKIE } from '../../backend/src/services/identitySessionService';

// Local QA identities and document remain identifiable as test evidence.
const db = new PrismaClient({ datasources: { db: { url: 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?connection_limit=2&pool_timeout=10' } } });
const id = randomUUID(), stone = 'سنگ آزمایش ارجاع';
let sellerId = '', buyerId = '', sellerToken = '', buyerToken = '';
test.beforeAll(async () => {
  const admin = await db.user.findFirstOrThrow({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
  const seller = await db.user.create({ data: { username: `qa-duty-seller-${id}`, email: `seller-duty-${id}@example.invalid`, password: 'unused', role: 'SALES', firstName: 'آزمایش', lastName: 'فروشنده' } });
  const buyer = await db.user.create({ data: { username: `qa-duty-buyer-${id}`, email: `buyer-duty-${id}@example.invalid`, password: 'unused', role: 'USER', firstName: 'آزمایش', lastName: 'خریدار' } });
  sellerId = seller.id; buyerId = buyer.id;
  await db.workspacePermission.createMany({ data: [
    { userId: sellerId, workspace: 'sales', permissionLevel: 'view', grantedBy: admin.id },
    { userId: buyerId, workspace: 'purchasing', permissionLevel: 'edit', grantedBy: admin.id },
  ] });
  sellerToken = (await createAuthoritativeSession(db, sellerId, { userAgent: 'Purchasing duty local QA' })).token;
  buyerToken = (await createAuthoritativeSession(db, buyerId, { userAgent: 'Purchasing duty local QA' })).token;
});
test.afterAll(async () => {
  try { await db.authSession.deleteMany({ where: { userId: { in: [sellerId, buyerId] } } }); await db.user.updateMany({ where: { id: { in: [sellerId, buyerId] } }, data: { isActive: false } }); }
  finally { await db.$disconnect(); }
});
test('assigned supplier inquiry appears in purchasing duties and opens the requested item', async ({ page }) => {
  test.setTimeout(90000);
  await page.context().addCookies([{ name: SESSION_COOKIE, value: sellerToken, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
  const response = await page.request.post('/api/purchasing/commands', { headers: { 'Idempotency-Key': randomUUID() }, data: { type: 'INQUIRY_CREATE', input: { reason: 'stock', stone, unit: 'مترمربع', quantity: '10', ownerId: buyerId } } });
  expect(response.status()).toBe(200);
  const inquiry = (await response.json()).data;
  await page.context().clearCookies();
  await page.context().addCookies([{ name: SESSION_COOKIE, value: buyerToken, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
  await page.goto('/dashboard/purchasing/duties');
  await expect(page.getByText(`استعلام ${stone}`, { exact: true })).toBeVisible();
  const destination = page.locator(`a[href="/dashboard/purchasing/inquiries?document=${inquiry.id}"]`);
  await expect(destination).toBeVisible();
  await destination.click();
  await expect(page.getByRole('heading', { name: stone, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ثبت پیشنهاد تأمین‌کننده', exact: true })).toBeVisible();
});
