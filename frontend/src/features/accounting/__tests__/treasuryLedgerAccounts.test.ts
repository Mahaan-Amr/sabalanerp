import assert from 'node:assert/strict';
import test from 'node:test';
import { treasuryLedgerAccounts } from '../treasuryLedgerAccounts';

test('treasury uses actual nested ledger context and isolates the selected book', () => {
  const cash = { id: 'cash', level: 'MOIN', financialAccountRequirement: 'REQUIRED' };
  const advance = { id: 'advance', level: 'MOIN', partyRequirement: 'REQUIRED' };
  const other = { id: 'other-book-cash', level: 'MOIN', financialAccountRequirement: 'REQUIRED' };
  const context = { books: [{ id: 'primary', accounts: [cash, advance] }, { id: 'other', accounts: [other] }] };
  assert.deepEqual(treasuryLedgerAccounts(context, 'primary').filter(x => x.financialAccountRequirement === 'REQUIRED'), [cash]);
  assert.deepEqual(treasuryLedgerAccounts(context, 'primary').filter(x => x.partyRequirement === 'REQUIRED'), [advance]);
  assert.deepEqual(treasuryLedgerAccounts(context, 'other'), [other]);
  assert.deepEqual(treasuryLedgerAccounts(context, ''), []);
  assert.deepEqual(treasuryLedgerAccounts(context, 'missing'), []);
  assert.deepEqual(treasuryLedgerAccounts(undefined, 'primary'), []);
});
