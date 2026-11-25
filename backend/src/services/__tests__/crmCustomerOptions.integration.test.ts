import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import express from 'express';
import { prisma } from '../../lib/prisma';
import router from '../../routes/crm';
import { createAuthoritativeSession, SESSION_COOKIE } from '../identitySessionService';

const database = new URL(process.env.DATABASE_URL || '');
if (database.hostname !== '127.0.0.1' || database.port !== '55432' || database.pathname !== '/sabalanerp') {
  throw new Error('Existing sabalanerp-local database required');
}

test('customer options search the full authorized population and return a bounded projection', async (context) => {
  const marker = randomUUID();
  const userIds: string[] = [];
  const app = express();
  app.use('/crm', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  async function actor(suffix: string, permitted: boolean) {
    const user = await prisma.user.create({ data: {
      username: marker + suffix, email: marker + suffix + '@example.invalid', role: 'USER',
      firstName: 'آزمون', lastName: suffix, password: 'fixture-only',
    } });
    userIds.push(user.id);
    if (permitted) {
      await prisma.workspacePermission.create({ data: { userId: user.id, workspace: 'crm', permissionLevel: 'view' } });
      await prisma.featurePermission.create({ data: { userId: user.id, workspace: 'crm', feature: 'crm_customers_view', permissionLevel: 'view' } });
    }
    const session = await createAuthoritativeSession(prisma, user.id, { userAgent: 'CRM options integration' });
    return { userId: user.id, cookie: SESSION_COOKIE + '=' + session.token };
  }

  const request = (path: string, cookie?: string) => fetch('http://127.0.0.1:' + address.port + '/crm/' + path,
    { headers: cookie ? { Cookie: cookie } : {} });

  try {
    const seller = await actor('-seller', true);
    const outsider = await actor('-outsider', false);
    const old = await prisma.crmCustomer.create({ data: {
      firstName: 'كيان', lastName: 'نيكي', companyName: marker, ownerUserId: seller.userId,
      createdAt: new Date(0), nationalCode: '1112223334',
      projectAddresses: { create: { address: 'نشانی کامل پروژه' } },
      phoneNumbers: { create: { number: '09123456987', type: 'mobile', isPrimary: true } },
    } });
    const hidden = await prisma.crmCustomer.create({ data: {
      firstName: old.firstName, lastName: old.lastName, companyName: marker, ownerUserId: outsider.userId,
      phoneNumbers: { create: { number: '09123456987', type: 'mobile', isPrimary: true } },
    } });
    await prisma.crmCustomer.createMany({ data: Array.from({ length: 105 }, (_, index) => ({
      firstName: 'نمونه', lastName: String(index), companyName: marker, ownerUserId: seller.userId,
    })) });

    const baselineStart = performance.now();
    // Existing CRM list API, previously requested by this form for its first 100 rows.
    const baseline = await request('customers?limit=100&search=' + marker, seller.cookie);
    assert.equal(baseline.status, 200);
    const baselineBody = await baseline.text();
    const baselineMs = performance.now() - baselineStart;
    const listed = JSON.parse(baselineBody);
    assert.equal(listed.data.length, 100);
    assert.ok(listed.data.every((row: { id: string }) => row.id !== old.id));

    assert.equal((await request('customer-options')).status, 401);
    assert.equal((await request('customer-options', outsider.cookie)).status, 403);
    const params = new URLSearchParams({ search: marker, limit: '10000' });
    const optionsStart = performance.now();
    const options = await request('customer-options?' + params, seller.cookie);
    assert.equal(options.status, 200);
    const optionsBody = await options.text();
    const optionsMs = performance.now() - optionsStart;
    const bounded = JSON.parse(optionsBody);
    assert.equal(bounded.data.length, 30);
    assert.deepEqual(Object.keys(bounded).sort(), ['data', 'success']);
    assert.ok(Buffer.byteLength(optionsBody) < Buffer.byteLength(baselineBody));
    context.diagnostic(JSON.stringify({
      baselineRows: listed.data.length, baselineBytes: Buffer.byteLength(baselineBody), baselineMs: Math.round(baselineMs),
      optionsRows: bounded.data.length, optionsBytes: Buffer.byteLength(optionsBody), optionsMs: Math.round(optionsMs),
    }));

    for (const search of ['کیان نیکی', 'كيان نيكي', '۰۹۱۲۳۴۵۶۹۸۷', '٠٩١٢٣٤٥٦٩٨٧', '09۱۲٣٤56۹۸٧']) {
      const response = await request('customer-options?' + new URLSearchParams({ search }), seller.cookie);
      assert.equal(response.status, 200);
      const { data } = await response.json() as typeof bounded;
      assert.deepEqual(data.map((row: { id: string }) => row.id), [old.id]);
      assert.equal(data[0].phone, '09123456987');
      for (const key of ['contacts', 'projectAddresses', 'nationalCode', '_count']) assert.equal(key in data[0], false);
    }

    const directory = await request('customers?' + new URLSearchParams({ view: 'directory', search: 'کیان نیکی' }), seller.cookie);
    assert.equal(directory.status, 200);
    const directoryBody = await directory.json() as {
      data: Array<{ id: string; projectCount: number; phoneNumbers: { number: string }[] }>;
      pagination: { total: number };
    };
    assert.equal(directoryBody.pagination.total, 1);
    assert.deepEqual(directoryBody.data.map(row => row.id), [old.id]);
    assert.equal(directoryBody.data[0].projectCount, 1);
    assert.equal(directoryBody.data[0].phoneNumbers[0].number, '09123456987');
    assert.equal('projectAddresses' in directoryBody.data[0], false);

    const restored = await request('customer-options?' + new URLSearchParams({ id: old.id }), seller.cookie);
    assert.equal(restored.status, 200);
    assert.equal((await restored.json() as typeof bounded).data[0].id, old.id);
    const denied = await request('customer-options?' + new URLSearchParams({ id: hidden.id }), seller.cookie);
    assert.equal(denied.status, 200);
    assert.deepEqual((await denied.json() as typeof bounded).data, []);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    try {
      await prisma.crmCustomer.deleteMany({ where: { companyName: marker, ownerUserId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.recognizedBrowserProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } finally {
      await prisma.$disconnect();
    }
  }
});
