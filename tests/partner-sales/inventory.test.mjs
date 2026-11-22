import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverPages, buildInventory, extractFeatureActions } from './harness/inventory.mjs';

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
  assert.equal(inventory.routes.find((row) => row.route === '/dashboard/purchasing')?.workspace, 'purchasing');
  assert.ok(inventory.routes.some((row) => row.app === 'inquiry'));
  assert.ok(inventory.routes.some((row) => row.route === '/admin/import/export/xlsx' && row.kind === 'http-handler'));
  assert.ok(inventory.actions.some((row) => row.action === 'inquiry:admin/actions.ts#createUserAction'));
  assert.ok(inventory.actions.some((row) => row.action === 'sales_contracts_create'));
  assert.equal(inventory.actions.find((row) => row.action === 'sales_contracts_create')?.workspace, 'sales');
  assert.equal(inventory.actions.find((row) => row.action === 'accounting_records_approve_void')?.workspace, 'accounting');
  for (const row of [...inventory.routes, ...inventory.actions]) {
    assert.ok(row.owner && row.roles.length && row.reason);
    assert.ok(['blocked', 'not-applicable'].includes(row.status));
  }
});

test('feature extraction fails closed when workspace mapping is missing or unknown', () => {
  const catalog = (mapping) => `export const FEATURES = {\n  SAMPLE: 'sample',\n} as const;\nexport const FEATURE_WORKSPACE_MAP: Record<string, string> = {\n${mapping}\n};`;
  assert.throws(() => extractFeatureActions(catalog('')), /Missing or unknown workspace/);
  assert.throws(() => extractFeatureActions(catalog("  [FEATURES.SAMPLE]: 'unknown',")), /Missing or unknown workspace/);
  assert.throws(() => extractFeatureActions(catalog("  [FEATURES.SAMPLE]: 'sales',").replace("SAMPLE: 'sample'", '...unrecognized')), /unrecognized definition/);
  assert.throws(() => extractFeatureActions(catalog("  // [FEATURES.SAMPLE]: 'sales',")), /Missing or unknown workspace/);
  assert.throws(() => extractFeatureActions(catalog("  [FEATURES.SAMPLE]: 'sales',\n  [FEATURES.SAMPLE]: 'crm',")), /Duplicate workspace mapping/);
  assert.throws(() => extractFeatureActions(catalog("  [FEATURES.SAMPLE]: 'sales',").replace("SAMPLE: 'sample',", "SAMPLE: 'sample',\nSAMPLE: 'sample',")), /Duplicate feature definition/);
  assert.throws(() => extractFeatureActions(catalog("  ...unrecognized,")), /mapping contains an unrecognized definition/);
  assert.equal(extractFeatureActions(catalog("  [FEATURES.SAMPLE]: 'sales',"))[0].workspace, 'sales');
});
