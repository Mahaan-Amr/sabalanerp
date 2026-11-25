import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import express from 'express';
import type { Prisma } from '@prisma/client';
import XLSX from 'xlsx';
import { prisma } from '../../lib/prisma';
import { FEATURES } from '../../middleware/feature';
import { digestToken, SESSION_COOKIE } from '../../services/identitySessionService';
import products from '../products';

const product = {
  id: 'cm32xkazg000108i92sop3lkn',
  code: '0010810450100',
  namePersian: 'تراورتن',
  stoneTypeCode: '01',
  stoneTypeName: 'Travertine',
  stoneTypeNamePersian: 'تراورتن',
  motherLengthValue: '3.250',
  isActive: true,
  isAvailable: true,
  availableInStairContracts: true,
  deletedAt: null,
};

test('mounted products router', async (t) => {
  t.mock.method(console, 'log', () => {});
  function stub<Model extends object, Method extends keyof Model>(
    model: Model,
    method: Method,
    implementation: (...args: never[]) => unknown,
  ) {
    const original = model[method];
    Object.assign(model, { [method]: implementation });
    t.after(() => { Object.assign(model, { [method]: original }); });
  }

  const actors = {
    stats: FEATURES.SALES_PRODUCTS_STATS,
    attributes: FEATURES.SALES_PRODUCTS_ATTRIBUTES,
    read: FEATURES.SALES_PRODUCTS_VIEW,
    template: FEATURES.SALES_PRODUCTS_TEMPLATE,
    export: FEATURES.SALES_PRODUCTS_EXPORT,
    noSales: FEATURES.SALES_PRODUCTS_EXPORT,
  };
  const sessions = new Map(Object.keys(actors).map(actor => [digestToken(actor), actor]));
  stub(prisma.authSession, 'findUnique', async ({ where }: { where: { tokenHash: string } }) => {
    const actor = sessions.get(where.tokenHash);
    if (!actor) return null;
    const future = new Date(Date.now() + 60_000);
    return {
      id: `session-${actor}`,
      lastActivityAt: new Date(),
      idleExpiresAt: future,
      absoluteExpiresAt: future,
      user: { id: actor, role: 'USER', isActive: true, mustChangePassword: false },
    };
  });
  stub(prisma.workspacePermission, 'findUnique', async ({ where }: { where: { userId_workspace: { userId: string; workspace: string } } }) => (
    where.userId_workspace.workspace === 'sales' && where.userId_workspace.userId !== 'noSales'
      ? { isActive: true, permissionLevel: 'view' }
      : null
  ));
  stub(prisma.roleWorkspacePermission, 'findUnique', async () => null);
  stub(prisma.roleFeaturePermission, 'findUnique', async () => null);
  stub(prisma.featurePermission, 'findUnique', async ({ where }: { where: { userId_workspace_feature: { userId: keyof typeof actors; feature: string } } }) => ({
    isActive: true,
    permissionLevel: actors[where.userId_workspace_feature.userId] === where.userId_workspace_feature.feature
      ? 'view'
      : 'none',
  }));
  stub(prisma.product, 'findUnique', async ({ where }: { where: { id: string } }) => (
    where.id === product.id ? product : null
  ));
  stub(prisma.product, 'count', async () => 0);
  const catalog = [
    product,
    { ...product, code: '0010810450200', isActive: false },
    { ...product, code: '0010810450300', deletedAt: new Date() },
    { ...product, code: '0010810450400', stoneTypeCode: '02' },
  ];
  stub(prisma.product, 'findMany', async ({ distinct, where }: Prisma.ProductFindManyArgs) => {
    if (distinct === undefined) {
      return catalog.filter(row =>
        (where?.deletedAt !== null || row.deletedAt === null)
        && (where?.isActive === undefined || row.isActive === where.isActive)
        && (where?.stoneTypeCode === undefined || row.stoneTypeCode === where.stoneTypeCode));
    }
    if (Array.isArray(distinct) && distinct.includes('stoneTypeCode')) {
      return [{
        stoneTypeCode: product.stoneTypeCode,
        stoneTypeName: product.stoneTypeName,
        stoneTypeNamePersian: product.stoneTypeNamePersian,
      }];
    }
    return [];
  });

  const app = express();
  app.use('/api/products', products);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/products`;
  const get = (path: string, actor?: keyof typeof actors) => fetch(base + path, {
    headers: actor ? { cookie: `${SESSION_COOKIE}=${actor}` } : undefined,
    signal: AbortSignal.timeout(3000),
  });

  await t.test('statistics use their own feature grant and return the statistics payload', async () => {
    const response = await get('/stats', 'stats');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      data: {
        totalProducts: 0,
        availableProducts: 0,
        unavailableProducts: 0,
        productsWithPrice: 0,
        productsWithoutPrice: 0,
      },
    });
    assert.equal((await get('/stats', 'read')).status, 403);
  });

  await t.test('attributes use their own feature grant and return the attributes payload', async () => {
    const response = await get('/attributes', 'attributes');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      data: {
        stoneTypes: [{ stoneTypeCode: '01', stoneTypeName: 'Travertine', stoneTypeNamePersian: 'تراورتن' }],
        colors: [],
        finishes: [],
        mines: [],
        qualities: [],
        cuttingDimensions: [],
      },
    });
    assert.equal((await get('/attributes', 'read')).status, 403);
  });

  await t.test('product detail distinguishes existing, absent and invalid IDs using the read grant', async () => {
    const response = await get('/' + product.id, 'read');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, data: product });

    for (const id of ['cm32xkazg000208i92sop3lkn', 'not-a-product-id']) {
      const missing = await get('/' + id, 'read');
      assert.equal(missing.status, 404);
      const payload: unknown = await missing.json();
      assert.ok(typeof payload === 'object' && payload !== null && 'success' in payload);
      assert.equal(payload.success, false);
    }
    assert.equal((await get('/' + product.id, 'stats')).status, 403);
  });

  await t.test('the template uses its own grant and retains the import-compatible workbook', async () => {
    assert.equal((await get('/template')).status, 401);
    assert.equal((await get('/template', 'read')).status, 403);
    assert.equal((await get('/template', 'export')).status, 403);

    const response = await get('/template', 'template');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="product-import-template.xlsx"');
    const workbook = XLSX.read(await response.arrayBuffer(), { type: 'array' });
    assert.deepEqual(workbook.SheetNames, ['محصولات']);
    const sheet = workbook.Sheets['محصولات'];
    assert.equal(sheet.I1.v, 'طول مادر (متر)');
    assert.equal(sheet.Y1.v, 'پله');
    assert.equal(sheet.A2.t, 's');
    assert.equal(sheet.A2.v, '1010810450100');
  });

  await t.test('the export uses its own grant and retains catalog filters and import columns', async () => {
    assert.equal((await get('/export', 'noSales')).status, 403);
    assert.equal((await get('/export', 'read')).status, 403);
    assert.equal((await get('/export', 'template')).status, 403);

    const response = await get('/export?stoneType=01&isActive=true', 'export');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition') ?? '', /^attachment; filename="products-export-\d{4}-\d{2}-\d{2}\.xlsx"$/);
    const workbook = XLSX.read(await response.arrayBuffer(), { type: 'array' });
    assert.deepEqual(workbook.SheetNames, ['محصولات']);
    const sheet = workbook.Sheets['محصولات'];
    assert.equal(sheet.A2.t, 's');
    assert.equal(sheet.A2.v, '0010810450100');
    assert.equal(sheet.I2.v, '3.250');
    assert.equal(sheet.Y2.v, 'بله');
    assert.equal(sheet.A3?.v ?? '', '');

    const includeDeleted = await get('/export?stoneType=01&isActive=true&includeDeleted=true', 'export');
    assert.equal(includeDeleted.status, 200);
    const withDeleted = XLSX.read(await includeDeleted.arrayBuffer(), { type: 'array' });
    assert.equal(withDeleted.Sheets['محصولات'].A3.v, '0010810450300');
  });
});
