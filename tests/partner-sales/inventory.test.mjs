import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverPages, buildInventory } from './harness/inventory.mjs';

test('route inventory discovers dynamic and nested routes without claiming coverage', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'partner-inventory-'));
  try {
    await mkdir(path.join(root, 'dashboard/sales/[id]'), { recursive: true });
    await writeFile(path.join(root, 'dashboard/sales/[id]/page.tsx'), '');
    assert.deepEqual(await discoverPages(root), ['/dashboard/sales/[id]']);
    await mkdir(path.join(root, 'dashboard/hr'), { recursive: true });
    await writeFile(path.join(root, 'dashboard/hr/page.tsx'), '');
    assert.deepEqual(await discoverPages(root), ['/dashboard/hr', '/dashboard/sales/[id]']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('every discovered route and permission has an owner and explicit untested outcome', async () => {
  const inventory = await buildInventory();
  assert.ok(inventory.routes.some((row) => row.route === '/dashboard/sales/contracts/create'));
  assert.ok(inventory.routes.some((row) => row.app === 'inquiry'));
  assert.ok(inventory.routes.some((row) => row.route === '/admin/import/export/xlsx' && row.kind === 'http-handler'));
  assert.ok(inventory.actions.some((row) => row.action === 'inquiry:admin/actions.ts#createUserAction'));
  assert.ok(inventory.actions.some((row) => row.action === 'sales_contracts_create'));
  for (const row of [...inventory.routes, ...inventory.actions]) {
    assert.ok(row.owner && row.roles.length && row.reason);
    assert.ok(['blocked', 'not-applicable'].includes(row.status));
  }
});
