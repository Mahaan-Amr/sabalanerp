import assert from 'node:assert/strict';
import { destinationDutyHref } from './dutyDestination';

assert.equal(destinationDutyHref('sales', {
  id: 'duty-1',
  status: 'OPEN',
  sourceActionCode: 'SALES_EDIT_CONTRACT_CORRECTION',
  destinationHref: '/dashboard/sales/contracts/contract-1/edit',
}), '/dashboard/sales/contracts/contract-1/edit');

assert.equal(destinationDutyHref('sales', {
  id: 'duty-1',
  status: 'COMPLETED',
  sourceActionCode: 'SALES_EDIT_CONTRACT_CORRECTION',
  destinationHref: '/dashboard/sales/contracts/contract-1/edit',
}), '/dashboard/sales/duties/duty-1');

assert.equal(destinationDutyHref('accounting', {
  id: 'duty-2',
  status: 'OPEN',
  sourceActionCode: 'ACCOUNTING_DECIDE_CONTRACT_CORRECTION',
  destinationHref: null,
}), '/dashboard/accounting/duties/duty-2');

assert.equal(destinationDutyHref('sales', {
  id: 'duty-3',
  status: 'OPEN',
  sourceActionCode: 'SALES_EDIT_CONTRACT_CORRECTION',
  destinationHref: '/dashboard/accounting/contracts/contract-1',
}), '/dashboard/sales/duties/duty-3');

console.log('cross-workspace duty destination tests passed');
