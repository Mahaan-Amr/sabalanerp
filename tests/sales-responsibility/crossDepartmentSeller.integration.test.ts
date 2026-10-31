import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '../../backend/node_modules/@prisma/client';
import { createAuthoritativeSession, SESSION_COOKIE } from '../../backend/src/services/identitySessionService';

const url = process.env.LOCAL_QA_DATABASE_URL;
assert.ok(url, 'Set LOCAL_QA_DATABASE_URL to the existing sabalanerp-local database');
const target = new URL(url);
assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(target.hostname) && target.pathname === '/sabalanerp');
const origin = process.env.LOCAL_QA_API_ORIGIN || 'http://127.0.0.1:5000';
assert.ok(['localhost', '127.0.0.1', 'backend'].includes(new URL(origin).hostname));

test('Amin works on his assigned Management contract without changing department or supplying a reason', async () => {
  const db = new PrismaClient({ datasources: { db: { url } } });
  const users: string[] = [];
  const contracts: string[] = [];
  const departments: string[] = [];
  let customerId: string | undefined;
  const suffix = randomUUID();
  try {
    for (const name of ['مدیریت', 'فروش و بازاریابی']) {
      const row = await db.department.create({ data: { name: `seller-qa-${name}-${suffix}`, namePersian: `${name} آزمون ${suffix}` } });
      departments.push(row.id);
    }
    const actor = async (firstName: string, lastName: string, role: 'ADMIN' | 'USER', departmentId: string, level = 'edit') => {
      const id = randomUUID();
      const row = await db.user.create({ data: { username: `seller-qa-${id}`, email: `${id}@seller-qa.invalid`,
        password: 'non-login-qa-fixture', firstName, lastName, role, departmentId } });
      users.push(row.id);
      await db.workspacePermission.create({ data: { userId: row.id, workspace: 'sales', permissionLevel: level } });
      for (const feature of ['sales_contracts_view', 'sales_contracts_edit', 'sales_contracts_approve', 'sales_dashboard_view', 'sales_payments_view', 'sales_deliveries_view']) {
        await db.featurePermission.create({ data: { userId: row.id, workspace: 'sales', feature, permissionLevel: level } });
      }
      const session = await createAuthoritativeSession(db, row.id, { userAgent: 'cross-department-seller-qa', ipAddress: '127.0.0.1' });
      return { ...row, cookie: `${SESSION_COOKIE}=${session.token}`, token: session.token };
    };
    const ali = await actor('علی', 'بهپور', 'ADMIN', departments[0]);
    const amin = await actor('امین', 'استوار', 'USER', departments[1]);
    const outsider = await actor('فروشنده', 'دیگر', 'USER', departments[1]);
    const manager = await actor('مدیر', 'فروش', 'USER', departments[0], 'admin');
    const viewer = await actor('فروشنده', 'فقط مشاهده', 'USER', departments[1], 'view');
    const customer = await db.crmCustomer.create({ data: { firstName: 'مشتری', lastName: `آزمون-${suffix}`, createdBy: ali.id } });
    customerId = customer.id;
    const project = await db.projectAddress.create({ data: { customerId: customer.id, address: 'نشانی آزمون محلی' } });
    const contractData = { contractKind: 'standard', customerId: customer.id,
      customer: { id: customer.id, firstName: customer.firstName, lastName: customer.lastName },
      projectId: project.id, project: { id: project.id, address: project.address }, products: [],
      payment: { currency: 'تومان', totalContractAmount: 0, payments: [] } };
    const makeContract = async (title: string) => {
      const row = await db.salesContract.create({ data: {
        contractNumber: `QA-SELLER-${randomUUID()}`, title, titlePersian: title, content: `آزمون محلی مسئول فروش برای ${customer.firstName} ${customer.lastName}`, contractData, totalAmount: 0,
        customerId: customer.id, departmentId: departments[0], createdBy: ali.id, responsibleSellerId: ali.id,
        status: 'PENDING_APPROVAL', commercialFlowVersion: 1, commercialRevision: 1, salesApprovalRevision: 1, commercialExpiresAt: new Date('2099-01-01'),
      } });
      contracts.push(row.id); return row;
    };
    const assigned = await makeContract('قرارداد آزمون واگذاری به امین');
    const unrelated = await makeContract('قرارداد غیرمرتبط مدیریت');
    const call = async (user: { cookie: string }, path: string, method = 'GET', body?: unknown, headers = {}) => {
      const response = await fetch(`${origin}/api/sales${path}`, { method,
        headers: { cookie: user.cookie, 'content-type': 'application/json', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, ...(await response.json() as { success: boolean; data: any; error?: string }) };
    };
    assert.equal((await call(amin, `/contracts/${assigned.id}`)).status, 403);
    const reassigned = await call(ali, `/contracts/${assigned.id}/responsible-seller`, 'PUT', { sellerId: amin.id });
    assert.equal(reassigned.status, 200, JSON.stringify(reassigned));
    assert.equal(reassigned.data.responsibleSellerId, amin.id);
    assert.equal(reassigned.data.status, 'PENDING_APPROVAL');
    assert.equal(reassigned.data.salesApprovalRevision, 1);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: amin.id } })).departmentId, departments[1]);
    assert.equal((await db.salesContract.findUniqueOrThrow({ where: { id: assigned.id } })).departmentId, departments[0]);
    const audit = await db.salesContractSellerAudit.findFirstOrThrow({ where: { contractId: assigned.id } });
    assert.equal(audit.previousSellerId, ali.id);
    assert.equal(audit.nextSellerId, amin.id);
    assert.equal(audit.changedBy, ali.id);
    assert.equal((await call(ali, `/contracts/${assigned.id}/responsible-seller`, 'PUT', { sellerId: amin.id })).status, 200);
    assert.equal(await db.salesContractSellerAudit.count({ where: { contractId: assigned.id } }), 1, 'no-op retry adds no duplicate audit');
    const detail = await call(amin, `/contracts/${assigned.id}`);
    assert.equal(detail.status, 200, JSON.stringify(detail));
    assert.equal(detail.data.commercialActions.canEdit, true);
    const list = await call(amin, '/contracts?limit=100');
    assert.equal(list.status, 200);
    assert.ok(list.data.some((row: { id: string }) => row.id === assigned.id));
    assert.ok(!list.data.some((row: { id: string }) => row.id === unrelated.id));
    assert.equal((await call(amin, `/contracts/${unrelated.id}`)).status, 403);
    assert.equal((await call(outsider, `/contracts/${assigned.id}`)).status, 403);
    assert.equal((await call(amin, `/contracts/${assigned.id}/product-graph`)).status, 200);
    assert.equal((await call(amin, `/contracts/${assigned.id}/payments`)).status, 200);
    assert.equal((await call(amin, `/contracts/${assigned.id}/deliveries`)).status, 200);
    assert.equal((await call(outsider, `/contracts/${assigned.id}/payments`)).status, 403);
    assert.equal((await call(outsider, `/contracts/${assigned.id}/deliveries`)).status, 403);
    const managerSellers = await call(manager, '/reports/sellers');
    assert.ok(managerSellers.data.some((row: { id: string }) => row.id === amin.id));
    assert.equal((await call(manager, `/reports/overview?period=all&sellerId=${amin.id}`)).status, 200);
    const salesDepartmentReport = await call(ali, `/reports/overview?period=all&departmentId=${departments[1]}`);
    assert.ok(!salesDepartmentReport.data.contracts.some((row: { id: string }) => row.id === assigned.id));
    await db.featurePermission.updateMany({ where: { userId: outsider.id, feature: 'sales_contracts_view' }, data: { permissionLevel: 'none' } });
    const ineligible = await call(ali, `/contracts/${unrelated.id}/responsible-seller`, 'PUT', { sellerId: outsider.id });
    assert.equal(ineligible.status, 400);
    assert.match(ineligible.error!, /دسترسی مشاهده/);
    await db.user.update({ where: { id: outsider.id }, data: { isActive: false } });
    assert.equal((await call(ali, `/contracts/${unrelated.id}/responsible-seller`, 'PUT', { sellerId: outsider.id })).status, 400);

    assert.equal((await call(manager, `/contracts/${unrelated.id}/responsible-seller`, 'PUT', { sellerId: amin.id })).status, 400);

    const draftId = `seller-qa-${suffix}`;
    const browserSessionId = `seller-qa-browser-${suffix}`;
    const lease = await call(amin, `/contract-edit-sessions/${draftId}/acquire`, 'POST', {
      contractId: assigned.id, browserSessionId, schemaVersion: 1, baseRevision: 0,
    });
    assert.equal(lease.status, 200, JSON.stringify(lease));
    const editHeaders = { 'x-contract-draft-id': draftId, 'x-contract-browser-session-id': browserSessionId,
      'x-contract-lease-token': lease.data.session.leaseToken, 'x-contract-base-revision': '0' };
    const saved = await call(amin, `/contracts/${assigned.id}`, 'PUT', { titlePersian: 'ویرایش موفق توسط امین' }, editHeaders);
    assert.equal(saved.status, 200, JSON.stringify(saved));
    assert.equal((await call(amin, `/contracts/${assigned.id}`)).data.titlePersian, 'ویرایش موفق توسط امین');
    if (process.env.LOCAL_QA_BROWSER === '1') {
      const { chromium, expect } = await import('@playwright/test');
      const { mkdir } = await import('node:fs/promises');
      const browser = await chromium.launch({ headless: true, channel: 'chrome' });
      const webOrigin = 'http://localhost:3000';
      const artifacts = 'tmp/qa/cross-department-seller';
      await mkdir(artifacts, { recursive: true });
      try {
        const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
        await adminContext.addCookies([{ name: SESSION_COOKIE, value: ali.token, url: webOrigin }]);
        const adminPage = await adminContext.newPage();
        await call(ali, `/contracts/${assigned.id}/responsible-seller`, 'PUT', { sellerId: ali.id });
        await adminPage.goto(`${webOrigin}/dashboard/sales/contracts/${assigned.id}`);
        const picker = adminPage.getByLabel('مسئول فروش جدید', { exact: true });
        await expect(picker).toBeVisible({ timeout: 90000 });
        await picker.selectOption(amin.id);
        await expect(adminPage.getByPlaceholder('دلیل تغییر مسئول (الزامی)')).toHaveCount(0);
        const request = adminPage.waitForResponse(response => response.url().endsWith('/responsible-seller') && response.request().method() === 'PUT');
        await adminPage.getByRole('button', { name: 'ثبت مسئول فروش', exact: true }).click();
        assert.equal((await request).status(), 200);
        await expect(picker).toHaveValue('');
        await adminPage.screenshot({ path: `${artifacts}/admin-assignment-desktop.png`, fullPage: true });
        await adminPage.setViewportSize({ width: 390, height: 844 });
        await picker.selectOption(amin.id);
        await adminPage.getByRole('button', { name: 'ثبت مسئول فروش', exact: true }).scrollIntoViewIfNeeded();
        await adminPage.screenshot({ path: `${artifacts}/admin-assignment-mobile.png` });
        const sellerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await sellerContext.addCookies([{ name: SESSION_COOKIE, value: amin.token, url: webOrigin }]);
        const page = await sellerContext.newPage();
        await page.goto(`${webOrigin}/dashboard/sales/contracts/${assigned.id}`);
        await expect(page.getByRole('heading', { name: 'ویرایش موفق توسط امین', exact: true })).toBeVisible({ timeout: 90000 });
        await page.screenshot({ path: `${artifacts}/amin-contract-desktop.png`, fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: `${artifacts}/amin-contract-mobile.png`, fullPage: true });
        await page.goto(`${webOrigin}/dashboard/sales/contracts/${assigned.id}/edit`);
        await expect(page.getByText('دسترسی ویرایش این قرارداد را ندارید', { exact: false })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'ذخیره تغییرات', exact: true })).toBeVisible({ timeout: 90000 });
        await page.screenshot({ path: `${artifacts}/amin-edit-mobile.png`, fullPage: true });
      } finally { await browser.close(); }
    }
    const report = await call(amin, '/reports/overview?period=all');
    assert.equal(report.status, 200, JSON.stringify(report));
    assert.ok(report.data.contracts.some((row: { id: string }) => row.id === assigned.id));
    assert.ok(!report.data.contracts.some((row: { id: string }) => row.id === unrelated.id));

    await db.salesContract.update({ where: { id: assigned.id }, data: { realizedSellerId: ali.id,
      realizedSellerSource: 'RESPONSIBLE_SELLER_SNAPSHOT', realizedAt: new Date(), realizedAmount: 100 } });
    // Assignment gives resource scope, never feature/workspace authority.
    assert.equal((await call(ali, `/contracts/${assigned.id}/responsible-seller`, 'PUT', { sellerId: viewer.id })).status, 200);
    assert.equal((await call(viewer, `/contracts/${assigned.id}`)).status, 200);
    const preserved = await db.salesContract.findUniqueOrThrow({ where: { id: assigned.id } });
    assert.equal(preserved.realizedSellerId, ali.id);
    assert.equal(String(preserved.realizedAmount), '100');
    assert.equal(preserved.createdBy, ali.id);
    assert.equal(preserved.departmentId, departments[0]);
    assert.equal((await call(viewer, `/contracts/${assigned.id}`, 'PUT', { title: 'forbidden' })).status, 403);
    assert.equal((await call(amin, `/contracts/${assigned.id}`)).status, 403, 'previous owner loses the cross-department exception');
    assert.equal((await call(ali, `/contracts/${assigned.id}/legacy-realized-credit`, 'PUT', { sellerId: amin.id })).status, 400);
    assert.equal((await call(amin, `/contract-edit-sessions/revoked-${suffix}/acquire`, 'POST', {
      contractId: assigned.id, browserSessionId, schemaVersion: 1, baseRevision: 1,
    })).status, 403);
    assert.ok(!(await call(amin, '/reports/overview?period=all')).data.contracts.some((row: { id: string }) => row.id === assigned.id));
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: amin.id } })).departmentId, departments[1]);
    await db.salesContract.update({ where: { id: unrelated.id }, data: { isInactive: true } });
    assert.equal((await call(ali, `/contracts/${unrelated.id}/responsible-seller`, 'PUT', { sellerId: viewer.id })).status, 409);
    console.log('Verified cross-department assignment, audit, list, detail, edit/save/reload, personal report, least privilege and revocation.');
  } finally {
    try {
      await db.salesContractDraftAudit.deleteMany({ where: { ownerUserId: { in: users } } });
      await db.salesContractEditSession.deleteMany({ where: { ownerUserId: { in: users } } });
      await db.accountingAuditLog.deleteMany({ where: { contractId: { in: contracts } } });
      await db.salesContractSellerAudit.deleteMany({ where: { contractId: { in: contracts } } });
      await db.salesContract.deleteMany({ where: { id: { in: contracts } } });
      if (customerId) await db.crmCustomer.delete({ where: { id: customerId } });
      await db.authSession.deleteMany({ where: { userId: { in: users } } });
      await db.recognizedBrowserProfile.deleteMany({ where: { userId: { in: users } } });
      await db.featurePermission.deleteMany({ where: { userId: { in: users } } });
      await db.workspacePermission.deleteMany({ where: { userId: { in: users } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.department.deleteMany({ where: { id: { in: departments } } });
    } finally { await db.$disconnect(); }
  }
});
