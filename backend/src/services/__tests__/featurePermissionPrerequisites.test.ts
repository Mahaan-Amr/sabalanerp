import assert from 'node:assert/strict';
import { expandFeaturePrerequisites, featurePrerequisites } from '../featurePermissionPrerequisites';

const features = [
  'sales_contracts_view',
  'sales_contracts_create',
  'sales_contracts_edit',
  'sales_contracts_delete',
  'accounting_dashboard_view',
  'accounting_payments_manage',
];

assert.deepEqual(featurePrerequisites('sales_contracts_edit', features), ['sales_contracts_view']);
assert.deepEqual(featurePrerequisites('sales_contracts_create', features), ['sales_contracts_view']);
assert.deepEqual(featurePrerequisites('sales_contracts_view', features), []);
assert.deepEqual(featurePrerequisites('accounting_payments_manage', features), ['accounting_dashboard_view']);
assert.deepEqual(featurePrerequisites('logistics_loadings_finalize', [
  'logistics_dashboard_view', 'logistics_loadings_view', 'logistics_loadings_finalize',
]), ['logistics_loadings_view']);
assert.deepEqual(expandFeaturePrerequisites(['sales_contracts_edit'], features), [
  'sales_contracts_view', 'sales_contracts_edit',
]);

console.log('Feature permission prerequisite tests passed.');
