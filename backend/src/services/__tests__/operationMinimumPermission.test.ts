import assert from 'node:assert/strict';
import test from 'node:test';
import { canEditOperationMinimum, parseOperationMinimum } from '../operationMinimumPermission';
import { FEATURES, FEATURE_LABELS, FEATURE_WORKSPACE_MAP } from '../../middleware/feature';
import { featurePrerequisites } from '../featurePermissionPrerequisites';

test('minimum input supports unrestricted values and rejects negative, non-finite, excess scale or overflow', () => {
  for (const value of [undefined, null, '', 0, '0.000']) assert.equal(parseOperationMinimum(value), null);
  assert.equal(parseOperationMinimum('12.345')?.toFixed(), '12.345');
  for (const value of [-1, '-1', 'NaN', Infinity, '1.0001', '1000000000000000', {}, true])
    assert.throws(() => parseOperationMinimum(value), /حداقل مقدار باید/);
});
test('Admin and Manager have minimum ownership, ordinary inventory edit does not grant it', async () => {
  const grant = (level: string) => ({ isActive: true, permissionLevel: level });
  const database = (feature: any = null, roleFeature: any = null) => ({
    featurePermission: { findUnique: async () => feature }, roleFeaturePermission: { findUnique: async () => roleFeature },
    workspacePermission: { findUnique: async () => grant('edit') }, roleWorkspacePermission: { findUnique: async () => null },
  }) as any;
  assert.equal(await canEditOperationMinimum({ id: 'admin', role: 'ADMIN' }, database()), true);
  assert.equal(await canEditOperationMinimum({ id: 'manager', role: 'MANAGER' }, database()), true);
  assert.equal(await canEditOperationMinimum({ id: 'seller', role: 'SALES' }, database()), false);
  assert.equal(await canEditOperationMinimum({ id: 'seller', role: 'SALES' }, database(null, grant('edit'))), true);
  assert.equal(await canEditOperationMinimum({ id: 'seller', role: 'SALES' }, database(grant('edit'))), true);
  assert.equal(await canEditOperationMinimum({ id: 'seller', role: 'SALES' }, database(grant('view'), grant('edit'))), false);
});

test('HR definitions expose the independent Persian minimum permission with catalog viewing prerequisites', () => {
  const feature = FEATURES.INVENTORY_OPERATION_MINIMUM_EDIT;
  assert.equal(FEATURE_LABELS[feature], 'تغییر حداقل مقدار ابزار و فرآوری سنگ');
  assert.equal(FEATURE_WORKSPACE_MAP[feature], 'inventory');
  assert.deepEqual(featurePrerequisites(feature, Object.values(FEATURES)), [
    'inventory_sub_services_view', 'inventory_stone_finishings_view',
  ]);
});
