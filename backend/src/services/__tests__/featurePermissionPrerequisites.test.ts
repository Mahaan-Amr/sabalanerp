import assert from 'node:assert/strict';
import { featurePrerequisites } from '../featurePermissionPrerequisites';

const features = [
  'sales_contracts_view',
  'sales_contracts_create',
  'sales_contracts_edit',
  'sales_contracts_delete',
  'accounting_payments_manage',
];

assert.deepEqual(featurePrerequisites('sales_contracts_edit', features), ['sales_contracts_view']);
assert.deepEqual(featurePrerequisites('sales_contracts_create', features), ['sales_contracts_view']);
assert.deepEqual(featurePrerequisites('sales_contracts_view', features), []);
assert.deepEqual(featurePrerequisites('accounting_payments_manage', features), []);

console.log('Feature permission prerequisite tests passed.');
