import assert from 'node:assert/strict';
import test from 'node:test';
import { accountingGroupHref, accountingNavigationGroups } from '../accountingNavigation';

test('every prior Accounting navigation destination remains reachable through one clear group', () => {
  const links = accountingNavigationGroups.flatMap(group => group.links.map(link => link.href.split('?')[0]));
  const previousDestinations = [
    '/dashboard/accounting/ledger', '/dashboard/accounting/supply-chain',
    '/dashboard/accounting/period-end', '/dashboard/accounting/dispatch',
    '/dashboard/accounting/contracts', '/dashboard/accounting/invoice-candidates',
    '/dashboard/accounting/receivables', '/dashboard/accounting/customer-accounts',
    '/dashboard/accounting/payments', '/dashboard/accounting/treasury',
    '/dashboard/accounting/tax', '/dashboard/accounting/tax-center',
    '/dashboard/accounting/audit', '/dashboard/accounting/performance',
    '/dashboard/accounting/settings',
  ];
  for (const href of previousDestinations) assert(links.includes(href), `${href} disappeared from Accounting navigation`);
  assert.equal(new Set(accountingNavigationGroups.map(group => accountingGroupHref(group.id))).size, accountingNavigationGroups.length);
  assert(accountingNavigationGroups.every(group => group.links.every(link => link.label && link.href.startsWith('/dashboard/accounting/'))));
});
